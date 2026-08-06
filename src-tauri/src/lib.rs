use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use russh::keys::key::PrivateKeyWithHashAlg;
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
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
    // Dedicated SFTP sessions (separate SSH connections for file operations)
    pub(crate) sftp_sessions: Mutex<HashMap<String, Arc<russh_sftp::client::SftpSession>>>,
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
            sftp_sessions: Mutex::new(HashMap::new()),
        }
    }

    fn load_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Option<T> {
        let data = std::fs::read_to_string(path).ok()?;
        match serde_json::from_str(&data) {
            Ok(v) => {
                log::info!("Loaded data from {}", path.display());
                Some(v)
            }
            Err(e) => {
                log::error!("Failed to parse {}: {}", path.display(), e);
                None
            }
        }
    }

    async fn save_connections(&self) {
        if let Ok(json) = serde_json::to_string_pretty(&*self.connections.lock().await) {
            if let Err(e) = std::fs::write(&self.config_path, json) {
                log::error!("Failed to save connections: {}", e);
            }
        }
    }

    async fn save_groups(&self) {
        if let Ok(json) = serde_json::to_string_pretty(&*self.groups.lock().await) {
            if let Err(e) = std::fs::write(&self.groups_path, json) {
                log::error!("Failed to save groups: {}", e);
            }
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
    log::info!("Added connection: {} ({}@{}:{})", config.name, config.username, config.host, config.port);
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
    log::info!("Updated connection: {} ({})", updated.name, updated.id);
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

    log::info!("Deleted connection: {}", id);
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

    log::info!("Connecting to {} ({}) as {}...", config.name, config.host, config.username);

    let mut session = russh::client::connect(ssh_config, addr, handler)
        .await
        .map_err(|e| {
            log::error!("SSH connection to {} failed: {}", config.host, e);
            format!("SSH connection failed: {}", e)
        })?;

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
                log::error!("Password authentication rejected for {}", config.username);
                return Err("Authentication rejected by server".into());
            }
            log::info!("Password authentication successful for {}", config.username);
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
                log::error!("Key authentication rejected for {}", config.username);
                return Err("Key authentication rejected by server".into());
            }
            log::info!("Key authentication successful for {}", config.username);
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

    log::info!("SSH session {} established for {} (pty {}x{})", session_id, connection_name, term_cols, term_rows);

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
                            log::info!("Session {} exited with code {}", session_id_clone, exit_status);
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
        log::info!("Session {} disconnected", session_id);
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

fn hex_preview(data: &[u8], max: usize) -> String {
    let n = data.len().min(max);
    let hex: Vec<String> = data[..n].iter().map(|b| format!("{:02x}", b)).collect();
    let ascii: String = data[..n]
        .iter()
        .map(|b| if *b >= 0x20 && *b < 0x7f { *b as char } else { '.' })
        .collect();
    format!("[{}] \"{}\"", hex.join(" "), ascii)
}

/// Scan a buffer for the byte offset where the SFTP SSH_FXP_VERSION packet starts.
///
/// Some servers inject shell/profile output (MOTD, monitoring scripts) into the
/// SFTP channel before the protocol begins. The SFTP parser then mis-reads the
/// first garbage bytes as a huge packet length and hangs. This locates the real
/// VERSION packet so the prefix garbage can be stripped.
///
/// A valid VERSION packet begins with:
///   [4-byte length][type=0x02][4-byte version]
fn find_sftp_version_start(buf: &[u8]) -> Option<usize> {
    if buf.len() < 9 {
        return None;
    }
    for i in 0..=(buf.len() - 9) {
        let len = u32::from_be_bytes([buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]);
        let typ = buf[i + 4];
        let ver = u32::from_be_bytes([buf[i + 5], buf[i + 6], buf[i + 7], buf[i + 8]]);
        // type must be SSH_FXP_VERSION (2); length and version must be sane.
        // Text garbage never contains a 0x02 type byte, so this is reliable.
        if typ == 0x02 && (5..=262144).contains(&len) && (1..=6).contains(&ver) {
            return Some(i);
        }
    }
    None
}

