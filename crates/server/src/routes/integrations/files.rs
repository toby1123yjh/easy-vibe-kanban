//! File operations are relative to an opened directory capability, not a
//! canonicalize/check/open sequence vulnerable to parent symlink replacement.
use std::{
    collections::BTreeMap,
    io,
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};

use axum::{
    Extension, Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use cap_std::fs::{Dir, OpenOptions};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::file::FileError;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use super::{IntegrationCaller, authorize_project, project_root};
use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize)]
pub struct FileQuery {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub overwrite: bool,
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ProjectFileKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectFileEntry {
    pub path: String,
    pub name: String,
    pub kind: ProjectFileKind,
    #[ts(type = "number")]
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectDirectoryPage {
    pub path: String,
    pub entries: Vec<ProjectFileEntry>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct UploadedProjectFile {
    pub path: String,
    #[ts(type = "number")]
    pub size_bytes: u64,
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/projects/{project_id}/files",
            get(list).merge(post(upload).layer(DefaultBodyLimit::disable())),
        )
        .route("/projects/{project_id}/files/download", get(download))
}

pub fn relative_path(raw: &str) -> Result<PathBuf, ApiError> {
    let normalized = raw.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains('\0') || normalized.contains(':') {
        return Err(ApiError::BadRequest("Path must be project-relative".into()));
    }
    let mut path = PathBuf::new();
    for part in normalized
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
    {
        let stem = part
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && matches!(stem.as_bytes()[3], b'1'..=b'9'));
        if part == ".." || part.ends_with([' ', '.']) || device {
            return Err(ApiError::BadRequest("Path has an unsafe component".into()));
        }
        path.push(part);
    }
    Ok(path)
}

fn display_path(path: &FsPath) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn file_error(error: io::Error) -> ApiError {
    match error.kind() {
        io::ErrorKind::NotFound => ApiError::File(FileError::NotFound),
        io::ErrorKind::AlreadyExists => {
            ApiError::Conflict("FILE_EXISTS: Pass overwrite=true to replace this file".into())
        }
        io::ErrorKind::PermissionDenied => {
            ApiError::Forbidden("File is not accessible within the project directory".into())
        }
        _ => ApiError::BadRequest(
            "File operation failed; check the path, permissions and available disk space".into(),
        ),
    }
}

async fn open_root(
    deployment: &DeploymentImpl,
    caller: &IntegrationCaller,
    project_id: Uuid,
) -> Result<Dir, ApiError> {
    authorize_project(&deployment.db().pool, caller, project_id).await?;
    let root = project_root(deployment, project_id).await?;
    Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(file_error)
}

async fn list(
    State(deployment): State<DeploymentImpl>,
    Extension(caller): Extension<IntegrationCaller>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<FileQuery>,
) -> Result<Json<ApiResponse<ProjectDirectoryPage>>, ApiError> {
    let path = relative_path(&query.path)?;
    let root = open_root(&deployment, &caller, project_id).await?;
    let page = tokio::task::spawn_blocking(move || {
        directory_page(
            &root,
            &path,
            query.cursor.as_deref(),
            query.limit.unwrap_or(100).clamp(1, 1000),
        )
    })
    .await
    .map_err(|_| ApiError::BadRequest("Directory listing interrupted".into()))??;
    Ok(Json(ApiResponse::success(page)))
}

fn directory_page(
    root: &Dir,
    path: &FsPath,
    cursor: Option<&str>,
    limit: usize,
) -> Result<ProjectDirectoryPage, ApiError> {
    let directory = root
        .open_dir(if path.as_os_str().is_empty() {
            FsPath::new(".")
        } else {
            path
        })
        .map_err(file_error)?;
    // Bound retained entries while scanning the full current directory. No Git
    // ignores or change-list filtering; cursor is the last lexical entry name.
    let mut entries = BTreeMap::new();
    for entry in directory.entries().map_err(file_error)? {
        let entry = entry.map_err(file_error)?;
        let name = entry.file_name().into_string().map_err(|_| {
            ApiError::BadRequest(
                "Directory contains a filename that cannot be represented as UTF-8".into(),
            )
        })?;
        if cursor.is_some_and(|cursor| name.as_str() <= cursor) {
            continue;
        }
        let metadata = directory.symlink_metadata(&name).map_err(file_error)?;
        let kind = if metadata.file_type().is_symlink() {
            ProjectFileKind::Symlink
        } else if metadata.is_dir() {
            ProjectFileKind::Directory
        } else if metadata.is_file() {
            ProjectFileKind::File
        } else {
            ProjectFileKind::Other
        };
        entries.insert(
            name.clone(),
            ProjectFileEntry {
                path: display_path(&path.join(&name)),
                name,
                kind,
                size_bytes: metadata.len(),
            },
        );
        if entries.len() > limit + 1 {
            entries.pop_last();
        }
    }
    let has_more = entries.len() > limit;
    if has_more {
        entries.pop_last();
    }
    let next_cursor = if has_more {
        entries.last_key_value().map(|(name, _)| name.clone())
    } else {
        None
    };
    Ok(ProjectDirectoryPage {
        path: display_path(path),
        entries: entries.into_values().collect(),
        next_cursor,
    })
}

async fn download(
    State(deployment): State<DeploymentImpl>,
    Extension(caller): Extension<IntegrationCaller>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<FileQuery>,
) -> Result<Response, ApiError> {
    let path = relative_path(&query.path)?;
    if path.as_os_str().is_empty() {
        return Err(ApiError::BadRequest("File path is required".into()));
    }
    let root = open_root(&deployment, &caller, project_id).await?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        // Opening a FIFO must not pin the HTTP worker waiting for a writer.
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = root.open_with(&path, &options).map_err(file_error)?;
    if !file.metadata().map_err(file_error)?.is_file() {
        return Err(ApiError::BadRequest("Target is not a regular file".into()));
    }
    let file = tokio::fs::File::from_std(file.into_std());
    // All externally supplied files are downloaded, never served as executable
    // HTML/SVG in the application's origin.
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("download");
    let encoded =
        percent_encoding::utf8_percent_encode(name, percent_encoding::NON_ALPHANUMERIC).to_string();
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename*=UTF-8''{encoded}"),
            ),
            (header::CACHE_CONTROL, "no-store".to_owned()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
        ],
        Body::from_stream(ReaderStream::new(file)),
    )
        .into_response())
}

