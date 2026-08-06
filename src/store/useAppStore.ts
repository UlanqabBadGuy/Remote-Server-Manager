import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface ConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: 'password' | 'keyfile';
  key_path: string | null;
  group_id: string | null;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: string;
  name: string;
  parent_id: string | null;
  order: number;
}

export interface Tab {
  id: string;
  type: 'terminal' | 'files' | 'editor';
  connectionId: string;
  connectionName: string;
  sessionId?: string;
  filePath?: string;
  fileName?: string;
}

export interface AppState {
  connections: ConnectionConfig[];
  groups: Group[];
  tabs: Tab[];
  activeTabId: string | null;
  theme: 'light' | 'dark';
  terminalTheme: string;
  terminalFontSize: number;
  sidebarVisible: boolean;
  loading: boolean;

  loadConnections: () => Promise<void>;
  loadGroups: () => Promise<void>;
  addConnection: (config: Omit<ConnectionConfig, 'id' | 'created_at' | 'updated_at'>) => Promise<ConnectionConfig>;
  updateConnection: (config: ConnectionConfig) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  addGroup: (name: string, parentId?: string | null) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  renameGroup: (id: string, name: string) => Promise<void>;
  moveConnectionToGroup: (connectionId: string, groupId: string | null) => Promise<void>;
  importConnections: (path: string) => Promise<void>;
  exportConnections: (path: string) => Promise<void>;
  openTerminal: (connectionId: string, connectionName: string) => void;
  openFileBrowser: (connectionId: string, connectionName: string) => void;
  openEditor: (connectionId: string, connectionName: string, filePath: string, fileName: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  toggleTheme: () => void;
  setTerminalTheme: (id: string) => void;
  setTerminalFontSize: (size: number) => void;
  toggleSidebar: () => void;
  setSessionId: (tabId: string, sessionId: string) => void;
}

function generateId(): string {
  return crypto.randomUUID();
}

export const useAppStore = create<AppState>((set, get) => ({
  connections: [],
  groups: [],
  tabs: [],
  activeTabId: null,
  theme: (localStorage.getItem('ssh-manager-theme') as 'light' | 'dark') || 'light',
  terminalTheme: localStorage.getItem('ssh-manager-terminal-theme') || 'tokyo-night',
  terminalFontSize: Number(localStorage.getItem('ssh-manager-terminal-fontsize')) || 14,
  sidebarVisible: localStorage.getItem('ssh-manager-sidebar-visible') !== 'false',
  loading: false,

  loadConnections: async () => {
    set({ loading: true });
    try {
      const connections = await invoke<ConnectionConfig[]>('list_connections');
      set({ connections, loading: false });
    } catch (error) {
      console.error('Failed to load connections:', error);
      set({ loading: false });
    }
  },

  loadGroups: async () => {
    try {
      const groups = await invoke<Group[]>('list_groups');
      set({ groups });
    } catch (error) {
      console.error('Failed to load groups:', error);
    }
  },

  addConnection: async (config) => {
    const newConfig = await invoke<ConnectionConfig>('add_connection', { config });
    set((state) => ({
      connections: [...state.connections, newConfig],
    }));
    return newConfig;
  },

  updateConnection: async (config) => {
    try {
      const updated = await invoke<ConnectionConfig>('update_connection', { config });
      set((state) => ({
        connections: state.connections.map((c) =>
          c.id === updated.id ? updated : c
        ),
      }));
    } catch (error) {
      console.error('Failed to update connection:', error);
      throw error;
    }
  },

  deleteConnection: async (id) => {
    try {
      await invoke('delete_connection', { id });
      set((state) => ({
        connections: state.connections.filter((c) => c.id !== id),
        tabs: state.tabs.filter((t) => t.connectionId !== id),
      }));
    } catch (error) {
      console.error('Failed to delete connection:', error);
      throw error;
    }
  },

  addGroup: async (name, parentId) => {
    try {
      const group = await invoke<Group>('add_group', { name, parentId: parentId ?? null });
      set((state) => ({
        groups: [...state.groups, group],
      }));
    } catch (error) {
      console.error('Failed to add group:', error);
      throw error;
    }
  },

  deleteGroup: async (id) => {
    try {
      await invoke('delete_group', { id });
      set((state) => ({
        groups: state.groups.filter((g) => g.id !== id && g.parent_id !== id),
        connections: state.connections.map((c) =>
          c.group_id === id ? { ...c, group_id: null } : c
        ),
      }));
    } catch (error) {
      console.error('Failed to delete group:', error);
      throw error;
    }
  },

  renameGroup: async (id, name) => {
    try {
      await invoke('rename_group', { id, name });
      set((state) => ({
        groups: state.groups.map((g) => (g.id === id ? { ...g, name } : g)),
      }));
    } catch (error) {
      console.error('Failed to rename group:', error);
      throw error;
    }
  },

  moveConnectionToGroup: async (connectionId, groupId) => {
    try {
      await invoke('move_connection_to_group', { connectionId, groupId });
      set((state) => ({
        connections: state.connections.map((c) =>
          c.id === connectionId ? { ...c, group_id: groupId } : c
        ),
      }));
    } catch (error) {
      console.error('Failed to move connection:', error);
      throw error;
    }
  },

  importConnections: async (path) => {
    try {
      await invoke('import_connections', { path });
      // Reload connections and groups after import
      const connections = await invoke<ConnectionConfig[]>('list_connections');
      const groups = await invoke<Group[]>('list_groups');
      set({ connections, groups });
    } catch (error) {
      console.error('Failed to import connections:', error);
      throw error;
    }
  },

  exportConnections: async (path) => {
    try {
      await invoke('export_connections', { path });
    } catch (error) {
      console.error('Failed to export connections:', error);
      throw error;
    }
  },

  openTerminal: (connectionId, connectionName) => {
    const tabId = generateId();
    const existingTab = get().tabs.find(
      (t) => t.connectionId === connectionId && t.type === 'terminal'
    );
    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }
    const newTab: Tab = {
      id: tabId,
      type: 'terminal',
      connectionId,
      connectionName,
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    }));
  },

