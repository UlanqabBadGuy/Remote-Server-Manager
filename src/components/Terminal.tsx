import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useAppStore } from '../store/useAppStore';
import { useAIStore } from '../store/useAIStore';
import 'xterm/css/xterm.css';

interface TerminalProps {
  connectionId: string;
  connectionName: string;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export default function Terminal({ connectionId, connectionName }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedText, setSelectedText] = useState('');
  const [selectionPos, setSelectionPos] = useState({ x: 0, y: 0 });
  const [selectionRange, setSelectionRange] = useState({ startLine: 1, endLine: 1 });

  const addTerminalOutput = useAIStore((s) => s.addTerminalOutput);
  const setActiveSshSession = useAIStore((s) => s.setActiveSshSession);

  const tabId = useAppStore((s) => {
    const tab = s.tabs.find(
      (t) => t.connectionId === connectionId && t.type === 'terminal'
    );
    return tab?.id ?? null;
  });

  const setSessionId = useAppStore((s) => s.setSessionId);

  const handleDisconnect = useCallback(async (sessionId: string) => {
    try {
      await invoke('ssh_disconnect', { sessionId });
    } catch {
      // session may already be gone
    }
  }, []);

  useEffect(() => {
    if (!terminalRef.current || !tabId) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily:
        "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Menlo', 'Consolas', monospace",
      theme: {
        background: '#1e1e2e',
        foreground: '#e0e0e0',
        cursor: '#4fc3f7',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fit after the terminal is visible in the DOM
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // fit may fail if container has zero dimensions
      }
    });

    // Selection handler for AI integration
    const onSelectionChange = () => {
      const text = term.getSelection();
      if (text && terminalRef.current) {
        const pos = term.getSelectionPosition();
        if (pos) {
          setSelectionRange({ startLine: pos.start.y + 1, endLine: pos.end.y + 1 });
        }
        const containerRect = terminalRef.current.getBoundingClientRect();
        setSelectionPos({
          x: containerRect.width - 50,
          y: 10,
        });
        setSelectedText(text);
      } else {
        setSelectedText('');
      }
    };
    term.onSelectionChange(onSelectionChange);

    let sessionId: string | null = null;
    let cancelled = false;

    const connect = async () => {
      try {
        const sid = await invoke<string>('ssh_connect', {
          connectionId,
          termCols: term.cols,
          termRows: term.rows,
        });
        if (cancelled) {
          handleDisconnect(sid);
          return;
        }
        sessionId = sid;
        setSessionId(tabId, sid);
        setActiveSshSession(sid);
        setStatus('connected');
      } catch (err) {
        if (cancelled) return;
        const msg = typeof err === 'string' ? err : String(err);
        setErrorMessage(msg);
        setStatus('error');
      }
    };

    connect();

    // Listen for SSH output events
    const setupListener = async () => {
      const unlisten = await listen<{ session_id: string; data: string }>(
        'ssh-output',
        (event) => {
          if (event.payload.session_id === sessionId) {
            term.write(event.payload.data);
          }
        }
      );
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenRef.current = unlisten;
    };

    setupListener();

    // Terminal input → send to backend
    const onDataDisposable = term.onData((data) => {
      if (sessionId) {
        invoke('ssh_write', { sessionId, data }).catch(() => {
          // write failed, session may be dead
        });
      }
    });

    // Intercept Ctrl+C / Ctrl+V at xterm level (xterm captures keys before DOM)
    const onKeyDisposable = term.onKey((ev) => {
      const { key, domEvent } = ev;
      if (domEvent.ctrlKey && !domEvent.altKey && !domEvent.shiftKey) {
        if (key === '\x03') {
          // Ctrl+C: copy selection if exists, else send to terminal
          const selection = term.getSelection();
          if (selection) {
            domEvent.preventDefault();
            navigator.clipboard.writeText(selection).catch(() => {});
            return;
          }
          // No selection: let it pass through as SIGINT
        }
        if (key === '\x16') {
          // Ctrl+V: paste
          domEvent.preventDefault();
          navigator.clipboard.readText().then((text) => {
            if (sessionId) {
              invoke('ssh_write', { sessionId, data: text }).catch(() => {});
            }
          }).catch(() => {});
          return;
        }
      }
    });

    // ResizeObserver for terminal container
    const resizeObserver = new ResizeObserver(() => {
      if (!cancelled) {
        try {
          fitAddon.fit();
          if (sessionId) {
            invoke('ssh_resize', {
              sessionId,
              cols: term.cols,
              rows: term.rows,
            }).catch(() => {
              // resize failed, session may be dead
            });
          }
        } catch {
          // fit may fail if container has zero dimensions
        }
      }
    });

    resizeObserver.observe(terminalRef.current);

    // Copy/Paste keyboard shortcuts (DOM-level, for Ctrl+Shift+C/V fallback)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
        }
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (sessionId) {
            invoke('ssh_write', { sessionId, data: text }).catch(() => {});
          }
        }).catch(() => {});
      }
    };

    terminalRef.current.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelled = true;
      setActiveSshSession(null);
      onDataDisposable.dispose();
      onKeyDisposable.dispose();
      resizeObserver.disconnect();
      terminalRef.current?.removeEventListener('keydown', handleKeyDown);

      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      if (sessionId) {
        handleDisconnect(sessionId);
      }

      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [connectionId, tabId, setSessionId, handleDisconnect]);

  return (
    <div className="terminal-container">
      <div ref={terminalRef} className="terminal-element" />
      {status !== 'connected' && (
        <div className="terminal-overlay">
          {status === 'connecting' && (
            <div className="terminal-status">
              <div className="terminal-status-spinner" />
              <span>Connecting to {connectionName}...</span>
            </div>
          )}
          {status === 'error' && (
            <div className="terminal-error">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <div className="terminal-error-title">Connection Failed</div>
              <div className="terminal-error-message">{errorMessage}</div>
            </div>
          )}
          {status === 'disconnected' && (
            <div className="terminal-status">
              <span>Disconnected from {connectionName}</span>
            </div>
          )}
        </div>
      )}
      {selectedText && status === 'connected' && (
        <button
          className="terminal-ai-btn"
          style={{ left: selectionPos.x, top: selectionPos.y }}
          onClick={() => {
            addTerminalOutput(selectedText, selectionRange.startLine, selectionRange.endLine);
            setSelectedText('');
          }}
          title="Send to AI Assistant"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </button>
      )}
    </div>
  );
}
