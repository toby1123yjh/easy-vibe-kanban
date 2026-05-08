use api_types::{
    CreateIssueAssigneeRequest, CreateIssueCommentReactionRequest, CreateIssueCommentRequest,
    CreateIssueFollowerRequest, CreateIssueRelationshipRequest, CreateIssueRequest,
    CreateIssueTagRequest, CreateProjectRequest, CreateProjectStatusRequest, CreateTagRequest,
    DeleteResponse, Issue, IssueAssignee, IssueComment, IssueCommentReaction, IssueFollower,
    IssuePriority, IssueRelationship, IssueRelationshipType, IssueTag, ListMembersResponse,
    ListOrganizationsResponse, MemberRole, MutationResponse, OrganizationMember,
    OrganizationMemberWithProfile, OrganizationWithRole, Project, ProjectStatus, Tag,
    UpdateIssueCommentRequest, UpdateIssueRequest, UpdateProjectRequest,
    UpdateProjectStatusRequest, UpdateTagRequest, User, Workspace,
};
use axum::{
    Router,
    extract::{Json, Path, Query, State},
    response::Json as ResponseJson,
    routing::{delete, get, patch, post},
};
use chrono::{DateTime, Utc};
use db::models::{
    arena_group::{
        ArenaGroup, ArenaGroupError, ArenaLifecycleStatus, ArenaMode, ArenaStatus, CreateArenaGroup,
    },
    coding_agent_turn::CodingAgentTurn,
    execution_process::{ExecutionProcessRunReason, ExecutionProcessStatus},
    requests::WorkspaceRepoInput,
    session::Session,
    workspace::Workspace as DbWorkspace,
    workspace_repo::WorkspaceRepo,
};
use deployment::Deployment;
use executors::{
    actions::{
        ExecutorAction, ExecutorActionType, coding_agent_follow_up::CodingAgentFollowUpRequest,
        coding_agent_initial::CodingAgentInitialRequest,
    },
    profile::ExecutorConfig,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use services::services::container::ContainerService;
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
use ts_rs::TS;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError, routes::workspaces::create::create_workspace_record};

const LOCAL_PROJECT_COLOR: &str = "210 80% 52%";

const DEFAULT_STATUSES: [(&str, &str, i32, bool); 5] = [
    ("Todo", "210 80% 52%", 100, false),
    ("In Progress", "38 92% 50%", 200, false),
    ("In Review", "265 70% 62%", 300, false),
    ("Done", "145 63% 42%", 400, false),
    ("Cancelled", "0 0% 50%", 500, true),
];

const DEFAULT_TAGS: [(&str, &str); 4] = [
    ("bug", "355 65% 53%"),
    ("feature", "124 82% 30%"),
    ("documentation", "205 100% 40%"),
    ("enhancement", "181 72% 78%"),
];

const ARENA_SYNTHESIS_WORKSPACE_PREFIX: &str = "Arena Synthesis";

#[derive(Debug, Deserialize)]
struct OrganizationQuery {
    organization_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
struct ProjectQuery {
    project_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
struct IssueQuery {
    issue_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
struct UserQuery {
    user_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
struct BulkUpdateProjectItem {
    id: Uuid,
    #[serde(flatten)]
    changes: UpdateProjectRequest,
}

#[derive(Debug, Deserialize)]
struct BulkUpdateProjectsRequest {
    updates: Vec<BulkUpdateProjectItem>,
}

#[derive(Debug, Deserialize)]
struct BulkUpdateProjectStatusItem {
    id: Uuid,
    #[serde(flatten)]
    changes: UpdateProjectStatusRequest,
}

#[derive(Debug, Deserialize)]
struct BulkUpdateProjectStatusesRequest {
    updates: Vec<BulkUpdateProjectStatusItem>,
}

#[derive(Debug, Deserialize)]
struct BulkUpdateIssueItem {
    id: Uuid,
    #[serde(flatten)]
    changes: UpdateIssueRequest,
}

#[derive(Debug, Deserialize)]
struct BulkUpdateIssuesRequest {
    updates: Vec<BulkUpdateIssueItem>,
}

pub fn router(_deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    Router::new()
        .route("/v1/organizations", get(list_organizations))
        .route("/v1/organizations/{org_id}/members", get(list_members))
        .route(
            "/v1/fallback/organization_members",
            get(fallback_organization_members),
        )
        .route("/v1/fallback/users", get(fallback_users))
        .route("/v1/fallback/projects", get(fallback_projects))
        .route(
            "/v1/fallback/project_statuses",
            get(fallback_project_statuses),
        )
        .route("/v1/fallback/issues", get(fallback_issues))
        .route("/v1/fallback/tags", get(fallback_tags))
        .route("/v1/fallback/issue_tags", get(fallback_issue_tags))
        .route(
            "/v1/fallback/issue_assignees",
            get(fallback_issue_assignees),
        )
        .route(
            "/v1/fallback/issue_followers",
            get(fallback_issue_followers),
        )
        .route(
            "/v1/fallback/issue_relationships",
            get(fallback_issue_relationships),
        )
        .route("/v1/fallback/pull_requests", get(fallback_pull_requests))
        .route(
            "/v1/fallback/pull_request_issues",
            get(fallback_pull_request_issues),
        )
        .route(
            "/v1/fallback/project_workspaces",
            get(fallback_project_workspaces),
        )
        .route(
            "/v1/fallback/user_workspaces",
            get(fallback_user_workspaces),
        )
        .route("/v1/fallback/notifications", get(fallback_notifications))
        .route("/v1/fallback/issue_comments", get(fallback_issue_comments))
        .route(
            "/v1/fallback/issue_comment_reactions",
            get(fallback_issue_comment_reactions),
        )
        .route("/v1/projects", post(create_project))
        .route("/v1/projects/bulk", post(bulk_update_projects))
        .route(
            "/v1/projects/{project_id}",
            get(get_project)
                .patch(update_project)
                .delete(delete_project),
        )
        .route("/v1/project_statuses", post(create_project_status))
        .route(
            "/v1/project_statuses/bulk",
            post(bulk_update_project_statuses),
        )
        .route(
            "/v1/project_statuses/{status_id}",
            patch(update_project_status).delete(delete_project_status),
        )
        .route("/v1/issues", post(create_issue))
        .route("/v1/issues/bulk", post(bulk_update_issues))
        .route(
            "/v1/issues/{issue_id}",
            patch(update_issue).delete(delete_issue),
        )
        .route("/v1/tags", post(create_tag))
        .route("/v1/tags/{tag_id}", patch(update_tag).delete(delete_tag))
        .route("/v1/issue_tags", post(create_issue_tag))
        .route("/v1/issue_tags/{issue_tag_id}", delete(delete_issue_tag))
        .route("/v1/issue_assignees", post(create_issue_assignee))
        .route(
            "/v1/issue_assignees/{issue_assignee_id}",
            delete(delete_issue_assignee),
        )
        .route("/v1/issue_followers", post(create_issue_follower))
        .route(
            "/v1/issue_followers/{issue_follower_id}",
            delete(delete_issue_follower),
        )
        .route("/v1/issue_relationships", post(create_issue_relationship))
        .route(
            "/v1/issue_relationships/{relationship_id}",
            delete(delete_issue_relationship),
        )
        .route("/v1/issue_comments", post(create_issue_comment))
        .route(
            "/v1/issue_comments/{comment_id}",
            patch(update_issue_comment).delete(delete_issue_comment),
        )
        .route(
            "/v1/issue_comment_reactions",
            post(create_issue_comment_reaction),
        )
        .route(
            "/v1/issue_comment_reactions/{reaction_id}",
            delete(delete_issue_comment_reaction),
        )
        // ── AI Arena (race mode) ────────────────────────────────────────
        // see docs/future/ai-arena/spec.md §4 + plan.md Step 1.3
        .route("/v1/fallback/arena_groups", get(fallback_arena_groups))
        .route(
            "/v1/issues/{issue_id}/workspaces",
            get(list_issue_workspaces),
        )
        .route("/v1/issues/{issue_id}/arena", post(create_arena_group))
        .route(
            "/v1/issues/{issue_id}/arena/active",
            get(get_active_arena_for_issue),
        )
        .route(
            "/v1/arena/{group_id}",
            get(get_arena_group).delete(dissolve_arena_group),
        )
        .route("/v1/arena/{group_id}/close", post(close_arena_group))
        .route("/v1/arena/{group_id}/message", post(send_arena_message))
        .route(
            "/v1/arena/{group_id}/start-implementation",
            post(start_arena_implementation),
        )
        .route(
            "/v1/arena/{group_id}/promote",
            post(promote_arena_workspace),
        )
        .route(
            "/v1/arena/{group_id}/workspaces/{workspace_id}/retry",
            post(retry_arena_workspace),
        )
}

fn local_user_id() -> Uuid {
    Uuid::from_u128(1)
}

fn local_org_id() -> Uuid {
    Uuid::from_u128(2)
}

fn txid() -> i64 {
    Utc::now().timestamp_millis()
}

fn priority_to_str(priority: IssuePriority) -> &'static str {
    match priority {
        IssuePriority::Urgent => "urgent",
        IssuePriority::High => "high",
        IssuePriority::Medium => "medium",
        IssuePriority::Low => "low",
    }
}

fn priority_from_str(value: Option<String>) -> Option<IssuePriority> {
    match value.as_deref() {
        Some("urgent") => Some(IssuePriority::Urgent),
        Some("high") => Some(IssuePriority::High),
        Some("medium") => Some(IssuePriority::Medium),
        Some("low") => Some(IssuePriority::Low),
        _ => None,
    }
}

fn relationship_type_to_str(relationship_type: IssueRelationshipType) -> &'static str {
    match relationship_type {
        IssueRelationshipType::Blocking => "blocking",
        IssueRelationshipType::Related => "related",
        IssueRelationshipType::HasDuplicate => "has_duplicate",
    }
}

fn relationship_type_from_str(value: String) -> IssueRelationshipType {
    match value.as_str() {
        "blocking" => IssueRelationshipType::Blocking,
        "has_duplicate" => IssueRelationshipType::HasDuplicate,
        _ => IssueRelationshipType::Related,
    }
}

fn empty_rows(table: &str) -> ResponseJson<Value> {
    ResponseJson(json!({ table: [] }))
}

async fn project_exists(pool: &SqlitePool, project_id: Uuid) -> Result<bool, ApiError> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(pool)
        .await?;
    Ok(count > 0)
}

async fn ensure_project_metadata(pool: &SqlitePool) -> Result<(), ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT p.id
        FROM projects p
        LEFT JOIN local_project_metadata m ON m.project_id = p.id
        WHERE m.project_id IS NULL
        ORDER BY p.created_at ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    for row in rows {
        let project_id: Uuid = row.try_get("id")?;
        let sort_order: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM local_project_metadata",
        )
        .fetch_one(pool)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO local_project_metadata
                (project_id, organization_id, color, sort_order)
            VALUES (?, ?, ?, ?)
            "#,
        )
        .bind(project_id)
        .bind(local_org_id())
        .bind(LOCAL_PROJECT_COLOR)
        .bind(sort_order)
        .execute(pool)
        .await?;
    }

    Ok(())
}

