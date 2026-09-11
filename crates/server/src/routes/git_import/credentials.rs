//! Encrypted, Host-local credentials. No plaintext private-key file is created.
use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex, OnceLock},
};

use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::{bad, conflict, types::*};
use crate::error::ApiError;

const PUBLIC_COLUMNS: &str =
    "id,name,host,port,username,auth_mode,fingerprint,has_passphrase,created_at,updated_at";
type Leases = Mutex<HashMap<Uuid, Arc<AsyncMutex<()>>>>;
static LEASES: OnceLock<Leases> = OnceLock::new();
#[cfg(test)]
tokio::task_local! {
    static TEST_KEY_DIRECTORY: std::path::PathBuf;
}

pub fn lease(id: Uuid) -> Result<OwnedMutexGuard<()>, ApiError> {
    let lock = LEASES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| conflict("Credential lease unavailable"))?
        .entry(id)
        .or_default()
        .clone();
    lock.try_lock_owned().map_err(|_| conflict("This connection is in use. Wait for its test/import to finish before editing or deleting it."))
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop, Default)]
pub struct Secret {
    pub private_key: Option<String>,
    pub password: Option<String>,
}

impl Drop for WriteGitConnection {
    fn drop(&mut self) {
        self.private_key.zeroize();
        self.password.zeroize();
    }
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<GitConnection>, ApiError> {
    let mut connections: Vec<GitConnection> = sqlx::query_as(&format!(
        "SELECT {PUBLIC_COLUMNS} FROM git_connections ORDER BY name,id"
    ))
    .fetch_all(pool)
    .await?;
    for connection in &mut connections {
        readiness(pool, connection).await;
    }
    Ok(connections)
}

pub async fn get(pool: &SqlitePool, id: Uuid) -> Result<GitConnection, ApiError> {
    let mut connection = sqlx::query_as(&format!(
        "SELECT {PUBLIC_COLUMNS} FROM git_connections WHERE id=?"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| bad("Git connection no longer exists"))?;
    readiness(pool, &mut connection).await;
    Ok(connection)
}

async fn readiness(pool: &SqlitePool, connection: &mut GitConnection) {
    if connection.auth_mode == "native" {
        connection.credential_ready = true;
        return;
    }
    match read_secret(pool, connection.id).await {
        Ok(_) => connection.credential_ready = true,
        Err(error) => {
            connection.credential_ready = false;
            connection.credential_error = Some(error.to_string());
        }
    }
}

pub async fn read_secret(pool: &SqlitePool, id: Uuid) -> Result<Secret, ApiError> {
    let ciphertext: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT secret_ciphertext FROM git_connections WHERE id=?")
            .bind(id)
            .fetch_one(pool)
            .await?;
    let Some(ciphertext) = ciphertext else {
        return Ok(Secret::default());
    };
    let key = master_key(pool).await?;
    decrypt(&key, id, &ciphertext)
}

pub async fn save(
    pool: &SqlitePool,
    id: Uuid,
    mut input: WriteGitConnection,
    updating: bool,
) -> Result<GitConnection, ApiError> {
    let _lease = lease(id)?;
    validate_metadata(&input)?;
    let previous = if updating {
        Some(get(pool, id).await?)
    } else {
        None
    };
    let mut secret = if previous
        .as_ref()
        .is_some_and(|old| old.auth_mode == input.auth_mode.as_str())
        && input.auth_mode != GitAuthMode::Native
        && input.private_key.is_none()
        && input.password.is_none()
    {
        read_secret(pool, id).await?
    } else if previous
        .as_ref()
        .is_some_and(|old| old.auth_mode == input.auth_mode.as_str())
        && input.auth_mode == GitAuthMode::PrivateKey
        && input.private_key.is_none()
    {
        let mut existing = read_secret(pool, id).await?;
        existing.password = input.password.take();
        existing
    } else {
        Secret {
            private_key: input.private_key.take(),
            password: input.password.take(),
        }
    };
    let fingerprint = validate_secret(input.auth_mode, &mut secret)?;
    let has_passphrase = secret
        .password
        .as_ref()
        .is_some_and(|value| !value.is_empty())
        && input.auth_mode == GitAuthMode::PrivateKey;
    let ciphertext = if input.auth_mode == GitAuthMode::Native {
        None
    } else {
        Some(encrypt(&*master_key(pool).await?, id, &secret)?)
    };
    let mut transaction = pool.begin_with("BEGIN IMMEDIATE").await?;
    reject_active(&mut transaction, id).await?;
    if updating {
        let result = sqlx::query("UPDATE git_connections SET name=?,host=?,port=?,username=?,auth_mode=?,fingerprint=?,has_passphrase=?,secret_ciphertext=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(input.name.trim()).bind(input.host.to_ascii_lowercase()).bind(i64::from(input.port))
            .bind(&input.username).bind(input.auth_mode.as_str()).bind(fingerprint).bind(has_passphrase).bind(ciphertext).bind(id)
            .execute(&mut *transaction).await?;
        if result.rows_affected() != 1 {
            return Err(bad("Git connection no longer exists"));
        }
    } else {
        sqlx::query("INSERT INTO git_connections(id,name,host,port,username,auth_mode,fingerprint,has_passphrase,secret_ciphertext) VALUES(?,?,?,?,?,?,?,?,?)")
            .bind(id).bind(input.name.trim()).bind(input.host.to_ascii_lowercase()).bind(i64::from(input.port))
            .bind(&input.username).bind(input.auth_mode.as_str()).bind(fingerprint).bind(has_passphrase).bind(ciphertext)
            .execute(&mut *transaction).await?;
    }
    transaction.commit().await?;
    get(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<(), ApiError> {
    let _lease = lease(id)?;
    let mut transaction = pool.begin_with("BEGIN IMMEDIATE").await?;
    reject_active(&mut transaction, id).await?;
    let result = sqlx::query("DELETE FROM git_connections WHERE id=?")
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() != 1 {
        return Err(bad("Git connection no longer exists"));
    }
    transaction.commit().await?;
    Ok(())
}

async fn reject_active(connection: &mut sqlx::SqliteConnection, id: Uuid) -> Result<(), ApiError> {
    let active: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM git_import_jobs WHERE connection_id=? AND state IN ('queued','running','cancelling'))")
        .bind(id).fetch_one(connection).await?;
    if active {
        return Err(conflict(
            "Connection has an unfinished import; stop or recover it first.",
        ));
    }
    Ok(())
}

fn validate_metadata(input: &WriteGitConnection) -> Result<(), ApiError> {
    if input.name.trim().is_empty() || input.name.len() > 200 || input.port == 0 {
        return Err(bad("Connection name and a valid port are required"));
    }
    if input.host.is_empty()
        || input.host.len() > 253
        || input.host.starts_with('-')
        || !input
            .host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-:".contains(&c))
    {
        return Err(bad(
            "Use a hostname or IP address without a URL, user, or path",
        ));
    }
    if input.username.is_empty()
        || input.username.len() > 128
        || input.username.starts_with('-')
        || !input
            .username
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
    {
        return Err(bad("Invalid SSH username"));
    }
    Ok(())
}

fn validate_secret(mode: GitAuthMode, secret: &mut Secret) -> Result<Option<String>, ApiError> {
    if secret
        .private_key
        .as_ref()
        .is_some_and(|s| s.len() > 128 * 1024)
        || secret.password.as_ref().is_some_and(|s| s.len() > 4096)
    {
        return Err(bad("Imported credential is too large"));
    }
    match mode {
        GitAuthMode::Native => {
            if secret.private_key.is_some() || secret.password.is_some() {
                return Err(bad(
                    "Native SSH uses local configuration; do not submit secrets",
                ));
            }
            Ok(None)
        }
        GitAuthMode::PrivateKey => {
            let key = decode_key(secret)?;
            Ok(Some(key.fingerprint(ssh_key::HashAlg::Sha256).to_string()))
        }
    }
}

pub fn decode_key(secret: &Secret) -> Result<ssh_key::PrivateKey, ApiError> {
    let text = secret
        .private_key
        .as_deref()
        .ok_or_else(|| bad("Import an OpenSSH private key"))?;
    let key = ssh_key::PrivateKey::from_openssh(text).map_err(|_| {
        bad("Invalid or unsupported key. Import an OpenSSH private key, not its public key.")
    })?;
    if key.is_encrypted() {
        key.decrypt(secret.password.as_deref().unwrap_or(""))
            .map_err(|_| bad("Private-key passphrase is missing or incorrect"))
    } else {
        Ok(key)
    }
}

fn encrypt(key: &[u8; 32], id: Uuid, secret: &Secret) -> Result<Vec<u8>, ApiError> {
    let plain = Zeroizing::new(
        serde_json::to_vec(secret).map_err(|_| conflict("Credential serialization failed"))?,
    );
    let mut nonce = [0; 12];
    OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| conflict("Credential encryption unavailable"))?;
    let mut aad = b"vk-git-credential-v1".to_vec();
    aad.extend_from_slice(id.as_bytes());
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plain,
                aad: &aad,
            },
        )
        .map_err(|_| conflict("Credential encryption failed"))?;
    let mut result = vec![1];
    result.extend_from_slice(&nonce);
    result.extend(encrypted);
    Ok(result)
}

fn decrypt(key: &[u8; 32], id: Uuid, envelope: &[u8]) -> Result<Secret, ApiError> {
    let unavailable = || {
        conflict(
            "Saved credential cannot be decrypted. Restore its matching application key backup, or delete the unusable connection and re-import it; projects are unaffected.",
        )
    };
    if envelope.len() < 29 || envelope[0] != 1 {
        return Err(unavailable());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| unavailable())?;
    let mut aad = b"vk-git-credential-v1".to_vec();
    aad.extend_from_slice(id.as_bytes());
    let plain = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&envelope[1..13]),
                Payload {
                    msg: &envelope[13..],
                    aad: &aad,
                },
            )
            .map_err(|_| unavailable())?,
    );
    serde_json::from_slice(&plain).map_err(|_| unavailable())
}

