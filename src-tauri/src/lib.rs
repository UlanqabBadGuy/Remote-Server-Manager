use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use russh::keys::key::PrivateKeyWithHashAlg;
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use uuid::Uuid;

// ── Data Models ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AuthType {
    #[serde(rename = "password")]
    Password,
    #[serde(rename = "keyfile")]
    KeyFile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub key_path: Option<String>,
    pub group_id: Option<String>,
    pub note: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub connection_id: String,
    pub connection_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: u32,
    pub modified: u64,
}

// ── Error helpers ────────────────────────────────────────────────────────────

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── SSH Session ──────────────────────────────────────────────────────────────

pub(crate) struct SshSessionInner {
    pub connection_id: String,
    pub connection_name: String,
    pub session_handle: Arc<russh::client::Handle<ClientHandler>>,
    pub cmd_tx: tokio::sync::mpsc::UnboundedSender<SshCommand>,
}

enum SshCommand {
    Write(Vec<u8>),
    Resize(u32, u32),
    Close,
}

// ── Client Handler ───────────────────────────────────────────────────────────

struct ClientHandler;

impl russh::client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

// ── App State ────────────────────────────────────────────────────────────────

pub struct AppState {
    pub config_path: PathBuf,
    pub groups_path: PathBuf,
    pub connections: Mutex<Vec<ConnectionConfig>>,
    pub groups: Mutex<Vec<Group>>,
    pub(crate) sessions: Mutex<HashMap<String, Arc<SshSessionInner>>>,
}

impl AppState {
    fn data_dir() -> PathBuf {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("remote-ssh-manager")
    }

