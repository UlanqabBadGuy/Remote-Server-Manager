import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import { useI18nStore } from '../store/useI18nStore';
import { t } from '../i18n/translations';

interface EditorTabProps {
  connectionId: string;
  filePath: string;
  fileName: string;
}

function getLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', html: 'html', htm: 'html', css: 'css', scss: 'scss',
    less: 'less', py: 'python', rs: 'rust', go: 'go', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', sh: 'shell', bash: 'shell',
    zsh: 'shell', yaml: 'yaml', yml: 'yaml', xml: 'xml', md: 'markdown',
    sql: 'sql', dockerfile: 'dockerfile', toml: 'toml', ini: 'ini',
    conf: 'ini', cfg: 'ini', env: 'plaintext', txt: 'plaintext', log: 'plaintext',
  };
  return map[ext || ''] || 'plaintext';
}

loader.config({ paths: { vs: '/node_modules/monaco-editor/min/vs' } });

export default function EditorTab({ connectionId, filePath, fileName }: EditorTabProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modified, setModified] = useState(false);
  const editorRef = useRef<Parameters<NonNullable<OnMount>>[0] | null>(null);
  const sftpSessionIdRef = useRef<string | null>(null);
  const { lang } = useI18nStore();
  const tr = (key: string) => t[lang][key] ?? key;

  // Connect SFTP and load file content
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await invoke<{ session_id: string; home_path: string }>('sftp_connect', {
          connectionId,
          privileged: false,
        });
        if (cancelled) return;
        sftpSessionIdRef.current = result.session_id;

        const data = await invoke<string>('sftp_read_file', {
          sftpSessionId: result.session_id,
          path: filePath,
        });
        if (cancelled) return;
        setContent(data);
        setModified(false);
      } catch (e) {
        if (!cancelled) setError(`${tr('file.connectFailed')}: ${e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (sftpSessionIdRef.current) {
        invoke('sftp_disconnect', { sftpSessionId: sftpSessionIdRef.current }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, filePath]);

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    const lang = getLanguage(fileName);
    const model = editor.getModel();
    if (model) {
      import('monaco-editor').then((m) => {
        m.editor.setModelLanguage(model, lang);
      });
    }
    editor.focus();
  }, [fileName]);

  const handleChange = useCallback(() => {
    setModified(true);
  }, []);

  // Save: write editor content directly to remote file via sftp_write_file
  const handleSave = useCallback(async () => {
    const sid = sftpSessionIdRef.current;
    if (!sid || !editorRef.current) return;
    const value = editorRef.current.getValue();
    try {
      setSaving(true);
      setError(null);
      await invoke('sftp_write_file', {
        sftpSessionId: sid,
        path: filePath,
        content: value,
      });
      setContent(value);
      setModified(false);
    } catch (e) {
      setError(`${tr('file.uploadFailed')}: ${e}`);
    } finally {
      setSaving(false);
    }
  }, [filePath]);

  // Keyboard shortcut: Ctrl+S / Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  if (loading) {
    return (
      <div className="editor-loading">
        <div className="spinner" />
        <p>{tr('file.loading')}</p>
      </div>
    );
  }

  if (error && content === null) {
    return (
      <div className="editor-error">
        <p style={{ color: 'var(--danger, #e53935)' }}>{error}</p>
      </div>
    );
  }

  const language = getLanguage(fileName);

  return (
    <div className="editor-container">
      <div className="editor-toolbar">
        <span className="editor-path" title={filePath}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          {fileName}
        </span>
        <span className="editor-language">{language}</span>
        {modified && <span className="editor-modified">●</span>}
        <div className="editor-toolbar-spacer" />
        <button
          className="editor-save-btn"
          onClick={handleSave}
          disabled={!modified || saving}
        >
          {saving ? tr('file.saving') : tr('file.save')}
        </button>
      </div>
      <div className="editor-body">
        <Editor
          height="100%"
          language={language}
          value={content ?? ''}
          theme="vs-dark"
          onChange={handleChange}
          onMount={handleEditorMount}
          options={{
            fontSize: 14,
            fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 2,
            wordWrap: 'off',
            automaticLayout: true,
          }}
          loading={
            <div className="editor-loading">
              <div className="spinner" />
            </div>
          }
        />
      </div>
      {error && (
        <div className="editor-status-error">{error}</div>
      )}
    </div>
  );
}