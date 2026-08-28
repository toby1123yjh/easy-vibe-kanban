use std::{collections::HashMap, path::Path};

use axum::{Json, extract::State, response::Json as ResponseJson};
use db::models::{
    execution_process::ExecutionProcessRunReason,
    requests::{
        CreateAndStartWorkspaceRequest, CreateAndStartWorkspaceResponse, CreateWorkspaceApiRequest,
        CreateWorkspaceMode,
    },
    session::{CreateSession, Session},
    task::{CreateTask, TaskExecutionKind},
    workspace::{CreateWorkspace, Workspace},
    workspace_repo::{CreateWorkspaceRepo, WorkspaceRepo},
};
use deployment::Deployment;
use services::services::{container::ContainerService, remote_client::RemoteClientError};
use utils::response::ApiResponse;
use uuid::Uuid;
use workspace_manager::WorkspaceManager;

use crate::{
    DeploymentImpl,
    error::ApiError,
    routes::{
        filesystem::validate_directory_path,
        sessions,
        workspaces::{
            attachments::{ImportedIssueAttachment, import_issue_attachments_from_remote},
            links::link_workspace_to_issue,
        },
    },
};

pub(crate) async fn create_workspace_record(
    deployment: &DeploymentImpl,
    name: Option<String>,
) -> Result<Workspace, ApiError> {
    let workspace_id = Uuid::new_v4();
    let branch_label = name
        .as_deref()
        .filter(|branch_label| !branch_label.is_empty())
        .unwrap_or("workspace");
    let git_branch_name = deployment
        .container()
        .git_branch_from_workspace(&workspace_id, branch_label)
        .await;

    let workspace = Workspace::create(
        &deployment.db().pool,
        &CreateWorkspace {
            branch: git_branch_name,
            name: name.filter(|workspace_name| !workspace_name.is_empty()),
        },
        workspace_id,
    )
    .await?;

    Ok(workspace)
}

pub async fn create_workspace(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateWorkspaceApiRequest>,
) -> Result<ResponseJson<ApiResponse<Workspace>>, ApiError> {
    let workspace = create_workspace_record(&deployment, payload.name).await?;

    deployment
        .track_if_analytics_allowed(
            "workspace_created",
            serde_json::json!({
                "workspace_id": workspace.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(workspace)))
}

fn normalize_prompt(prompt: &str) -> Option<String> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn path_to_api_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

async fn validate_direct_folder_path(
    deployment: &DeploymentImpl,
    directory_path: Option<String>,
) -> Result<std::path::PathBuf, ApiError> {
    let raw_path = directory_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| {
            ApiError::BadRequest(
                "A directory path is required for direct folder workspaces.".to_string(),
            )
        })?;

    validate_directory_path(deployment, raw_path).await
}

async fn create_direct_folder_workspace_record(
    deployment: &DeploymentImpl,
    name: Option<String>,
    directory_path: Option<String>,
) -> Result<Workspace, ApiError> {
    let selected_dir = validate_direct_folder_path(deployment, directory_path).await?;
    let selected_dir_str = path_to_api_string(&selected_dir);
    let workspace_id = Uuid::new_v4();
    let workspace_name = name.filter(|workspace_name| !workspace_name.is_empty());
    let is_git_repo =
        selected_dir.join(".git").exists() && deployment.git().is_repo_openable(&selected_dir);

    if is_git_repo {
        let current_branch = deployment.git().get_current_branch(&selected_dir)?;
        let repo = deployment
            .repo()
            .register(&deployment.db().pool, &selected_dir_str, None)
            .await?;
        let target_branch = repo
            .default_target_branch
            .clone()
            .unwrap_or_else(|| current_branch.clone());
        let container_ref = selected_dir.parent().ok_or_else(|| {
            ApiError::BadRequest(
                "Cannot use a filesystem root as a git direct folder workspace.".to_string(),
            )
        })?;
        let workspace = Workspace::create_direct_folder(
            &deployment.db().pool,
            &CreateWorkspace {
                branch: current_branch,
                name: workspace_name,
            },
            workspace_id,
            &path_to_api_string(container_ref),
        )
        .await?;

        if let Err(error) = WorkspaceRepo::create_many(
            &deployment.db().pool,
            workspace.id,
            &[CreateWorkspaceRepo {
                repo_id: repo.id,
                target_branch,
            }],
        )
        .await
        {
            Workspace::delete(&deployment.db().pool, workspace.id).await?;
            return Err(ApiError::Database(error));
        }

        Ok(workspace)
    } else {
        Workspace::create_direct_folder(
            &deployment.db().pool,
            &CreateWorkspace {
                branch: "direct-folder".to_string(),
                name: workspace_name,
            },
            workspace_id,
            &selected_dir_str,
        )
        .await
        .map_err(ApiError::from)
    }
}