    fn new() -> Self {
        let data_dir = Self::data_dir();
        std::fs::create_dir_all(&data_dir).ok();

        let config_path = data_dir.join("connections.json");
        let groups_path = data_dir.join("groups.json");

        let connections = Self::load_json(&config_path).unwrap_or_default();
        let groups = Self::load_json(&groups_path).unwrap_or_default();

        Self {
            config_path,
            groups_path,
            connections: Mutex::new(connections),
            groups: Mutex::new(groups),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn load_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Option<T> {
        let data = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&data).ok()
    }

    async fn save_connections(&self) {
        if let Ok(json) = serde_json::to_string_pretty(&*self.connections.lock().await) {
            std::fs::write(&self.config_path, json).ok();
        }
    }

    async fn save_groups(&self) {
        if let Ok(json) = serde_json::to_string_pretty(&*self.groups.lock().await) {
            std::fs::write(&self.groups_path, json).ok();
        }
    }
}

// ── Connection CRUD Commands ─────────────────────────────────────────────────

#[tauri::command]
async fn list_connections(state: tauri::State<'_, AppState>) -> Result<Vec<ConnectionConfig>, String> {
    Ok(state.connections.lock().await.clone())
}

#[tauri::command]
async fn add_connection(
    state: tauri::State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<ConnectionConfig, String> {
    let now = Utc::now().to_rfc3339();
    let mut config = config;
    if config.id.is_empty() {
        config.id = Uuid::new_v4().to_string();
    }
    if config.port == 0 {
        config.port = 22;
    }
    config.created_at = now.clone();
    config.updated_at = now;

    let mut connections = state.connections.lock().await;
    connections.push(config.clone());
    drop(connections);
    state.save_connections().await;
    Ok(config)
}

#[tauri::command]
async fn update_connection(
    state: tauri::State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<ConnectionConfig, String> {
    let mut connections = state.connections.lock().await;
    let pos = connections
        .iter()
        .position(|c| c.id == config.id)
        .ok_or_else(|| format!("Connection not found: {}", config.id))?;

    let mut updated = config;
    updated.updated_at = Utc::now().to_rfc3339();
    updated.created_at = connections[pos].created_at.clone();

    connections[pos] = updated.clone();
    drop(connections);
    state.save_connections().await;
    Ok(updated)
}

#[tauri::command]
async fn delete_connection(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut connections = state.connections.lock().await;
    let pos = connections
        .iter()
        .position(|c| c.id == id)
        .ok_or_else(|| format!("Connection not found: {}", id))?;
    connections.remove(pos);
    drop(connections);
    state.save_connections().await;

    let entry = keyring::Entry::new("remote-ssh-manager", &id).map_err(err)?;
    entry.delete_credential().ok();

    Ok(())
}

#[tauri::command]
async fn list_groups(state: tauri::State<'_, AppState>) -> Result<Vec<Group>, String> {
    Ok(state.groups.lock().await.clone())
}

#[tauri::command]
async fn add_group(
    state: tauri::State<'_, AppState>,
    name: String,
    parent_id: Option<String>,
) -> Result<Group, String> {
    let mut groups = state.groups.lock().await;
    let siblings = groups.iter().filter(|g| g.parent_id == parent_id);
    let max_order = siblings.map(|g| g.order).max().unwrap_or(0);
    let group = Group {
        id: Uuid::new_v4().to_string(),
        name,
        parent_id,
        order: max_order + 1,
    };
    groups.push(group.clone());
    drop(groups);
    state.save_groups().await;
    Ok(group)
}

#[tauri::command]
async fn delete_group(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    // Recursively collect all descendant group IDs
    let mut to_remove = vec![id.clone()];
    let groups_snapshot = state.groups.lock().await.clone();
    let mut i = 0;
    while i < to_remove.len() {
        let current = to_remove[i].clone();
        for g in &groups_snapshot {
            if g.parent_id.as_deref() == Some(&current) && !to_remove.contains(&g.id) {
                to_remove.push(g.id.clone());
            }
        }
        i += 1;
    }

    // Move connections out of deleted groups
    {
        let mut connections = state.connections.lock().await;
        for conn in connections.iter_mut() {
            if conn.group_id.as_ref().map(|gid| to_remove.contains(gid)).unwrap_or(false) {
                conn.group_id = None;
            }
        }
        drop(connections);
        state.save_connections().await;
    }

    {
        let mut groups = state.groups.lock().await;
        groups.retain(|g| !to_remove.contains(&g.id));
        drop(groups);
        state.save_groups().await;
    }
    Ok(())
}

#[tauri::command]
async fn rename_group(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let mut groups = state.groups.lock().await;
    let group = groups
        .iter_mut()
        .find(|g| g.id == id)
        .ok_or_else(|| format!("Group not found: {}", id))?;
    group.name = name;
    drop(groups);
    state.save_groups().await;
    Ok(())
}

#[tauri::command]
async fn move_connection_to_group(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    group_id: Option<String>,
) -> Result<(), String> {
    let mut connections = state.connections.lock().await;
    let conn = connections
        .iter_mut()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;
    conn.group_id = group_id;
    conn.updated_at = Utc::now().to_rfc3339();
    drop(connections);
    state.save_connections().await;
    Ok(())
}

#[tauri::command]
async fn export_connections(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let connections = state.connections.lock().await.clone();
    let groups = state.groups.lock().await.clone();
    let export = serde_json::json!({
        "connections": connections,
        "groups": groups,
    });
    let json = serde_json::to_string_pretty(&export).map_err(err)?;
    std::fs::write(&path, json).map_err(err)?;
    Ok(())
}

#[tauri::command]
async fn import_connections(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let data = std::fs::read_to_string(&path).map_err(err)?;
    let import: serde_json::Value = serde_json::from_str(&data).map_err(err)?;

    if let Some(arr) = import["connections"].as_array() {
        let mut connections = state.connections.lock().await;
        for item in arr {
            if let Ok(mut conn) = serde_json::from_value::<ConnectionConfig>(item.clone()) {
                if conn.id.is_empty() {
                    conn.id = Uuid::new_v4().to_string();
                }
                let now = Utc::now().to_rfc3339();
                conn.created_at = now.clone();
                conn.updated_at = now;
                connections.push(conn);
            }
        }
        drop(connections);
        state.save_connections().await;
    }

    if let Some(arr) = import["groups"].as_array() {
        let mut groups = state.groups.lock().await;
        for item in arr {
            if let Ok(group) = serde_json::from_value::<Group>(item.clone()) {
                if !groups.iter().any(|g| g.id == group.id) {
                    groups.push(group);
                }
            }
        }
        drop(groups);
        state.save_groups().await;
    }

    Ok(())
}

// ── Credential Storage Commands ──────────────────────────────────────────────

#[tauri::command]
async fn store_password(
    _state: tauri::State<'_, AppState>,
    connection_id: String,
    password: String,
) -> Result<(), String> {
    let entry = keyring::Entry::new("remote-ssh-manager", &connection_id).map_err(err)?;
    entry.set_password(&password).map_err(err)?;
    Ok(())
}

#[tauri::command]
async fn get_password(
    _state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<String, String> {
    let entry = keyring::Entry::new("remote-ssh-manager", &connection_id).map_err(err)?;
    entry.get_password().map_err(err)
}

#[tauri::command]
async fn delete_password(
    _state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    let entry = keyring::Entry::new("remote-ssh-manager", &connection_id).map_err(err)?;
    entry.delete_credential().map_err(err)
}

// ── SSH Connection Commands ──────────────────────────────────────────────────

#[tauri::command]
async fn ssh_connect(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    term_cols: u32,
    term_rows: u32,
) -> Result<String, String> {
    let config = {
        let connections = state.connections.lock().await;
        connections
            .iter()
            .find(|c| c.id == connection_id)
            .cloned()
            .ok_or_else(|| format!("Connection not found: {}", connection_id))?
    };

    let session_id = Uuid::new_v4().to_string();
    let connection_name = config.name.clone();

    let ssh_config = Arc::new(russh::client::Config::default());
    let handler = ClientHandler;

    let addr = (config.host.as_str(), config.port);

    let mut session = russh::client::connect(ssh_config, addr, handler)
        .await
        .map_err(|e| format!("SSH connection failed: {}", e))?;

    // Authenticate
    match config.auth_type {
        AuthType::Password => {
            let entry = keyring::Entry::new("remote-ssh-manager", &connection_id).map_err(err)?;
            let password = entry
                .get_password()
                .map_err(|e| format!("Failed to get password: {}", e))?;
            let auth_result = session
                .authenticate_password(&config.username, &password)
                .await
                .map_err(|e| format!("Authentication failed: {}", e))?;
            if !auth_result.success() {
                return Err("Authentication rejected by server".into());
            }
        }
        AuthType::KeyFile => {
            let key_path = config
                .key_path
                .as_ref()
                .ok_or_else(|| "Key file path not configured".to_string())?;
            let key_pair = russh::keys::load_secret_key(key_path, None)
                .map_err(|e| format!("Failed to load key file: {}", e))?;

            let hash_alg = session
                .best_supported_rsa_hash()
                .await
                .map_err(|e| format!("Failed to negotiate hash: {}", e))?
                .flatten();

            let auth_result = session
                .authenticate_publickey(
                    &config.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key_pair), hash_alg),
                )
                .await
                .map_err(|e| format!("Key authentication failed: {}", e))?;
            if !auth_result.success() {
                return Err("Key authentication rejected by server".into());
            }
        }
    }

    // Wrap session in Arc for sharing
    let session_arc = Arc::new(session);

    // Open channel and request PTY + shell
    let mut channel = session_arc
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    channel
        .request_pty(false, "xterm-256color", term_cols, term_rows, 0, 0, &[])
        .await
        .map_err(|e| format!("Failed to request PTY: {}", e))?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| format!("Failed to request shell: {}", e))?;

    // Set up command channel
    let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::unbounded_channel::<SshCommand>();

    let session_id_clone = session_id.clone();
    let app_handle_clone = app_handle.clone();
    let session_arc_clone = session_arc.clone();

    // Spawn event loop task
    tokio::spawn(async move {
        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(SshCommand::Write(data)) => {
                            if channel.data_bytes(data).await.is_err() {
                                break;
                            }
                        }
                        Some(SshCommand::Resize(cols, rows)) => {
                            channel.window_change(cols, rows, 0, 0).await.ok();
                        }
                        Some(SshCommand::Close) | None => {
                            channel.close().await.ok();
                            break;
                        }
                    }
                }
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let text = String::from_utf8_lossy(&data[..]).to_string();
                            let payload = serde_json::json!({
                                "session_id": &session_id_clone,
                                "data": text,
                            });
                            app_handle_clone.emit("ssh-output", payload).ok();
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                            let payload = serde_json::json!({
                                "session_id": &session_id_clone,
                                "data": format!("\r\n[Process exited with code {}]\r\n", exit_status),
                            });
                            app_handle_clone.emit("ssh-output", payload).ok();
                            break;
                        }
                        None => {
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        session_arc_clone
            .disconnect(russh::Disconnect::ByApplication, "", "English")
            .await
            .ok();
    });

    // Store session info
    let session_inner = Arc::new(SshSessionInner {
        connection_id: connection_id.clone(),
        connection_name: connection_name.clone(),
        session_handle: session_arc,
        cmd_tx,
    });

    {
        let mut sessions = state.sessions.lock().await;
        sessions.insert(session_id.clone(), session_inner);
    }

    Ok(session_id)
}