/// Dropping a cancelled upload removes only its randomly allocated staging
/// file, through the same parent handle; it never touches the destination.
struct StagedUpload {
    directory: Arc<Dir>,
    name: String,
}
impl Drop for StagedUpload {
    fn drop(&mut self) {
        let _ = self.directory.remove_file(&self.name);
    }
}

fn stage_upload(
    root: &Dir,
    path: &FsPath,
) -> Result<(StagedUpload, std::fs::File, String), ApiError> {
    let filename = path
        .file_name()
        .and_then(|p| p.to_str())
        .ok_or_else(|| ApiError::BadRequest("File path is required".into()))?
        .to_owned();
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(FsPath::new("."));
    root.create_dir_all(parent).map_err(file_error)?;
    let directory = Arc::new(root.open_dir(parent).map_err(file_error)?);
    let name = format!(".vk-upload-{}", Uuid::new_v4());
    let file = directory
        .open_with(&name, OpenOptions::new().write(true).create_new(true))
        .map_err(file_error)?
        .into_std();
    Ok((StagedUpload { directory, name }, file, filename))
}

fn publish_upload(staged: &StagedUpload, filename: &str, overwrite: bool) -> Result<(), ApiError> {
    if overwrite {
        // rename replaces the directory entry, not the target of a symlink.
        staged
            .directory
            .rename(&staged.name, &staged.directory, filename)
            .map_err(file_error)?;
    } else {
        // hard_link is an atomic no-clobber publication on both Windows and
        // Unix. Unsupported filesystems fail safely, leaving the old file intact.
        staged
            .directory
            .hard_link(&staged.name, &staged.directory, filename)
            .map_err(file_error)?;
    }
    Ok(())
}

