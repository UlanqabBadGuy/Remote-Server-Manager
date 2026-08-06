import { useAppStore } from '../store/useAppStore';
import { useAIStore } from '../store/useAIStore';
import { useI18nStore } from '../store/useI18nStore';
import { t, tf } from '../i18n/translations';
import { resetTour } from './TourGuide';

export default function IconRail() {
  const { sidebarVisible, toggleSidebar, toggleTheme, theme } = useAppStore();
  const { visible: aiVisible, toggleVisible: toggleAI } = useAIStore();
  const { lang } = useI18nStore();
  const tr = (key: string) => t[lang][key] ?? key;

  return (
    <div className="icon-rail">
      {/* Toggle sidebar */}
      <button
        className={`icon-rail-btn${sidebarVisible ? ' active' : ''}`}
        onClick={toggleSidebar}
        title={tr('rail.toggleSidebar')}
        data-tour="sidebar-toggle"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>

      {/* Toggle AI */}
      <button
        className={`icon-rail-btn${aiVisible ? ' active' : ''}`}
        onClick={toggleAI}
        title={tr('rail.toggleAI')}
        data-tour="ai-toggle"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </button>

      <div className="icon-rail-divider" />

      {/* Theme toggle */}
      <button
        className="icon-rail-btn"
        onClick={toggleTheme}
        title={tf(tr('rail.switchTheme'), { theme: theme === 'light' ? tr('rail.themeDark') : tr('rail.themeLight') })}
      >
        {theme === 'light' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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

      {/* Tour guide */}
      <button
        className="icon-rail-btn"
        onClick={resetTour}
        title={tr('rail.startTour')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
    </div>
  );
}
