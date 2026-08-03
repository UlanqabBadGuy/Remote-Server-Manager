import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../store/useAppStore';
import { useAIStore } from '../store/useAIStore';
import { useToastStore } from '../store/useToastStore';
import { useI18nStore } from '../store/useI18nStore';
import { t, tf } from '../i18n/translations';
import { resetTour } from './TourGuide';
import type { ConnectionConfig, Group } from '../store/useAppStore';

interface SidebarProps {
  onNewConnection: () => void;
  onNewConnectionInGroup: (groupId: string) => void;
  onEditConnection: (connection: ConnectionConfig) => void;
  onQuickConnect: () => void;
}

interface ConnContextMenu {
  visible: boolean;
  x: number;
  y: number;
  type: 'connection';
  connection: ConnectionConfig;
}

interface GroupContextMenu {
  visible: boolean;
  x: number;
  y: number;
  type: 'group';
  group: Group;
}

type ContextMenuState = ConnContextMenu | GroupContextMenu | { visible: false };

interface TreeNode {
  group: Group;
  children: TreeNode[];
  connections: ConnectionConfig[];
}

// Build tree from flat groups
function buildGroupTree(groups: Group[], connections: ConnectionConfig[]): TreeNode[] {
  const childrenMap = new Map<string | null, Group[]>();
  for (const g of groups) {
    const key = g.parent_id;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(g);
  }

  const connMap = new Map<string | null, ConnectionConfig[]>();
  for (const c of connections) {
    const key = c.group_id;
    if (!connMap.has(key)) connMap.set(key, []);
    connMap.get(key)!.push(c);
  }

  function buildNode(group: Group): TreeNode {
    const childGroups = (childrenMap.get(group.id) ?? [])
      .sort((a, b) => a.order - b.order)
      .map((g) => buildNode(g));
    const nodeConns = (connMap.get(group.id) ?? []);
    return { group, children: childGroups, connections: nodeConns };
  }

  const roots = (childrenMap.get(null) ?? [])
    .sort((a, b) => a.order - b.order)
    .map((g) => buildNode(g));

  return roots;
}

// Count all connections in a node and its descendants
function countConnections(node: TreeNode): number {
  return node.connections.length + node.children.reduce((sum, c) => sum + countConnections(c), 0);
}