fn project_from_row(row: &SqliteRow) -> Result<Project, sqlx::Error> {
    Ok(Project {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        name: row.try_get("name")?,
        color: row.try_get("color")?,
        sort_order: row.try_get("sort_order")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn list_local_projects(pool: &SqlitePool) -> Result<Vec<Project>, ApiError> {
    ensure_project_metadata(pool).await?;

    let rows = sqlx::query(
        r#"
        SELECT
            p.id,
            m.organization_id,
            p.name,
            m.color,
            m.sort_order,
            p.created_at,
            p.updated_at
        FROM projects p
        JOIN local_project_metadata m ON m.project_id = p.id
        WHERE m.organization_id = ?
        ORDER BY m.sort_order ASC, p.created_at ASC
        "#,
    )
    .bind(local_org_id())
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(project_from_row)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApiError::from)
}

async fn get_local_project(pool: &SqlitePool, project_id: Uuid) -> Result<Project, ApiError> {
    ensure_project_metadata(pool).await?;

    let row = sqlx::query(
        r#"
        SELECT
            p.id,
            m.organization_id,
            p.name,
            m.color,
            m.sort_order,
            p.created_at,
            p.updated_at
        FROM projects p
        JOIN local_project_metadata m ON m.project_id = p.id
        WHERE p.id = ?
        "#,
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest("Project not found".to_string()))?;

    project_from_row(&row).map_err(ApiError::from)
}

async fn create_local_project(
    pool: &SqlitePool,
    request: CreateProjectRequest,
) -> Result<Project, ApiError> {
    let project_id = request.id.unwrap_or_else(Uuid::new_v4);
    let sort_order: i32 =
        sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM local_project_metadata")
            .fetch_one(pool)
            .await?;

    sqlx::query("INSERT INTO projects (id, name) VALUES (?, ?)")
        .bind(project_id)
        .bind(request.name)
        .execute(pool)
        .await?;

    sqlx::query(
        r#"
        INSERT INTO local_project_metadata
            (project_id, organization_id, color, sort_order)
        VALUES (?, ?, ?, ?)
        "#,
    )
    .bind(project_id)
    .bind(local_org_id())
    .bind(request.color)
    .bind(sort_order)
    .execute(pool)
    .await?;

    ensure_default_statuses(pool, project_id).await?;
    ensure_default_tags(pool, project_id).await?;
    get_local_project(pool, project_id).await
}

async fn update_local_project(
    pool: &SqlitePool,
    project_id: Uuid,
    changes: UpdateProjectRequest,
) -> Result<Project, ApiError> {
    if let Some(name) = changes.name {
        sqlx::query(
            "UPDATE projects SET name = ?, updated_at = datetime('now', 'subsec') WHERE id = ?",
        )
        .bind(name)
        .bind(project_id)
        .execute(pool)
        .await?;
    }

    if changes.color.is_some() || changes.sort_order.is_some() {
        ensure_project_metadata(pool).await?;

        let existing = get_local_project(pool, project_id).await?;
        sqlx::query(
            r#"
            UPDATE local_project_metadata
            SET color = ?, sort_order = ?, updated_at = datetime('now', 'subsec')
            WHERE project_id = ?
            "#,
        )
        .bind(changes.color.unwrap_or(existing.color))
        .bind(changes.sort_order.unwrap_or(existing.sort_order))
        .bind(project_id)
        .execute(pool)
        .await?;
    }

    get_local_project(pool, project_id).await
}

fn status_from_row(row: &SqliteRow) -> Result<ProjectStatus, sqlx::Error> {
    Ok(ProjectStatus {
        id: row.try_get("id")?,
        project_id: row.try_get("project_id")?,
        name: row.try_get("name")?,
        color: row.try_get("color")?,
        sort_order: row.try_get("sort_order")?,
        hidden: row.try_get("hidden")?,
        created_at: row.try_get("created_at")?,
    })
}

async fn list_project_statuses(
    pool: &SqlitePool,
    project_id: Uuid,
) -> Result<Vec<ProjectStatus>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT id, project_id, name, color, sort_order, hidden, created_at
        FROM local_project_statuses
        WHERE project_id = ?
        ORDER BY sort_order ASC
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(status_from_row)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApiError::from)
}

async fn get_project_status(pool: &SqlitePool, status_id: Uuid) -> Result<ProjectStatus, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, project_id, name, color, sort_order, hidden, created_at
        FROM local_project_statuses
        WHERE id = ?
        "#,
    )
    .bind(status_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest("Project status not found".to_string()))?;

    status_from_row(&row).map_err(ApiError::from)
}

async fn ensure_default_statuses(
    pool: &SqlitePool,
    project_id: Uuid,
) -> Result<Vec<ProjectStatus>, ApiError> {
    if !project_exists(pool, project_id).await? {
        return Ok(Vec::new());
    }

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM local_project_statuses WHERE project_id = ?")
            .bind(project_id)
            .fetch_one(pool)
            .await?;

    if count == 0 {
        for (name, color, sort_order, hidden) in DEFAULT_STATUSES {
            sqlx::query(
                r#"
                INSERT INTO local_project_statuses
                    (id, project_id, name, color, sort_order, hidden)
                VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(project_id)
            .bind(name)
            .bind(color)
            .bind(sort_order)
            .bind(hidden)
            .execute(pool)
            .await?;
        }
    }

    list_project_statuses(pool, project_id).await
}

async fn create_local_status(
    pool: &SqlitePool,
    request: CreateProjectStatusRequest,
) -> Result<ProjectStatus, ApiError> {
    let id = request.id.unwrap_or_else(Uuid::new_v4);
    sqlx::query(
        r#"
        INSERT INTO local_project_statuses
            (id, project_id, name, color, sort_order, hidden)
        VALUES (?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(id)
    .bind(request.project_id)
    .bind(request.name)
    .bind(request.color)
    .bind(request.sort_order)
    .bind(request.hidden)
    .execute(pool)
    .await?;

    get_project_status(pool, id).await
}

async fn update_local_status(
    pool: &SqlitePool,
    status_id: Uuid,
    changes: UpdateProjectStatusRequest,
) -> Result<ProjectStatus, ApiError> {
    let existing = get_project_status(pool, status_id).await?;

    sqlx::query(
        r#"
        UPDATE local_project_statuses
        SET name = ?, color = ?, sort_order = ?, hidden = ?
        WHERE id = ?
        "#,
    )
    .bind(changes.name.unwrap_or(existing.name))
    .bind(changes.color.unwrap_or(existing.color))
    .bind(changes.sort_order.unwrap_or(existing.sort_order))
    .bind(changes.hidden.unwrap_or(existing.hidden))
    .bind(status_id)
    .execute(pool)
    .await?;

    get_project_status(pool, status_id).await
}

fn issue_from_row(row: &SqliteRow) -> Result<Issue, sqlx::Error> {
    let extension_metadata = row
        .try_get::<String, _>("extension_metadata")
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or(Value::Null);

    Ok(Issue {
        id: row.try_get("id")?,
        project_id: row.try_get("project_id")?,
        issue_number: row.try_get("issue_number")?,
        simple_id: row.try_get("simple_id")?,
        status_id: row.try_get("status_id")?,
        title: row.try_get("title")?,
        description: row.try_get("description")?,
        priority: priority_from_str(row.try_get("priority")?),
        start_date: row.try_get("start_date")?,
        target_date: row.try_get("target_date")?,
        completed_at: row.try_get("completed_at")?,
        sort_order: row.try_get("sort_order")?,
        parent_issue_id: row.try_get("parent_issue_id")?,
        parent_issue_sort_order: row.try_get("parent_issue_sort_order")?,
        extension_metadata,
        creator_user_id: row.try_get("creator_user_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn list_project_issues(pool: &SqlitePool, project_id: Uuid) -> Result<Vec<Issue>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT
            id,
            project_id,
            issue_number,
            simple_id,
            status_id,
            title,
            description,
            priority,
            start_date,
            target_date,
            completed_at,
            sort_order,
            parent_issue_id,
            parent_issue_sort_order,
            extension_metadata,
            creator_user_id,
            created_at,
            updated_at
        FROM local_issues
        WHERE project_id = ?
        ORDER BY sort_order ASC, created_at ASC
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(issue_from_row)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApiError::from)
}

async fn get_local_issue(pool: &SqlitePool, issue_id: Uuid) -> Result<Issue, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT
            id,
            project_id,
            issue_number,
            simple_id,
            status_id,
            title,
            description,
            priority,
            start_date,
            target_date,
            completed_at,
            sort_order,
            parent_issue_id,
            parent_issue_sort_order,
            extension_metadata,
            creator_user_id,
            created_at,
            updated_at
        FROM local_issues
        WHERE id = ?
        "#,
    )
    .bind(issue_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest("Issue not found".to_string()))?;

    issue_from_row(&row).map_err(ApiError::from)
}

async fn create_local_issue(
    pool: &SqlitePool,
    request: CreateIssueRequest,
) -> Result<Issue, ApiError> {
    let id = request.id.unwrap_or_else(Uuid::new_v4);
    let issue_number: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(issue_number), 0) + 1 FROM local_issues WHERE project_id = ?",
    )
    .bind(request.project_id)
    .fetch_one(pool)
    .await?;
    let simple_id = format!("LOCAL-{issue_number}");
    let extension_metadata =
        serde_json::to_string(&request.extension_metadata).unwrap_or_else(|_| "null".to_string());

    sqlx::query(
        r#"
        INSERT INTO local_issues (
            id,
            project_id,
            issue_number,
            simple_id,
            status_id,
            title,
            description,
            priority,
            start_date,
            target_date,
            completed_at,
            sort_order,
            parent_issue_id,
            parent_issue_sort_order,
            extension_metadata,
            creator_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(id)
    .bind(request.project_id)
    .bind(issue_number)
    .bind(simple_id)
    .bind(request.status_id)
    .bind(request.title)
    .bind(request.description)
    .bind(request.priority.map(priority_to_str))
    .bind(request.start_date)
    .bind(request.target_date)
    .bind(request.completed_at)
    .bind(request.sort_order)
    .bind(request.parent_issue_id)
    .bind(request.parent_issue_sort_order)
    .bind(extension_metadata)
    .bind(local_user_id())
    .execute(pool)
    .await?;

    get_local_issue(pool, id).await
}

async fn update_local_issue(
    pool: &SqlitePool,
    issue_id: Uuid,
    changes: UpdateIssueRequest,
) -> Result<Issue, ApiError> {
    let existing = get_local_issue(pool, issue_id).await?;
    let extension_metadata = changes
        .extension_metadata
        .unwrap_or(existing.extension_metadata);
    let extension_metadata =
        serde_json::to_string(&extension_metadata).unwrap_or_else(|_| "null".to_string());

    sqlx::query(
        r#"
        UPDATE local_issues
        SET
            status_id = ?,
            title = ?,
            description = ?,
            priority = ?,
            start_date = ?,
            target_date = ?,
            completed_at = ?,
            sort_order = ?,
            parent_issue_id = ?,
            parent_issue_sort_order = ?,
            extension_metadata = ?,
            updated_at = datetime('now', 'subsec')
        WHERE id = ?
        "#,
    )
    .bind(changes.status_id.unwrap_or(existing.status_id))
    .bind(changes.title.unwrap_or(existing.title))
    .bind(changes.description.unwrap_or(existing.description))
    .bind(
        changes
            .priority
            .unwrap_or(existing.priority)
            .map(priority_to_str),
    )
    .bind(changes.start_date.unwrap_or(existing.start_date))
    .bind(changes.target_date.unwrap_or(existing.target_date))
    .bind(changes.completed_at.unwrap_or(existing.completed_at))
    .bind(changes.sort_order.unwrap_or(existing.sort_order))
    .bind(changes.parent_issue_id.unwrap_or(existing.parent_issue_id))
    .bind(
        changes
            .parent_issue_sort_order
            .unwrap_or(existing.parent_issue_sort_order),
    )
    .bind(extension_metadata)
    .bind(issue_id)
    .execute(pool)
    .await?;

    get_local_issue(pool, issue_id).await
}

fn tag_from_row(row: &SqliteRow) -> Result<Tag, sqlx::Error> {
    Ok(Tag {
        id: row.try_get("id")?,
        project_id: row.try_get("project_id")?,
        name: row.try_get("name")?,
        color: row.try_get("color")?,
    })
}

async fn list_project_tags(pool: &SqlitePool, project_id: Uuid) -> Result<Vec<Tag>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, project_id, name, color FROM local_tags WHERE project_id = ? ORDER BY name ASC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(tag_from_row)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApiError::from)
}

async fn ensure_default_tags(pool: &SqlitePool, project_id: Uuid) -> Result<Vec<Tag>, ApiError> {
    if !project_exists(pool, project_id).await? {
        return Ok(Vec::new());
    }

    for (name, color) in DEFAULT_TAGS {
        sqlx::query(
            r#"
            INSERT INTO local_tags (id, project_id, name, color)
            SELECT ?, ?, ?, ?
            WHERE NOT EXISTS (
                SELECT 1 FROM local_tags
                WHERE project_id = ? AND name = ?
            )
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(project_id)
        .bind(name)
        .bind(color)
        .bind(project_id)
        .bind(name)
        .execute(pool)
        .await?;
    }

    list_project_tags(pool, project_id).await
}

async fn get_local_tag(pool: &SqlitePool, tag_id: Uuid) -> Result<Tag, ApiError> {
    let row = sqlx::query("SELECT id, project_id, name, color FROM local_tags WHERE id = ?")
        .bind(tag_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Tag not found".to_string()))?;

    tag_from_row(&row).map_err(ApiError::from)
}

fn issue_tag_from_row(row: &SqliteRow) -> Result<IssueTag, sqlx::Error> {
    Ok(IssueTag {
        id: row.try_get("id")?,
        issue_id: row.try_get("issue_id")?,
        tag_id: row.try_get("tag_id")?,
    })
}

async fn list_project_issue_tags(
    pool: &SqlitePool,
    project_id: Uuid,
) -> Result<Vec<IssueTag>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT it.id, it.issue_id, it.tag_id
        FROM local_issue_tags it
        JOIN local_issues i ON i.id = it.issue_id
        WHERE i.project_id = ?
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(issue_tag_from_row)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApiError::from)
}

fn issue_assignee_from_row(row: &SqliteRow) -> Result<IssueAssignee, sqlx::Error> {
    Ok(IssueAssignee {
        id: row.try_get("id")?,
        issue_id: row.try_get("issue_id")?,
        user_id: row.try_get("user_id")?,
        assigned_at: row.try_get("assigned_at")?,
    })
}

async fn list_project_issue_assignees(
    pool: &SqlitePool,
    project_id: Uuid,
) -> Result<Vec<IssueAssignee>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT ia.id, ia.issue_id, ia.user_id, ia.assigned_at
        FROM local_issue_assignees ia
        JOIN local_issues i ON i.id = ia.issue_id
        WHERE i.project_id = ?
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(issue_assignee_from_row)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApiError::from)
}