/// Find the byte offset of `needle` within `haystack`.
fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[derive(Serialize)]
struct SftpConnectResult {
    session_id: String,
    home_path: String,
}

/// Try to open an SFTP session on a given SSH session handle.
///
/// When `sudo_password` is Some, the session is elevated to root via sudo.
async fn open_sftp_on_session(
    session_handle: &Arc<russh::client::Handle<ClientHandler>>,
    sudo_password: Option<&str>,
) -> Result<russh_sftp::client::SftpSession, String> {
    let sftp_config = russh_sftp::client::Config {
        request_timeout_secs: 30,
        ..Default::default()
    };

    if let Some(password) = sudo_password {
        log::info!("Trying SFTP via sudo elevation...");
        match try_sftp_sudo(session_handle, password, &sftp_config).await {
            Ok(sftp) => {
                log::info!("SFTP sudo elevation succeeded");
                return Ok(sftp);
            }
            Err(e) => {
                log::warn!("SFTP sudo elevation failed: {}", e);
                return Err(format!("Privileged SFTP (sudo) failed: {}", e));
            }
        }
    }

    log::info!("Trying SFTP subsystem...");
    match try_sftp_subsystem(session_handle, &sftp_config).await {
        Ok(sftp) => {
            log::info!("SFTP subsystem succeeded");
            return Ok(sftp);
        }
        Err(e) => log::warn!("SFTP subsystem failed: {}", e),
    }

    Err(format!(
        "SFTP connection failed. The server may not have SFTP subsystem configured. \
         Check sshd_config for 'Subsystem sftp' on the remote server. \
         (Last error: {})",
        "subsystem rejected or timed out"
    ))
}

