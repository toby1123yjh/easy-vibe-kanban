use db::models::repo::Repo;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum GitAuthMode {
    Native,
    PrivateKey,
}

impl GitAuthMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::PrivateKey => "private_key",
        }
    }
}

#[derive(Debug, Clone, Serialize, TS, FromRow)]
pub struct GitConnection {
    pub id: Uuid,
    pub name: String,
    pub host: String,
    #[ts(type = "number")]
    pub port: i64,
    pub username: String,
    #[ts(type = "GitAuthMode")]
    pub auth_mode: String,
    pub fingerprint: Option<String>,
    pub has_passphrase: bool,
    pub created_at: String,
    pub updated_at: String,
    #[sqlx(default)]
    pub credential_ready: bool,
    #[sqlx(default)]
    pub credential_error: Option<String>,
}

// Never derive Debug or Serialize for input-only credentials.
#[derive(Deserialize, TS)]
pub struct WriteGitConnection {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_mode: GitAuthMode,
    pub private_key: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
pub struct InspectGitRemote {
    pub url: String,
    pub connection_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct TestGitConnection {
    pub url: String,
}

#[derive(Debug, Serialize, TS)]
pub struct GitRemoteInspection {
    pub url: String,
    pub branches: Vec<String>,
    pub default_branch: Option<String>,
    pub suggested_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct StartGitImport {
    pub request_id: Uuid,
    pub url: String,
    pub connection_id: Option<Uuid>,
    pub branch: Option<String>,
    pub directory_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum GitImportState {
    Queued,
    Running,
    Cancelling,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Serialize, TS)]
pub struct GitImportJob {
    pub id: Uuid,
    pub request_id: Uuid,
    pub url: String,
    pub connection_id: Option<Uuid>,
    pub branch: Option<String>,
    pub directory_path: String,
    #[ts(type = "GitImportState")]
    pub state: String,
    pub phase: String,
    pub progress: Option<i32>,
    pub error: Option<String>,
    pub repo: Option<Repo>,
}
