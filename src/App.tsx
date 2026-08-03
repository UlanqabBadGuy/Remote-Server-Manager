import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from './store/useAppStore';
import { useAIStore } from './store/useAIStore';
import MenuBar from './components/MenuBar';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import Terminal from './components/Terminal';
import FileBrowser from './components/FileBrowser';
import AISidebar from './components/AISidebar';
import TourGuide from './components/TourGuide';
import UpdateChecker from './components/UpdateChecker';
import Welcome from './components/Welcome';
import ConnectionDialog from './components/ConnectionDialog';
import QuickConnect from './components/QuickConnect';
import Toast from './components/Toast';
import type { ConnectionConfig } from './store/useAppStore';
import './App.css';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 500;
const AI_MIN = 280;
const AI_MAX = 700;
const SIDEBAR_DEFAULT = 280;
const AI_DEFAULT = 360;

function loadPanelWidths(): { left: number; right: number } {
  try {
    const saved = localStorage.getItem('ssh-manager-panel-widths');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        left: Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parsed.left ?? SIDEBAR_DEFAULT)),
        right: Math.max(AI_MIN, Math.min(AI_MAX, parsed.right ?? AI_DEFAULT)),
      };
    }
  } catch {}
  return { left: SIDEBAR_DEFAULT, right: AI_DEFAULT };
}

function savePanelWidths(left: number, right: number) {
  localStorage.setItem('ssh-manager-panel-widths', JSON.stringify({ left, right }));
}

function App() {
  const { tabs, activeTabId, theme } = useAppStore();
  const { visible: aiVisible } = useAIStore();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionConfig | null>(null);
  const [showQuickConnect, setShowQuickConnect] = useState(false);
  const [defaultGroupId, setDefaultGroupId] = useState<string | null>(null);

  const initialWidths = loadPanelWidths();
  const [leftWidth, setLeftWidth] = useState(initialWidths.left);
  const [rightWidth, setRightWidth] = useState(initialWidths.right);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const handleMouseDown = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(side);
    startXRef.current = e.clientX;
    startWidthRef.current = side === 'left' ? leftWidth : rightWidth;
  }, [leftWidth, rightWidth]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = dragging === 'left'
        ? e.clientX - startXRef.current
        : startXRef.current - e.clientX;

      const newWidth = startWidthRef.current + delta;

      if (dragging === 'left') {
        const clamped = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, newWidth));
        setLeftWidth(clamped);
      } else {
        const clamped = Math.max(AI_MIN, Math.min(AI_MAX, newWidth));
        setRightWidth(clamped);
      }
    };

    const handleMouseUp = () => {
      setDragging((prev) => {
        if (prev === 'left') {
          savePanelWidths(leftWidth, rightWidth);
        } else if (prev === 'right') {
          savePanelWidths(leftWidth, rightWidth);
        }
        return null;
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, leftWidth, rightWidth]);

  useEffect(() => {
    savePanelWidths(leftWidth, rightWidth);
  }, [leftWidth, rightWidth]);

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
    <div className={`app ${theme} ${dragging ? 'app-dragging' : ''}`}>
      <MenuBar />
      <div className="app-main">
        <div style={{ width: `${leftWidth}px`, minWidth: `${leftWidth}px`, flexShrink: 0 }}>
          <Sidebar
          onNewConnection={handleNewConnection}
          onNewConnectionInGroup={handleNewConnectionInGroup}
          onEditConnection={handleEditConnection}
          onQuickConnect={() => setShowQuickConnect(true)}
        />
      </div>

      <div
        className="resize-handle"
        onMouseDown={(e) => handleMouseDown('left', e)}
      >
        <div className="resize-handle-bar" />
      </div>

      <div className="main-content">
        <TabBar />
        <div className="content-area" data-tour="terminal-area">
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

      {aiVisible && (
        <>
          <div
            className="resize-handle"
            onMouseDown={(e) => handleMouseDown('right', e)}
          >
            <div className="resize-handle-bar" />
          </div>
          <div style={{ width: `${rightWidth}px`, minWidth: `${rightWidth}px`, flexShrink: 0 }}>
            <AISidebar />
          </div>
        </>
      )}

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
      <TourGuide />
      <UpdateChecker />
      </div>
    </div>
  );
}

export default App;