// Recursive GroupNode component
function GroupNodeItem({
  node,
  depth,
  collapsedGroups,
  toggleGroup,
  onConnectionContextMenu,
  onGroupContextMenu,
  onConnectionDoubleClick,
}: {
  node: TreeNode;
  depth: number;
  collapsedGroups: Set<string>;
  toggleGroup: (id: string) => void;
  onConnectionContextMenu: (e: React.MouseEvent, conn: ConnectionConfig) => void;
  onGroupContextMenu: (e: React.MouseEvent, group: Group) => void;
  onConnectionDoubleClick: (conn: ConnectionConfig) => void;
}) {
  const isCollapsed = collapsedGroups.has(node.group.id);
  const totalCount = countConnections(node);

  return (
    <div className="tree-group">
      <div
        className="tree-group-header"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        onClick={() => toggleGroup(node.group.id)}
        onContextMenu={(e) => onGroupContextMenu(e, node.group)}
      >
        <svg
          className={`tree-arrow ${isCollapsed ? '' : 'expanded'}`}
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <svg className="tree-folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span className="tree-group-name">{node.group.name}</span>
        {totalCount > 0 && <span className="tree-group-count">{totalCount}</span>}
      </div>
      {!isCollapsed && (
        <div className="tree-group-children">
          {node.children.map((child) => (
            <GroupNodeItem
              key={child.group.id}
              node={child}
              depth={depth + 1}
              collapsedGroups={collapsedGroups}
              toggleGroup={toggleGroup}
              onConnectionContextMenu={onConnectionContextMenu}
              onGroupContextMenu={onGroupContextMenu}
              onConnectionDoubleClick={onConnectionDoubleClick}
            />
          ))}
          {node.connections.map((conn) => (
            <div
              key={conn.id}
              className="tree-connection-item"
              style={{ paddingLeft: `${(depth + 1) * 16 + 12}px` }}
              onDoubleClick={() => onConnectionDoubleClick(conn)}
              onContextMenu={(e) => onConnectionContextMenu(e, conn)}
            >
              <svg className="tree-conn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
              <div className="tree-conn-info">
                <div className="tree-conn-name">{conn.name}</div>
                <div className="tree-conn-host">
                  {conn.username}@{conn.host}:{conn.port}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar({ onNewConnection, onNewConnectionInGroup, onEditConnection, onQuickConnect }: SidebarProps) {
  const {
    connections,
    groups,
    openTerminal,
    openFileBrowser,
    deleteConnection,
    deleteGroup,
    addGroup,
    renameGroup,
    moveConnectionToGroup,
    importConnections,
    exportConnections,
    loadConnections,
    loadGroups,
    toggleTheme,
    theme,
  } = useAppStore();

  const { addToast } = useToastStore();
  const { toggleVisible: toggleAI } = useAIStore();
  const { lang } = useI18nStore();
  const tr = (key: string) => t[lang][key] ?? key;

  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false });

  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConnections();
    loadGroups();
  }, [loadConnections, loadGroups]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu({ visible: false });
      }
    };
    if (contextMenu.visible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu.visible]);

  // Adjust context menu position to stay within viewport
  useLayoutEffect(() => {
    if (contextMenu.visible && contextMenuRef.current) {
      const menu = contextMenuRef.current;
      const rect = menu.getBoundingClientRect();
      const padding = 8;

      let adjustedX = contextMenu.x;
      let adjustedY = contextMenu.y;

      // Overflow right
      if (rect.right > window.innerWidth - padding) {
        adjustedX = window.innerWidth - rect.width - padding;
      }
      // Overflow bottom
      if (rect.bottom > window.innerHeight - padding) {
        adjustedY = window.innerHeight - rect.height - padding;
      }
      // Clamp to left/top
      if (adjustedX < padding) adjustedX = padding;
      if (adjustedY < padding) adjustedY = padding;

      menu.style.left = `${adjustedX}px`;
      menu.style.top = `${adjustedY}px`;
    }
  }, [contextMenu]);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // Filter connections by search
  const filteredConnections = useMemo(() => {
    if (!searchQuery) return connections;
    const q = searchQuery.toLowerCase();
    return connections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q)
    );
  }, [connections, searchQuery]);

  // Build tree structure
  const treeNodes = useMemo(
    () => buildGroupTree(groups, filteredConnections),
    [groups, filteredConnections]
  );

  // Ungrouped connections (group_id is null)
  const ungroupedConnections = useMemo(
    () => filteredConnections.filter((c) => !c.group_id),
    [filteredConnections]
  );

  // --- Group operations ---
  const handleAddRootGroup = useCallback(async () => {
    const name = prompt(tr('sidebar.enterGroupName'));
    if (name && name.trim()) {
      await addGroup(name.trim(), null);
    }
  }, [addGroup]);

  const handleImport = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        title: tr('sidebar.selectImportFile'),
      });
      if (!selected) return;
      await importConnections(selected as string);
      addToast('success', tr('sidebar.importSuccess'));
    } catch (error) {
      addToast('error', `${tr('sidebar.importFailed')}: ${error}`);
    }
  }, [importConnections, addToast]);

  const handleExport = useCallback(async () => {
    try {
      const savePath = await save({
        defaultPath: 'connections.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        title: tr('sidebar.exportDialogTitle'),
      });
      if (!savePath) return;
      await exportConnections(savePath);
      addToast('success', tr('sidebar.exportSuccess'));
    } catch (error) {
      addToast('error', `${tr('sidebar.exportFailed')}: ${error}`);
    }
  }, [exportConnections, addToast]);

  const handleAddSubGroup = useCallback(async (parentId: string) => {
    const name = prompt(tr('sidebar.enterSubGroupName'));
    if (name && name.trim()) {
      await addGroup(name.trim(), parentId);
      // Expand the parent so the new sub-group is visible
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
    setContextMenu({ visible: false });
  }, [addGroup]);

  const handleDeleteGroup = useCallback(async (group: Group) => {
    const hasChildren = groups.some((g) => g.parent_id === group.id);
    const hasConnections = connections.some((c) => c.group_id === group.id);
    const msg = hasChildren || hasConnections
      ? tf(tr('sidebar.deleteGroupMsg'), { name: group.name })
      : tf(tr('sidebar.deleteGroupSimpleMsg'), { name: group.name });
    if (!confirm(msg)) return;
    await deleteGroup(group.id);
    setContextMenu({ visible: false });
  }, [deleteGroup, groups, connections]);

  const handleRenameGroup = useCallback(async (group: Group) => {
    const name = prompt(tr('sidebar.renameGroup'), group.name);
    if (name && name.trim() && name !== group.name) {
      await renameGroup(group.id, name.trim());
    }
    setContextMenu({ visible: false });
  }, [renameGroup]);

  // --- Connection operations ---
  const handleConnectionDoubleClick = useCallback(
    (conn: ConnectionConfig) => {
      openTerminal(conn.id, conn.name);
    },
    [openTerminal]
  );

  const handleConnContextMenu = useCallback(
    (e: React.MouseEvent, conn: ConnectionConfig) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        type: 'connection',
        connection: conn,
      });
    },
    []
  );

  const handleGroupContextMenu = useCallback(
    (e: React.MouseEvent, group: Group) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        type: 'group',
        group,
      });
    },
    []
  );

  const handleOpenTerminal = (conn: ConnectionConfig) => {
    openTerminal(conn.id, conn.name);
    setContextMenu({ visible: false });
  };

  const handleOpenFiles = (conn: ConnectionConfig) => {
    openFileBrowser(conn.id, conn.name);
    setContextMenu({ visible: false });
  };

  const handleEdit = (conn: ConnectionConfig) => {
    onEditConnection(conn);
    setContextMenu({ visible: false });
  };

  const handleDelete = async (conn: ConnectionConfig) => {
    try {
      await deleteConnection(conn.id);
    } catch {
      // handled in store
    }
    setContextMenu({ visible: false });
  };

  const handleMoveToGroup = async (connectionId: string, groupId: string | null) => {
    await moveConnectionToGroup(connectionId, groupId);
    setContextMenu({ visible: false });
  };

  // Build all groups for the "Move to" submenu
  const allGroupOptions = useMemo(() => {
    const opts: { id: string | null; label: string }[] = [{ id: null, label: tr('sidebar.ungrouped') }];
    function addGroupsForParent(parentId: string | null, prefix: string) {
      const children = groups
        .filter((g) => g.parent_id === parentId)
        .sort((a, b) => a.order - b.order);
      for (const g of children) {
        opts.push({ id: g.id, label: `${prefix}${g.name}` });
        addGroupsForParent(g.id, `${prefix}${g.name} / `);
      }
    }
    addGroupsForParent(null, '');
    return opts;
  }, [groups]);

  return (
    <div className="sidebar" data-tour="sidebar">
      <div className="sidebar-header">
        <h2 className="sidebar-title">{tr('sidebar.title')}</h2>
        <div className="sidebar-header-actions">
          <button
            className="icon-btn"
            onClick={toggleAI}
            title={tr('sidebar.toggleAI')}
            data-tour="ai-toggle"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </button>
          <button
            className="icon-btn"
            onClick={toggleTheme}
            title={tf(tr('sidebar.switchTheme'), { theme: theme === 'light' ? tr('sidebar.themeDark') : tr('sidebar.themeLight') })}
          >
            {theme === 'light' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>
          <button
            className="icon-btn"
            onClick={resetTour}
            title={tr('sidebar.startTour')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>
        </div>
      </div>

      <div className="sidebar-search">
        <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="search-input"
          placeholder={tr('sidebar.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="sidebar-actions">
        <button className="sidebar-btn primary" onClick={onNewConnection} data-tour="new-connection">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {tr('sidebar.newConnection')}
        </button>
        <button className="sidebar-btn" onClick={onQuickConnect} data-tour="quick-connect">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          {tr('sidebar.quickConnect')}
        </button>
      </div>

      <div className="sidebar-tree" data-tour="sidebar-tree">
        {/* Root-level groups */}
        {treeNodes.map((node) => (
          <GroupNodeItem
            key={node.group.id}
            node={node}
            depth={0}
            collapsedGroups={collapsedGroups}
            toggleGroup={toggleGroup}
            onConnectionContextMenu={handleConnContextMenu}
            onGroupContextMenu={handleGroupContextMenu}
            onConnectionDoubleClick={handleConnectionDoubleClick}
          />
        ))}

        {/* Ungrouped connections */}
        {ungroupedConnections.map((conn) => (
          <div
            key={conn.id}
            className="tree-connection-item tree-connection-root"
            style={{ paddingLeft: '28px' }}
            onDoubleClick={() => handleConnectionDoubleClick(conn)}
            onContextMenu={(e) => handleConnContextMenu(e, conn)}
          >
            <svg className="tree-conn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
            <div className="tree-conn-info">
              <div className="tree-conn-name">{conn.name}</div>
              <div className="tree-conn-host">
                {conn.username}@{conn.host}:{conn.port}
              </div>
            </div>
          </div>
        ))}

        {/* Empty state */}
        {filteredConnections.length === 0 && groups.length === 0 && (
          <div className="empty-state">
            {searchQuery
              ? tr('sidebar.noMatch')
              : tr('sidebar.empty')}
          </div>
        )}
      </div>

      <div className="sidebar-footer" data-tour="import-export">
        <button className="sidebar-btn footer-btn" onClick={handleAddRootGroup} title={tr('sidebar.addGroupTitle')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
          {tr('sidebar.addGroup')}
        </button>
        <button className="sidebar-btn footer-btn" onClick={handleImport} title={tr('sidebar.importTitle')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {tr('sidebar.import')}
        </button>
        <button className="sidebar-btn footer-btn" onClick={handleExport} title={tr('sidebar.exportTitle')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {tr('sidebar.export')}
        </button>
      </div>

      {/* Context Menu */}
      {contextMenu.visible && createPortal(
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'connection' && (
            <>
              <div
                className="context-menu-item"
                onClick={() => handleOpenTerminal(contextMenu.connection)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                {tr('sidebar.openTerminal')}
              </div>
              <div
                className="context-menu-item"
                onClick={() => handleOpenFiles(contextMenu.connection)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                {tr('sidebar.openFileBrowser')}
              </div>
              <div className="context-menu-divider" />
              <div
                className="context-menu-item"
                onClick={() => handleEdit(contextMenu.connection)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                {tr('sidebar.edit')}
              </div>
              {/* Move to group submenu */}
              <div className="context-menu-item context-menu-submenu-trigger">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <polyline points="12 11 12 17" />
                  <polyline points="9 14 15 14" />
                </svg>
                {tr('sidebar.moveToGroup')}
                <svg className="submenu-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <div className="context-submenu">
                  {allGroupOptions.map((opt) => (
                    <div
                      key={opt.id ?? '__none__'}
                      className={`context-menu-item ${contextMenu.connection.group_id === opt.id ? 'active' : ''}`}
                      onClick={() => handleMoveToGroup(contextMenu.connection.id, opt.id)}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="context-menu-divider" />
              <div
                className="context-menu-item danger"
                onClick={() => handleDelete(contextMenu.connection)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                {tr('sidebar.delete')}
              </div>
            </>
          )}

          {contextMenu.type === 'group' && (
            <>
              <div
                className="context-menu-item"
                onClick={() => {
                  onNewConnectionInGroup(contextMenu.group.id);
                  setContextMenu({ visible: false });
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                  <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                  <line x1="6" y1="6" x2="6.01" y2="6" />
                  <line x1="6" y1="18" x2="6.01" y2="18" />
                  <line x1="19" y1="18" x2="19" y2="22" />
                  <line x1="15" y1="18" x2="23" y2="18" />
                </svg>
                {tr('sidebar.addConnection')}
              </div>
              <div
                className="context-menu-item"
                onClick={() => handleAddSubGroup(contextMenu.group.id)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="11" x2="12" y2="17" />
                  <line x1="9" y1="14" x2="15" y2="14" />
                </svg>
                {tr('sidebar.addSubGroup')}
              </div>
              <div
                className="context-menu-item"
                onClick={() => handleRenameGroup(contextMenu.group)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                {tr('sidebar.rename')}
              </div>
              <div className="context-menu-divider" />
              <div
                className="context-menu-item danger"
                onClick={() => handleDeleteGroup(contextMenu.group)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                {tr('sidebar.deleteGroup')}
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export default Sidebar;