/// Open SFTP subsystem on a channel.
/// Uses channel.wait() for reading (proven to work) via a duplex bridge,
/// bypassing into_stream()/ChannelRx which fails to deliver data on some servers.
async fn try_sftp_subsystem(
    handle: &Arc<russh::client::Handle<ClientHandler>>,
    cfg: &russh_sftp::client::Config,
) -> Result<russh_sftp::client::SftpSession, String> {
    log::info!("  [subsystem] Opening channel...");
    let mut channel = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        handle.channel_open_session(),
    )
    .await
    .map_err(|_| "Channel open timed out (10s)".to_string())?
    .map_err(|e| format!("Failed to open channel: {}", e))?;
    log::info!("  [subsystem] Channel opened, requesting sftp subsystem...");

    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("Failed to request SFTP subsystem: {}", e))?;

    // Wait for Success/Failure before proceeding
    loop {
        match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            channel.wait(),
        )
        .await
        {
            Ok(Some(ChannelMsg::Success)) => {
                log::info!("  [subsystem] Server confirmed SFTP subsystem (Success)");
                break;
            }
            Ok(Some(ChannelMsg::Failure)) => {
                return Err("SFTP subsystem rejected by server".to_string());
            }
            Ok(Some(ChannelMsg::Eof)) | Ok(None) => {
                return Err("Channel closed while waiting for SFTP subsystem".to_string());
            }
            Ok(Some(other)) => {
                log::info!("  [subsystem] Skipping message: {:?}", other);
                continue;
            }
            Err(_) => {
                return Err("Timed out waiting for SFTP subsystem confirmation".to_string());
            }
        }
    }

    // Bridge: channel.wait() ↔ duplex pipe ↔ SftpSession
    // This bypasses into_stream()/ChannelRx which fails to deliver SFTP data
    // on some servers, and strips any shell/profile garbage the server injects
    // before the SFTP VERSION packet.
    let (client_side, mut bridge_side) = tokio::io::duplex(65536);

    tokio::spawn(async move {
        let mut chan = channel;
        let mut read_buf = vec![0u8; 32768];
        let mut pending = Vec::new(); // buffers server data until VERSION start is found
        let mut sftp_started = false; // true once VERSION packet start is located
        loop {
            tokio::select! {
                msg = chan.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            if sftp_started {
                                if bridge_side.write_all(&data).await.is_err() {
                                    break;
                                }
                            } else {
                                pending.extend_from_slice(&data);
                                if let Some(idx) = find_sftp_version_start(&pending) {
                                    if idx > 0 {
                                        log::warn!(
                                            "  [bridge] stripped {} bytes of leading garbage: {}",
                                            idx,
                                            hex_preview(&pending[..idx], 48)
                                        );
                                    }
                                    let rest = pending.split_off(idx);
                                    sftp_started = true;
                                    log::info!(
                                        "  [bridge] SFTP VERSION found, forwarding {} bytes",
                                        rest.len()
                                    );
                                    if bridge_side.write_all(&rest).await.is_err() {
                                        break;
                                    }
                                } else if pending.len() > 1_000_000 {
                                    // Safety valve: give up scanning and pass data through.
                                    log::warn!("  [bridge] no SFTP VERSION header in first 1MB, passing through");
                                    let rest = std::mem::take(&mut pending);
                                    sftp_started = true;
                                    if bridge_side.write_all(&rest).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                        Some(ChannelMsg::ExtendedData { data, ext }) => {
                            // Server stderr — log but do not forward to the SFTP parser.
                            log::info!(
                                "  [bridge] ExtendedData (ext={}, {} bytes): {}",
                                ext,
                                data.len(),
                                hex_preview(&data, 48)
                            );
                        }
                        Some(ChannelMsg::Eof) => {
                            log::info!("  [bridge] recv Eof");
                            bridge_side.shutdown().await.ok();
                            break;
                        }
                        None => {
                            log::info!("  [bridge] channel closed (None)");
                            break;
                        }
                        Some(other) => {
                            log::info!("  [bridge] recv other: {:?}", other);
                        }
                    }
                }
                n = bridge_side.read(&mut read_buf) => {
                    match n {
                        Ok(0) => {
                            log::info!("  [bridge] SftpSession closed pipe (read 0)");
                            chan.eof().await.ok();
                            break;
                        }
                        Ok(n) => {
                            if chan.data_bytes(read_buf[..n].to_vec()).await.is_err() {
                                log::warn!("  [bridge] data_bytes failed");
                                break;
                            }
                        }
                        Err(e) => {
                            log::warn!("  [bridge] read error: {}", e);
                            break;
                        }
                    }
                }
            }
        }
        log::info!("  [bridge] task ended");
    });

    log::info!("  [subsystem] Bridge started, initializing SFTP protocol...");

    tokio::time::timeout(
        std::time::Duration::from_secs(20),
        russh_sftp::client::SftpSession::new_with_config(client_side, cfg.clone()),
    )
    .await
    .map_err(|_| "SFTP protocol initialization timed out (20s)".to_string())?
    .map_err(|e| format!("SFTP protocol init failed: {}", e))
}

