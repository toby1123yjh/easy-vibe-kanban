//! Native custom-command asset management for direct agent providers.
//!
//! Runtime `CommandAdapter`s remain responsible for launching a provider and
//! encoding runtime controls. This module owns only provider-native reusable
//! command assets and exposes a safe, revisioned lifecycle/API contract.

mod claude;
mod codex;
mod gemini;
mod markdown;
mod oh_my_pi;
mod service;
mod storage;
mod types;

pub use service::{AgentCommandService, ProviderCommandAssetManager};
use storage::*;
pub use types::*;

#[cfg(test)]
mod tests;
