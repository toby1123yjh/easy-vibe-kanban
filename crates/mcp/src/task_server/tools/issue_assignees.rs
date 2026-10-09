use api_types::{
    CreateTaskAssigneeRequest, ListTaskAssigneesResponse, MutationResponse, TaskAssignee,
};
use rmcp::{
    ErrorData, handler::server::wrapper::Parameters, model::CallToolResult, schemars, tool,
    tool_router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::McpServer;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpListTaskAssigneesRequest {
    #[schemars(description = "Task ID to list assignees for")]
    #[serde(rename = "task_id")]
    issue_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct IssueAssigneeSummary {
    #[schemars(description = "Task assignee ID")]
    id: String,
    #[schemars(description = "Task ID")]
    #[serde(rename = "task_id")]
    issue_id: String,
    #[schemars(description = "User ID")]
    user_id: String,
    #[schemars(description = "Assignment timestamp")]
    assigned_at: String,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpListTaskAssigneesResponse {
    #[serde(rename = "task_id")]
    issue_id: String,
    #[serde(rename = "task_assignees")]
    issue_assignees: Vec<IssueAssigneeSummary>,
    count: usize,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpAssignTaskRequest {
    #[schemars(description = "Task ID to assign")]
    #[serde(rename = "task_id")]
    issue_id: Uuid,
    #[schemars(description = "User ID to assign to the task")]
    user_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpAssignTaskResponse {
    #[serde(rename = "task_assignee_id")]
    issue_assignee_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpUnassignTaskRequest {
    #[schemars(description = "Task assignee ID to remove")]
    #[serde(rename = "task_assignee_id")]
    issue_assignee_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpUnassignTaskResponse {
    success: bool,
    #[serde(rename = "task_assignee_id")]
    issue_assignee_id: String,
}

#[tool_router(router = issue_assignees_tools_router, vis = "pub")]
impl McpServer {
    #[tool(description = "List assignees for an task.")]
    async fn list_task_assignees(
        &self,
        Parameters(McpListTaskAssigneesRequest { issue_id }): Parameters<
            McpListTaskAssigneesRequest,
        >,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!("/api/remote/task-assignees?task_id={}", issue_id));
        let response: ListTaskAssigneesResponse = match self.send_json(self.client.get(&url)).await
        {
            Ok(r) => r,
            Err(e) => return Ok(Self::tool_error(e)),
        };

        let assignees = response
            .issue_assignees
            .into_iter()
            .map(|assignee| IssueAssigneeSummary {
                id: assignee.id.to_string(),
                issue_id: assignee.issue_id.to_string(),
                user_id: assignee.user_id.to_string(),
                assigned_at: assignee.assigned_at.to_rfc3339(),
            })
            .collect::<Vec<_>>();

        McpServer::success(&McpListTaskAssigneesResponse {
            issue_id: issue_id.to_string(),
            count: assignees.len(),
            issue_assignees: assignees,
        })
    }

    #[tool(description = "Assign a user to an task.")]
    async fn assign_task(
        &self,
        Parameters(McpAssignTaskRequest { issue_id, user_id }): Parameters<McpAssignTaskRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let payload = CreateTaskAssigneeRequest {
            id: None,
            issue_id,
            user_id,
        };

        let url = self.url("/api/remote/task-assignees");
        let response: MutationResponse<TaskAssignee> =
            match self.send_json(self.client.post(&url).json(&payload)).await {
                Ok(r) => r,
                Err(e) => return Ok(Self::tool_error(e)),
            };

        McpServer::success(&McpAssignTaskResponse {
            issue_assignee_id: response.data.id.to_string(),
        })
    }

    #[tool(description = "Remove an assignee from an task using task_assignee_id.")]
    async fn unassign_task(
        &self,
        Parameters(McpUnassignTaskRequest { issue_assignee_id }): Parameters<
            McpUnassignTaskRequest,
        >,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!("/api/remote/task-assignees/{}", issue_assignee_id));
        if let Err(e) = self.send_empty_json(self.client.delete(&url)).await {
            return Ok(Self::tool_error(e));
        }

        McpServer::success(&McpUnassignTaskResponse {
            success: true,
            issue_assignee_id: issue_assignee_id.to_string(),
        })
    }
}