/// Open an SFTP session with elevated (root) privileges via sudo.
///
/// sudo and sftp-server share the same stdin, so the sudo password must reach
/// sudo before any SFTP data. We orchestrate this by having the elevated shell
/// print a ready marker immediately before exec'ing sftp-server; only after the
/// marker is seen do we start the SFTP handshake (send INIT). The garbage-
/// stripping bridge then handles any output preceding the SFTP VERSION packet.
async fn try_sftp_sudo(
    handle: &Arc<russh::client::Handle<ClientHandler>>,
    password: &str,
    cfg: &russh_sftp::client::Config,
) -> Result<russh_sftp::client::SftpSession, String> {
    const SUDO_PROMPT: &str = "SFTP_SUDO_PROMPT_7f3a";
    const READY_MARKER: &str = "__SFTP_SUDO_READY__";

    let cmd = format!(
        "sudo -S -p '{prompt}' /bin/sh -c 'for p in /usr/lib/openssh/sftp-server /usr/libexec/openssh/sftp-server /usr/libexec/sftp-server /usr/lib/ssh/sftp-server; do if [ -x \"$p\" ]; then echo {marker}; exec \"$p\"; fi; done; exit 127'",
        prompt = SUDO_PROMPT,
        marker = READY_MARKER
    );

    log::info!("  [sudo] Opening channel...");
    let mut channel = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        handle.channel_open_session(),
    )
    .await
    .map_err(|_| "Channel open timed out".to_string())?
    .map_err(|e| format!("Failed to open channel: {}", e))?;

    log::info!("  [sudo] Channel opened, exec sudo sftp-server...");
    channel
        .exec(false, cmd)
        .await
        .map_err(|e| format!("Failed to exec sudo sftp-server: {}", e))?;

    // Phase 1: sudo orchestration — wait for the ready marker, answer the prompt.
    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    let mut password_sent = false;
    let mut leftover = Vec::new();

    let phase1 = async {
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    stdout_buf.extend_from_slice(&data);
                    // Defensive: some sudo builds write the prompt to stdout.
                    if !password_sent
                        && find_bytes(&stdout_buf, SUDO_PROMPT.as_bytes()).is_some()
                    {
                        log::info!("  [sudo] prompt on stdout, sending password");
                        let mut pw = password.as_bytes().to_vec();
                        pw.push(b'\n');
                        channel.data_bytes(pw).await.ok();
                        password_sent = true;
                    }
                    if let Some(pos) = find_bytes(&stdout_buf, READY_MARKER.as_bytes()) {
                        let after = pos + READY_MARKER.len();
                        leftover = stdout_buf[after..].to_vec();
                        log::info!(
                            "  [sudo] ready marker found (password_sent={})",
                            password_sent
                        );
                        return Ok::<(), String>(());
                    }
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    stderr_buf.extend_from_slice(&data);
                    if !password_sent
                        && find_bytes(&stderr_buf, SUDO_PROMPT.as_bytes()).is_some()
                    {
                        log::info!("  [sudo] prompt on stderr, sending password");
                        let mut pw = password.as_bytes().to_vec();
                        pw.push(b'\n');
                        channel.data_bytes(pw).await.ok();
                        password_sent = true;
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    return Err(format!(
                        "sudo exited with status {} before starting sftp-server. stderr: {}",
                        exit_status,
                        String::from_utf8_lossy(&stderr_buf).trim()
                    ));
                }
                Some(ChannelMsg::Eof) | None => {
                    return Err(format!(
                        "Channel closed during sudo elevation. stderr: {}",
                        String::from_utf8_lossy(&stderr_buf).trim()
                    ));
                }
                _ => {}
            }
        }
    };

    tokio::time::timeout(std::time::Duration::from_secs(40), phase1)
        .await
        .map_err(|_| {
            format!(
                "sudo elevation timed out (40s). stderr: {}",
                String::from_utf8_lossy(&stderr_buf).trim()
            )
        })??;

    // Phase 2: hand off to SftpSession via a garbage-stripping bridge.
    let (client_side, mut bridge_side) = tokio::io::duplex(65536);

    tokio::spawn(async move {
        let mut chan = channel;
        let mut read_buf = vec![0u8; 32768];
        let mut pending = leftover;
        let mut sftp_started = false;

        // Forward bytes that already arrived right after the marker.
        if let Some(idx) = find_sftp_version_start(&pending) {
            if idx > 0 {
                log::warn!("  [sudo-bridge] stripped {} garbage bytes", idx);
            }
            let rest = pending.split_off(idx);
            sftp_started = true;
            bridge_side.write_all(&rest).await.ok();
        }

        loop {
            tokio::select! {
                msg = chan.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            if sftp_started {
                                if bridge_side.write_all(&data).await.is_err() { break; }
                            } else {
                                pending.extend_from_slice(&data);
                                if let Some(idx) = find_sftp_version_start(&pending) {
                                    if idx > 0 {
                                        log::warn!("  [sudo-bridge] stripped {} garbage bytes", idx);
                                    }
                                    let rest = pending.split_off(idx);
                                    sftp_started = true;
                                    if bridge_side.write_all(&rest).await.is_err() { break; }
                                } else if pending.len() > 1_000_000 {
                                    let rest = std::mem::take(&mut pending);
                                    sftp_started = true;
                                    if bridge_side.write_all(&rest).await.is_err() { break; }
                                }
                            }
                        }
                        Some(ChannelMsg::ExtendedData { .. }) => {}
                        Some(ChannelMsg::Eof) | None => {
                            bridge_side.shutdown().await.ok();
                            break;
                        }
                        _ => {}
                    }
                }
                n = bridge_side.read(&mut read_buf) => {
                    match n {
                        Ok(0) => {
                            chan.eof().await.ok();
                            break;
                        }
                        Ok(n) => {
                            if chan.data_bytes(read_buf[..n].to_vec()).await.is_err() { break; }
                        }
                        Err(_) => break,
                    }
                }
            }
        }
        log::info!("  [sudo-bridge] task ended");
    });

    log::info!("  [sudo] Bridge started, initializing SFTP protocol...");
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        russh_sftp::client::SftpSession::new_with_config(client_side, cfg.clone()),
    )
    .await
    .map_err(|_| "SFTP protocol initialization timed out after sudo (30s)".to_string())?
    .map_err(|e| format!("SFTP protocol init failed after sudo: {}", e))
}

