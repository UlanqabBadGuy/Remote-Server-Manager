import { useAppStore } from '../store/useAppStore';
import { useI18nStore } from '../store/useI18nStore';
import { t } from '../i18n/translations';

interface WelcomeProps {
  onNewConnection: () => void;
  onQuickConnect: () => void;
}

function Welcome({ onNewConnection, onQuickConnect }: WelcomeProps) {
  const { connections, openTerminal } = useAppStore();
  const { lang } = useI18nStore();
  const tr = (key: string) => t[lang][key] ?? key;

  const recentConnections = connections.slice(0, 5);

  return (
    <div className="welcome">
      <div className="welcome-content">
        <div className="welcome-logo">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </div>
        <h1 className="welcome-title">{tr('welcome.title')}</h1>
        <p className="welcome-subtitle">{tr('welcome.subtitle')}</p>

        <div className="welcome-actions">
          <button className="welcome-btn primary" onClick={onNewConnection}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {tr('welcome.newConnection')}
          </button>
          <button className="welcome-btn" onClick={onQuickConnect}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            {tr('welcome.quickConnect')}
          </button>
        </div>

        {recentConnections.length > 0 && (
          <div className="welcome-recent">
            <h3 className="recent-title">{tr('welcome.recent')}</h3>
            <div className="recent-list">
              {recentConnections.map((conn) => (
                <div
                  key={conn.id}
                  className="recent-item"
                  onClick={() => openTerminal(conn.id, conn.name)}
                >
                  <div className="connection-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                      <line x1="6" y1="6" x2="6.01" y2="6" />
                      <line x1="6" y1="18" x2="6.01" y2="18" />
                    </svg>
                  </div>
                  <div className="connection-info">
                    <div className="connection-name">{conn.name}</div>
                    <div className="connection-host">
                      {conn.username}@{conn.host}:{conn.port}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Welcome;