async fn delete_failed_single_agent_records(
    pool: &sqlx::SqlitePool,
    workspace_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    // agent_runs.workspace_id uses ON DELETE RESTRICT, so the runs must be
    // removed explicitly before Workspace deletion can cascade Sessions.
    sqlx::query("DELETE FROM agent_runs WHERE workspace_id = ?")
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        r#"
        DELETE FROM tasks
        WHERE execution_kind = 'agent'
          AND id IN (
              SELECT binding.task_id
              FROM agent_task_bindings binding
              JOIN sessions session ON session.id = binding.session_id
              WHERE session.workspace_id = ?
          )
        "#,
    )
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    let deleted = sqlx::query("DELETE FROM workspaces WHERE id = ?")
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?
        .rows_affected();
    transaction.commit().await?;
    Ok(deleted)
}

async fn compensate_failed_single_agent_creation(
    deployment: &DeploymentImpl,
    workspace_id: Uuid,
    may_have_remote_link: bool,
) -> Result<(), ApiError> {
    let mut remote_cleanup_error = None;
    if may_have_remote_link && let Ok(client) = deployment.remote_client() {
        match client.delete_workspace(workspace_id).await {
            Ok(()) | Err(RemoteClientError::Http { status: 404, .. }) => {}
            Err(error) => remote_cleanup_error = Some(error),
        }
    }

    let Some(workspace) = Workspace::find_by_id(&deployment.db().pool, workspace_id).await? else {
        if let Some(error) = remote_cleanup_error {
            return Err(error.into());
        }
        return Ok(());
    };
    let deletion_context = match deployment
        .workspace_manager()
        .load_managed_workspace(workspace)
        .await
    {
        Ok(managed_workspace) => match managed_workspace.prepare_deletion_context().await {
            Ok(context) => Some(context),
            Err(error) => {
                tracing::warn!(
                    %workspace_id,
                    "failed to prepare filesystem compensation context: {error}"
                );
                None
            }
        },
        Err(error) => {
            tracing::warn!(
                %workspace_id,
                "failed to load workspace for filesystem compensation: {error}"
            );
            None
        }
    };

    delete_failed_single_agent_records(&deployment.db().pool, workspace_id).await?;
    if let Some(context) = deletion_context {
        // External DirectFolder ownership produces no workspace path or branch
        // cleanup in this context, so compensation never deletes user folders.
        WorkspaceManager::spawn_workspace_deletion_cleanup(context, true);
    }

    if let Some(error) = remote_cleanup_error {
        return Err(error.into());
    }
    Ok(())
}

fn escape_markdown_label(label: &str) -> String {
    let mut escaped = String::with_capacity(label.len());
    for ch in label.chars() {
        if matches!(ch, '[' | ']' | '\\') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn build_workspace_attachment_markdown(
    file: &ImportedIssueAttachment,
    label: &str,
    uses_image_markdown: bool,
) -> String {
    let path = format!(".vibe-attachments/{}", file.file.file_path);
    let normalized_label = if label.trim().is_empty() {
        file.file.original_name.as_str()
    } else {
        label
    };
    let escaped_label = escape_markdown_label(normalized_label);

    if uses_image_markdown {
        format!("![{}]({})", escaped_label, path)
    } else {
        format!("[{}]({})", escaped_label, path)
    }
}

struct ParsedAttachmentMarkdown<'a> {
    attachment_id: Uuid,
    label: &'a str,
    uses_image_markdown: bool,
    end: usize,
}

fn find_unescaped_char(haystack: &str, target: char) -> Option<usize> {
    let mut escaped = false;

    for (index, ch) in haystack.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }

        if ch == '\\' {
            escaped = true;
            continue;
        }

        if ch == target {
            return Some(index);
        }
    }

    None
}

