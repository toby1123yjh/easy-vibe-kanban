use std::path::PathBuf;

use api_types::{CreateProjectRequest, CreateTaskRequest, Project, Task};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
};
use db::models::{
    integration::IntegrationRequest,
    project::DEFAULT_PROJECT_ID,
    scratch::{ProjectRepoDefaultsData, Scratch, ScratchPayload, ScratchType},
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use super::{IntegrationCaller, authorize_project, request_hash, request_key};
use crate::{DeploymentImpl, error::ApiError, routes::local_remote};

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateExternalProject {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateExternalTask {
    pub title: String,
    pub description: Option<String>,
    pub status_id: Option<Uuid>,
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/projects", post(create_project))
        .route("/projects/{project_id}", get(get_project))
        .route("/projects/{project_id}/tasks", post(create_issue))
        .route("/projects/{project_id}/tasks/{issue_id}", get(get_issue))
}

/// The same resolver is consumed by file access and external workflow creation.
/// The built-in default root contains unrelated sessions and is never a project.
pub async fn project_root(
    deployment: &DeploymentImpl,
    project_id: Uuid,
) -> Result<PathBuf, ApiError> {
    resolve_project_root(&deployment.db().pool, project_id).await
}

pub(crate) async fn resolve_project_root(
    pool: &sqlx::SqlitePool,
    project_id: Uuid,
) -> Result<PathBuf, ApiError> {
    let missing = || {
        ApiError::Conflict("PROJECT_SPACE_REQUIRED: Configure one project directory in VB before calling this endpoint".into())
    };
    if project_id == DEFAULT_PROJECT_ID {
        return Err(missing());
    }
    let defaults = Scratch::find_by_id(pool, project_id, &ScratchType::ProjectRepoDefaults)
        .await?
        .and_then(|scratch| match scratch.payload {
            ScratchPayload::ProjectRepoDefaults(value) => Some(value),
            _ => None,
        });
    let explicit = defaults
        .as_ref()
        .and_then(|d| d.directory_path.as_deref())
        .map(str::trim)
        .filter(|p| !p.is_empty());
    let root = if let Some(path) = explicit {
        PathBuf::from(path)
    } else {
        let mut paths: Vec<String> = sqlx::query_scalar("SELECT r.path FROM repos r JOIN project_repos p ON p.repo_id = r.id WHERE p.project_id = ?")
            .bind(project_id).fetch_all(pool).await?;
        if paths.is_empty() {
            if let Some(defaults) = defaults {
                // Do not silently drop stale repositories and thereby turn an
                // ambiguous multi-repo project into a single-root grant.
                if defaults.repos.len() != 1 {
                    return Err(missing());
                }
                let path: Option<String> =
                    sqlx::query_scalar("SELECT path FROM repos WHERE id = ?")
                        .bind(defaults.repos[0].repo_id)
                        .fetch_optional(pool)
                        .await?;
                paths.push(path.ok_or_else(missing)?);
            }
        }
        if paths.len() != 1 {
            return Err(missing());
        }
        PathBuf::from(paths.remove(0))
    };
    if !root.is_absolute() {
        return Err(missing());
    }
    let root = tokio::fs::canonicalize(root).await.map_err(|_| missing())?;
    if !tokio::fs::metadata(&root)
        .await
        .map_err(|_| missing())?
        .is_dir()
    {
        return Err(missing());
    }
    Ok(root)
}

async fn get_project(
    State(deployment): State<DeploymentImpl>,
    Extension(caller): Extension<IntegrationCaller>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Project>>, ApiError> {
    authorize_project(&deployment.db().pool, &caller, project_id).await?;
    Ok(Json(ApiResponse::success(
        local_remote::get_local_project(&deployment.db().pool, project_id).await?,
    )))
}

async fn create_project(
    State(deployment): State<DeploymentImpl>,
    Extension(caller): Extension<IntegrationCaller>,
    headers: HeaderMap,
    Json(mut input): Json<CreateExternalProject>,
) -> Result<Json<ApiResponse<Project>>, ApiError> {
    input.name = super::validate_name(&input.name)?.to_owned();
    let key = request_key(&headers)?;
    let hash = request_hash(&input)?;
    let setting = deployment
        .config()
        .read()
        .await
        .managed_workspace_root
        .clone();
    let root = setting
        .filter(|p| !p.trim().is_empty())
        .map(|p| PathBuf::from(p.trim()))
        .unwrap_or_else(|| utils::assets::asset_dir().join("workspaces"));
    let root = if root.is_absolute() {
        root
    } else {
        std::env::current_dir()?.join(root)
    };
    let project_id =
        create_project_record(&deployment.db().pool, &caller, &input, &key, &hash, root).await?;
    get_project(State(deployment), Extension(caller), Path(project_id)).await
}

async fn create_project_record(
    pool: &sqlx::SqlitePool,
    caller: &IntegrationCaller,
    input: &CreateExternalProject,
    key: &str,
    hash: &str,
    root: PathBuf,
) -> Result<Uuid, ApiError> {
    let root_json = serde_json::to_string(&root)
        .map_err(|_| ApiError::BadRequest("Invalid allocation root".into()))?;
    // Persist identity/root BEFORE touching the filesystem. A retry captures
    // neither another UUID nor a changed configured root.
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let request = IntegrationRequest::reserve(
        &mut tx,
        caller.id,
        "project.create",
        "",
        key,
        hash,
        Some(&root_json),
    )
    .await?;
    if request.request_hash != hash {
        return Err(ApiError::Conflict(
            "IDEMPOTENCY_CONFLICT: Request key was used with different parameters".into(),
        ));
    }
    tx.commit().await?;
    if request.state == "complete" {
        authorize_project(pool, caller, request.resource_id).await?;
        return Ok(request.resource_id);
    }
    let root: PathBuf = serde_json::from_str(
        request
            .context_json
            .as_deref()
            .ok_or_else(|| ApiError::Conflict("Project allocation record is incomplete".into()))?,
    )
    .map_err(|_| ApiError::Conflict("Project allocation record is invalid".into()))?;
    tokio::fs::create_dir_all(&root).await?;
    let root = tokio::fs::canonicalize(root).await?;
    let child = format!("project-{}", request.resource_id);
    // Handle-scoped allocation cannot follow a replaced child/junction outside
    // this captured root. No cleanup ever removes retained user files.
    let root_handle = cap_std::fs::Dir::open_ambient_dir(&root, cap_std::ambient_authority())?;
    match root_handle.create_dir(&child) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(ApiError::Io(error)),
    }
    let child_meta = root_handle.symlink_metadata(&child)?;
    if !child_meta.is_dir() || child_meta.file_type().is_symlink() {
        return Err(ApiError::Conflict(
            "Project allocation directory was replaced".into(),
        ));
    }
    let child_handle = root_handle.open_dir(&child)?;
    let directory = root.join(&child);
    let payload = serde_json::to_string(&ScratchPayload::ProjectRepoDefaults(
        ProjectRepoDefaultsData {
            repos: Vec::new(),
            directory_path: Some(directory.to_string_lossy().into_owned()),
        },
    ))
    .map_err(|_| ApiError::BadRequest("Invalid project directory".into()))?;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let current =
        IntegrationRequest::reserve(&mut tx, caller.id, "project.create", "", key, hash, None)
            .await?;
    if current.state != "complete" {
        // Recheck enabled status under the publication transaction.
        let enabled: bool =
            sqlx::query_scalar("SELECT enabled FROM external_integrations WHERE id = ?")
                .bind(caller.id)
                .fetch_one(&mut *tx)
                .await?;
        if !enabled {
            return Err(ApiError::Unauthorized);
        }
        let staged = crate::routes::project_store::create_in(
            &mut tx,
            &directory,
            CreateProjectRequest {
                id: Some(request.resource_id),
                organization_id: Uuid::nil(),
                name: input.name.clone(),
                color: "210 80% 52%".into(),
            },
        )
        .await?;
        sqlx::query("INSERT INTO scratch (id, scratch_type, payload) VALUES (?, 'PROJECT_REPO_DEFAULTS', ?) ON CONFLICT(id,scratch_type) DO UPDATE SET payload=excluded.payload").bind(request.resource_id).bind(payload).execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO external_integration_projects (integration_id, project_id) VALUES (?, ?)",
        )
        .bind(caller.id)
        .bind(request.resource_id)
        .execute(&mut *tx)
        .await?;
        IntegrationRequest::complete(&mut tx, caller.id, "project.create", "", key).await?;
        if let Some(staged) = staged {
            staged.publish()?;
        }
    }
    tx.commit().await?;
    drop(child_handle);
    authorize_project(pool, caller, request.resource_id).await?;
    Ok(request.resource_id)
}

async fn get_issue(
    State(deployment): State<DeploymentImpl>,
    Extension(caller): Extension<IntegrationCaller>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<ApiResponse<Task>>, ApiError> {
    authorize_project(&deployment.db().pool, &caller, project_id).await?;
    let issue = local_remote::get_local_issue(&deployment.db().pool, issue_id).await?;
    if issue.project_id != project_id {
        return Err(ApiError::Forbidden(
            "Task is not in the authorized project".into(),
        ));
    }
    Ok(Json(ApiResponse::success(issue)))
}

async fn create_issue(
    State(deployment): State<DeploymentImpl>,
    Extension(caller): Extension<IntegrationCaller>,
    Path(project_id): Path<Uuid>,
    headers: HeaderMap,
    Json(mut input): Json<CreateExternalTask>,
) -> Result<Json<ApiResponse<Task>>, ApiError> {
    let pool = &deployment.db().pool;
    authorize_project(pool, &caller, project_id).await?;
    input.title = input.title.trim().to_owned();
    if input.title.is_empty() {
        return Err(ApiError::BadRequest("Task title is required".into()));
    }
    let key = request_key(&headers)?;
    let hash = request_hash(&input)?;
    let scope = project_id.to_string();
    // Validate/refresh the sole business authority before consulting its index.
    crate::routes::project_store::read(pool, project_id).await?;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let request = IntegrationRequest::reserve(
        &mut tx,
        caller.id,
        "issue.create",
        &scope,
        &key,
        &hash,
        None,
    )
    .await?;
    if request.request_hash != hash {
        return Err(ApiError::Conflict(
            "IDEMPOTENCY_CONFLICT: Request key was used with different parameters".into(),
        ));
    }
    // Keep the reserved identity across file publication / SQLite commit failure.
    tx.commit().await?;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let request = IntegrationRequest::reserve(
        &mut tx,
        caller.id,
        "issue.create",
        &scope,
        &key,
        &hash,
        None,
    )
    .await?;
    if request.state != "complete" {
        let authorized:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM external_integrations i JOIN external_integration_projects p ON p.integration_id=i.id WHERE i.id=? AND i.enabled=1 AND p.project_id=?)").bind(caller.id).bind(project_id).fetch_one(&mut *tx).await?;
        if !authorized {
            return Err(ApiError::Forbidden(
                "Integration project grant was revoked".into(),
            ));
        }
        let status_id: Option<Uuid> = if let Some(status_id) = input.status_id {
            sqlx::query_scalar(
                "SELECT id FROM local_project_statuses WHERE id = ? AND project_id = ?",
            )
            .bind(status_id)
            .bind(project_id)
            .fetch_optional(&mut *tx)
            .await?
        } else {
            sqlx::query_scalar("SELECT id FROM local_project_statuses WHERE project_id = ? AND hidden = 0 ORDER BY sort_order, id LIMIT 1")
                .bind(project_id).fetch_optional(&mut *tx).await?
        };
        let status_id = status_id
            .ok_or_else(|| ApiError::BadRequest("Select a valid project status".into()))?;
        let (_, staged) = local_remote::insert_local_issue(
            &mut tx,
            CreateTaskRequest {
                id: Some(request.resource_id),
                project_id,
                status_id,
                title: input.title,
                description: input.description,
                priority: None,
                start_date: None,
                target_date: None,
                completed_at: None,
                sort_order: 0.0,
                parent_issue_id: None,
                parent_issue_sort_order: None,
                extension_metadata: serde_json::Value::Null,
            },
        )
        .await?;
        IntegrationRequest::complete(&mut tx, caller.id, "issue.create", &scope, &key).await?;
        staged.publish()?;
    }
    tx.commit().await?;
    get_issue(
        State(deployment),
        Extension(caller),
        Path((project_id, request.resource_id)),
    )
    .await
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    use super::*;

    async fn fixture() -> (sqlx::SqlitePool, IntegrationCaller) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        sqlx::migrate!("../db/migrations").run(&pool).await.unwrap();
        let caller = IntegrationCaller { id: Uuid::new_v4() };
        sqlx::query(
            "INSERT INTO external_integrations (id, name, key_digest) VALUES (?, 'test', 'digest')",
        )
        .bind(caller.id)
        .execute(&pool)
        .await
        .unwrap();
        (pool, caller)
    }

    #[tokio::test]
    async fn project_creation_retries_keep_identity_directory_and_local_visibility() {
        let (pool, caller) = fixture().await;
        let root = tempfile::tempdir().unwrap();
        let other_root = tempfile::tempdir().unwrap();
        let input = CreateExternalProject {
            name: "Documents".into(),
        };
        let hash = request_hash(&input).unwrap();
        let id = create_project_record(&pool, &caller, &input, "one", &hash, root.path().into())
            .await
            .unwrap();
        let retry = create_project_record(
            &pool,
            &caller,
            &input,
            "one",
            &hash,
            other_root.path().into(),
        )
        .await
        .unwrap();
        assert_eq!(id, retry);
        let directory = resolve_project_root(&pool, id).await.unwrap();
        assert_eq!(
            directory,
            std::fs::canonicalize(root.path().join(format!("project-{id}"))).unwrap()
        );
        assert_eq!(std::fs::read_dir(other_root.path()).unwrap().count(), 0);
        assert!(!directory.join(".git").exists());
        let project = local_remote::get_local_project(&pool, id).await.unwrap();
        assert_eq!(project.name, "Documents");
        let statuses: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM local_project_statuses WHERE project_id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(statuses, 5);
        let second =
            create_project_record(&pool, &caller, &input, "two", &hash, root.path().into())
                .await
                .unwrap();
        assert_ne!(id, second);
        assert_ne!(
            directory,
            resolve_project_root(&pool, second).await.unwrap()
        );
        assert!(
            create_project_record(
                &pool,
                &caller,
                &input,
                "one",
                "different",
                root.path().into()
            )
            .await
            .is_err()
        );
        sqlx::query(
            "DELETE FROM external_integration_projects WHERE integration_id = ? AND project_id = ?",
        )
        .bind(caller.id)
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            create_project_record(&pool, &caller, &input, "one", &hash, root.path().into())
                .await
                .is_err()
        );
        assert!(directory.exists());
    }

    #[tokio::test]
    async fn failed_allocation_resumes_same_request_without_losing_user_files() {
        let (pool, caller) = fixture().await;
        let root = tempfile::tempdir().unwrap();
        let root_json = serde_json::to_string(&root.path()).unwrap();
        let input = CreateExternalProject {
            name: "Recovered".into(),
        };
        let hash = request_hash(&input).unwrap();
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        let request = IntegrationRequest::reserve(
            &mut tx,
            caller.id,
            "project.create",
            "",
            "retry",
            &hash,
            Some(&root_json),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let directory = root.path().join(format!("project-{}", request.resource_id));
        // Partial filesystem phase succeeded, publication did not.
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("retained.txt"), b"keep me").unwrap();
        let recovered = create_project_record(
            &pool,
            &caller,
            &input,
            "retry",
            &hash,
            root.path().join("new-setting"),
        )
        .await
        .unwrap();
        assert_eq!(recovered, request.resource_id);
        assert_eq!(
            std::fs::read(directory.join("retained.txt")).unwrap(),
            b"keep me"
        );
        assert!(!root.path().join("new-setting").exists());
    }

    #[tokio::test]
    async fn default_project_and_unconfigured_project_never_expose_shared_root() {
        let (pool, _) = fixture().await;
        assert!(
            resolve_project_root(&pool, DEFAULT_PROJECT_ID)
                .await
                .is_err()
        );
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO projects (id, name) VALUES (?, 'unconfigured')")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(resolve_project_root(&pool, id).await.is_err());
    }

    #[tokio::test]
    async fn multiple_repositories_require_an_explicit_root() {
        let (pool, _) = fixture().await;
        let root = tempfile::tempdir().unwrap();
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO projects (id, name) VALUES (?, 'multi')")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        for name in ["one", "two"] {
            let repo_id = Uuid::new_v4();
            std::fs::create_dir(root.path().join(name)).unwrap();
            sqlx::query("INSERT INTO repos (id, path, name, display_name) VALUES (?, ?, ?, ?)")
                .bind(repo_id)
                .bind(root.path().join(name).to_string_lossy().as_ref())
                .bind(name)
                .bind(name)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO project_repos (id, project_id, repo_id) VALUES (?, ?, ?)")
                .bind(Uuid::new_v4())
                .bind(id)
                .bind(repo_id)
                .execute(&pool)
                .await
                .unwrap();
        }
        assert!(resolve_project_root(&pool, id).await.is_err());
        let payload = serde_json::to_string(&ScratchPayload::ProjectRepoDefaults(
            ProjectRepoDefaultsData {
                repos: vec![],
                directory_path: Some(root.path().to_string_lossy().into_owned()),
            },
        ))
        .unwrap();
        sqlx::query("INSERT INTO scratch (id, scratch_type, payload) VALUES (?, 'PROJECT_REPO_DEFAULTS', ?)")
            .bind(id).bind(payload).execute(&pool).await.unwrap();
        assert_eq!(
            resolve_project_root(&pool, id).await.unwrap(),
            std::fs::canonicalize(root.path()).unwrap()
        );
    }
}
