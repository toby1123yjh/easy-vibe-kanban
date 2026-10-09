use api_types::{
    CreateTaskRelationshipRequest, MutationResponse, TaskRelationship, TaskRelationshipType,
};
use rmcp::{
    ErrorData, handler::server::wrapper::Parameters, model::CallToolResult, schemars, tool,
    tool_router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::McpServer;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpCreateTaskRelationshipRequest {
    #[schemars(description = "The source task ID")]
    #[serde(rename = "task_id")]
    issue_id: Uuid,
    #[schemars(description = "The related task ID")]
    #[serde(rename = "related_task_id")]
    related_issue_id: Uuid,
    #[schemars(description = "Relationship type: 'blocking', 'related', or 'has_duplicate'")]
    relationship_type: TaskRelationshipType,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpCreateTaskRelationshipResponse {
    relationship_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpDeleteTaskRelationshipRequest {
    #[schemars(
        description = "The relationship ID to delete (from get_task or create_task_relationship)"
    )]
    relationship_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpDeleteTaskRelationshipResponse {
    success: bool,
    deleted_relationship_id: String,
}

#[tool_router(router = issue_relationships_tools_router, vis = "pub")]
impl McpServer {
    #[tool(
        description = "Create a relationship between two tasks. Types: 'blocking', 'related', 'has_duplicate'."
    )]
    async fn create_issue_relationship(
        &self,
        Parameters(McpCreateTaskRelationshipRequest {
            issue_id,
            related_issue_id,
            relationship_type,
        }): Parameters<McpCreateTaskRelationshipRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let payload = CreateTaskRelationshipRequest {
            id: None,
            issue_id,
            related_issue_id,
            relationship_type,
        };

        let url = self.url("/api/remote/task-relationships");
        let response: MutationResponse<TaskRelationship> =
            match self.send_json(self.client.post(&url).json(&payload)).await {
                Ok(r) => r,
                Err(e) => return Ok(Self::tool_error(e)),
            };

        McpServer::success(&McpCreateTaskRelationshipResponse {
            relationship_id: response.data.id.to_string(),
        })
    }

    #[tool(description = "Delete a relationship between two tasks.")]
    async fn delete_issue_relationship(
        &self,
        Parameters(McpDeleteTaskRelationshipRequest { relationship_id }): Parameters<
            McpDeleteTaskRelationshipRequest,
        >,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!(
            "/api/remote/task-relationships/{}",
            relationship_id
        ));
        if let Err(e) = self.send_empty_json(self.client.delete(&url)).await {
            return Ok(Self::tool_error(e));
        }

        McpServer::success(&McpDeleteTaskRelationshipResponse {
            success: true,
            deleted_relationship_id: relationship_id.to_string(),
        })
    }
}