fn parse_attachment_markdown_at(
    prompt: &str,
    start: usize,
) -> Option<ParsedAttachmentMarkdown<'_>> {
    let rest = prompt.get(start..)?;
    let (uses_image_markdown, label_start_offset) = if rest.starts_with("![") {
        (true, 2)
    } else if rest.starts_with('[') {
        (false, 1)
    } else {
        return None;
    };

    let label_rest = rest.get(label_start_offset..)?;
    let label_end_offset = find_unescaped_char(label_rest, ']')?;
    let label = &label_rest[..label_end_offset];

    let after_label = label_rest.get(label_end_offset + 1..)?;
    let attachment_prefix = "(attachment://";
    if !after_label.starts_with(attachment_prefix) {
        return None;
    }

    let attachment_id_start =
        start + label_start_offset + label_end_offset + 1 + attachment_prefix.len();
    let attachment_id_rest = prompt.get(attachment_id_start..)?;
    let attachment_id_end_offset = attachment_id_rest.find(')')?;
    let attachment_id = Uuid::parse_str(&attachment_id_rest[..attachment_id_end_offset]).ok()?;

    Some(ParsedAttachmentMarkdown {
        attachment_id,
        label,
        uses_image_markdown,
        end: attachment_id_start + attachment_id_end_offset + 1,
    })
}

fn rewrite_imported_issue_attachments_markdown(
    prompt: &str,
    imported_attachments: &[ImportedIssueAttachment],
) -> String {
    if imported_attachments.is_empty() {
        return prompt.to_string();
    }

    let imported_by_attachment_id = imported_attachments
        .iter()
        .map(|attachment| (attachment.attachment_id, attachment))
        .collect::<HashMap<_, _>>();
    let mut rewritten = String::with_capacity(prompt.len());
    let mut index = 0;

    while index < prompt.len() {
        if let Some(parsed) = parse_attachment_markdown_at(prompt, index)
            && let Some(attachment) = imported_by_attachment_id.get(&parsed.attachment_id)
        {
            rewritten.push_str(&build_workspace_attachment_markdown(
                attachment,
                parsed.label,
                parsed.uses_image_markdown,
            ));
            index = parsed.end;
            continue;
        }

        let Some(ch) = prompt[index..].chars().next() else {
            break;
        };
        rewritten.push(ch);
        index += ch.len_utf8();
    }

    rewritten
}