  openFileBrowser: (connectionId, connectionName) => {
    const tabId = generateId();
    const existingTab = get().tabs.find(
      (t) => t.connectionId === connectionId && t.type === 'files'
    );
    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }
    const newTab: Tab = {
      id: tabId,
      type: 'files',
      connectionId,
      connectionName,
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    }));
  },

  openEditor: (connectionId, connectionName, filePath, fileName) => {
    const tabId = generateId();
    const existingTab = get().tabs.find(
      (t) =>
        t.connectionId === connectionId &&
        t.type === 'editor' &&
        t.filePath === filePath
    );
    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }
    const newTab: Tab = {
      id: tabId,
      type: 'editor',
      connectionId,
      connectionName,
      filePath,
      fileName,
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    }));
  },

  closeTab: (tabId) => {
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      let newActiveId = state.activeTabId;
      if (state.activeTabId === tabId) {
        newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
      }
      return { tabs: newTabs, activeTabId: newActiveId };
    });
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
  },

  toggleTheme: () => {
    set((state) => {
      const newTheme = state.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('ssh-manager-theme', newTheme);
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return { theme: newTheme };
    });
  },

  setTerminalTheme: (id) => {
    localStorage.setItem('ssh-manager-terminal-theme', id);
    set({ terminalTheme: id });
  },

  setTerminalFontSize: (size) => {
    localStorage.setItem('ssh-manager-terminal-fontsize', String(size));
    set({ terminalFontSize: size });
  },

  toggleSidebar: () => {
    const current = get().sidebarVisible;
    const next = !current;
    localStorage.setItem('ssh-manager-sidebar-visible', String(next));
    set({ sidebarVisible: next });
  },

  setSessionId: (tabId, sessionId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, sessionId } : t
      ),
    }));
  },
}));