fn issue_follower_from_row(row: &SqliteRow) -> Result<IssueFollower, sqlx::Error> {
    Ok(IssueFollower {
        id: row.try_get("id")?,
        issue_id: row.try_get("issue_id")?,
        user_id: row.try_get("user_id")?,
    })
}

async fn list_project_issue_followers(
    pool: &SqlitePool,
    project_id: Uuid,
) -> Result<Vec<IssueFollower>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT f.id, f.issue_id, f.user_id
        FROM local_issue_followers f
        JOIN local_issues i ON i.id = f.issue_id
        WHERE i.project_id = ?
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(issue_follower_from_row)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApiError::from)
}

fn issue_relationship_from_row(row: &SqliteRow) -> Result<IssueRelationship, sqlx::Error> {
    Ok(IssueRelationship {
        id: row.try_get("id")?,
        issue_id: row.try_get("issue_id")?,
        related_issue_id: row.try_get("related_issue_id")?,
        relationship_type: relationship_type_from_str(row.try_get("relationship_type")?),
        created_at: row.try_get("created_at")?,
    })
}

async fn list_project_issue_relationships(
    pool: &SqlitePool,
    project_id: Uuid,
) -> Result<Vec<IssueRelationship>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT r.id, r.issue_id, r.related_issue_id, r.relationship_type, r.created_at
        FROM local_issue_relationships r
        JOIN local_issues i ON i.id = r.issue_id
        WHERE i.project_id = ?
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(issue_relationship_from_row)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApiError::from)
}

fn issue_comment_from_row(row: &SqliteRow) -> Result<IssueComment, sqlx::Error> {
    Ok(IssueComment {
        id: row.try_get("id")?,
        issue_id: row.try_get("issue_id")?,
        author_id: row.try_get("author_id")?,
        parent_id: row.try_get("parent_id")?,
        message: row.try_get("message")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn list_issue_comments(
    pool: &SqlitePool,
    issue_id: Uuid,
) -> Result<Vec<IssueComment>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT id, issue_id, author_id, parent_id, message, created_at, updated_at
        FROM local_issue_comments
        WHERE issue_id = ?
        ORDER BY created_at ASC
        "#,
    )
    .bind(issue_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(issue_comment_from_row)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApiError::from)
}

async fn get_issue_comment(pool: &SqlitePool, comment_id: Uuid) -> Result<IssueComment, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, issue_id, author_id, parent_id, message, created_at, updated_at
        FROM local_issue_comments
        WHERE id = ?
        "#,
    )
    .bind(comment_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest("Issue comment not found".to_string()))?;

    issue_comment_from_row(&row).map_err(ApiError::from)
}

fn issue_comment_reaction_from_row(row: &SqliteRow) -> Result<IssueCommentReaction, sqlx::Error> {
    Ok(IssueCommentReaction {
        id: row.try_get("id")?,
        comment_id: row.try_get("comment_id")?,
        user_id: row.try_get("user_id")?,
        emoji: row.try_get("emoji")?,
        created_at: row.try_get("created_at")?,
    })
}

async fn list_issue_comment_reactions(
    pool: &SqlitePool,
    issue_id: Uuid,
) -> Result<Vec<IssueCommentReaction>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT r.id, r.comment_id, r.user_id, r.emoji, r.created_at
        FROM local_issue_comment_reactions r
        JOIN local_issue_comments c ON c.id = r.comment_id
        WHERE c.issue_id = ?
        ORDER BY r.created_at ASC
        "#,
    )
    .bind(issue_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(issue_comment_reaction_from_row)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApiError::from)
}

async fn get_issue_comment_reaction(
    pool: &SqlitePool,
    reaction_id: Uuid,
) -> Result<IssueCommentReaction, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, comment_id, user_id, emoji, created_at
        FROM local_issue_comment_reactions
        WHERE id = ?
        "#,
    )
    .bind(reaction_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest("Issue comment reaction not found".to_string()))?;

    issue_comment_reaction_from_row(&row).map_err(ApiError::from)
}

async fn list_project_workspaces(
    pool: &SqlitePool,
    project_id: Uuid,
) -> Result<Vec<Workspace>, ApiError> {
    let workspaces = sqlx::query_as::<_, Workspace>(
        r#"
        SELECT
            w.id,
            i.project_id,
            ? AS owner_user_id,
            i.id AS issue_id,
            w.id AS local_workspace_id,
            w.name,
            w.archived,
            NULL AS files_changed,
            NULL AS lines_added,
            NULL AS lines_removed,
            w.created_at,
            w.updated_at
        FROM workspaces w
        JOIN local_workspace_links l ON l.workspace_id = w.id
        JOIN local_issues i ON i.id = l.issue_id
        WHERE l.project_id = ?
        ORDER BY w.updated_at DESC
        "#,
    )
    .bind(local_user_id())
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    Ok(workspaces)
}

async fn list_user_workspaces(pool: &SqlitePool) -> Result<Vec<Workspace>, ApiError> {
    let workspaces = sqlx::query_as::<_, Workspace>(
        r#"
        SELECT
            w.id,
            i.project_id,
            ? AS owner_user_id,
            i.id AS issue_id,
            w.id AS local_workspace_id,
            w.name,
            w.archived,
            NULL AS files_changed,
            NULL AS lines_added,
            NULL AS lines_removed,
            w.created_at,
            w.updated_at
        FROM workspaces w
        JOIN local_workspace_links l ON l.workspace_id = w.id
        JOIN local_issues i ON i.id = l.issue_id
        ORDER BY w.updated_at DESC
        "#,
    )
    .bind(local_user_id())
    .fetch_all(pool)
    .await?;

    Ok(workspaces)
}

async fn list_organizations() -> ResponseJson<ListOrganizationsResponse> {
    let now = Utc::now();
    ResponseJson(ListOrganizationsResponse {
        organizations: vec![OrganizationWithRole {
            id: local_org_id(),
            name: "Local".to_string(),
            slug: "local".to_string(),
            is_personal: true,
            issue_prefix: "LOCAL".to_string(),
            created_at: now,
            updated_at: now,
            user_role: MemberRole::Admin,
        }],
    })
}

async fn list_members(Path(_org_id): Path<Uuid>) -> ResponseJson<ListMembersResponse> {
    ResponseJson(ListMembersResponse {
        members: vec![OrganizationMemberWithProfile {
            user_id: local_user_id(),
            role: MemberRole::Admin,
            joined_at: Utc::now(),
            first_name: Some("Local".to_string()),
            last_name: Some("User".to_string()),
            username: Some("local".to_string()),
            email: Some("local@vibe-kanban.local".to_string()),
            avatar_url: None,
        }],
    })
}

async fn fallback_organization_members(
    Query(query): Query<OrganizationQuery>,
) -> ResponseJson<Value> {
    if query.organization_id != Some(local_org_id()) {
        return empty_rows("organization_member_metadata");
    }

    ResponseJson(json!({
        "organization_member_metadata": [OrganizationMember {
            organization_id: local_org_id(),
            user_id: local_user_id(),
            role: MemberRole::Admin,
            joined_at: Utc::now(),
            last_seen_at: None,
        }]
    }))
}

