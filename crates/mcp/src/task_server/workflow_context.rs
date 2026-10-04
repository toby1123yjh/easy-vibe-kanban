use std::{fmt, sync::Arc};

use executors::workflow_mcp::{
    AGENT_RUN_ID_ENV, READY_ADDRESS_ENV, SESSION_ID_ENV, TOKEN_ENV, TURN_ID_ENV,
    WorkflowMcpReadyReporter, valid_token,
};
use uuid::Uuid;

/// Explicit execution identity, supplied only by VB. Not model tool arguments.
#[derive(Clone)]
pub struct WorkflowLaunchContext {
    pub session_id: Uuid,
    pub agent_run_id: Uuid,
    pub turn_id: Uuid,
    pub(crate) token: String,
    pub(crate) readiness: Arc<WorkflowMcpReadyReporter>,
}

impl fmt::Debug for WorkflowLaunchContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowLaunchContext")
            .field("session_id", &self.session_id)
            .field("agent_run_id", &self.agent_run_id)
            .field("turn_id", &self.turn_id)
            .finish_non_exhaustive()
    }
}

impl WorkflowLaunchContext {
    pub fn from_environment() -> anyhow::Result<Self> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    fn from_lookup(get: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let id = |key: &str| -> anyhow::Result<Uuid> {
            let value = get(key).ok_or_else(|| anyhow::anyhow!("Missing {key}"))?;
            Uuid::parse_str(&value).map_err(|_| anyhow::anyhow!("Invalid {key}"))
        };
        let token = get(TOKEN_ENV).ok_or_else(|| anyhow::anyhow!("Missing {TOKEN_ENV}"))?;
        anyhow::ensure!(valid_token(&token), "Invalid workflow credential");
        let session_id = id(SESSION_ID_ENV)?;
        let agent_run_id = id(AGENT_RUN_ID_ENV)?;
        let turn_id = id(TURN_ID_ENV)?;
        let readiness_address = get(READY_ADDRESS_ENV)
            .ok_or_else(|| anyhow::anyhow!("Missing workflow MCP readiness listener"))?;
        let readiness = Arc::new(WorkflowMcpReadyReporter::new(
            &readiness_address,
            session_id,
            agent_run_id,
            turn_id,
            token.clone(),
        )?);
        Ok(Self {
            session_id,
            agent_run_id,
            turn_id,
            token,
            readiness,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_launch_fails_closed_and_never_formats_the_token() {
        assert!(WorkflowLaunchContext::from_lookup(|_| None).is_err());
        let token = "abcde123".repeat(8);
        let context = WorkflowLaunchContext::from_lookup(|key| {
            Some(match key {
                TOKEN_ENV => token.clone(),
                READY_ADDRESS_ENV => "127.0.0.1:12345".to_owned(),
                _ => Uuid::nil().to_string(),
            })
        })
        .unwrap();
        assert!(!format!("{context:?}").contains(&token));
        assert!(
            WorkflowLaunchContext::from_lookup(|key| {
                Some(if key == TOKEN_ENV {
                    "secret\r\nheader".into()
                } else {
                    Uuid::nil().to_string()
                })
            })
            .is_err()
        );
    }
}
