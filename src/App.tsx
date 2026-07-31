import { useState, useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import Terminal from './components/Terminal';
import FileBrowser from './components/FileBrowser';
import Welcome from './components/Welcome';
import ConnectionDialog from './components/ConnectionDialog';
import QuickConnect from './components/QuickConnect';
import Toast from './components/Toast';
import type { ConnectionConfig } from './store/useAppStore';
import './App.css';

function App() {
  const { tabs, activeTabId, theme } = useAppStore();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionConfig | null>(null);
  const [showQuickConnect, setShowQuickConnect] = useState(false);
  const [defaultGroupId, setDefaultGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleNewConnection = () => {
    setEditingConnection(null);
    setDefaultGroupId(null);
    setShowAddDialog(true);
  };

  const handleNewConnectionInGroup = (groupId: string) => {
    setEditingConnection(null);
    setDefaultGroupId(groupId);
    setShowAddDialog(true);
  };

  const handleEditConnection = (connection: ConnectionConfig) => {
    setEditingConnection(connection);
    setShowAddDialog(true);
  };

  const handleCloseDialog = () => {
    setShowAddDialog(false);
    setEditingConnection(null);
  };

  return (
    <div className={`app ${theme}`}>
      <Sidebar
        onNewConnection={handleNewConnection}
        onNewConnectionInGroup={handleNewConnectionInGroup}
        onEditConnection={handleEditConnection}
        onQuickConnect={() => setShowQuickConnect(true)}
      />
      <div className="main-content">
        <TabBar />
        <div className="content-area">
          {activeTab ? (
            activeTab.type === 'terminal' ? (
              <Terminal
                connectionId={activeTab.connectionId}
                connectionName={activeTab.connectionName}
              />
            ) : activeTab.type === 'files' ? (
              <FileBrowser
                connectionId={activeTab.connectionId}
                sessionId={activeTab.sessionId || ''}
              />
            ) : (
              <div className="tab-content">
                <div className="tab-placeholder">
                  <div className="tab-placeholder-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <div className="tab-placeholder-title">File Browser</div>
                  <div className="tab-placeholder-subtitle">
                    {activeTab.connectionName}
                  </div>
                </div>
              </div>
            )
          ) : (
            <Welcome
              onNewConnection={handleNewConnection}
              onQuickConnect={() => setShowQuickConnect(true)}
            />
          )}
        </div>
      </div>

      {showAddDialog && (
        <ConnectionDialog
          connection={editingConnection}
          defaultGroupId={defaultGroupId}
          onClose={handleCloseDialog}
        />
      )}

      {showQuickConnect && (
        <QuickConnect onClose={() => setShowQuickConnect(false)} />
      )}

      <Toast />
    </div>
  );
}

export default App;