async fn fallback_users(Query(query): Query<OrganizationQuery>) -> ResponseJson<Value> {
    if query.organization_id != Some(local_org_id()) {
        return empty_rows("users");
    }

    ResponseJson(json!({
        "users": [User {
            id: local_user_id(),
            email: "local@vibe-kanban.local".to_string(),
            first_name: Some("Local".to_string()),
            last_name: Some("User".to_string()),
            username: Some("local".to_string()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }]
    }))
}

async fn fallback_projects(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<OrganizationQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    if query.organization_id != Some(local_org_id()) {
        return Ok(empty_rows("projects"));
    }

    let projects = list_local_projects(&deployment.db().pool).await?;
    Ok(ResponseJson(json!({ "projects": projects })))
}

async fn fallback_project_statuses(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ProjectQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    let Some(project_id) = query.project_id else {
        return Ok(empty_rows("project_statuses"));
    };

    let statuses = ensure_default_statuses(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(json!({ "project_statuses": statuses })))
}

async fn fallback_issues(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ProjectQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    let Some(project_id) = query.project_id else {
        return Ok(empty_rows("issues"));
    };

    let issues = list_project_issues(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(json!({ "issues": issues })))
}

async fn fallback_tags(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ProjectQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    let Some(project_id) = query.project_id else {
        return Ok(empty_rows("tags"));
    };

    let tags = list_project_tags(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(json!({ "tags": tags })))
}

async fn fallback_issue_tags(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ProjectQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    let Some(project_id) = query.project_id else {
        return Ok(empty_rows("issue_tags"));
    };

    let issue_tags = list_project_issue_tags(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(json!({ "issue_tags": issue_tags })))
}

async fn fallback_issue_assignees(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ProjectQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    let Some(project_id) = query.project_id else {
        return Ok(empty_rows("issue_assignees"));
    };

    let issue_assignees = list_project_issue_assignees(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(json!({ "issue_assignees": issue_assignees })))
}

async fn fallback_issue_followers(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ProjectQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    let Some(project_id) = query.project_id else {
        return Ok(empty_rows("issue_followers"));
    };

    let issue_followers = list_project_issue_followers(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(json!({ "issue_followers": issue_followers })))
}

async fn fallback_issue_relationships(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ProjectQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    let Some(project_id) = query.project_id else {
        return Ok(empty_rows("issue_relationships"));
    };

    let issue_relationships =
        list_project_issue_relationships(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(
        json!({ "issue_relationships": issue_relationships }),
    ))
}

async fn fallback_pull_requests() -> ResponseJson<Value> {
    empty_rows("pull_requests")
}

async fn fallback_pull_request_issues() -> ResponseJson<Value> {
    empty_rows("pull_request_issues")
}

async fn fallback_project_workspaces(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ProjectQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    let Some(project_id) = query.project_id else {
        return Ok(empty_rows("workspaces"));
    };

    let workspaces = list_project_workspaces(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(json!({ "workspaces": workspaces })))
}

async fn fallback_user_workspaces(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<UserQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    if query
        .user_id
        .is_some_and(|user_id| user_id != local_user_id())
    {
        return Ok(empty_rows("workspaces"));
    }

    let workspaces = list_user_workspaces(&deployment.db().pool).await?;
    Ok(ResponseJson(json!({ "workspaces": workspaces })))
}

async fn fallback_notifications() -> ResponseJson<Value> {
    empty_rows("notifications")
}

async fn fallback_issue_comments(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<IssueQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    let Some(issue_id) = query.issue_id else {
        return Ok(empty_rows("issue_comments"));
    };

    let issue_comments = list_issue_comments(&deployment.db().pool, issue_id).await?;
    Ok(ResponseJson(json!({ "issue_comments": issue_comments })))
}

async fn fallback_issue_comment_reactions(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<IssueQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    let Some(issue_id) = query.issue_id else {
        return Ok(empty_rows("issue_comment_reactions"));
    };

    let issue_comment_reactions =
        list_issue_comment_reactions(&deployment.db().pool, issue_id).await?;
    Ok(ResponseJson(
        json!({ "issue_comment_reactions": issue_comment_reactions }),
    ))
}

async fn create_project(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateProjectRequest>,
) -> Result<ResponseJson<MutationResponse<Project>>, ApiError> {
    let data = create_local_project(&deployment.db().pool, request).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn get_project(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<Project>, ApiError> {
    Ok(ResponseJson(
        get_local_project(&deployment.db().pool, project_id).await?,
    ))
}

async fn update_project(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(changes): Json<UpdateProjectRequest>,
) -> Result<ResponseJson<MutationResponse<Project>>, ApiError> {
    let data = update_local_project(&deployment.db().pool, project_id, changes).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn bulk_update_projects(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<BulkUpdateProjectsRequest>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    for update in request.updates {
        update_local_project(&deployment.db().pool, update.id, update.changes).await?;
    }

    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn delete_project(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(project_id)
        .execute(&deployment.db().pool)
        .await?;

    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn create_project_status(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateProjectStatusRequest>,
) -> Result<ResponseJson<MutationResponse<ProjectStatus>>, ApiError> {
    let data = create_local_status(&deployment.db().pool, request).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn update_project_status(
    State(deployment): State<DeploymentImpl>,
    Path(status_id): Path<Uuid>,
    Json(changes): Json<UpdateProjectStatusRequest>,
) -> Result<ResponseJson<MutationResponse<ProjectStatus>>, ApiError> {
    let data = update_local_status(&deployment.db().pool, status_id, changes).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn bulk_update_project_statuses(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<BulkUpdateProjectStatusesRequest>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    for update in request.updates {
        update_local_status(&deployment.db().pool, update.id, update.changes).await?;
    }

    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn delete_project_status(
    State(deployment): State<DeploymentImpl>,
    Path(status_id): Path<Uuid>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    sqlx::query("DELETE FROM local_project_statuses WHERE id = ?")
        .bind(status_id)
        .execute(&deployment.db().pool)
        .await?;

    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn create_issue(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateIssueRequest>,
) -> Result<ResponseJson<MutationResponse<Issue>>, ApiError> {
    let data = create_local_issue(&deployment.db().pool, request).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn update_issue(
    State(deployment): State<DeploymentImpl>,
    Path(issue_id): Path<Uuid>,
    Json(changes): Json<UpdateIssueRequest>,
) -> Result<ResponseJson<MutationResponse<Issue>>, ApiError> {
    let data = update_local_issue(&deployment.db().pool, issue_id, changes).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn bulk_update_issues(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<BulkUpdateIssuesRequest>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    for update in request.updates {
        update_local_issue(&deployment.db().pool, update.id, update.changes).await?;
    }

    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn delete_issue(
    State(deployment): State<DeploymentImpl>,
    Path(issue_id): Path<Uuid>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    sqlx::query("DELETE FROM local_issues WHERE id = ?")
        .bind(issue_id)
        .execute(&deployment.db().pool)
        .await?;

    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn create_tag(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateTagRequest>,
) -> Result<ResponseJson<MutationResponse<Tag>>, ApiError> {
    let id = request.id.unwrap_or_else(Uuid::new_v4);
    sqlx::query("INSERT INTO local_tags (id, project_id, name, color) VALUES (?, ?, ?, ?)")
        .bind(id)
        .bind(request.project_id)
        .bind(request.name)
        .bind(request.color)
        .execute(&deployment.db().pool)
        .await?;
    let data = get_local_tag(&deployment.db().pool, id).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn update_tag(
    State(deployment): State<DeploymentImpl>,
    Path(tag_id): Path<Uuid>,
    Json(changes): Json<UpdateTagRequest>,
) -> Result<ResponseJson<MutationResponse<Tag>>, ApiError> {
    let existing = get_local_tag(&deployment.db().pool, tag_id).await?;
    sqlx::query("UPDATE local_tags SET name = ?, color = ? WHERE id = ?")
        .bind(changes.name.unwrap_or(existing.name))
        .bind(changes.color.unwrap_or(existing.color))
        .bind(tag_id)
        .execute(&deployment.db().pool)
        .await?;
    let data = get_local_tag(&deployment.db().pool, tag_id).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn delete_tag(
    State(deployment): State<DeploymentImpl>,
    Path(tag_id): Path<Uuid>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    sqlx::query("DELETE FROM local_tags WHERE id = ?")
        .bind(tag_id)
        .execute(&deployment.db().pool)
        .await?;
    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn create_issue_tag(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateIssueTagRequest>,
) -> Result<ResponseJson<MutationResponse<IssueTag>>, ApiError> {
    let id = request.id.unwrap_or_else(Uuid::new_v4);
    sqlx::query("INSERT OR IGNORE INTO local_issue_tags (id, issue_id, tag_id) VALUES (?, ?, ?)")
        .bind(id)
        .bind(request.issue_id)
        .bind(request.tag_id)
        .execute(&deployment.db().pool)
        .await?;
    let data = IssueTag {
        id,
        issue_id: request.issue_id,
        tag_id: request.tag_id,
    };
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn delete_issue_tag(
    State(deployment): State<DeploymentImpl>,
    Path(issue_tag_id): Path<Uuid>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    sqlx::query("DELETE FROM local_issue_tags WHERE id = ?")
        .bind(issue_tag_id)
        .execute(&deployment.db().pool)
        .await?;
    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn create_issue_assignee(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateIssueAssigneeRequest>,
) -> Result<ResponseJson<MutationResponse<IssueAssignee>>, ApiError> {
    let id = request.id.unwrap_or_else(Uuid::new_v4);
    sqlx::query(
        "INSERT OR IGNORE INTO local_issue_assignees (id, issue_id, user_id) VALUES (?, ?, ?)",
    )
    .bind(id)
    .bind(request.issue_id)
    .bind(request.user_id)
    .execute(&deployment.db().pool)
    .await?;

    let data = IssueAssignee {
        id,
        issue_id: request.issue_id,
        user_id: request.user_id,
        assigned_at: Utc::now(),
    };
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn delete_issue_assignee(
    State(deployment): State<DeploymentImpl>,
    Path(issue_assignee_id): Path<Uuid>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    sqlx::query("DELETE FROM local_issue_assignees WHERE id = ?")
        .bind(issue_assignee_id)
        .execute(&deployment.db().pool)
        .await?;
    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn create_issue_follower(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateIssueFollowerRequest>,
) -> Result<ResponseJson<MutationResponse<IssueFollower>>, ApiError> {
    let id = request.id.unwrap_or_else(Uuid::new_v4);
    sqlx::query(
        "INSERT OR IGNORE INTO local_issue_followers (id, issue_id, user_id) VALUES (?, ?, ?)",
    )
    .bind(id)
    .bind(request.issue_id)
    .bind(request.user_id)
    .execute(&deployment.db().pool)
    .await?;

    let data = IssueFollower {
        id,
        issue_id: request.issue_id,
        user_id: request.user_id,
    };
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn delete_issue_follower(
    State(deployment): State<DeploymentImpl>,
    Path(issue_follower_id): Path<Uuid>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    sqlx::query("DELETE FROM local_issue_followers WHERE id = ?")
        .bind(issue_follower_id)
        .execute(&deployment.db().pool)
        .await?;
    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn create_issue_relationship(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateIssueRelationshipRequest>,
) -> Result<ResponseJson<MutationResponse<IssueRelationship>>, ApiError> {
    let id = request.id.unwrap_or_else(Uuid::new_v4);
    sqlx::query(
        r#"
        INSERT INTO local_issue_relationships
            (id, issue_id, related_issue_id, relationship_type)
        VALUES (?, ?, ?, ?)
        "#,
    )
    .bind(id)
    .bind(request.issue_id)
    .bind(request.related_issue_id)
    .bind(relationship_type_to_str(request.relationship_type))
    .execute(&deployment.db().pool)
    .await?;

    let data = IssueRelationship {
        id,
        issue_id: request.issue_id,
        related_issue_id: request.related_issue_id,
        relationship_type: request.relationship_type,
        created_at: Utc::now(),
    };
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn delete_issue_relationship(
    State(deployment): State<DeploymentImpl>,
    Path(relationship_id): Path<Uuid>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    sqlx::query("DELETE FROM local_issue_relationships WHERE id = ?")
        .bind(relationship_id)
        .execute(&deployment.db().pool)
        .await?;
    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn create_issue_comment(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateIssueCommentRequest>,
) -> Result<ResponseJson<MutationResponse<IssueComment>>, ApiError> {
    let id = request.id.unwrap_or_else(Uuid::new_v4);
    sqlx::query(
        r#"
        INSERT INTO local_issue_comments
            (id, issue_id, author_id, parent_id, message)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(id)
    .bind(request.issue_id)
    .bind(local_user_id())
    .bind(request.parent_id)
    .bind(request.message)
    .execute(&deployment.db().pool)
    .await?;

    let data = get_issue_comment(&deployment.db().pool, id).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn update_issue_comment(
    State(deployment): State<DeploymentImpl>,
    Path(comment_id): Path<Uuid>,
    Json(changes): Json<UpdateIssueCommentRequest>,
) -> Result<ResponseJson<MutationResponse<IssueComment>>, ApiError> {
    let existing = get_issue_comment(&deployment.db().pool, comment_id).await?;
    sqlx::query(
        r#"
        UPDATE local_issue_comments
        SET message = ?, parent_id = ?, updated_at = datetime('now', 'subsec')
        WHERE id = ?
        "#,
    )
    .bind(changes.message.unwrap_or(existing.message))
    .bind(changes.parent_id.unwrap_or(existing.parent_id))
    .bind(comment_id)
    .execute(&deployment.db().pool)
    .await?;

    let data = get_issue_comment(&deployment.db().pool, comment_id).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn delete_issue_comment(
    State(deployment): State<DeploymentImpl>,
    Path(comment_id): Path<Uuid>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    sqlx::query("DELETE FROM local_issue_comments WHERE id = ?")
        .bind(comment_id)
        .execute(&deployment.db().pool)
        .await?;
    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

async fn create_issue_comment_reaction(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateIssueCommentReactionRequest>,
) -> Result<ResponseJson<MutationResponse<IssueCommentReaction>>, ApiError> {
    let id = request.id.unwrap_or_else(Uuid::new_v4);
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO local_issue_comment_reactions
            (id, comment_id, user_id, emoji)
        VALUES (?, ?, ?, ?)
        "#,
    )
    .bind(id)
    .bind(request.comment_id)
    .bind(local_user_id())
    .bind(request.emoji)
    .execute(&deployment.db().pool)
    .await?;

    let data = get_issue_comment_reaction(&deployment.db().pool, id).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn delete_issue_comment_reaction(
    State(deployment): State<DeploymentImpl>,
    Path(reaction_id): Path<Uuid>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    sqlx::query("DELETE FROM local_issue_comment_reactions WHERE id = ?")
        .bind(reaction_id)
        .execute(&deployment.db().pool)
        .await?;
    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

// ─────────────────────────────────────────────────────────────────────
// AI Arena (race mode)
//
// One arena_group represents N parallel attempts at a single local
// kanban issue, each running in its own workspace + worktree under a
// different executor. See docs/future/ai-arena/spec.md for the full
// design and notes-step0.md §2 / §5 for the rationale behind the
// promote-via-archived-flag pattern (it triggers the existing 1h
// accelerated cleanup path in `find_expired_for_cleanup`).
// ─────────────────────────────────────────────────────────────────────

const ARENA_MIN_ATTEMPTS: usize = 2;
const ARENA_MAX_ATTEMPTS: usize = 6;

/// Per-project ceiling for parallel arena attempts. Falls back to the
/// global hard limit (`ARENA_MAX_ATTEMPTS`) when the row hasn't been
/// migrated yet (e.g. very old DBs predating the `arena_max_workspaces`
/// column).
async fn arena_max_for_project(pool: &SqlitePool, project_id: Uuid) -> Result<usize, ApiError> {
    let row: Option<i64> = sqlx::query_scalar(
        r#"SELECT arena_max_workspaces
             FROM local_project_metadata
            WHERE project_id = ?"#,
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;

    let project_cap = row
        .and_then(|v| usize::try_from(v).ok())
        .unwrap_or(ARENA_MAX_ATTEMPTS);

    Ok(project_cap.clamp(ARENA_MIN_ATTEMPTS, ARENA_MAX_ATTEMPTS))
}

/// One executor slot in a `CreateArenaRequest`. Mirrors the structure
/// of `CreateAndStartWorkspaceRequest` for a single attempt: a fully
/// resolved `ExecutorConfig`, an optional per-attempt name, and an
/// optional per-attempt prompt override (defaults to the group's
/// shared `prompt`).
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
pub struct ArenaAttemptInput {
    pub executor_config: ExecutorConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Optional per-attempt prompt override. Falls back to the
    /// group-level `prompt` when not provided.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
pub struct CreateArenaRequest {
    pub project_id: Uuid,
    pub base_branch: String,
    pub prompt: String,
    #[serde(default)]
    pub mode: ArenaMode,
    pub repos: Vec<WorkspaceRepoInput>,
    pub attempts: Vec<ArenaAttemptInput>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct ArenaWorkspaceSummary {
    pub workspace_id: Uuid,
    pub session_id: Option<Uuid>,
    pub name: Option<String>,
    pub branch: String,
    pub purpose: ArenaWorkspacePurpose,
    pub arena_status: ArenaStatus,
    pub executor: Option<String>,
    pub variant: Option<String>,
    pub latest_execution_status: Option<ExecutionProcessStatus>,
    pub has_uncommitted_changes: Option<bool>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ArenaWorkspacePurpose {
    #[default]
    Attempt,
    Synthesis,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, sqlx::Type)]
#[sqlx(type_name = "arena_event_kind", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ArenaEventKind {
    AskAll,
    Workspace,
    Challenge,
    Synthesize,
    StartImplementation,
}

#[derive(Debug, Clone, Serialize, TS, sqlx::FromRow)]
pub struct ArenaEvent {
    pub id: Uuid,
    pub arena_group_id: Uuid,
    pub kind: ArenaEventKind,
    pub prompt: String,
    pub source_workspace_id: Option<Uuid>,
    pub target_workspace_id: Option<Uuid>,
    pub synthesis_workspace_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct ArenaGroupResponse {
    #[serde(flatten)]
    pub group: ArenaGroup,
    pub workspaces: Vec<ArenaWorkspaceSummary>,
    pub events: Vec<ArenaEvent>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
pub struct PromoteArenaRequest {
    pub workspace_id: Uuid,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
pub struct RetryArenaRequest {
    pub executor_config: ExecutorConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Optional override; falls back to the group's prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct DissolveArenaResponse {
    pub group_id: Uuid,
    pub workspaces_archived: usize,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct CloseArenaResponse {
    pub group_id: Uuid,
    pub lifecycle_status: ArenaLifecycleStatus,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
pub struct StartArenaImplementationRequest {
    pub workspace_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub follow_up_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executor_config: Option<ExecutorConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ArenaMessageTarget {
    All,
    Workspace {
        workspace_id: Uuid,
    },
    Challenge {
        responder_workspace_id: Uuid,
        source_workspace_id: Uuid,
    },
    Synthesize {
        #[serde(default)]
        options: ArenaSynthesizeOptions,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ArenaSynthesizeOptions {
    pub include_original_prompt: bool,
    pub include_attempt_summaries: bool,
    pub include_activity: bool,
}

impl Default for ArenaSynthesizeOptions {
    fn default() -> Self {
        Self {
            include_original_prompt: true,
            include_attempt_summaries: true,
            include_activity: true,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
pub struct ArenaMessageRequest {
    pub target: ArenaMessageTarget,
    pub prompt: String,
    pub executor_config: ExecutorConfig,
    #[serde(default)]
    pub executor_configs: Vec<ArenaWorkspaceExecutorConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
pub struct ArenaWorkspaceExecutorConfig {
    pub workspace_id: Uuid,
    pub executor_config: ExecutorConfig,
}

/// Insert (or upsert) a row into `local_workspace_links` so the new
/// workspace shows up under the issue everywhere the rest of the
/// fallback queries already join through that table.
async fn insert_workspace_link(
    pool: &SqlitePool,
    workspace_id: Uuid,
    project_id: Uuid,
    issue_id: Uuid,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"INSERT INTO local_workspace_links
               (workspace_id, project_id, issue_id)
           VALUES (?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE
               SET project_id = excluded.project_id,
                   issue_id   = excluded.issue_id,
                   updated_at = datetime('now', 'subsec')"#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(issue_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Verify the issue exists and belongs to the project.
async fn ensure_issue_in_project(
    pool: &SqlitePool,
    issue_id: Uuid,
    project_id: Uuid,
) -> Result<(), ApiError> {
    let row = sqlx::query("SELECT 1 FROM local_issues WHERE id = ? AND project_id = ?")
        .bind(issue_id)
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
    if row.is_none() {
        return Err(ApiError::BadRequest(format!(
            "issue {issue_id} does not belong to project {project_id}"
        )));
    }
    Ok(())
}

fn arena_workspace_purpose_from_name(name: Option<&str>) -> ArenaWorkspacePurpose {
    if name
        .map(str::trim)
        .is_some_and(|name| name.starts_with(ARENA_SYNTHESIS_WORKSPACE_PREFIX))
    {
        ArenaWorkspacePurpose::Synthesis
    } else {
        ArenaWorkspacePurpose::Attempt
    }
}

fn is_synthesis_workspace(workspace: &DbWorkspace) -> bool {
    arena_workspace_purpose_from_name(workspace.name.as_deref()) == ArenaWorkspacePurpose::Synthesis
}

fn find_attempt_workspace_in_group<'a>(
    workspaces: &'a [DbWorkspace],
    group_id: Uuid,
    workspace_id: Uuid,
) -> Result<&'a DbWorkspace, ArenaGroupError> {
    workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id && !is_synthesis_workspace(workspace))
        .ok_or(ArenaGroupError::WorkspaceNotInGroup {
            group_id,
            workspace_id,
        })
}

fn build_design_arena_prompt(prompt: &str) -> String {
    format!(
        "You are in AI Arena Design Mode.\n\
         Your goal is to produce a design direction, reasoning, tradeoffs, risks, and decision support.\n\
         Use free-form prose. Do not force a fixed template.\n\
         You may inspect the repository for context, but do not create commits, push branches, open PRs, or treat code changes as the final output.\n\
         If you change files while exploring, leave them uncommitted unless the user explicitly asks to start implementation.\n\n\
         User request:\n{}",
        prompt
    )
}

fn build_attempt_prompt(mode: ArenaMode, prompt: &str) -> String {
    match mode {
        ArenaMode::Design => build_design_arena_prompt(prompt),
        ArenaMode::Implementation => prompt.to_string(),
    }
}

fn build_synthesis_prompt(
    instruction: &str,
    original_prompt: &str,
    attempt_sections: &[String],
    activity_sections: &[String],
    options: &ArenaSynthesizeOptions,
) -> String {
    let mut sections = vec![
        "You are the independent synthesis agent for an AI Arena.\n\
         Write a neutral decision memo. Compare the attempts, preserve disagreement, tradeoffs, and open risks.\n\
         Do not inherit or assume any single attempt's position. Do not create commits, push branches, or open PRs."
            .to_string(),
        format!("User synthesis instruction:\n{}", instruction.trim()),
    ];

    if options.include_original_prompt {
        sections.push(format!(
            "Original Arena prompt:\n{}",
            original_prompt.trim()
        ));
    }

    if options.include_attempt_summaries {
        sections.push(format!(
            "Attempt summaries:\n\n{}",
            if attempt_sections.is_empty() {
                "No attempt summaries available yet.".to_string()
            } else {
                attempt_sections.join("\n\n")
            }
        ));
    }

    if options.include_activity {
        sections.push(format!(
            "Arena activity history:\n\n{}",
            if activity_sections.is_empty() {
                "No prior page-level activity recorded.".to_string()
            } else {
                activity_sections.join("\n\n")
            }
        ));
    }

    sections.join("\n\n---\n\n")
}

async fn latest_session_id_for_workspace(
    pool: &SqlitePool,
    workspace_id: Uuid,
) -> Result<Option<Uuid>, ApiError> {
    Ok(sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id
             FROM sessions
            WHERE workspace_id = ?
            ORDER BY created_at DESC
            LIMIT 1"#,
    )
    .bind(workspace_id)
    .fetch_optional(pool)
    .await?)
}

async fn latest_execution_status_for_workspace(
    pool: &SqlitePool,
    workspace_id: Uuid,
) -> Result<Option<ExecutionProcessStatus>, ApiError> {
    Ok(sqlx::query_scalar::<_, ExecutionProcessStatus>(
        r#"SELECT ep.status
             FROM sessions s
             JOIN execution_processes ep ON ep.session_id = s.id
            WHERE s.workspace_id = ?
              AND ep.run_reason = 'codingagent'
            ORDER BY ep.created_at DESC
            LIMIT 1"#,
    )
    .bind(workspace_id)
    .fetch_optional(pool)
    .await?)
}

async fn workspace_to_summary(
    pool: &SqlitePool,
    ws: &DbWorkspace,
    executor_config: Option<&ExecutorConfig>,
) -> Result<ArenaWorkspaceSummary, ApiError> {
    Ok(ArenaWorkspaceSummary {
        workspace_id: ws.id,
        session_id: latest_session_id_for_workspace(pool, ws.id).await?,
        name: ws.name.clone(),
        branch: ws.branch.clone(),
        purpose: arena_workspace_purpose_from_name(ws.name.as_deref()),
        arena_status: ws.arena_status,
        executor: executor_config.map(|c| c.executor.to_string()),
        variant: executor_config.and_then(|c| c.variant.clone()),
        latest_execution_status: latest_execution_status_for_workspace(pool, ws.id).await?,
        has_uncommitted_changes: None,
    })
}

/// Spawn one workspace inside a group: create the DB row, attach
/// repos, link to the issue, mark `arena_group_id`, then start the
/// initial coding agent execution. The whole thing is sequential per
/// call so we can surface a precise error per-attempt; the caller
/// loops over N attempts.
async fn spawn_arena_attempt(
    deployment: &DeploymentImpl,
    group: &ArenaGroup,
    issue_id: Uuid,
    project_id: Uuid,
    repos: &[WorkspaceRepoInput],
    attempt: ArenaAttemptInput,
    attempt_index: usize,
) -> Result<(DbWorkspace, ExecutorConfig), ApiError> {
    let pool = &deployment.db().pool;

    let attempt_prompt = attempt
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| group.prompt.clone());
    if attempt_prompt.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Arena prompt must not be empty.".to_string(),
        ));
    }

    let display_name = attempt.name.clone().unwrap_or_else(|| {
        format!(
            "{}-arena-{}",
            attempt.executor_config.executor.to_string().to_lowercase(),
            attempt_index + 1
        )
    });

    let workspace = create_workspace_record(deployment, Some(display_name)).await?;

    let mut managed_workspace = deployment
        .workspace_manager()
        .load_managed_workspace(workspace.clone())
        .await?;
    for repo in repos {
        managed_workspace
            .add_repository(repo, deployment.git())
            .await
            .map_err(ApiError::from)?;
    }

    let workspace = managed_workspace.workspace.clone();

    DbWorkspace::set_arena_group_id(pool, workspace.id, Some(group.id)).await?;
    DbWorkspace::set_arena_status(pool, workspace.id, ArenaStatus::Active).await?;
    insert_workspace_link(pool, workspace.id, project_id, issue_id).await?;

    deployment
        .container()
        .start_workspace(
            &workspace,
            attempt.executor_config.clone(),
            build_attempt_prompt(group.mode, &attempt_prompt),
        )
        .await?;

    let updated = DbWorkspace::find_by_id(pool, workspace.id)
        .await?
        .unwrap_or(workspace);

    Ok((updated, attempt.executor_config))
}

async fn workspaces_for_group(
    pool: &SqlitePool,
    group_id: Uuid,
) -> Result<Vec<ArenaWorkspaceSummary>, ApiError> {
    let workspaces = DbWorkspace::find_by_arena_group_id(pool, group_id).await?;
    let mut summaries = Vec::with_capacity(workspaces.len());
    for ws in workspaces.iter() {
        summaries.push(workspace_to_summary(pool, ws, None).await?);
    }
    Ok(summaries)
}

async fn arena_events_for_group(
    pool: &SqlitePool,
    group_id: Uuid,
) -> Result<Vec<ArenaEvent>, ApiError> {
    Ok(sqlx::query_as::<_, ArenaEvent>(
        r#"SELECT id,
                  arena_group_id,
                  kind,
                  prompt,
                  source_workspace_id,
                  target_workspace_id,
                  synthesis_workspace_id,
                  created_at
             FROM arena_events
            WHERE arena_group_id = ?
            ORDER BY created_at ASC"#,
    )
    .bind(group_id)
    .fetch_all(pool)
    .await?)
}

struct RecordArenaEvent<'a> {
    group_id: Uuid,
    kind: ArenaEventKind,
    prompt: &'a str,
    source_workspace_id: Option<Uuid>,
    target_workspace_id: Option<Uuid>,
    synthesis_workspace_id: Option<Uuid>,
}

async fn record_arena_event(
    pool: &SqlitePool,
    event: RecordArenaEvent<'_>,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"INSERT INTO arena_events
               (id, arena_group_id, kind, prompt, source_workspace_id, target_workspace_id, synthesis_workspace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(Uuid::new_v4())
    .bind(event.group_id)
    .bind(event.kind)
    .bind(event.prompt)
    .bind(event.source_workspace_id)
    .bind(event.target_workspace_id)
    .bind(event.synthesis_workspace_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn arena_group_response(
    pool: &SqlitePool,
    group: ArenaGroup,
) -> Result<ArenaGroupResponse, ApiError> {
    let workspaces = workspaces_for_group(pool, group.id).await?;
    let events = arena_events_for_group(pool, group.id).await?;
    Ok(ArenaGroupResponse {
        group,
        workspaces,
        events,
    })
}

async fn create_arena_group(
    State(deployment): State<DeploymentImpl>,
    Path(issue_id): Path<Uuid>,
    Json(payload): Json<CreateArenaRequest>,
) -> Result<ResponseJson<MutationResponse<ArenaGroupResponse>>, ApiError> {
    let CreateArenaRequest {
        project_id,
        base_branch,
        prompt,
        mode,
        repos,
        attempts,
    } = payload;

    if attempts.len() < ARENA_MIN_ATTEMPTS {
        return Err(ApiError::BadRequest(format!(
            "Arena requires at least {ARENA_MIN_ATTEMPTS} attempts, got {}",
            attempts.len()
        )));
    }

    let pool = &deployment.db().pool;
    let project_max = arena_max_for_project(pool, project_id).await?;
    if attempts.len() > project_max {
        return Err(ApiError::BadRequest(format!(
            "Project allows at most {project_max} arena attempts, got {}",
            attempts.len()
        )));
    }
    if repos.is_empty() {
        return Err(ApiError::BadRequest(
            "At least one repository is required.".to_string(),
        ));
    }
    if prompt.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Arena prompt must not be empty.".to_string(),
        ));
    }

    ensure_issue_in_project(pool, issue_id, project_id).await?;

    if ArenaGroup::find_active_by_issue_id(pool, issue_id)
        .await?
        .is_some()
    {
        return Err(ApiError::BadRequest(format!(
            "issue {issue_id} already has an active arena group; close, adopt, promote, or dissolve it first"
        )));
    }

    let group = ArenaGroup::create(
        pool,
        &CreateArenaGroup {
            issue_id,
            project_id,
            prompt: prompt.clone(),
            base_branch: base_branch.clone(),
            mode,
        },
    )
    .await?;

    let mut summaries = Vec::with_capacity(attempts.len());
    for (idx, attempt) in attempts.into_iter().enumerate() {
        match spawn_arena_attempt(
            &deployment,
            &group,
            issue_id,
            project_id,
            &repos,
            attempt,
            idx,
        )
        .await
        {
            Ok((workspace, executor_config)) => {
                summaries
                    .push(workspace_to_summary(pool, &workspace, Some(&executor_config)).await?);
            }
            Err(err) => {
                tracing::error!(
                    arena_group_id = %group.id,
                    attempt_index = idx,
                    "failed to spawn arena attempt: {err:#}"
                );
                // Best-effort cleanup: leave the group + already-spawned
                // workspaces in place (the user can dissolve via the
                // DELETE endpoint). The error reflects the first failing
                // attempt so the UI can surface it.
                return Err(err);
            }
        }
    }

    deployment
        .track_if_analytics_allowed(
            "arena_group_created",
            json!({
                "arena_group_id": group.id.to_string(),
                "issue_id":       issue_id.to_string(),
                "attempt_count":  summaries.len(),
            }),
        )
        .await;

    Ok(ResponseJson(MutationResponse {
        data: ArenaGroupResponse {
            group,
            workspaces: summaries,
            events: Vec::new(),
        },
        txid: txid(),
    }))
}

async fn get_active_arena_for_issue(
    State(deployment): State<DeploymentImpl>,
    Path(issue_id): Path<Uuid>,
) -> Result<ResponseJson<Option<ArenaGroupResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let Some(group) = ArenaGroup::find_active_by_issue_id(pool, issue_id).await? else {
        return Ok(ResponseJson(None));
    };
    Ok(ResponseJson(Some(arena_group_response(pool, group).await?)))
}

async fn get_arena_group(
    State(deployment): State<DeploymentImpl>,
    Path(group_id): Path<Uuid>,
) -> Result<ResponseJson<ArenaGroupResponse>, ApiError> {
    let pool = &deployment.db().pool;
    let group = ArenaGroup::find_by_id(pool, group_id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;
    Ok(ResponseJson(arena_group_response(pool, group).await?))
}

async fn close_arena_group(
    State(deployment): State<DeploymentImpl>,
    Path(group_id): Path<Uuid>,
) -> Result<ResponseJson<MutationResponse<CloseArenaResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let group = ArenaGroup::find_by_id(pool, group_id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;

    if group.lifecycle_status == ArenaLifecycleStatus::Open {
        ArenaGroup::set_lifecycle_status(pool, group.id, ArenaLifecycleStatus::Closed).await?;
    }

    Ok(ResponseJson(MutationResponse {
        data: CloseArenaResponse {
            group_id,
            lifecycle_status: ArenaLifecycleStatus::Closed,
        },
        txid: txid(),
    }))
}

async fn start_arena_implementation(
    State(deployment): State<DeploymentImpl>,
    Path(group_id): Path<Uuid>,
    Json(payload): Json<StartArenaImplementationRequest>,
) -> Result<ResponseJson<MutationResponse<ArenaGroupResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let group = ArenaGroup::find_by_id(pool, group_id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;

    let siblings = DbWorkspace::find_by_arena_group_id(pool, group.id).await?;
    let workspace = find_attempt_workspace_in_group(&siblings, group.id, payload.workspace_id)
        .map_err(ApiError::from)?;

    ArenaGroup::set_implementation_workspace(pool, group.id, payload.workspace_id).await?;
    record_arena_event(
        pool,
        RecordArenaEvent {
            group_id: group.id,
            kind: ArenaEventKind::StartImplementation,
            prompt: payload.follow_up_prompt.as_deref().unwrap_or(""),
            source_workspace_id: None,
            target_workspace_id: Some(payload.workspace_id),
            synthesis_workspace_id: None,
        },
    )
    .await?;

    if let Some(prompt) = payload
        .follow_up_prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
    {
        let _ = start_arena_follow_up(
            &deployment,
            workspace,
            prompt.to_string(),
            payload.executor_config.clone(),
        )
        .await?;
    }

    let group = ArenaGroup::find_by_id(pool, group.id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;

    Ok(ResponseJson(MutationResponse {
        data: arena_group_response(pool, group).await?,
        txid: txid(),
    }))
}

async fn latest_workspace_summary_text(
    pool: &SqlitePool,
    workspace_id: Uuid,
) -> Result<Option<String>, ApiError> {
    Ok(sqlx::query_scalar::<_, String>(
        r#"SELECT cat.summary
             FROM sessions s
             JOIN execution_processes ep ON ep.session_id = s.id
             JOIN coding_agent_turns cat ON cat.execution_process_id = ep.id
            WHERE s.workspace_id = ?
              AND cat.summary IS NOT NULL
            ORDER BY ep.created_at DESC
            LIMIT 1"#,
    )
    .bind(workspace_id)
    .fetch_optional(pool)
    .await?)
}

fn build_challenge_prompt(user_prompt: &str, source_label: &str, source_summary: &str) -> String {
    format!(
        "The user wants you to critique or respond to another Arena attempt.\n\
         Other attempt: {source_label}\n\n\
         Other attempt summary:\n{source_summary}\n\n\
         User instruction:\n{user_prompt}"
    )
}

fn workspace_label(workspace: &DbWorkspace, index: usize) -> String {
    workspace
        .name
        .clone()
        .unwrap_or_else(|| format!("Attempt {}", index + 1))
}

async fn workspace_repo_inputs(
    pool: &SqlitePool,
    workspace_id: Uuid,
) -> Result<Vec<WorkspaceRepoInput>, ApiError> {
    let repo_rows: Vec<(Uuid, String)> = sqlx::query_as::<_, (Uuid, String)>(
        r#"SELECT repo_id, target_branch
             FROM workspace_repos
            WHERE workspace_id = ?
            ORDER BY created_at ASC"#,
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?;

    Ok(repo_rows
        .into_iter()
        .map(|(repo_id, target_branch)| WorkspaceRepoInput {
            repo_id,
            target_branch,
        })
        .collect())
}

fn event_activity_section(event: &ArenaEvent, workspaces: &[DbWorkspace]) -> String {
    let label_for = |workspace_id: Option<Uuid>| {
        workspace_id
            .and_then(|id| {
                workspaces
                    .iter()
                    .position(|workspace| workspace.id == id)
                    .map(|index| workspace_label(&workspaces[index], index))
            })
            .unwrap_or_else(|| "Arena".to_string())
    };

    let title = match event.kind {
        ArenaEventKind::AskAll => "Ask all".to_string(),
        ArenaEventKind::Workspace => format!("Message to {}", label_for(event.target_workspace_id)),
        ArenaEventKind::Challenge => format!(
            "{} challenged {}",
            label_for(event.target_workspace_id),
            label_for(event.source_workspace_id)
        ),
        ArenaEventKind::Synthesize => "Synthesize".to_string(),
        ArenaEventKind::StartImplementation => {
            format!(
                "Start implementation from {}",
                label_for(event.target_workspace_id)
            )
        }
    };

    format!("{title}:\n{}", event.prompt)
}

async fn spawn_arena_synthesis_workspace(
    deployment: &DeploymentImpl,
    group: &ArenaGroup,
    source_workspace: &DbWorkspace,
    existing_synthesis_count: usize,
    prompt: String,
    executor_config: ExecutorConfig,
) -> Result<DbWorkspace, ApiError> {
    let pool = &deployment.db().pool;
    let repos = workspace_repo_inputs(pool, source_workspace.id).await?;
    if repos.is_empty() {
        return Err(ApiError::BadRequest(format!(
            "workspace {} has no repos to mirror for synthesis",
            source_workspace.id
        )));
    }

    let display_name = format!(
        "{} {}",
        ARENA_SYNTHESIS_WORKSPACE_PREFIX,
        existing_synthesis_count + 1
    );
    let workspace = create_workspace_record(deployment, Some(display_name)).await?;

    let mut managed_workspace = deployment
        .workspace_manager()
        .load_managed_workspace(workspace.clone())
        .await?;
    for repo in &repos {
        managed_workspace
            .add_repository(repo, deployment.git())
            .await
            .map_err(ApiError::from)?;
    }

    let workspace = managed_workspace.workspace.clone();
    DbWorkspace::set_arena_group_id(pool, workspace.id, Some(group.id)).await?;
    DbWorkspace::set_arena_status(pool, workspace.id, ArenaStatus::Active).await?;
    insert_workspace_link(pool, workspace.id, group.project_id, group.issue_id).await?;

    deployment
        .container()
        .start_workspace(&workspace, executor_config, prompt)
        .await?;

    let updated = DbWorkspace::find_by_id(pool, workspace.id)
        .await?
        .unwrap_or(workspace);

    Ok(updated)
}

fn executor_config_for_arena_message(
    default_config: &ExecutorConfig,
    overrides: &[ArenaWorkspaceExecutorConfig],
    workspace_id: Uuid,
) -> ExecutorConfig {
    overrides
        .iter()
        .find(|override_config| override_config.workspace_id == workspace_id)
        .map(|override_config| override_config.executor_config.clone())
        .unwrap_or_else(|| default_config.clone())
}

async fn start_arena_follow_up(
    deployment: &DeploymentImpl,
    workspace: &DbWorkspace,
    prompt: String,
    executor_config: Option<ExecutorConfig>,
) -> Result<Uuid, ApiError> {
    let pool = &deployment.db().pool;
    deployment
        .container()
        .ensure_container_exists(workspace)
        .await?;

    let session_id = latest_session_id_for_workspace(pool, workspace.id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Arena workspace has no session".to_string()))?;
    let session = Session::find_by_id(pool, session_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Arena session not found".to_string()))?;

    let executor_config = executor_config.ok_or_else(|| {
        ApiError::BadRequest("Arena follow-up requires an executor_config".to_string())
    })?;

    let latest_session_info = CodingAgentTurn::find_latest_session_info(pool, session.id).await?;
    let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;
    let cleanup_action = deployment.container().cleanup_actions_for_repos(&repos);
    let working_dir = session
        .agent_working_dir
        .as_ref()
        .filter(|dir| !dir.is_empty())
        .cloned();

    let action_type = if let Some(info) = latest_session_info {
        ExecutorActionType::CodingAgentFollowUpRequest(CodingAgentFollowUpRequest {
            prompt,
            selected_skills: None,
            session_id: info.session_id,
            reset_to_message_id: None,
            executor_config,
            working_dir,
        })
    } else {
        ExecutorActionType::CodingAgentInitialRequest(CodingAgentInitialRequest {
            prompt,
            selected_skills: None,
            executor_config,
            working_dir,
        })
    };

    let action = ExecutorAction::new(action_type, cleanup_action.map(Box::new));
    let execution_process = deployment
        .container()
        .start_execution(
            workspace,
            &session,
            &action,
            &ExecutionProcessRunReason::CodingAgent,
        )
        .await?;

    Ok(execution_process.id)
}

async fn send_arena_message(
    State(deployment): State<DeploymentImpl>,
    Path(group_id): Path<Uuid>,
    Json(payload): Json<ArenaMessageRequest>,
) -> Result<ResponseJson<MutationResponse<ArenaGroupResponse>>, ApiError> {
    let ArenaMessageRequest {
        target,
        prompt,
        executor_config,
        executor_configs,
    } = payload;
    let pool = &deployment.db().pool;
    let group = ArenaGroup::find_by_id(pool, group_id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;
    let siblings = DbWorkspace::find_by_arena_group_id(pool, group.id).await?;
    let attempt_siblings: Vec<&DbWorkspace> = siblings
        .iter()
        .filter(|workspace| !is_synthesis_workspace(workspace))
        .collect();

    match target {
        ArenaMessageTarget::All => {
            if attempt_siblings.is_empty() {
                return Err(ApiError::BadRequest(
                    "Arena group has no attempts to message".to_string(),
                ));
            }
            for workspace in attempt_siblings.iter().copied() {
                let workspace_executor_config = executor_config_for_arena_message(
                    &executor_config,
                    &executor_configs,
                    workspace.id,
                );
                start_arena_follow_up(
                    &deployment,
                    workspace,
                    prompt.clone(),
                    Some(workspace_executor_config),
                )
                .await?;
            }
            record_arena_event(
                pool,
                RecordArenaEvent {
                    group_id: group.id,
                    kind: ArenaEventKind::AskAll,
                    prompt: &prompt,
                    source_workspace_id: None,
                    target_workspace_id: None,
                    synthesis_workspace_id: None,
                },
            )
            .await?;
        }
        ArenaMessageTarget::Workspace { workspace_id } => {
            let workspace = attempt_siblings
                .iter()
                .copied()
                .find(|ws| ws.id == workspace_id)
                .ok_or_else(|| ArenaGroupError::WorkspaceNotInGroup {
                    group_id: group.id,
                    workspace_id,
                })?;
            start_arena_follow_up(
                &deployment,
                workspace,
                prompt.clone(),
                Some(executor_config.clone()),
            )
            .await?;
            record_arena_event(
                pool,
                RecordArenaEvent {
                    group_id: group.id,
                    kind: ArenaEventKind::Workspace,
                    prompt: &prompt,
                    source_workspace_id: None,
                    target_workspace_id: Some(workspace_id),
                    synthesis_workspace_id: None,
                },
            )
            .await?;
        }
        ArenaMessageTarget::Challenge {
            responder_workspace_id,
            source_workspace_id,
        } => {
            let responder = attempt_siblings
                .iter()
                .copied()
                .find(|ws| ws.id == responder_workspace_id)
                .ok_or_else(|| ArenaGroupError::WorkspaceNotInGroup {
                    group_id: group.id,
                    workspace_id: responder_workspace_id,
                })?;
            if !attempt_siblings
                .iter()
                .any(|ws| ws.id == source_workspace_id)
            {
                return Err(ApiError::from(ArenaGroupError::WorkspaceNotInGroup {
                    group_id: group.id,
                    workspace_id: source_workspace_id,
                }));
            }
            let source_summary = latest_workspace_summary_text(pool, source_workspace_id)
                .await?
                .unwrap_or_else(|| "No summary available yet.".to_string());
            let challenge_prompt =
                build_challenge_prompt(&prompt, &source_workspace_id.to_string(), &source_summary);
            start_arena_follow_up(
                &deployment,
                responder,
                challenge_prompt,
                Some(executor_config.clone()),
            )
            .await?;
            record_arena_event(
                pool,
                RecordArenaEvent {
                    group_id: group.id,
                    kind: ArenaEventKind::Challenge,
                    prompt: &prompt,
                    source_workspace_id: Some(source_workspace_id),
                    target_workspace_id: Some(responder_workspace_id),
                    synthesis_workspace_id: None,
                },
            )
            .await?;
        }
        ArenaMessageTarget::Synthesize { options } => {
            let Some(source_workspace) = attempt_siblings.first().copied() else {
                return Err(ApiError::BadRequest(
                    "Arena group has no workspaces to synthesize".to_string(),
                ));
            };
            let mut summaries = Vec::new();
            for (index, sibling) in attempt_siblings.iter().copied().enumerate() {
                let summary = latest_workspace_summary_text(pool, sibling.id)
                    .await?
                    .unwrap_or_else(|| "No summary available yet.".to_string());
                summaries.push(format!(
                    "{} ({})\n{}",
                    workspace_label(sibling, index),
                    sibling.id,
                    summary
                ));
            }

            let events = arena_events_for_group(pool, group.id).await?;
            let activity_sections: Vec<String> = events
                .iter()
                .map(|event| event_activity_section(event, &siblings))
                .collect();
            let synthesis_prompt = build_synthesis_prompt(
                &prompt,
                &group.prompt,
                &summaries,
                &activity_sections,
                &options,
            );
            let synthesis_count = siblings
                .iter()
                .filter(|ws| is_synthesis_workspace(ws))
                .count();
            let synthesis_workspace = spawn_arena_synthesis_workspace(
                &deployment,
                &group,
                source_workspace,
                synthesis_count,
                synthesis_prompt,
                executor_config.clone(),
            )
            .await?;
            record_arena_event(
                pool,
                RecordArenaEvent {
                    group_id: group.id,
                    kind: ArenaEventKind::Synthesize,
                    prompt: &prompt,
                    source_workspace_id: None,
                    target_workspace_id: None,
                    synthesis_workspace_id: Some(synthesis_workspace.id),
                },
            )
            .await?;
        }
    }

    let group = ArenaGroup::find_by_id(pool, group.id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;

    Ok(ResponseJson(MutationResponse {
        data: arena_group_response(pool, group).await?,
        txid: txid(),
    }))
}

async fn promote_arena_workspace(
    State(deployment): State<DeploymentImpl>,
    Path(group_id): Path<Uuid>,
    Json(payload): Json<PromoteArenaRequest>,
) -> Result<ResponseJson<MutationResponse<ArenaGroupResponse>>, ApiError> {
    let pool = &deployment.db().pool;

    let group = ArenaGroup::find_by_id(pool, group_id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;

    if group.mode == ArenaMode::Design
        && group.lifecycle_status != ArenaLifecycleStatus::ImplementationStarted
    {
        return Err(ApiError::BadRequest(
            "Design Arena attempts must be started as implementation before promote.".to_string(),
        ));
    }

    let siblings = DbWorkspace::find_by_arena_group_id(pool, group.id).await?;
    find_attempt_workspace_in_group(&siblings, group.id, payload.workspace_id)
        .map_err(ApiError::from)?;

    // 1. Mark the chosen workspace as promoted.
    DbWorkspace::set_arena_status(pool, payload.workspace_id, ArenaStatus::Promoted).await?;
    ArenaGroup::set_promoted(pool, group.id, payload.workspace_id).await?;

    // 2. Archive every other sibling (arena_status=archived AND archived=true)
    //    so the existing 1h cleanup path picks them up. We deliberately do
    //    NOT call container.delete here — that synchronously removes the
    //    worktree and would block this request.
    for ws in siblings.iter() {
        if ws.id == payload.workspace_id {
            continue;
        }
        DbWorkspace::set_arena_status(pool, ws.id, ArenaStatus::Archived).await?;
        DbWorkspace::set_archived(pool, ws.id, true).await?;
    }

    let group = ArenaGroup::find_by_id(pool, group.id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;

    deployment
        .track_if_analytics_allowed(
            "arena_workspace_promoted",
            json!({
                "arena_group_id":       group.id.to_string(),
                "promoted_workspace_id": payload.workspace_id.to_string(),
                "sibling_count":        siblings.len().saturating_sub(1),
            }),
        )
        .await;

    Ok(ResponseJson(MutationResponse {
        data: arena_group_response(pool, group).await?,
        txid: txid(),
    }))
}

async fn retry_arena_workspace(
    State(deployment): State<DeploymentImpl>,
    Path((group_id, workspace_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<RetryArenaRequest>,
) -> Result<ResponseJson<MutationResponse<ArenaGroupResponse>>, ApiError> {
    let pool = &deployment.db().pool;

    let group = ArenaGroup::find_by_id(pool, group_id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;
    if group.promoted_workspace_id.is_some() {
        return Err(ApiError::from(ArenaGroupError::AlreadyPromoted {
            group_id: group.id,
        }));
    }

    // Verify workspace belongs to group + figure out repos to reuse.
    let siblings = DbWorkspace::find_by_arena_group_id(pool, group.id).await?;
    let target = find_attempt_workspace_in_group(&siblings, group.id, workspace_id)
        .map_err(ApiError::from)?;

    // Pull repo set from the failing workspace so the retry mirrors it.
    // Runtime-checked query to avoid requiring a fresh .sqlx cache for
    // a fork-only path; matches the style of sibling queries in this file.
    let repo_rows: Vec<(Uuid, String)> = sqlx::query_as::<_, (Uuid, String)>(
        r#"SELECT repo_id, target_branch
             FROM workspace_repos
            WHERE workspace_id = ?
            ORDER BY created_at ASC"#,
    )
    .bind(target.id)
    .fetch_all(pool)
    .await?;
    let repos: Vec<WorkspaceRepoInput> = repo_rows
        .into_iter()
        .map(|(repo_id, target_branch)| WorkspaceRepoInput {
            repo_id,
            target_branch,
        })
        .collect();

    if repos.is_empty() {
        return Err(ApiError::BadRequest(format!(
            "workspace {workspace_id} has no repos to mirror; cannot retry"
        )));
    }

    // Mark the failing attempt as archived (arena-internally) but
    // **don't** flip the user-archived flag — the user might want to
    // keep its logs around.
    DbWorkspace::set_arena_status(pool, workspace_id, ArenaStatus::Archived).await?;

    let attempts_so_far = siblings
        .iter()
        .filter(|workspace| !is_synthesis_workspace(workspace))
        .count();
    let attempt = ArenaAttemptInput {
        executor_config: payload.executor_config,
        name: payload.name,
        prompt: payload.prompt,
    };
    spawn_arena_attempt(
        &deployment,
        &group,
        group.issue_id,
        group.project_id,
        &repos,
        attempt,
        attempts_so_far,
    )
    .await?;

    let group = ArenaGroup::find_by_id(pool, group.id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;

    Ok(ResponseJson(MutationResponse {
        data: arena_group_response(pool, group).await?,
        txid: txid(),
    }))
}

async fn dissolve_arena_group(
    State(deployment): State<DeploymentImpl>,
    Path(group_id): Path<Uuid>,
) -> Result<ResponseJson<MutationResponse<DissolveArenaResponse>>, ApiError> {
    let pool = &deployment.db().pool;

    let group = ArenaGroup::find_by_id(pool, group_id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;
    if group.promoted_workspace_id.is_some() {
        return Err(ApiError::BadRequest(
            "Cannot dissolve a promoted arena group; the merged attempt is now your work."
                .to_string(),
        ));
    }

    let siblings = DbWorkspace::find_by_arena_group_id(pool, group.id).await?;
    let mut archived = 0usize;
    for ws in siblings.iter() {
        DbWorkspace::set_arena_status(pool, ws.id, ArenaStatus::Archived).await?;
        DbWorkspace::set_archived(pool, ws.id, true).await?;
        archived += 1;
    }

    ArenaGroup::delete(pool, group.id).await?;

    Ok(ResponseJson(MutationResponse {
        data: DissolveArenaResponse {
            group_id: group.id,
            workspaces_archived: archived,
        },
        txid: txid(),
    }))
}

async fn fallback_arena_groups(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ProjectQuery>,
) -> Result<ResponseJson<Value>, ApiError> {
    let Some(project_id) = query.project_id else {
        return Ok(empty_rows("arena_groups"));
    };

    let groups = ArenaGroup::find_all_by_project_id(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(json!({ "arena_groups": groups })))
}

async fn list_issue_workspaces(
    State(deployment): State<DeploymentImpl>,
    Path(issue_id): Path<Uuid>,
) -> Result<ResponseJson<Vec<DbWorkspace>>, ApiError> {
    // Fixes the dead-code `?task_id=` pattern noted in
    // docs/future/ai-arena/notes-step0.md §3.5: list every workspace
    // that the local kanban issue links to (regardless of arena
    // membership).
    let pool = &deployment.db().pool;
    // Use runtime-checked query (matches other `local_workspace_links`
    // queries in this file) so this handler does not require a refreshed
    // .sqlx offline cache to compile.
    let workspace_ids: Vec<Uuid> = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT workspace_id
             FROM local_workspace_links
            WHERE issue_id = ?
            ORDER BY created_at ASC"#,
    )
    .bind(issue_id)
    .fetch_all(pool)
    .await?;

    let mut workspaces = Vec::with_capacity(workspace_ids.len());
    for ws_id in workspace_ids {
        if let Some(ws) = DbWorkspace::find_by_id(pool, ws_id).await? {
            workspaces.push(ws);
        }
    }
    Ok(ResponseJson(workspaces))
}

#[cfg(test)]
mod tests {
    use api_types::{CreateIssueRequest, CreateProjectRequest, IssuePriority};
    use chrono::Utc;
    use serde_json::Value;
    use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};
    use uuid::Uuid;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect in-memory sqlite");

        for statement in [
            r#"
            CREATE TABLE projects (
                id BLOB PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE local_project_metadata (
                project_id BLOB PRIMARY KEY,
                organization_id BLOB NOT NULL,
                color TEXT NOT NULL DEFAULT '210 80% 52%',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE local_project_statuses (
                id BLOB PRIMARY KEY,
                project_id BLOB NOT NULL,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                hidden INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE local_issues (
                id BLOB PRIMARY KEY,
                project_id BLOB NOT NULL,
                issue_number INTEGER NOT NULL,
                simple_id TEXT NOT NULL,
                status_id BLOB NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                priority TEXT,
                start_date TEXT,
                target_date TEXT,
                completed_at TEXT,
                sort_order REAL NOT NULL,
                parent_issue_id BLOB,
                parent_issue_sort_order REAL,
                extension_metadata TEXT NOT NULL DEFAULT 'null',
                creator_user_id BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE local_tags (
                id BLOB PRIMARY KEY,
                project_id BLOB NOT NULL,
                name TEXT NOT NULL,
                color TEXT NOT NULL
            )
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create test schema");
        }

        pool
    }

    #[tokio::test]
    async fn local_issue_create_seeds_default_statuses_and_simple_id() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();

        sqlx::query("INSERT INTO projects (id, name) VALUES (?, ?)")
            .bind(project_id)
            .bind("Local Project")
            .execute(&pool)
            .await
            .expect("insert project");

        let statuses = super::ensure_default_statuses(&pool, project_id)
            .await
            .expect("seed statuses");

        assert_eq!(statuses.len(), 5);
        assert_eq!(statuses[0].name, "Todo");
        assert_eq!(statuses[4].name, "Cancelled");
        assert!(statuses[4].hidden);

        let issue = super::create_local_issue(
            &pool,
            CreateIssueRequest {
                id: None,
                project_id,
                status_id: statuses[0].id,
                title: "First local issue".to_string(),
                description: Some("stored only in SQLite".to_string()),
                priority: Some(IssuePriority::High),
                start_date: None,
                target_date: None,
                completed_at: None,
                sort_order: 1001.0,
                parent_issue_id: None,
                parent_issue_sort_order: None,
                extension_metadata: Value::Null,
            },
        )
        .await
        .expect("create local issue");

        assert_eq!(issue.project_id, project_id);
        assert_eq!(issue.issue_number, 1);
        assert_eq!(issue.simple_id, "LOCAL-1");
        assert_eq!(issue.title, "First local issue");
        assert_eq!(issue.priority, Some(IssuePriority::High));
    }

    #[tokio::test]
    async fn local_project_create_seeds_default_tags() {
        let pool = setup_pool().await;

        let project = super::create_local_project(
            &pool,
            CreateProjectRequest {
                id: None,
                organization_id: super::local_org_id(),
                name: "Tagged Project".to_string(),
                color: "210 80% 52%".to_string(),
            },
        )
        .await
        .expect("create local project");

        let tags = super::list_project_tags(&pool, project.id)
            .await
            .expect("list default tags");

        let tag_names: Vec<_> = tags.iter().map(|tag| tag.name.as_str()).collect();
        assert_eq!(
            tag_names,
            vec!["bug", "documentation", "enhancement", "feature"]
        );
    }

    #[test]
    fn arena_workspace_purpose_detects_synthesis_workspace_names() {
        assert_eq!(
            super::arena_workspace_purpose_from_name(Some("Arena Synthesis 1")),
            super::ArenaWorkspacePurpose::Synthesis
        );
        assert_eq!(
            super::arena_workspace_purpose_from_name(Some("codex-arena-1")),
            super::ArenaWorkspacePurpose::Attempt
        );
        assert_eq!(
            super::arena_workspace_purpose_from_name(None),
            super::ArenaWorkspacePurpose::Attempt
        );
    }

    fn test_workspace(
        group_id: Uuid,
        workspace_id: Uuid,
        name: Option<&str>,
    ) -> super::DbWorkspace {
        let now = Utc::now();
        super::DbWorkspace {
            id: workspace_id,
            task_id: None,
            container_ref: None,
            branch: "arena-test".to_string(),
            setup_completed_at: None,
            created_at: now,
            updated_at: now,
            archived: false,
            pinned: false,
            name: name.map(str::to_string),
            worktree_deleted: false,
            arena_group_id: Some(group_id),
            arena_status: super::ArenaStatus::Active,
        }
    }

    #[test]
    fn attempt_workspace_lookup_rejects_synthesis_workspaces() {
        let group_id = Uuid::new_v4();
        let attempt_id = Uuid::new_v4();
        let synthesis_id = Uuid::new_v4();
        let workspaces = vec![
            test_workspace(group_id, attempt_id, Some("codex-arena-1")),
            test_workspace(group_id, synthesis_id, Some("Arena Synthesis 1")),
        ];

        let attempt = super::find_attempt_workspace_in_group(&workspaces, group_id, attempt_id)
            .expect("attempt workspace");
        assert_eq!(attempt.id, attempt_id);

        let synthesis_result =
            super::find_attempt_workspace_in_group(&workspaces, group_id, synthesis_id);
        assert!(synthesis_result.is_err());
    }

    #[test]
    fn synthesis_prompt_only_includes_selected_context_sections() {
        let options = super::ArenaSynthesizeOptions {
            include_original_prompt: true,
            include_attempt_summaries: true,
            include_activity: false,
        };

        let prompt = super::build_synthesis_prompt(
            "Write the decision memo.",
            "Original arena prompt",
            &[
                "Attempt A:\nUse the lightweight design.".to_string(),
                "Attempt B:\nUse the workflow design.".to_string(),
            ],
            &["Ask all: explain risks".to_string()],
            &options,
        );

        assert!(prompt.contains("Write the decision memo."));
        assert!(prompt.contains("Original arena prompt"));
        assert!(prompt.contains("Attempt A"));
        assert!(!prompt.contains("Ask all: explain risks"));
    }
}
