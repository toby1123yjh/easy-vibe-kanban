use async_trait::async_trait;
use db::models::workspace::{CreateWorkspace, Workspace, WorkspaceError};
use deployment::Deployment;
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

        Ok(workspace.id)
    }
}