async fn master_key(pool: &SqlitePool) -> Result<Zeroizing<[u8; 32]>, ApiError> {
    let existing: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM git_connections WHERE secret_ciphertext IS NOT NULL)",
    )
    .fetch_one(pool)
    .await?;
    #[cfg(not(test))]
    let directory = utils::assets::asset_dir().join("git-credentials");
    #[cfg(test)]
    let directory = TEST_KEY_DIRECTORY
        .try_with(Clone::clone)
        .unwrap_or_else(|_| utils::assets::asset_dir().join("git-credentials"));
    tokio::task::spawn_blocking(move || load_master(&directory, existing))
        .await
        .map_err(|_| conflict("Credential key worker failed"))?
}

pub(super) fn is_link(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn load_master(directory: &Path, encrypted_rows: bool) -> Result<Zeroizing<[u8; 32]>, ApiError> {
    if !directory.exists() {
        #[allow(unused_mut)]
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match builder.create(directory) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.into()),
        }
    }
    require_regular(directory, true)?;
    secure(directory, true)?;
    let lock_path = directory.join("initialize.lock");
    if lock_path.exists() {
        require_regular(&lock_path, false)?;
    }
    let lock = private_options()
        .create(true)
        .truncate(false)
        .open(&lock_path)?;
    secure(&lock_path, false)?;
    lock.lock()?;
    let path = directory.join("master-v1.key");
    let mut key = Zeroizing::new([0u8; 32]);
    match OpenOptions::new().read(true).open(&path) {
        Ok(mut file) => {
            require_regular(&path, false)?;
            secure(&path, false)?;
            let mut bytes = Zeroizing::new(Vec::new());
            Read::by_ref(&mut file).take(34).read_to_end(&mut bytes)?;
            if bytes.len() != 33 || bytes[0] != 1 {
                return Err(conflict(
                    "Application Git credential key is corrupt. Restore its backup; do not overwrite it while encrypted connections exist.",
                ));
            }
            key.copy_from_slice(&bytes[1..]);
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if encrypted_rows {
                return Err(conflict(
                    "Application Git credential key is missing. Restore its backup or delete all unusable saved credentials before re-importing; projects are unaffected.",
                ));
            }
            OsRng.fill_bytes(key.as_mut());
            let mut file = private_options().create_new(true).open(&path)?;
            secure(&path, false)?;
            file.write_all(&[1])?;
            file.write_all(key.as_ref())?;
            file.sync_all()?;
        }
        Err(e) => return Err(e.into()),
    }
    Ok(key)
}

