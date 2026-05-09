use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowEventKind {
    RunStatus,
    NodeStatus,
    NodeOutput,
    NodeError,
    NodeWaitingHuman,
    NodeWaitingArena,
}

impl WorkflowEventKind {
    pub fn v1_kinds() -> Vec<Self> {
        vec![
            Self::RunStatus,
            Self::NodeStatus,
            Self::NodeOutput,
            Self::NodeError,
            Self::NodeWaitingHuman,
            Self::NodeWaitingArena,
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkflowEvent {
    pub sequence: u64,
    pub run_id: String,
    pub node_id: Option<String>,
    pub kind: WorkflowEventKind,
    pub status: Option<String>,
    pub payload: Value,
}

impl WorkflowEvent {
    pub fn run_status(
        run_id: impl Into<String>,
        status: impl Into<String>,
        payload: Value,
    ) -> Self {
        Self::new(
            WorkflowEventKind::RunStatus,
            run_id,
            None::<String>,
            Some(status.into()),
            payload,
        )
    }

    pub fn node_status(
        run_id: impl Into<String>,
        node_id: impl Into<String>,
        status: impl Into<String>,
        payload: Value,
    ) -> Self {
        Self::new(
            WorkflowEventKind::NodeStatus,
            run_id,
            Some(node_id.into()),
            Some(status.into()),
            payload,
        )
    }

    pub fn node_output(
        run_id: impl Into<String>,
        node_id: impl Into<String>,
        payload: Value,
    ) -> Self {
        Self::new(
            WorkflowEventKind::NodeOutput,
            run_id,
            Some(node_id.into()),
            None,
            payload,
        )
    }

    pub fn node_error(
        run_id: impl Into<String>,
        node_id: impl Into<String>,
        payload: Value,
    ) -> Self {
        Self::new(
            WorkflowEventKind::NodeError,
            run_id,
            Some(node_id.into()),
            None,
            payload,
        )
    }

    pub fn node_waiting_human(
        run_id: impl Into<String>,
        node_id: impl Into<String>,
        payload: Value,
    ) -> Self {
        Self::new(
            WorkflowEventKind::NodeWaitingHuman,
            run_id,
            Some(node_id.into()),
            None,
            payload,
        )
    }

    pub fn node_waiting_arena(
        run_id: impl Into<String>,
        node_id: impl Into<String>,
        payload: Value,
    ) -> Self {
        Self::new(
            WorkflowEventKind::NodeWaitingArena,
            run_id,
            Some(node_id.into()),
            None,
            payload,
        )
    }

    fn new(
        kind: WorkflowEventKind,
        run_id: impl Into<String>,
        node_id: Option<String>,
        status: Option<String>,
        payload: Value,
    ) -> Self {
        Self {
            sequence: 0,
            run_id: run_id.into(),
            node_id,
            kind,
            status,
            payload,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct WorkflowEventBus {
    inner: Arc<Mutex<WorkflowEventBusInner>>,
}

#[derive(Debug, Default)]
struct WorkflowEventBusInner {
    next_sequence: u64,
    events: Vec<WorkflowEvent>,
}

impl WorkflowEventBus {
    pub fn publish(&self, mut event: WorkflowEvent) -> WorkflowEvent {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.next_sequence += 1;
        event.sequence = inner.next_sequence;
        inner.events.push(event.clone());
        event
    }

    pub fn events(&self) -> Vec<WorkflowEvent> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .events
            .clone()
    }
}

#[cfg(test)]
mod tests {
    use crate::events::{WorkflowEvent, WorkflowEventBus, WorkflowEventKind};

    #[test]
    fn event_bus_assigns_monotonic_sequences() {
        let bus = WorkflowEventBus::default();

        let first = bus.publish(WorkflowEvent::run_status(
            "run-1",
            "running",
            serde_json::json!({ "status": "running" }),
        ));
        let second = bus.publish(WorkflowEvent::node_status(
            "run-1",
            "node-1",
            "succeeded",
            serde_json::json!({ "status": "succeeded" }),
        ));

        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);
        assert_eq!(bus.events().len(), 2);
    }

    #[test]
    fn workflow_events_serialize_with_snake_case_kind() {
        let event = WorkflowEvent::node_output(
            "run-1",
            "node-1",
            serde_json::json!({ "output_text": "done" }),
        );

        let value = serde_json::to_value(event).unwrap();

        assert_eq!(value["kind"], "node_output");
        assert_eq!(value["payload"]["output_text"], "done");
    }

    #[test]
    fn event_kind_names_cover_v1_stream_surface() {
        assert_eq!(
            vec![
                WorkflowEventKind::RunStatus,
                WorkflowEventKind::NodeStatus,
                WorkflowEventKind::NodeOutput,
                WorkflowEventKind::NodeError,
                WorkflowEventKind::NodeWaitingHuman,
                WorkflowEventKind::NodeWaitingArena,
            ],
            WorkflowEventKind::v1_kinds()
        );
    }
}
