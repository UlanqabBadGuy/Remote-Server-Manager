import { useState, useCallback } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { open } from '@tauri-apps/plugin-shell';
import { appDataDir } from '@tauri-apps/api/path';
import { useI18nStore } from '../store/useI18nStore';
import { t } from '../i18n/translations';

type MenuName = 'app' | 'help' | 'settings';

export default function MenuBar() {
  const { lang, setLang } = useI18nStore();
  const tr = (key: string) => t[lang][key] ?? key;

  const [activeMenu, setActiveMenu] = useState<MenuName | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

  const handleMenuClick = (menu: MenuName) => {
    setActiveMenu((prev) => (prev === menu ? null : menu));
  };

  const handleMenuItemClick = () => {
    setActiveMenu(null);
  };

  const handleCheckUpdate = useCallback(async () => {
    setActiveMenu(null);
    setUpdateStatus(tr('update.checking'));
    try {
      const update = await check();
      if (update) {
        setUpdateStatus(tr('update.available'));
        await update.downloadAndInstall(() => {});
        setUpdateStatus(null);
      } else {
        setUpdateStatus(tr('update.uptodate'));
        setTimeout(() => setUpdateStatus(null), 2500);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found') || msg.includes('404')) {
        setUpdateStatus(tr('update.uptodate'));
      } else {
        setUpdateStatus(`${tr('update.failed')}: ${msg}`);
      }
      setTimeout(() => setUpdateStatus(null), 3000);
    }
  }, [lang]);

  const handleOpenLogs = useCallback(async () => {
    setActiveMenu(null);
    try {
      const dataDir = await appDataDir();
      const logsDir = `${dataDir}logs`;
      await open(logsDir);
    } catch {
      try {
        const dataDir = await appDataDir();
        await open(dataDir);
      } catch {}
    }
  }, []);

  const handleFeedback = useCallback(() => {
    setActiveMenu(null);
    open('https://github.com/UlanqabBadGuy/Remote-Server-Manager/issues/new');
  }, []);

  return (
    <>
      <div className="menu-bar">
        <div className="menu-bar-items">
          {/* App Menu */}
          <div className="menu-item-container">
            <button
              className={`menu-item ${activeMenu === 'app' ? 'active' : ''}`}
              onClick={() => handleMenuClick('app')}
            >
              {tr('menu.app')}
            </button>
            {activeMenu === 'app' && (
              <div className="menu-dropdown">
                <button
                  className="menu-dropdown-item"
                  onClick={() => { handleMenuItemClick(); setShowAbout(true); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>{tr('menu.about')}</span>
                </button>
                <button
                  className="menu-dropdown-item"
                  onClick={handleCheckUpdate}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>{tr('menu.checkUpdate')}</span>
                </button>
                <div className="menu-dropdown-separator" />
                <button
                  className="menu-dropdown-item"
                  onClick={() => { handleMenuItemClick(); setShowSettings(true); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>{tr('menu.settings')}</span>
                </button>
                <div className="menu-dropdown-separator" />
                <button
                  className="menu-dropdown-item"
                  onClick={handleOpenLogs}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>{tr('menu.openLogs')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Help Menu */}
          <div className="menu-item-container">
            <button
              className={`menu-item ${activeMenu === 'help' ? 'active' : ''}`}
              onClick={() => handleMenuClick('help')}
            >
              {tr('menu.help')}
            </button>
            {activeMenu === 'help' && (
              <div className="menu-dropdown">
                <button
                  className="menu-dropdown-item"
                  onClick={handleFeedback}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>{tr('menu.feedback')}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="menu-bar-title">Remote SSH Manager</div>
      </div>

      {/* Click outside to close menu */}
      {activeMenu && (
        <div className="menu-backdrop" onClick={() => setActiveMenu(null)} />
      )}

      {/* Update status toast */}
      {updateStatus && (
        <div className="menu-update-toast">
          {updateStatus.includes('Checking') || updateStatus.includes('正在') ? (
            <svg className="ai-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : null}
          <span>{updateStatus}</span>
        </div>
      )}

      {/* About Dialog */}
      {showAbout && (
        <div className="menu-overlay" onClick={() => setShowAbout(false)}>
          <div className="about-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="about-header">
              <h2>{tr('about.title')}</h2>
              <button className="about-close" onClick={() => setShowAbout(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="about-body">
              <div className="about-logo">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <div className="about-info">
                <div className="about-row">
                  <span className="about-label">{tr('about.version')}</span>
                  <span className="about-value">0.1.0</span>
                </div>
                <div className="about-row">
                  <span className="about-label">{tr('about.build')}</span>
                  <span className="about-value">Tauri v2 + React 19</span>
                </div>
                <div className="about-row">
                  <span className="about-label">{tr('about.author')}</span>
                  <span className="about-value">UlanqabBadGuy</span>
                </div>
                <div className="about-row">
                  <span className="about-label">{tr('about.license')}</span>
                  <span className="about-value">MIT</span>
                </div>
              </div>
            </div>
            <div className="about-footer">
              <span className="about-copyright">{tr('about.copyright')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Settings Dialog */}
      {showSettings && (
        <div className="menu-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="about-header">
              <h2>{tr('settings.title')}</h2>
              <button className="about-close" onClick={() => setShowSettings(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="about-body">
              <div className="about-info">
                <div className="about-row">
                  <span className="about-label">{tr('settings.language')}</span>
                  <div className="settings-lang-select">
                    <button
                      className={`settings-lang-btn ${lang === 'zh' ? 'active' : ''}`}
                      onClick={() => setLang('zh')}
                    >
                      {tr('settings.langZh')}
                    </button>
                    <button
                      className={`settings-lang-btn ${lang === 'en' ? 'active' : ''}`}
                      onClick={() => setLang('en')}
                    >
                      {tr('settings.langEn')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="about-footer">
              <button className="settings-close-btn" onClick={() => setShowSettings(false)}>
                {tr('settings.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}