fn private_options() -> OpenOptions {
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
}

fn require_regular(path: &Path, directory: bool) -> Result<(), ApiError> {
    let metadata = std::fs::symlink_metadata(path)?;
    if is_link(&metadata)
        || (directory && !metadata.is_dir())
        || (!directory && !metadata.is_file())
    {
        return Err(conflict(
            "Credential storage must not be a link or special file",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn secure(path: &Path, directory: bool) -> Result<(), ApiError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(
        path,
        std::fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }),
    )?;
    Ok(())
}

#[cfg(windows)]
fn secure(path: &Path, _directory: bool) -> Result<(), ApiError> {
    use std::{os::windows::ffi::OsStrExt, ptr};

    use utils::command_ext::NoWindowExt;
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SE_FILE_OBJECT,
                SetNamedSecurityInfoW,
            },
            DACL_SECURITY_INFORMATION, GetSecurityDescriptorDacl,
            PROTECTED_DACL_SECURITY_INFORMATION,
        },
    };
    let output = std::process::Command::new("whoami.exe")
        .args(["/user", "/fo", "csv", "/nh"])
        .no_window()
        .output()?;
    if !output.status.success() {
        return Err(conflict(
            "Cannot identify current user for credential file permissions",
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let sid = text
        .split('"')
        .find(|part| {
            part.starts_with("S-1-")
                && part
                    .bytes()
                    .all(|c| c.is_ascii_digit() || c == b'-' || c == b'S')
        })
        .ok_or_else(|| conflict("Cannot identify credential file owner"))?;
    let descriptor: Vec<u16> = format!("D:P(A;OICI;FA;;;{sid})")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        let mut security = ptr::null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            descriptor.as_ptr(),
            1,
            &mut security,
            ptr::null_mut(),
        ) == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let mut present = 0;
        let mut defaulted = 0;
        let mut acl = ptr::null_mut();
        let result = if GetSecurityDescriptorDacl(security, &mut present, &mut acl, &mut defaulted)
            == 0
            || present == 0
        {
            Err(std::io::Error::last_os_error())
        } else {
            let code = SetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                acl,
                ptr::null_mut(),
            );
            if code == 0 {
                Ok(())
            } else {
                Err(std::io::Error::from_raw_os_error(code as i32))
            }
        };
        LocalFree(security);
        result?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn encrypted_crud_preserves_secrets_and_rolls_back_invalid_replacement() {
        let temporary = tempfile::tempdir().unwrap();
        TEST_KEY_DIRECTORY
            .scope(temporary.path().join("credentials"), async {
                let pool = sqlx::sqlite::SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect("sqlite::memory:")
                    .await
                    .unwrap();
                sqlx::raw_sql("CREATE TABLE repos(id BLOB PRIMARY KEY);")
                    .execute(&pool)
                    .await
                    .unwrap();
                sqlx::raw_sql(include_str!(
                    "../../../../db/migrations/20260910000000_git_imports.sql"
                ))
                .execute(&pool)
                .await
                .unwrap();
                let key =
                    ssh_key::PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519).unwrap();
                let encrypted = key.encrypt(&mut OsRng, "synthetic-passphrase").unwrap();
                let key_text = encrypted.to_openssh(ssh_key::LineEnding::LF).unwrap();
                let input = |private_key, password| WriteGitConnection {
                    name: "Synthetic key".into(),
                    host: "example.invalid".into(),
                    port: 22,
                    username: "git".into(),
                    auth_mode: GitAuthMode::PrivateKey,
                    private_key,
                    password,
                };
                let id = Uuid::new_v4();
                let saved = save(
                    &pool,
                    id,
                    input(
                        Some(key_text.to_string()),
                        Some("synthetic-passphrase".into()),
                    ),
                    false,
                )
                .await
                .unwrap();
                assert!(saved.credential_ready && saved.has_passphrase);
                let ciphertext: Vec<u8> =
                    sqlx::query_scalar("SELECT secret_ciphertext FROM git_connections WHERE id=?")
                        .bind(id)
                        .fetch_one(&pool)
                        .await
                        .unwrap();
                assert!(!ciphertext.windows(11).any(|s| s == b"PRIVATE KEY"));
                assert!(!ciphertext.windows(20).any(|s| s == b"synthetic-passphrase"));
                let mut metadata_edit = input(None, None);
                metadata_edit.name = "Renamed".into();
                let edited = save(&pool, id, metadata_edit, true).await.unwrap();
                assert_eq!(edited.name, "Renamed");
                assert_eq!(edited.fingerprint, saved.fingerprint);
                assert_eq!(
                    decode_key(&read_secret(&pool, id).await.unwrap())
                        .unwrap()
                        .public_key(),
                    key.public_key()
                );
                assert!(
                    save(&pool, id, input(None, Some("wrong".into())), true)
                        .await
                        .is_err()
                );
                assert_eq!(get(&pool, id).await.unwrap().name, "Renamed");
                assert!(read_secret(&pool, id).await.is_ok());
                let public = serde_json::to_string(&list(&pool).await.unwrap()).unwrap();
                assert!(!public.contains("synthetic-passphrase"));
                assert!(!public.contains("PRIVATE KEY"));
                std::fs::remove_file(temporary.path().join("credentials/master-v1.key")).unwrap();
                let unavailable = get(&pool, id).await.unwrap();
                assert!(!unavailable.credential_ready);
                assert!(unavailable.credential_error.unwrap().contains("missing"));
                delete(&pool, id).await.unwrap();
                assert!(list(&pool).await.unwrap().is_empty());
            })
            .await;
    }
    #[test]
    fn envelope_authenticates_row_and_detects_tampering() {
        let id = Uuid::new_v4();
        let key = [42u8; 32];
        let secret = Secret {
            private_key: Some("never-store-plaintext".into()),
            password: Some("secret-password".into()),
        };
        let first = encrypt(&key, id, &secret).unwrap();
        let second = encrypt(&key, id, &secret).unwrap();
        assert_ne!(first, second);
        assert!(
            !first
                .windows(21)
                .any(|part| part == b"never-store-plaintext")
        );
        assert_eq!(
            decrypt(&key, id, &first).unwrap().password.as_deref(),
            Some("secret-password")
        );
        assert!(decrypt(&key, Uuid::new_v4(), &first).is_err());
        assert!(decrypt(&[1; 32], id, &first).is_err());
        let mut bad = first;
        bad[15] ^= 1;
        assert!(decrypt(&key, id, &bad).is_err());
        assert!(decrypt(&key, id, &[1, 2]).is_err());
    }
    #[test]
    fn key_roundtrip_and_missing_existing_key_fails_closed() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("credentials");
        assert!(load_master(&path, true).is_err());
        let first = load_master(&path, false).unwrap();
        let second = load_master(&path, true).unwrap();
        assert_eq!(*first, *second);
    }

    #[cfg(windows)]
    #[test]
    fn master_storage_has_a_protected_single_owner_dacl() {
        use std::{os::windows::ffi::OsStrExt, ptr};

        use windows_sys::Win32::{
            Foundation::LocalFree,
            Security::{
                Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT},
                DACL_SECURITY_INFORMATION, GetSecurityDescriptorControl, SE_DACL_PROTECTED,
            },
        };
        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path().join("credentials");
        load_master(&directory, false).unwrap();
        for path in [&directory, &directory.join("master-v1.key")] {
            let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            unsafe {
                let mut descriptor = ptr::null_mut();
                let mut acl = ptr::null_mut();
                assert_eq!(
                    GetNamedSecurityInfoW(
                        path.as_ptr(),
                        SE_FILE_OBJECT,
                        DACL_SECURITY_INFORMATION,
                        ptr::null_mut(),
                        ptr::null_mut(),
                        &mut acl,
                        ptr::null_mut(),
                        &mut descriptor
                    ),
                    0
                );
                let mut control = 0;
                let mut revision = 0;
                assert_ne!(
                    GetSecurityDescriptorControl(descriptor, &mut control, &mut revision),
                    0
                );
                assert_ne!(control & SE_DACL_PROTECTED, 0);
                assert!(!acl.is_null());
                assert_eq!((*acl).AceCount, 1);
                LocalFree(descriptor);
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn master_storage_permissions_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path().join("credentials");
        load_master(&directory, false).unwrap();
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(directory.join("master-v1.key"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    #[test]
    fn concurrent_initialization_uses_one_key_and_corruption_is_not_overwritten() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("credentials");
        let keys = std::thread::scope(|scope| {
            let first = scope.spawn(|| load_master(&path, false).unwrap());
            let second = scope.spawn(|| load_master(&path, false).unwrap());
            (first.join().unwrap(), second.join().unwrap())
        });
        assert_eq!(*keys.0, *keys.1);
        let file = path.join("master-v1.key");
        std::fs::write(&file, b"corrupt-key").unwrap();
        assert!(load_master(&path, false).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"corrupt-key");
    }

    #[test]
    fn imported_keys_require_the_correct_passphrase_and_never_accept_public_keys() {
        let key = ssh_key::PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519).unwrap();
        let encrypted = key.encrypt(&mut OsRng, "test-only-passphrase").unwrap();
        let mut secret = Secret {
            private_key: Some(
                encrypted
                    .to_openssh(ssh_key::LineEnding::LF)
                    .unwrap()
                    .to_string(),
            ),
            password: Some("wrong".into()),
        };
        assert!(decode_key(&secret).is_err());
        secret.password = Some("test-only-passphrase".into());
        assert_eq!(decode_key(&secret).unwrap().public_key(), key.public_key());
        secret.private_key = Some(key.public_key().to_openssh().unwrap());
        assert!(decode_key(&secret).is_err());
    }

    #[tokio::test]
    async fn native_crud_rejects_live_leases_and_durable_active_jobs() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql("CREATE TABLE repos(id BLOB PRIMARY KEY);")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!(
            "../../../../db/migrations/20260910000000_git_imports.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        let id = Uuid::new_v4();
        let input = || WriteGitConnection {
            name: "Test connection".into(),
            host: "example.invalid".into(),
            port: 22,
            username: "git".into(),
            auth_mode: GitAuthMode::Native,
            private_key: None,
            password: None,
        };
        let saved = save(&pool, id, input(), false).await.unwrap();
        assert!(saved.credential_ready);
        let public = serde_json::to_string(&saved).unwrap();
        assert!(!public.contains("private_key"));
        assert!(!public.contains("password"));
        assert!(!public.contains("ciphertext"));
        let guard = lease(id).unwrap();
        assert!(delete(&pool, id).await.is_err());
        assert!(save(&pool, id, input(), true).await.is_err());
        drop(guard);
        sqlx::query("INSERT INTO git_import_jobs(id,request_id,request_json,transport,url,connection_id,directory_path,state,phase) VALUES(?,?, '{}','native','git@example.invalid:repo',?,'test-only-path','running','downloading')")
            .bind(Uuid::new_v4()).bind(Uuid::new_v4()).bind(id).execute(&pool).await.unwrap();
        assert!(delete(&pool, id).await.is_err());
        assert!(save(&pool, id, input(), true).await.is_err());
        assert_eq!(list(&pool).await.unwrap().len(), 1);
        sqlx::query("UPDATE git_import_jobs SET state='failed'")
            .execute(&pool)
            .await
            .unwrap();
        save(&pool, id, input(), true).await.unwrap();
        delete(&pool, id).await.unwrap();
        assert!(list(&pool).await.unwrap().is_empty());
    }
}