#[tauri::command]
async fn ssh_disconnect(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let session = {
        let mut sessions = state.sessions.lock().await;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        session.cmd_tx.send(SshCommand::Close).ok();
    }

    Ok(())
}

#[tauri::command]
async fn ssh_write(
    state: tauri::State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;
    session
        .cmd_tx
        .send(SshCommand::Write(data.into_bytes()))
        .map_err(|e| format!("Failed to send data: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn ssh_resize(
    state: tauri::State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;
    session
        .cmd_tx
        .send(SshCommand::Resize(cols, rows))
        .map_err(|e| format!("Failed to resize: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn ssh_list_sessions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SessionInfo>, String> {
    let sessions = state.sessions.lock().await;
    let infos: Vec<SessionInfo> = sessions
        .iter()
        .map(|(id, s)| SessionInfo {
            id: id.clone(),
            connection_id: s.connection_id.clone(),
            connection_name: s.connection_name.clone(),
        })
        .collect();
    Ok(infos)
}

// ── SFTP Commands ────────────────────────────────────────────────────────────

async fn open_sftp_channel(
    session_handle: &russh::client::Handle<ClientHandler>,
) -> Result<russh_sftp::client::SftpSession, String> {
    let sftp_channel = session_handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SFTP channel: {}", e))?;

    sftp_channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("Failed to request SFTP subsystem: {}", e))?;

    let stream = sftp_channel.into_stream();

    let sftp = russh_sftp::client::SftpSession::new(stream)
        .await
        .map_err(|e| format!("Failed to initialize SFTP: {}", e))?;

    Ok(sftp)
}

#[tauri::command]
async fn sftp_list_directory(
    state: tauri::State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("Session not found: {}", session_id))?
    };

    let sftp = open_sftp_channel(&session.session_handle).await?;

    let read_dir = sftp
        .read_dir(&path)
        .await
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result = Vec::new();
    for entry in read_dir {
        let metadata = entry.metadata();
        let is_dir = metadata
            .permissions
            .map(|p| (p & 0o40000) != 0)
            .unwrap_or(false);
        let size = metadata.size.unwrap_or(0);
        let permissions = metadata.permissions.unwrap_or(0);
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let entry_path = entry.path();

        result.push(FileEntry {
            name: entry.file_name(),
            path: entry_path,
            is_dir,
            size,
            permissions,
            modified,
        });
    }

    sftp.close().await.map_err(err)?;
    Ok(result)
}

#[tauri::command]
async fn sftp_upload_file(
    state: tauri::State<'_, AppState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("Session not found: {}", session_id))?
    };

    let data = std::fs::read(&local_path)
        .map_err(|e| format!("Failed to read local file: {}", e))?;

    let sftp = open_sftp_channel(&session.session_handle).await?;

    sftp.write(&remote_path, &data)
        .await
        .map_err(|e| format!("Failed to upload file: {}", e))?;

    sftp.close().await.map_err(err)?;
    Ok(())
}