/// Establish SFTP connection. Reuses the existing SSH session when available
/// (matching MobaXterm's single-connection behavior). Falls back to a new
/// connection if no terminal session exists.
#[tauri::command]
async fn sftp_connect(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    privileged: Option<bool>,
) -> Result<SftpConnectResult, String> {
    let privileged = privileged.unwrap_or(false);

    let config = {
        let connections = state.connections.lock().await;
        connections
            .iter()
            .find(|c| c.id == connection_id)
            .cloned()
            .ok_or_else(|| format!("Connection not found: {}", connection_id))?
    };

    // For privileged mode we reuse the stored SSH login password for sudo.
    let sudo_password: Option<String> = if privileged {
        match config.auth_type {
            AuthType::Password => {
                let entry =
                    keyring::Entry::new("remote-ssh-manager", &connection_id).map_err(err)?;
                let password = entry.get_password().map_err(|e| {
                    format!("Privileged mode needs the stored SSH password: {}", e)
                })?;
                Some(password)
            }
            AuthType::KeyFile => {
                return Err(
                    "Privileged (sudo) mode requires a password-based connection. \
                     This connection uses a key file, so no password is available for sudo. \
                     Configure passwordless sudo on the server instead."
                        .to_string(),
                );
            }
        }
    } else {
        None
    };

    // Try to reuse the existing SSH session (like MobaXterm does)
    let existing_handle = {
        let sessions = state.sessions.lock().await;
        sessions
            .values()
            .find(|s| s.connection_id == connection_id)
            .map(|s| s.session_handle.clone())
    };

    let sftp = if let Some(handle) = existing_handle {
        log::info!(
            "Reusing existing SSH session for SFTP on {} ({}) privileged={}",
            config.name,
            config.host,
            privileged
        );
        open_sftp_on_session(&handle, sudo_password.as_deref()).await
    } else {
        log::info!(
            "No existing SSH session, creating new connection for SFTP on {} ({})",
            config.name,
            config.host
        );
        // Create a new SSH connection
        let ssh_config = Arc::new(russh::client::Config::default());
        let handler = ClientHandler;

        let mut session = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            russh::client::connect(ssh_config, (config.host.as_str(), config.port), handler),
        )
        .await
        .map_err(|_| {
            log::error!("SFTP SSH connection to {} timed out after 30s", config.host);
            format!("SFTP connection to {} timed out (30s)", config.host)
        })?
        .map_err(|e| {
            log::error!("SFTP SSH connection to {} failed: {}", config.host, e);
            format!("SFTP connection failed: {}", e)
        })?;

        // Authenticate
        match config.auth_type {
            AuthType::Password => {
                let entry =
                    keyring::Entry::new("remote-ssh-manager", &connection_id).map_err(err)?;
                let password = entry
                    .get_password()
                    .map_err(|e| format!("Failed to get password for SFTP: {}", e))?;
                let auth_result = session
                    .authenticate_password(&config.username, &password)
                    .await
                    .map_err(|e| format!("SFTP authentication failed: {}", e))?;
                if !auth_result.success() {
                    return Err("SFTP authentication rejected by server".into());
                }
            }
            AuthType::KeyFile => {
                let key_path = config
                    .key_path
                    .as_ref()
                    .ok_or_else(|| "Key file path not configured".to_string())?;
                let key_pair = russh::keys::load_secret_key(key_path, None)
                    .map_err(|e| format!("Failed to load key file for SFTP: {}", e))?;
                let hash_alg = session
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|e| format!("Failed to negotiate hash for SFTP: {}", e))?
                    .flatten();
                let auth_result = session
                    .authenticate_publickey(
                        &config.username,
                        PrivateKeyWithHashAlg::new(Arc::new(key_pair), hash_alg),
                    )
                    .await
                    .map_err(|e| format!("SFTP key authentication failed: {}", e))?;
                if !auth_result.success() {
                    return Err("SFTP key authentication rejected by server".into());
                }
            }
        }

        let session_arc = Arc::new(session);
        open_sftp_on_session(&session_arc, sudo_password.as_deref()).await
    };

    let sftp = sftp?;

    // Get home directory via SFTP canonicalize (like MobaXterm starting at /home/user)
    let home_path = sftp
        .canonicalize(".")
        .await
        .unwrap_or_else(|_| "/".to_string());
    log::info!("SFTP home path for {}: {}", config.name, home_path);

    let sftp_session_id = Uuid::new_v4().to_string();
    {
        let mut sftp_sessions = state.sftp_sessions.lock().await;
        sftp_sessions.insert(sftp_session_id.clone(), Arc::new(sftp));
    }

    log::info!(
        "SFTP session {} established for {} (home: {})",
        sftp_session_id,
        config.name,
        home_path
    );
    Ok(SftpConnectResult {
        session_id: sftp_session_id,
        home_path,
    })
}

