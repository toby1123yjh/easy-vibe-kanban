use server::routes::workflows::{
    CreateWorkflowRequest, TriggerWorkflowRequest, UpdateWorkflowRequest, WorkflowActionResponse,
    WorkflowNodeExecutionResponse, WorkflowRunResponse, WorkflowTemplateListResponse,
    WorkflowTemplateResponse,
};
use ts_rs::TS;

#[test]
fn workflow_route_dtos_export_stable_type_names() {
    let declarations = [
        WorkflowTemplateResponse::decl(),
        WorkflowTemplateListResponse::decl(),
        CreateWorkflowRequest::decl(),
        UpdateWorkflowRequest::decl(),
        TriggerWorkflowRequest::decl(),
        WorkflowRunResponse::decl(),
        WorkflowNodeExecutionResponse::decl(),
        WorkflowActionResponse::decl(),
    ];

    for declaration in declarations {
        assert!(declaration.contains("export type "));
    }
}

#[test]
fn workflow_router_function_is_public() {
    let _router = server::routes::workflows::router;
}
