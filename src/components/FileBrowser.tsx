import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../store/useAppStore';
import { useI18nStore } from '../store/useI18nStore';
import { t, tf } from '../i18n/translations';

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  permissions: number;
  modified: number;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[] | null;
  loaded: boolean;
  loading: boolean;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  entry: FileEntry | null;
}

interface FileBrowserProps {
  connectionId: string;
  sessionId: string;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatPermissions(perm: number, isDir: boolean): string {
  const type = isDir ? 'd' : '-';
  const r = (perm & 0o400) ? 'r' : '-';
  const w = (perm & 0o200) ? 'w' : '-';
  const x = (perm & 0o100) ? 'x' : '-';
  const rr = (perm & 0o040) ? 'r' : '-';
  const ww = (perm & 0o020) ? 'w' : '-';
  const xx = (perm & 0o010) ? 'x' : '-';
  const rrr = (perm & 0o004) ? 'r' : '-';
  const www = (perm & 0o002) ? 'w' : '-';
  const xxx = (perm & 0o001) ? 'x' : '-';
  return `${type}${r}${w}${x}${rr}${ww}${xx}${rrr}${www}${xxx}`;
}

function formatDate(timestamp: number): string {
  if (timestamp === 0) return '-';
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays < 365) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function joinPath(parent: string, name: string): string {
  if (parent === '/') return `/${name}`;
  return `${parent}/${name}`;
}

function FileBrowser({ connectionId, sessionId: initialSessionId }: FileBrowserProps) {
  const { setSessionId, tabs, activeTabId } = useAppStore();

  const [sessionId, setLocalSessionId] = useState(initialSessionId);
  const [connecting, setConnecting] = useState(false);
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<'name' | 'size' | 'permissions' | 'modified'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, entry: null,
  });
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const { lang } = useI18nStore();
  const tr = (key: string) => t[lang][key] ?? key;

  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Auto-connect if no sessionId
  useEffect(() => {
    if (!initialSessionId && !sessionId && !connecting) {
      setConnecting(true);
      setError(null);
      invoke<string>('ssh_connect', {
        connectionId,
        termCols: 80,
        termRows: 24,
      })
        .then((sid) => {
          setLocalSessionId(sid);
          setConnecting(false);
          // Find the active tab and set sessionId
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (activeTab && activeTab.type === 'files') {
            setSessionId(activeTab.id, sid);
          }
        })
        .catch((e) => {
          setError(`${tr('file.connectFailed')}: ${e}`);
          setConnecting(false);
        });
    }
  }, [initialSessionId]);

  // Load root directory entries
  useEffect(() => {
    if (sessionId) {
      loadDirectory(currentPath);
    }
  }, [sessionId, currentPath]);

  const loadDirectory = useCallback(async (path: string) => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<FileEntry[]>('sftp_list_directory', {
        sessionId,
        path,
      });
      setEntries(result);
    } catch (e) {
      setError(`${tr('file.listFailed')}: ${e}`);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const loadTreeChildren = useCallback(async (node: TreeNode): Promise<TreeNode> => {
    try {
      const result = await invoke<FileEntry[]>('sftp_list_directory', {
        sessionId,
        path: node.path,
      });
      const dirs = result.filter((e) => e.is_dir);
      const children: TreeNode[] = dirs.map((d) => ({
        name: d.name,
        path: d.path,
        children: null,
        loaded: false,
        loading: false,
      }));
      return { ...node, children, loaded: true, loading: false };
    } catch {
      return { ...node, children: [], loaded: true, loading: false };
    }
  }, [sessionId]);

  // Initialize root tree nodes
  useEffect(() => {
    if (sessionId) {
      setTreeNodes([{
        name: '/',
        path: '/',
        children: null,
        loaded: false,
        loading: false,
      }]);
    }
  }, [sessionId]);

  const handleTreeToggle = useCallback(async (node: TreeNode) => {
    const path = node.path;

    if (expandedDirs.has(path)) {
      // Collapse
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      return;
    }

    // Expand
    setExpandedDirs((prev) => new Set(prev).add(path));

    // Load children if not loaded
    if (!node.loaded && !node.loading) {
      setTreeNodes((prev) =>
        updateTreeNode(prev, path, { ...node, loading: true })
      );
      const updated = await loadTreeChildren(node);
      setTreeNodes((prev) =>
        updateTreeNode(prev, path, updated)
      );
    }
  }, [expandedDirs, loadTreeChildren]);

  const handleTreeNavigate = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedEntries(new Set());
  }, []);

  const handleBreadcrumbClick = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedEntries(new Set());
  }, []);

  const handleSort = useCallback((column: 'name' | 'size' | 'permissions' | 'modified') => {
    setSortColumn((prev) => {
      if (prev === column) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDirection('asc');
      return column;
    });
  }, []);

  const sortedEntries = [...entries].sort((a, b) => {
    const dirCmp = (a.is_dir === b.is_dir) ? 0 : a.is_dir ? -1 : 1;
    if (sortColumn === 'name') {
      const cmp = a.name.localeCompare(b.name);
      if (dirCmp !== 0) return dirCmp;
      return sortDirection === 'asc' ? cmp : -cmp;
    }
    if (dirCmp !== 0) return dirCmp;
    let cmp = 0;
    if (sortColumn === 'size') cmp = a.size - b.size;
    else if (sortColumn === 'permissions') cmp = a.permissions - b.permissions;
    else if (sortColumn === 'modified') cmp = a.modified - b.modified;
    return sortDirection === 'asc' ? cmp : -cmp;
  });

  const handleDoubleClick = useCallback((entry: FileEntry) => {
    if (entry.is_dir) {
      setCurrentPath(entry.path);
      setSelectedEntries(new Set());
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleTableContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, entry: null });
  }, []);

  useEffect(() => {
    const handleClick = () => {
      setContextMenu((prev) => ({ ...prev, visible: false }));
    };
    if (contextMenu.visible) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu.visible]);

  const handleRefresh = useCallback(() => {
    if (sessionId) {
      loadDirectory(currentPath);
      // Also reload tree
      setTreeNodes([{
        name: '/',
        path: '/',
        children: null,
        loaded: false,
        loading: false,
      }]);
      setExpandedDirs(new Set());
    }
  }, [sessionId, currentPath, loadDirectory]);

  const handleUpload = useCallback(async () => {
    if (!sessionId) return;
    try {
      const selected = await open({ multiple: true });
      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];
      for (const filePath of files) {
        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file';
        const remotePath = joinPath(currentPath, fileName);
        await invoke('sftp_upload_file', {
          sessionId,
          localPath: filePath,
          remotePath,
        });
      }
      loadDirectory(currentPath);
    } catch (e) {
      setError(`${tr('file.uploadFailed')}: ${e}`);
    }
  }, [sessionId, currentPath, loadDirectory]);

  const handleNewFolder = useCallback(async () => {
    if (!sessionId) return;
    const name = prompt(tr('file.enterFolderName'));
    if (!name) return;
    try {
      const remotePath = joinPath(currentPath, name);
      await invoke('sftp_create_directory', { sessionId, path: remotePath });
      loadDirectory(currentPath);
    } catch (e) {
      setError(`${tr('file.createFolderFailed')}: ${e}`);
    }
  }, [sessionId, currentPath, loadDirectory]);

  const handleDeleteEntry = useCallback(async (entry: FileEntry) => {
    if (!sessionId) return;
    const msg = entry.is_dir
      ? tf(tr('file.deleteDirMsg'), { name: entry.name })
      : tf(tr('file.deleteFileMsg'), { name: entry.name });
    if (!confirm(msg)) return;
    try {
      await invoke('sftp_delete_file', { sessionId, path: entry.path });
      loadDirectory(currentPath);
    } catch (e) {
      setError(`${tr('file.deleteFailed')}: ${e}`);
    }
  }, [sessionId, currentPath, loadDirectory]);

  const handleRenameEntry = useCallback(async (entry: FileEntry) => {
    if (!sessionId) return;
    const newName = prompt(tr('file.enterNewName'), entry.name);
    if (!newName || newName === entry.name) return;
    const parentPath = currentPath === '/' ? '/' : currentPath;
    const newPath = joinPath(parentPath, newName);
    try {
      await invoke('sftp_rename_file', {
        sessionId,
        oldPath: entry.path,
        newPath,
      });
      loadDirectory(currentPath);
    } catch (e) {
      setError(`${tr('file.renameFailed')}: ${e}`);
    }
  }, [sessionId, currentPath, loadDirectory]);

  const handleDownloadEntry = useCallback(async (entry: FileEntry) => {
    if (!sessionId || entry.is_dir) return;
    try {
      const savePath = await save({ defaultPath: entry.name });
      if (!savePath) return;
      await invoke('sftp_download_file', {
        sessionId,
        remotePath: entry.path,
        localPath: savePath,
      });
    } catch (e) {
      setError(`${tr('file.downloadFailed')}: ${e}`);
    }
  }, [sessionId]);

  const handleToggleSelect = useCallback((entry: FileEntry, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedEntries((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
        }
        return next;
      });
    } else {
      setSelectedEntries(new Set([entry.path]));
    }
  }, []);

  const breadcrumbs = currentPath.split('/').filter(Boolean);
  const breadcrumbPaths: { name: string; path: string }[] = [
    { name: '/', path: '/' },
  ];
  let accumulated = '';
  for (const seg of breadcrumbs) {
    accumulated += `/${seg}`;
    breadcrumbPaths.push({ name: seg, path: accumulated });
  }

  const sortArrow = (column: string) => {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  // Connecting state
  if (connecting) {
    return (
      <div className="file-browser">
        <div className="file-browser-loading">
          <div className="spinner" />
          <p>{tr('file.connecting')}</p>
        </div>
      </div>
    );
  }

  // No session
  if (!sessionId) {
    return (
      <div className="file-browser">
        <div className="file-browser-loading">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <p>{tr('file.pleaseConnect')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="file-browser">
      {/* Toolbar */}
      <div className="file-browser-toolbar">
        <button className="fb-toolbar-btn" onClick={handleUpload} title={tr('file.upload')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>{tr('file.upload')}</span>
        </button>
        <button className="fb-toolbar-btn" onClick={handleNewFolder} title={tr('file.newFolder')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
          <span>{tr('file.newFolder')}</span>
        </button>
        <div className="fb-toolbar-separator" />
        <button
          className="fb-toolbar-btn"
          onClick={() => {
            if (contextMenu.entry) {
              handleDeleteEntry(contextMenu.entry);
            } else if (selectedEntries.size > 0) {
              const first = entries.find((e) => e.path === Array.from(selectedEntries)[0]);
              if (first) handleDeleteEntry(first);
            }
          }}
          title={tr('file.delete')}
          disabled={selectedEntries.size === 0}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span>{tr('file.delete')}</span>
        </button>
        <button
          className="fb-toolbar-btn"
          onClick={() => {
            const entry = selectedEntries.size > 0
              ? entries.find((e) => e.path === Array.from(selectedEntries)[0])
              : null;
            if (entry) handleRenameEntry(entry);
          }}
          title={tr('file.rename')}
          disabled={selectedEntries.size !== 1}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span>{tr('file.rename')}</span>
        </button>
        <button
          className="fb-toolbar-btn"
          onClick={() => {
            const entry = selectedEntries.size > 0
              ? entries.find((e) => e.path === Array.from(selectedEntries)[0])
              : null;
            if (entry && !entry.is_dir) handleDownloadEntry(entry);
          }}
          title={tr('file.download')}
          disabled={selectedEntries.size !== 1 || (selectedEntries.size === 1 && entries.find((e) => e.path === Array.from(selectedEntries)[0])?.is_dir)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{tr('file.download')}</span>
        </button>
        <div className="fb-toolbar-separator" />
        <button className="fb-toolbar-btn" onClick={handleRefresh} title={tr('file.refresh')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span>{tr('file.refresh')}</span>
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="file-browser-breadcrumb">
        {breadcrumbPaths.map((bp, i) => (
          <span key={bp.path}>
            {i > 0 && <span className="breadcrumb-sep">/</span>}
            <span
              className={`breadcrumb-item ${i === breadcrumbPaths.length - 1 ? 'breadcrumb-current' : ''}`}
              onClick={() => handleBreadcrumbClick(bp.path)}
            >
              {bp.name}
            </span>
          </span>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="file-browser-error">
          <span>{error}</span>
          <button className="fb-error-close" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Content */}
      <div className="file-browser-content">
        {/* Directory Tree */}
        <div className="file-browser-tree">
          <div className="fb-tree-title">{tr('file.explorer')}</div>
          <div className="fb-tree-list">
            {treeNodes.map((node) => (
              <TreeNodeItem
                key={node.path}
                node={node}
                depth={0}
                expanded={expandedDirs}
                onToggle={handleTreeToggle}
                onNavigate={handleTreeNavigate}
                currentPath={currentPath}
                tr={tr}
              />
            ))}
          </div>
        </div>

        {/* File List */}
        <div className="file-browser-list" onContextMenu={handleTableContextMenu}>
          {loading ? (
            <div className="file-browser-loading">
              <div className="spinner" />
              <p>{tr('file.loading')}</p>
            </div>
          ) : (
            <table className="file-browser-table">
              <thead>
                <tr>
                  <th className="fb-col-name" onClick={() => handleSort('name')}>
                    {tr('file.name')}{sortArrow('name')}
                  </th>
                  <th className="fb-col-size" onClick={() => handleSort('size')}>
                    {tr('file.size')}{sortArrow('size')}
                  </th>
                  <th className="fb-col-perm" onClick={() => handleSort('permissions')}>
                    {tr('file.permissions')}{sortArrow('permissions')}
                  </th>
                  <th className="fb-col-modified" onClick={() => handleSort('modified')}>
                    {tr('file.modified')}{sortArrow('modified')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => (
                  <tr
                    key={entry.path}
                    className={`fb-row ${selectedEntries.has(entry.path) ? 'fb-row-selected' : ''}`}
                    onDoubleClick={() => handleDoubleClick(entry)}
                    onClick={(e) => handleToggleSelect(entry, e)}
                    onContextMenu={(e) => handleContextMenu(e, entry)}
                  >
                    <td className="fb-col-name">
                      <span className="fb-entry-icon">
                        {entry.is_dir ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--accent, #4fc3f7)" stroke="var(--accent, #4fc3f7)" strokeWidth="1">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        )}
                      </span>
                      <span className="fb-entry-name">{entry.name}</span>
                    </td>
                    <td className="fb-col-size">
                      {entry.is_dir ? '-' : formatSize(entry.size)}
                    </td>
                    <td className="fb-col-perm">
                      {formatPermissions(entry.permissions, entry.is_dir)}
                    </td>
                    <td className="fb-col-modified">
                      {formatDate(entry.modified)}
                    </td>
                  </tr>
                ))}
                {sortedEntries.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} className="fb-empty">{tr('file.emptyDir')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className="file-browser-status">
        <span>{tf(tr('file.items'), { count: entries.length })}</span>
      </div>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.entry ? (
            <>
              {!contextMenu.entry.is_dir && (
                <div
                  className="context-menu-item"
                  onClick={() => {
                    handleDownloadEntry(contextMenu.entry!);
                    setContextMenu((prev) => ({ ...prev, visible: false }));
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {tr('file.download')}
                </div>
              )}
              <div
                className="context-menu-item"
                onClick={() => {
                  handleRenameEntry(contextMenu.entry!);
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                {tr('file.rename')}
              </div>
              <div className="context-menu-divider" />
              <div
                className="context-menu-item danger"
                onClick={() => {
                  handleDeleteEntry(contextMenu.entry!);
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                {tr('file.delete')}
              </div>
            </>
          ) : (
            <>
              <div className="context-menu-item" onClick={handleUpload}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {tr('file.upload')}
              </div>
              <div className="context-menu-item" onClick={handleNewFolder}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="11" x2="12" y2="17" />
                  <line x1="9" y1="14" x2="15" y2="14" />
                </svg>
                {tr('file.newFolder')}
              </div>
              <div className="context-menu-divider" />
              <div className="context-menu-item" onClick={handleRefresh}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                {tr('file.refresh')}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Recursive tree node component
function TreeNodeItem({
  node,
  depth,
  expanded,
  onToggle,
  onNavigate,
  currentPath,
  tr,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (node: TreeNode) => void;
  onNavigate: (path: string) => void;
  currentPath: string;
  tr: (key: string) => string;
}) {
  const isExpanded = expanded.has(node.path);
  const isCurrent = currentPath === node.path;

  return (
    <div className="fb-tree-node">
      <div
        className={`fb-tree-row ${isCurrent ? 'fb-tree-row-active' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span
          className={`fb-tree-arrow ${isExpanded ? 'fb-tree-arrow-expanded' : ''}`}
          onClick={() => onToggle(node)}
        >
          {node.loading ? (
            <span className="fb-tree-spinner" />
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          )}
        </span>
        <span className="fb-tree-icon">
          {isExpanded ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent, #4fc3f7)" stroke="var(--accent, #4fc3f7)" strokeWidth="1">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent, #4fc3f7)" stroke="var(--accent, #4fc3f7)" strokeWidth="1">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          )}
        </span>
        <span
          className="fb-tree-name"
          onClick={() => onNavigate(node.path)}
        >
          {node.name || '/'}
        </span>
      </div>
      {isExpanded && node.children && node.children.length > 0 && (
        <div className="fb-tree-children">
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onNavigate={onNavigate}
              currentPath={currentPath}
              tr={tr}
            />
          ))}
        </div>
      )}
      {isExpanded && node.loaded && (!node.children || node.children.length === 0) && (
        <div className="fb-tree-empty" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
          {tr('file.empty')}
        </div>
      )}
    </div>
  );
}

function updateTreeNode(nodes: TreeNode[], path: string, updated: TreeNode): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === path) return updated;
    if (n.children) {
      return { ...n, children: updateTreeNode(n.children, path, updated) };
    }
    return n;
  });
}

export default FileBrowser;