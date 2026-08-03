import { useEffect, useState, useCallback } from 'react';
import { check } from '@tauri-apps/plugin-updater';

export default function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const checkForUpdates = useCallback(async () => {
    try {
      const update = await check();
      setUpdateAvailable(!!update);
    } catch {
      // Ignore errors (e.g., offline)
    }
  }, []);

  const handleUpdate = useCallback(async () => {
    setDownloading(true);
    try {
      const update = await check();
      if (!update) {
        setUpdateAvailable(false);
        return;
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case 'Finished':
            break;
        }
      });

      // After install, the app will restart
    } catch (err) {
      console.error('Update failed:', err);
    } finally {
      setDownloading(false);
    }
  }, []);

  // Check on mount
  useEffect(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  if (!updateAvailable && !downloading) return null;

  if (downloading) {
    return (
      <div className="update-banner">
        <div className="update-banner-content">
          <svg className="ai-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>Downloading update... {progress}%</span>
        </div>
      </div>
    );
  }

  return (
    <div className="update-banner">
      <div className="update-banner-content">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>New version available!</span>
        <button className="update-btn" onClick={handleUpdate}>
          Update Now
        </button>
        <button className="update-dismiss" onClick={() => setUpdateAvailable(false)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}