#[tauri::command]
async fn sftp_disconnect(
    state: tauri::State<'_, AppState>,
    sftp_session_id: String,
) -> Result<(), String> {
    let mut sftp_sessions = state.sftp_sessions.lock().await;
    if sftp_sessions.remove(&sftp_session_id).is_some() {
        log::info!("SFTP session {} disconnected", sftp_session_id);
    }
    Ok(())
}

#[tauri::command]
async fn sftp_list_directory(
    state: tauri::State<'_, AppState>,
    sftp_session_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    let sftp = {
        let sftp_sessions = state.sftp_sessions.lock().await;
        sftp_sessions
            .get(&sftp_session_id)
            .cloned()
            .ok_or_else(|| format!("SFTP session not found: {}", sftp_session_id))?
    };

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

    Ok(result)
}

#[tauri::command]
async fn sftp_upload_file(
    state: tauri::State<'_, AppState>,
    sftp_session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let sftp = {
        let sftp_sessions = state.sftp_sessions.lock().await;
        sftp_sessions
            .get(&sftp_session_id)
            .cloned()
            .ok_or_else(|| format!("SFTP session not found: {}", sftp_session_id))?
    };

    let data = std::fs::read(&local_path)
        .map_err(|e| format!("Failed to read local file: {}", e))?;

    // russh-sftp's write() opens with WRITE only (no CREATE/TRUNCATE), so it
    // fails with "No such file" when the remote file does not already exist.
    // Use create() which opens with CREATE | TRUNCATE | WRITE, then flush and
    // close via shutdown() so the upload is fully committed.
    let mut file = sftp
        .create(&remote_path)
        .await
        .map_err(|e| format!("Failed to create remote file {}: {}", remote_path, e))?;
    file.write_all(&data)
        .await
        .map_err(|e| format!("Failed to upload file: {}", e))?;
    file.shutdown()
        .await
        .map_err(|e| format!("Failed to finalize upload: {}", e))?;

    log::info!("Uploaded {} to {} ({} bytes)", local_path, remote_path, data.len());
    Ok(())
}