#[tauri::command]
async fn sftp_download_file(
    state: tauri::State<'_, AppState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("Session not found: {}", session_id))?
    };

    let sftp = open_sftp_channel(&session.session_handle).await?;

    let data = sftp
        .read(&remote_path)
        .await
        .map_err(|e| format!("Failed to download file: {}", e))?;

    sftp.close().await.map_err(err)?;

    if let Some(parent) = std::path::Path::new(&local_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create local directory: {}", e))?;
    }

    std::fs::write(&local_path, data)
        .map_err(|e| format!("Failed to write local file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn sftp_delete_file(
    state: tauri::State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("Session not found: {}", session_id))?
    };

    let sftp = open_sftp_channel(&session.session_handle).await?;

    // Try to remove as file first, then as directory
    if let Err(_) = sftp.remove_file(&path).await {
        sftp.remove_dir(&path)
            .await
            .map_err(|e| format!("Failed to delete: {}", e))?;
    }

    sftp.close().await.map_err(err)?;
    Ok(())
}

#[tauri::command]
async fn sftp_rename_file(
    state: tauri::State<'_, AppState>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("Session not found: {}", session_id))?
    };

    let sftp = open_sftp_channel(&session.session_handle).await?;

    sftp.rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("Failed to rename: {}", e))?;

    sftp.close().await.map_err(err)?;
    Ok(())
}

#[tauri::command]
async fn sftp_create_directory(
    state: tauri::State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("Session not found: {}", session_id))?
    };

    let sftp = open_sftp_channel(&session.session_handle).await?;

    sftp.create_dir(&path)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    sftp.close().await.map_err(err)?;
    Ok(())
}

// ── App Setup ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let state = AppState::new();
            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_connections,
            add_connection,
            update_connection,
            delete_connection,
            list_groups,
            add_group,
            delete_group,
            rename_group,
            move_connection_to_group,
            export_connections,
            import_connections,
            store_password,
            get_password,
            delete_password,
            ssh_connect,
            ssh_disconnect,
            ssh_write,
            ssh_resize,
            ssh_list_sessions,
            sftp_list_directory,
            sftp_upload_file,
            sftp_download_file,
            sftp_delete_file,
            sftp_rename_file,
            sftp_create_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
