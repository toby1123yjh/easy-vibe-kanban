use api_types::{
    CreateTaskTagRequest, ListTagsResponse, ListTaskTagsResponse, MutationResponse, TaskTag,
};
use rmcp::{
    ErrorData, handler::server::wrapper::Parameters, model::CallToolResult, schemars, tool,
    tool_router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::McpServer;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpListTagsRequest {
    #[schemars(
        description = "The project ID to list tags from. Optional if running inside a workspace linked to a remote project."
    )]
    project_id: Option<Uuid>,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct TagSummary {
    #[schemars(description = "Tag ID")]
    id: String,
    #[schemars(description = "Project ID")]
    project_id: String,
    #[schemars(description = "Tag name")]
    name: String,
    #[schemars(description = "Tag color value")]
    color: String,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpListTagsResponse {
    project_id: String,
    tags: Vec<TagSummary>,
    count: usize,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpListTaskTagsRequest {
    #[schemars(description = "Task ID to list tags for")]
    #[serde(rename = "task_id")]
    issue_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct TaskTagSummary {
    #[schemars(description = "Task-tag relation ID")]
    id: String,
    #[schemars(description = "Task ID")]
    #[serde(rename = "task_id")]
    issue_id: String,
    #[schemars(description = "Tag ID")]
    tag_id: String,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpListTaskTagsResponse {
    #[serde(rename = "task_id")]
    issue_id: String,
    #[serde(rename = "task_tags")]
    issue_tags: Vec<TaskTagSummary>,
    count: usize,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpAddTaskTagRequest {
    #[schemars(description = "Task ID to attach the tag to")]
    #[serde(rename = "task_id")]
    issue_id: Uuid,
    #[schemars(description = "Tag ID to attach")]
    tag_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpAddTaskTagResponse {
    #[serde(rename = "task_tag_id")]
    issue_tag_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpRemoveTaskTagRequest {
    #[schemars(description = "Task-tag relation ID to remove")]
    #[serde(rename = "task_tag_id")]
    issue_tag_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpRemoveTaskTagResponse {
    success: bool,
    #[serde(rename = "task_tag_id")]
    issue_tag_id: String,
}

#[tool_router(router = issue_tags_tools_router, vis = "pub")]
impl McpServer {
    #[tool(
        description = "List tags for a project. `project_id` is optional if running inside a workspace linked to a remote project."
    )]
    async fn list_tags(
        &self,
        Parameters(McpListTagsRequest { project_id }): Parameters<McpListTagsRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let project_id = match self.resolve_project_id(project_id) {
            Ok(id) => id,
            Err(e) => return Ok(Self::tool_error(e)),
        };

        let url = self.url(&format!("/api/remote/tags?project_id={}", project_id));
        let response: ListTagsResponse = match self.send_json(self.client.get(&url)).await {
            Ok(r) => r,
            Err(e) => return Ok(Self::tool_error(e)),
        };

        let tags = response
            .tags
            .into_iter()
            .map(|tag| TagSummary {
                id: tag.id.to_string(),
                project_id: tag.project_id.to_string(),
                name: tag.name,
                color: tag.color,
            })
            .collect::<Vec<_>>();

        McpServer::success(&McpListTagsResponse {
            project_id: project_id.to_string(),
            count: tags.len(),
            tags,
        })
    }

    #[tool(description = "List tags attached to an task.")]
    async fn list_task_tags(
        &self,
        Parameters(McpListTaskTagsRequest { issue_id }): Parameters<McpListTaskTagsRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!("/api/remote/task-tags?task_id={}", issue_id));
        let response: ListTaskTagsResponse = match self.send_json(self.client.get(&url)).await {
            Ok(r) => r,
            Err(e) => return Ok(Self::tool_error(e)),
        };

        let issue_tags = response
            .issue_tags
            .into_iter()
            .map(|issue_tag| TaskTagSummary {
                id: issue_tag.id.to_string(),
                issue_id: issue_tag.issue_id.to_string(),
                tag_id: issue_tag.tag_id.to_string(),
            })
            .collect::<Vec<_>>();

        McpServer::success(&McpListTaskTagsResponse {
            issue_id: issue_id.to_string(),
            count: issue_tags.len(),
            issue_tags,
        })
    }

    #[tool(description = "Attach a tag to an task.")]
    async fn add_task_tag(
        &self,
        Parameters(McpAddTaskTagRequest { issue_id, tag_id }): Parameters<McpAddTaskTagRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let payload = CreateTaskTagRequest {
            id: None,
            issue_id,
            tag_id,
        };

        let url = self.url("/api/remote/task-tags");
        let response: MutationResponse<TaskTag> =
            match self.send_json(self.client.post(&url).json(&payload)).await {
                Ok(r) => r,
                Err(e) => return Ok(Self::tool_error(e)),
            };

        McpServer::success(&McpAddTaskTagResponse {
            issue_tag_id: response.data.id.to_string(),
        })
    }

    #[tool(description = "Remove a tag from an task using task_tag_id.")]
    async fn remove_task_tag(
        &self,
        Parameters(McpRemoveTaskTagRequest { issue_tag_id }): Parameters<McpRemoveTaskTagRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!("/api/remote/task-tags/{}", issue_tag_id));
        if let Err(e) = self.send_empty_json(self.client.delete(&url)).await {
            return Ok(Self::tool_error(e));
        }

        McpServer::success(&McpRemoveTaskTagResponse {
            success: true,
            issue_tag_id: issue_tag_id.to_string(),
        })
    }
}