#[tauri::command]
async fn sftp_download_file(
    state: tauri::State<'_, AppState>,
    sftp_session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let sftp = {
        let sftp_sessions = state.sftp_sessions.lock().await;
        sftp_sessions
            .get(&sftp_session_id)
            .cloned()
            .ok_or_else(|| format!("SFTP session not found: {}", sftp_session_id))?
    };

    let data = sftp
        .read(&remote_path)
        .await
        .map_err(|e| format!("Failed to download file: {}", e))?;

    if let Some(parent) = std::path::Path::new(&local_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create local directory: {}", e))?;
    }

    std::fs::write(&local_path, data)
        .map_err(|e| format!("Failed to write local file: {}", e))?;

    log::info!("Downloaded {} to {}", remote_path, local_path);
    Ok(())
}

#[tauri::command]
async fn sftp_delete_file(
    state: tauri::State<'_, AppState>,
    sftp_session_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = {
        let sftp_sessions = state.sftp_sessions.lock().await;
        sftp_sessions
            .get(&sftp_session_id)
            .cloned()
            .ok_or_else(|| format!("SFTP session not found: {}", sftp_session_id))?
    };

    // Try to remove as file first, then as directory
    if let Err(_) = sftp.remove_file(&path).await {
        sftp.remove_dir(&path)
            .await
            .map_err(|e| format!("Failed to delete: {}", e))?;
    }

    log::info!("Deleted remote path: {}", path);
    Ok(())
}

#[tauri::command]
async fn sftp_rename_file(
    state: tauri::State<'_, AppState>,
    sftp_session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let sftp = {
        let sftp_sessions = state.sftp_sessions.lock().await;
        sftp_sessions
            .get(&sftp_session_id)
            .cloned()
            .ok_or_else(|| format!("SFTP session not found: {}", sftp_session_id))?
    };

    sftp.rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("Failed to rename: {}", e))?;

    log::info!("Renamed {} to {}", old_path, new_path);
    Ok(())
}

#[tauri::command]
async fn sftp_create_directory(
    state: tauri::State<'_, AppState>,
    sftp_session_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = {
        let sftp_sessions = state.sftp_sessions.lock().await;
        sftp_sessions
            .get(&sftp_session_id)
            .cloned()
            .ok_or_else(|| format!("SFTP session not found: {}", sftp_session_id))?
    };

    sftp.create_dir(&path)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    log::info!("Created directory: {}", path);
    Ok(())
}

