use async_trait::async_trait;
use db::models::{
    workspace::{CreateWorkspace, Workspace, WorkspaceError},
    workspace_repo::{CreateWorkspaceRepo, WorkspaceRepo},
};
use deployment::Deployment;
use sqlx::Row;
use uuid::Uuid;

use super::runner::{WorkflowWorkspaceRequest, WorkflowWorkspaceResolver};
use crate::{DeploymentImpl, error::ApiError};

pub fn main_workflow_branch_name(issue_id: Uuid, run_id: Uuid) -> String {
    format!("vk/{issue_id}-wf-{}", short_run_id(run_id))
}

pub fn short_run_id(run_id: Uuid) -> String {
    run_id.simple().to_string()[..8].to_string()
}

#[derive(Clone)]
pub struct DeploymentWorkflowWorkspaceResolver {
    deployment: DeploymentImpl,
}

impl DeploymentWorkflowWorkspaceResolver {
    pub fn new(deployment: DeploymentImpl) -> Self {
        Self { deployment }
    }

    async fn project_workspace_repos(
        &self,
        project_id: Uuid,
    ) -> Result<Vec<CreateWorkspaceRepo>, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT r.id AS repo_id, r.path, r.default_target_branch
            FROM repos r
            JOIN project_repos pr ON pr.repo_id = r.id
            WHERE pr.project_id = ?
            ORDER BY r.display_name ASC
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.deployment.db().pool)
        .await?;

        let repos = rows
            .into_iter()
            .map(|row| {
                let repo_id: Uuid = row.get("repo_id");
                let path: String = row.get("path");
                let default_target_branch: Option<String> = row.get("default_target_branch");
                let target_branch = default_target_branch
                    .filter(|branch| !branch.trim().is_empty())
                    .unwrap_or_else(|| {
                        self.deployment
                            .git()
                            .get_current_branch(std::path::Path::new(&path))
                            .unwrap_or_else(|_| "main".to_string())
                    });

                CreateWorkspaceRepo {
                    repo_id,
                    target_branch,
                }
            })
            .collect();

        Ok(repos)
    }
}

#[async_trait]
impl WorkflowWorkspaceResolver for DeploymentWorkflowWorkspaceResolver {
    async fn create_or_bind_main_workspace(
        &self,
        request: WorkflowWorkspaceRequest,
    ) -> Result<Uuid, ApiError> {
        let pool = &self.deployment.db().pool;

        if let Some(workspace_id) = request.existing_workspace_id {
            let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspaces WHERE id = ?")
                .bind(workspace_id)
                .fetch_one(pool)
                .await?;
            if exists == 0 {
                return Err(ApiError::Workspace(WorkspaceError::WorkspaceNotFound));
            }

            return Ok(workspace_id);
        }

        let project_id = request.project_id.ok_or_else(|| {
            ApiError::BadRequest(
                "Workflow workspace creation requires a project with repositories. Select an existing workspace instead."
                    .to_string(),
            )
        })?;
        let repos = self.project_workspace_repos(project_id).await?;
        if repos.is_empty() {
            return Err(ApiError::BadRequest(
                "Project has no repositories configured for workflow runs.".to_string(),
            ));
        }

        let workspace_id = Uuid::new_v4();
        let workspace = Workspace::create(
            pool,
            &CreateWorkspace {
                branch: request.branch_name,
                name: Some(format!("Workflow {}", short_run_id(request.run_id))),
            },
            workspace_id,
        )
        .await?;
        WorkspaceRepo::create_many(pool, workspace.id, &repos).await?;

        Ok(workspace.id)
    }
}