async fn upload(
    State(deployment): State<DeploymentImpl>,
    Extension(caller): Extension<IntegrationCaller>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<FileQuery>,
    mut multipart: Multipart,
) -> Result<Json<ApiResponse<UploadedProjectFile>>, ApiError> {
    let path = relative_path(&query.path)?;
    let root = open_root(&deployment, &caller, project_id).await?;
    let (staged, file, filename) = stage_upload(&root, &path)?;
    let mut file = tokio::fs::File::from_std(file);
    let mut field = multipart
        .next_field()
        .await?
        .ok_or_else(|| ApiError::BadRequest("One multipart file field is required".into()))?;
    if field.name() != Some("file") {
        return Err(ApiError::BadRequest(
            "Expected multipart field named file".into(),
        ));
    }
    let mut size_bytes = 0;
    while let Some(chunk) = field.chunk().await? {
        file.write_all(&chunk).await.map_err(file_error)?;
        size_bytes += chunk.len() as u64;
    }
    if multipart.next_field().await?.is_some() {
        return Err(ApiError::BadRequest(
            "Upload exactly one file per request".into(),
        ));
    }
    file.flush().await.map_err(file_error)?;
    file.sync_all().await.map_err(file_error)?;
    drop(file);
    // A long upload cannot publish after its grant/key was revoked.
    authorize_project(&deployment.db().pool, &caller, project_id).await?;
    publish_upload(&staged, &filename, query.overwrite)?;
    Ok(Json(ApiResponse::success(UploadedProjectFile {
        path: display_path(&path),
        size_bytes,
    })))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    #[test]
    fn portable_paths_reject_escape_and_device_aliases() {
        for path in [
            "../secret",
            "C:\\secret",
            "//server/share",
            "/etc/passwd",
            "x/../../y",
            "x:stream",
            "CON",
            "x/NUL.txt",
            "x/.. ",
            "\0",
        ] {
            assert!(relative_path(path).is_err(), "{path}");
        }
        assert_eq!(
            display_path(&relative_path("docs\\./report.txt").unwrap()),
            "docs/report.txt"
        );
    }

    #[test]
    fn uploads_are_atomic_conflict_by_default_and_keep_old_data_on_abandon() {
        let temp = tempfile::tempdir().unwrap();
        let root = Dir::open_ambient_dir(temp.path(), cap_std::ambient_authority()).unwrap();
        root.write("report", b"old").unwrap();
        let (staged, mut file, filename) = stage_upload(&root, FsPath::new("report")).unwrap();
        file.write_all(b"complete new").unwrap();
        drop(file);
        assert!(publish_upload(&staged, &filename, false).is_err());
        assert_eq!(root.read("report").unwrap(), b"old");
        publish_upload(&staged, &filename, true).unwrap();
        assert_eq!(root.read("report").unwrap(), b"complete new");
        drop(staged);
        let (staged, mut file, _) = stage_upload(&root, FsPath::new("report")).unwrap();
        file.write_all(b"partial").unwrap();
        drop(file);
        drop(staged);
        assert_eq!(root.read("report").unwrap(), b"complete new");
        assert_eq!(root.entries().unwrap().count(), 1);
    }

    #[test]
    fn concurrent_no_overwrite_publications_have_one_winner() {
        let temp = tempfile::tempdir().unwrap();
        let root = Dir::open_ambient_dir(temp.path(), cap_std::ambient_authority()).unwrap();
        let (a, mut af, name) = stage_upload(&root, FsPath::new("result")).unwrap();
        let (b, mut bf, _) = stage_upload(&root, FsPath::new("result")).unwrap();
        af.write_all(b"a").unwrap();
        bf.write_all(b"b").unwrap();
        drop(af);
        drop(bf);
        let results = std::thread::scope(|scope| {
            let first = scope.spawn(|| publish_upload(&a, &name, false));
            let second = scope.spawn(|| publish_upload(&b, &name, false));
            (first.join().unwrap(), second.join().unwrap())
        });
        assert_ne!(results.0.is_ok(), results.1.is_ok());
    }

    #[test]
    fn pagination_includes_hidden_and_gitignored_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = Dir::open_ambient_dir(temp.path(), cap_std::ambient_authority()).unwrap();
        for name in [".env", ".gitignore", "data.bin", "report"] {
            root.write(name, b"contents").unwrap();
        }
        let first = directory_page(&root, FsPath::new(""), None, 2).unwrap();
        assert_eq!(
            first
                .entries
                .iter()
                .map(|e| e.name.as_str())
                .collect::<Vec<_>>(),
            [".env", ".gitignore"]
        );
        let second =
            directory_page(&root, FsPath::new(""), first.next_cursor.as_deref(), 2).unwrap();
        assert_eq!(second.entries.len(), 2);
        assert!(second.next_cursor.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn outside_symlink_cannot_read_or_stage_an_upload() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), b"private").unwrap();
        std::os::unix::fs::symlink(outside.path(), temp.path().join("escape")).unwrap();
        let root = Dir::open_ambient_dir(temp.path(), cap_std::ambient_authority()).unwrap();
        assert!(root.open("escape/secret").is_err());
        assert!(stage_upload(&root, FsPath::new("escape/secret")).is_err());
        assert_eq!(
            std::fs::read(outside.path().join("secret")).unwrap(),
            b"private"
        );
    }

    #[cfg(windows)]
    #[test]
    fn outside_windows_junction_cannot_read_or_publish_uploads() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), b"private").unwrap();
        // Junctions need no symlink privilege and exercise Windows reparse
        // points on the same platform as the supported local installation.
        let result = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(temp.path().join("escape"))
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "cannot create test junction: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        let root = Dir::open_ambient_dir(temp.path(), cap_std::ambient_authority()).unwrap();
        assert!(root.open("escape/secret").is_err());
        assert!(stage_upload(&root, FsPath::new("escape/secret")).is_err());
        assert_eq!(
            std::fs::read(outside.path().join("secret")).unwrap(),
            b"private"
        );
    }
}