#[tauri::command]
async fn sftp_create_file(
    state: tauri::State<'_, AppState>,
    sftp_session_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = {
        let sftp_sessions = state.sftp_sessions.lock().await;
        sftp_sessions
            .get(&sftp_session_id)
            .cloned()
            .ok_or_else(|| format!("SFTP session not found: {}", sftp_session_id))?
    };

    // create() opens with CREATE | TRUNCATE | WRITE, producing an empty file.
    let mut file = sftp
        .create(&path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;
    file.shutdown()
        .await
        .map_err(|e| format!("Failed to finalize file creation: {}", e))?;

    log::info!("Created file: {}", path);
    Ok(())
}

#[tauri::command]
async fn sftp_read_file(
    state: tauri::State<'_, AppState>,
    sftp_session_id: String,
    path: String,
) -> Result<String, String> {
    let sftp = {
        let sftp_sessions = state.sftp_sessions.lock().await;
        sftp_sessions
            .get(&sftp_session_id)
            .cloned()
            .ok_or_else(|| format!("SFTP session not found: {}", sftp_session_id))?
    };

    let data = sftp
        .read(&path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    String::from_utf8(data)
        .map_err(|e| format!("File is not valid UTF-8: {}", e))
}

#[tauri::command]
async fn sftp_write_file(
    state: tauri::State<'_, AppState>,
    sftp_session_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let sftp = {
        let sftp_sessions = state.sftp_sessions.lock().await;
        sftp_sessions
            .get(&sftp_session_id)
            .cloned()
            .ok_or_else(|| format!("SFTP session not found: {}", sftp_session_id))?
    };

    let data = content.into_bytes();
    let mut file = sftp
        .create(&path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&data)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;
    file.shutdown()
        .await
        .map_err(|e| format!("Failed to finalize write: {}", e))?;

    log::info!("Wrote {} bytes to {}", data.len(), path);
    Ok(())
}

// ── HTTP Proxy Commands (bypass CORS) ────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct HttpRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[tauri::command]
async fn proxy_fetch(request: HttpRequest) -> Result<String, String> {
    let client = reqwest::Client::new();
    let method = match request.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(method, &request.url);
    for (key, value) in &request.headers {
        req = req.header(key.as_str(), value.as_str());
    }
    if let Some(body) = &request.body {
        req = req.body(body.clone());
    }

    let resp = req.send().await.map_err(err)?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(err)?;

    if status < 200 || status >= 300 {
        return Err(format!("HTTP {}: {}", status, text));
    }

    Ok(text)
}

#[tauri::command]
async fn proxy_fetch_stream(
    app_handle: tauri::AppHandle,
    request: HttpRequest,
    stream_id: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let method = match request.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(method, &request.url);
    for (key, value) in &request.headers {
        req = req.header(key.as_str(), value.as_str());
    }
    if let Some(body) = &request.body {
        req = req.body(body.clone());
    }

    let resp = req.send().await.map_err(err)?;
    let status = resp.status().as_u16();

    if status < 200 || status >= 300 {
        let text = resp.text().await.map_err(err)?;
        app_handle
            .emit(
                &format!("proxy-stream-error-{}", stream_id),
                format!("HTTP {}: {}", status, text),
            )
            .ok();
        return Ok(());
    }

    let mut stream = resp.bytes_stream();
    use futures::StreamExt;

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes).to_string();
                app_handle
                    .emit(&format!("proxy-stream-data-{}", stream_id), text)
                    .ok();
            }
            Err(e) => {
                app_handle
                    .emit(&format!("proxy-stream-error-{}", stream_id), err(e))
                    .ok();
                return Ok(());
            }
        }
    }

    app_handle
        .emit(&format!("proxy-stream-done-{}", stream_id), "")
        .ok();

    Ok(())
}

// ── Open Log Directory Command ───────────────────────────────────────────────

#[tauri::command]
async fn open_log_dir(app_handle: tauri::AppHandle) -> Result<(), String> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log dir: {}", e))?;

    // Ensure directory exists
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create log dir: {}", e))?;

    log::info!("Opening log directory: {}", log_dir.display());

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

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
            // Log plugin: always enabled, writes to file + stdout
            app.handle().plugin(
                tauri_plugin_log::Builder::new()
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    ])
                    .level(log::LevelFilter::Info)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                    .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                    .build(),
            )?;

            log::info!("Application started, data dir: {:?}", AppState::data_dir());

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
            sftp_connect,
            sftp_disconnect,
            sftp_list_directory,
            sftp_upload_file,
            sftp_download_file,
            sftp_delete_file,
            sftp_rename_file,
            sftp_create_directory,
            sftp_create_file,
            sftp_read_file,
            sftp_write_file,
            proxy_fetch,
            proxy_fetch_stream,
            open_log_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