pub async fn create_and_start_workspace(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateAndStartWorkspaceRequest>,
) -> Result<ResponseJson<ApiResponse<CreateAndStartWorkspaceResponse>>, ApiError> {
    let CreateAndStartWorkspaceRequest {
        mode,
        name,
        repos,
        directory_path,
        linked_issue,
        executor_config,
        prompt,
        selected_skills,
        resume_session_id,
        resume_scope_path,
        attachment_ids,
    } = payload;

    let mut workspace_prompt = normalize_prompt(&prompt).ok_or_else(|| {
        ApiError::BadRequest(
            "A workspace prompt is required. Provide a non-empty `prompt`.".to_string(),
        )
    })?;
    let resume_session_id = resume_session_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned);
    let resume_scope_path = resume_scope_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned);

    let is_worktree = matches!(mode, CreateWorkspaceMode::Worktree);
    let workspace_record = match mode {
        CreateWorkspaceMode::Worktree => {
            if repos.is_empty() {
                return Err(ApiError::BadRequest(
                    "At least one repository is required".to_string(),
                ));
            }
            create_workspace_record(&deployment, name).await?
        }
        CreateWorkspaceMode::DirectFolder => {
            create_direct_folder_workspace_record(&deployment, name, directory_path).await?
        }
    };
    let workspace_id = workspace_record.id;

    let creation_result = async {
        let mut managed_workspace = deployment
            .workspace_manager()
            .load_managed_workspace(workspace_record)
            .await?;
        if is_worktree {
            for repo in &repos {
                managed_workspace
                    .add_repository(repo, deployment.git())
                    .await
                    .map_err(ApiError::from)?;
            }
        }

        if let Some(ids) = &attachment_ids {
            managed_workspace.associate_attachments(ids).await?;
        }

        if let Some(linked_issue) = &linked_issue
            && let Ok(client) = deployment.remote_client()
        {
            match import_issue_attachments_from_remote(
                &client,
                deployment.file(),
                linked_issue.issue_id,
            )
            .await
            {
                Ok(imported_attachments) if !imported_attachments.is_empty() => {
                    let imported_ids = imported_attachments
                        .iter()
                        .map(|imported| imported.file.id)
                        .collect::<Vec<_>>();

                    if let Err(e) = managed_workspace.associate_attachments(&imported_ids).await {
                        tracing::warn!("Failed to associate imported files with workspace: {}", e);
                    }

                    workspace_prompt = rewrite_imported_issue_attachments_markdown(
                        &workspace_prompt,
                        &imported_attachments,
                    );

                    tracing::info!(
                        "Imported {} files from issue {}",
                        imported_ids.len(),
                        linked_issue.issue_id
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(
                        "Failed to import issue attachments for issue {}: {}",
                        linked_issue.issue_id,
                        e
                    );
                }
            }
        }

        let workspace = managed_workspace.workspace.clone();
        tracing::info!("Created workspace {}", workspace.id);

        deployment.container().create(&workspace).await?;
        let workspace = Workspace::find_by_id(&deployment.db().pool, workspace.id)
            .await?
            .ok_or_else(|| ApiError::BadRequest("Created workspace was not found".to_string()))?;
        let create_session = CreateSession {
            executor: Some(executor_config.executor.to_string()),
            name: None,
        };
        let session_id = Uuid::new_v4();
        let session = if let Some(linked_issue) = &linked_issue {
            let title = workspace
                .name
                .as_deref()
                .map(str::trim)
                .filter(|title| !title.is_empty())
                .or_else(|| {
                    let prompt = workspace_prompt.trim();
                    (!prompt.is_empty()).then_some(prompt)
                })
                .unwrap_or("Agent task")
                .chars()
                .take(160)
                .collect::<String>();
            let (session, _) = Session::create_with_agent_task(
                &deployment.db().pool,
                &create_session,
                session_id,
                workspace.id,
                &CreateTask {
                    id: Uuid::new_v4(),
                    project_id: linked_issue.remote_project_id,
                    issue_id: linked_issue.issue_id,
                    parent_task_id: None,
                    title,
                    execution_kind: TaskExecutionKind::Agent,
                },
            )
            .await?;
            session
        } else {
            Session::create(
                &deployment.db().pool,
                &create_session,
                session_id,
                workspace.id,
            )
            .await?
        };
        let workspace_repos =
            WorkspaceRepo::find_repos_for_workspace(&deployment.db().pool, workspace.id).await?;
        let repos_with_setup = if workspace.is_direct_folder() {
            Vec::new()
        } else {
            workspace_repos
                .iter()
                .filter(|repo| repo.setup_script.is_some())
                .collect::<Vec<_>>()
        };

        // Link only after the canonical Session/Task exists, but before any
        // setup or Agent process can start. Process launch is intentionally
        // the final fallible stage because record compensation cannot safely
        // stand in for terminating an already-started provider process.
        if let Some(linked_issue) = &linked_issue {
            link_workspace_to_issue(
                &deployment,
                &workspace,
                linked_issue.remote_project_id,
                linked_issue.issue_id,
            )
            .await?;
        }

        let agent_run = if repos_with_setup.is_empty() {
            sessions::start_coding_agent_execution_for_session(
                &deployment,
                session,
                workspace_prompt,
                selected_skills,
                executor_config.clone(),
                resume_session_id.clone(),
                resume_scope_path.clone(),
            )
            .await?
        } else if repos_with_setup
            .iter()
            .all(|repo| repo.parallel_setup_script)
        {
            for repo in repos_with_setup {
                if let Some(setup_action) = deployment
                    .container()
                    .setup_actions_for_repos(std::slice::from_ref(repo))
                    && let Err(error) = deployment
                        .container()
                        .start_execution(
                            &workspace,
                            &session,
                            &setup_action,
                            &ExecutionProcessRunReason::SetupScript,
                        )
                        .await
                {
                    tracing::warn!(
                        workspace_id = %workspace.id,
                        repo_id = %repo.id,
                        "failed to start parallel workspace setup script: {error:#}"
                    );
                }
            }
            sessions::start_coding_agent_execution_for_session(
                &deployment,
                session,
                workspace_prompt,
                selected_skills,
                executor_config.clone(),
                resume_session_id.clone(),
                resume_scope_path.clone(),
            )
            .await?
        } else {
            let setup_action = deployment
                .container()
                .setup_actions_for_repos(&workspace_repos)
                .ok_or_else(|| {
                    ApiError::BadRequest(
                        "Workspace setup configuration did not produce a setup action".to_string(),
                    )
                })?;
            let reserved = sessions::reserve_coding_agent_execution_for_session(
                &deployment,
                session,
                workspace_prompt,
                selected_skills,
                executor_config.clone(),
                resume_session_id,
                resume_scope_path,
            )
            .await?;
            sessions::setup_gate::start_reserved_after_setup(
                &deployment,
                reserved.agent_run_id,
                &setup_action,
            )
            .await?;
            reserved
        };

        Ok::<_, ApiError>((workspace, agent_run))
    }
    .await;

    let (workspace, agent_run) = match creation_result {
        Ok(created) => created,
        Err(error) => {
            if let Err(cleanup_error) = compensate_failed_single_agent_creation(
                &deployment,
                workspace_id,
                linked_issue.is_some(),
            )
            .await
            {
                tracing::error!(
                    %workspace_id,
                    "failed to compensate single-Agent creation: {cleanup_error:#}"
                );
            }
            return Err(error);
        }
    };

    deployment
        .track_if_analytics_allowed(
            "workspace_created_and_started",
            serde_json::json!({
                "executor": &executor_config.executor,
                "variant": &executor_config.variant,
                "workspace_id": workspace.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(
        CreateAndStartWorkspaceResponse {
            workspace,
            agent_run,
        },
    )))
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::file::File;
    use sqlx::{
        SqlitePool,
        sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    };
    use uuid::Uuid;

    use super::{
        ImportedIssueAttachment, delete_failed_single_agent_records,
        rewrite_imported_issue_attachments_markdown,
    };

    async fn single_agent_cleanup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .expect("connect single-Agent cleanup test database");

        for statement in [
            r#"
            CREATE TABLE workspaces (
                id BLOB PRIMARY KEY,
                container_ref TEXT,
                workspace_kind TEXT NOT NULL,
                container_ownership TEXT NOT NULL
            )
            "#,
            r#"
            CREATE TABLE sessions (
                id BLOB PRIMARY KEY,
                workspace_id BLOB NOT NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            )
            "#,
            r#"
            CREATE TABLE tasks (
                id BLOB PRIMARY KEY,
                execution_kind TEXT NOT NULL
            )
            "#,
            r#"
            CREATE TABLE agent_task_bindings (
                task_id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL UNIQUE,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
            "#,
            r#"
            CREATE TABLE agent_runs (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                workspace_id BLOB NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
            )
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create single-Agent cleanup fixture table");
        }

        pool
    }

    async fn insert_single_agent_creation(
        pool: &SqlitePool,
        workspace_id: Uuid,
        session_id: Uuid,
        task_id: Uuid,
        agent_run_id: Uuid,
    ) {
        sqlx::query(
            r#"
            INSERT INTO workspaces (
                id, container_ref, workspace_kind, container_ownership
            ) VALUES (?, 'D:\\existing-project', 'direct_folder', 'external')
            "#,
        )
        .bind(workspace_id)
        .execute(pool)
        .await
        .expect("insert Workspace");
        sqlx::query("INSERT INTO sessions (id, workspace_id) VALUES (?, ?)")
            .bind(session_id)
            .bind(workspace_id)
            .execute(pool)
            .await
            .expect("insert Session");
        sqlx::query("INSERT INTO tasks (id, execution_kind) VALUES (?, 'agent')")
            .bind(task_id)
            .execute(pool)
            .await
            .expect("insert Agent Task");
        sqlx::query("INSERT INTO agent_task_bindings (task_id, session_id) VALUES (?, ?)")
            .bind(task_id)
            .bind(session_id)
            .execute(pool)
            .await
            .expect("insert Agent Task binding");
        sqlx::query("INSERT INTO agent_runs (id, session_id, workspace_id) VALUES (?, ?, ?)")
            .bind(agent_run_id)
            .bind(session_id)
            .bind(workspace_id)
            .execute(pool)
            .await
            .expect("insert AgentRun");
    }

    #[tokio::test]
    async fn delete_failed_single_agent_records_removes_partial_creation_only() {
        let pool = single_agent_cleanup_pool().await;
        let failed = (
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
        );
        let unrelated = (
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
        );
        insert_single_agent_creation(&pool, failed.0, failed.1, failed.2, failed.3).await;
        insert_single_agent_creation(&pool, unrelated.0, unrelated.1, unrelated.2, unrelated.3)
            .await;

        let deleted = delete_failed_single_agent_records(&pool, failed.0)
            .await
            .expect("compensate failed single-Agent creation");

        assert_eq!(deleted, 1);
        for (table, id) in [
            ("workspaces", failed.0),
            ("sessions", failed.1),
            ("tasks", failed.2),
            ("agent_runs", failed.3),
        ] {
            let count: i64 =
                sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE id = ?"))
                    .bind(id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(count, 0, "failed creation left a row in {table}");
        }
        let failed_binding_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM agent_task_bindings WHERE task_id = ?")
                .bind(failed.2)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(failed_binding_count, 0);

        for (table, id) in [
            ("workspaces", unrelated.0),
            ("sessions", unrelated.1),
            ("tasks", unrelated.2),
            ("agent_runs", unrelated.3),
        ] {
            let count: i64 =
                sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE id = ?"))
                    .bind(id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(count, 1, "cleanup removed an unrelated row from {table}");
        }
    }

    fn imported_file(
        attachment_id: Uuid,
        original_name: &str,
        file_path: &str,
        mime_type: Option<&str>,
    ) -> ImportedIssueAttachment {
        ImportedIssueAttachment {
            attachment_id,
            file: File {
                id: Uuid::new_v4(),
                file_path: file_path.to_string(),
                original_name: original_name.to_string(),
                mime_type: mime_type.map(str::to_string),
                size_bytes: 123,
                hash: "hash".to_string(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
        }
    }

    #[test]
    fn rewrites_imported_non_image_attachment_links() {
        let attachment_id = Uuid::new_v4();
        let prompt = format!("[proposal.pdf](attachment://{})", attachment_id);
        let imported = vec![imported_file(
            attachment_id,
            "proposal.pdf",
            "abc_proposal.pdf",
            Some("application/pdf"),
        )];

        let rewritten = rewrite_imported_issue_attachments_markdown(&prompt, &imported);

        assert_eq!(
            rewritten,
            "[proposal.pdf](.vibe-attachments/abc_proposal.pdf)"
        );
    }

    #[test]
    fn preserves_authored_image_markdown_for_imported_images() {
        let attachment_id = Uuid::new_v4();
        let prompt = format!("![diagram.png](attachment://{})", attachment_id);
        let imported = vec![imported_file(
            attachment_id,
            "diagram.png",
            "xyz_diagram.png",
            Some("image/png"),
        )];

        let rewritten = rewrite_imported_issue_attachments_markdown(&prompt, &imported);

        assert_eq!(
            rewritten,
            "![diagram.png](.vibe-attachments/xyz_diagram.png)"
        );
    }

    #[test]
    fn preserves_authored_link_markdown_for_imported_images() {
        let attachment_id = Uuid::new_v4();
        let prompt = format!("[diagram.png](attachment://{})", attachment_id);
        let imported = vec![imported_file(
            attachment_id,
            "diagram.png",
            "xyz_diagram.png",
            Some("image/png"),
        )];

        let rewritten = rewrite_imported_issue_attachments_markdown(&prompt, &imported);

        assert_eq!(
            rewritten,
            "[diagram.png](.vibe-attachments/xyz_diagram.png)"
        );
    }

    #[test]
    fn preserves_authored_image_markdown_for_imported_non_images() {
        let attachment_id = Uuid::new_v4();
        let prompt = format!("![proposal.pdf](attachment://{})", attachment_id);
        let imported = vec![imported_file(
            attachment_id,
            "proposal.pdf",
            "abc_proposal.pdf",
            Some("application/pdf"),
        )];

        let rewritten = rewrite_imported_issue_attachments_markdown(&prompt, &imported);

        assert_eq!(
            rewritten,
            "![proposal.pdf](.vibe-attachments/abc_proposal.pdf)"
        );
    }

    #[test]
    fn leaves_unknown_attachment_references_unchanged() {
        let prompt = format!("[proposal.pdf](attachment://{})", Uuid::new_v4());
        let imported = vec![imported_file(
            Uuid::new_v4(),
            "proposal.pdf",
            "abc_proposal.pdf",
            Some("application/pdf"),
        )];

        let rewritten = rewrite_imported_issue_attachments_markdown(&prompt, &imported);

        assert_eq!(rewritten, prompt);
    }

    #[test]
    fn rewrites_multiple_attachments_and_leaves_other_links_alone() {
        let image_attachment_id = Uuid::new_v4();
        let file_attachment_id = Uuid::new_v4();
        let prompt = format!(
            "See [doc.pdf](attachment://{}) and ![shot.png](attachment://{}). https://example.com",
            file_attachment_id, image_attachment_id
        );
        let imported = vec![
            imported_file(
                file_attachment_id,
                "doc.pdf",
                "doc_file.pdf",
                Some("application/pdf"),
            ),
            imported_file(
                image_attachment_id,
                "shot.png",
                "shot_file.png",
                Some("image/png"),
            ),
        ];

        let rewritten = rewrite_imported_issue_attachments_markdown(&prompt, &imported);

        assert_eq!(
            rewritten,
            "See [doc.pdf](.vibe-attachments/doc_file.pdf) and ![shot.png](.vibe-attachments/shot_file.png). https://example.com"
        );
    }
}
