import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import type { ConnectionConfig } from '../store/useAppStore';

interface QuickConnectProps {
  onClose: () => void;
}

interface QuickFormData {
  host: string;
  port: number;
  username: string;
  password: string;
}

function QuickConnect({ onClose }: QuickConnectProps) {
  const { openTerminal } = useAppStore();
  const { addToast } = useToastStore();

  const [formData, setFormData] = useState<QuickFormData>({
    host: '',
    port: 22,
    username: '',
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [connecting, setConnecting] = useState(false);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.host.trim()) newErrors.host = 'Host is required';
    if (!formData.port || formData.port < 1 || formData.port > 65535)
      newErrors.port = 'Port must be between 1 and 65535';
    if (!formData.username.trim()) newErrors.username = 'Username is required';
    if (!formData.password.trim()) newErrors.password = 'Password is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setConnecting(true);
    const connName = `${formData.username}@${formData.host}:${formData.port}`;

    try {
      // Save temporary connection config so the Rust backend can find it
      const config = {
        name: connName,
        host: formData.host.trim(),
        port: formData.port,
        username: formData.username.trim(),
        auth_type: 'password' as const,
        key_path: null,
        group_id: null,
        note: 'Quick connect session',
      };

      const newConn = await invoke<ConnectionConfig>('add_connection', { config });

      // Store the password in the system keychain
      await invoke('store_password', {
        connectionId: newConn.id,
        password: formData.password,
      });

      openTerminal(newConn.id, newConn.name);
      onClose();
    } catch (error) {
      console.error('Failed to quick connect:', error);
      addToast('error', `Failed to connect: ${error}`);
    } finally {
      setConnecting(false);
    }
  };

  const updateField = <K extends keyof QuickFormData>(field: K, value: QuickFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog quick-connect-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Quick Connect</h3>
          <button className="dialog-close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form className="dialog-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group flex-3">
              <label className="form-label" htmlFor="qc-host">Host</label>
              <input
                id="qc-host"
                type="text"
                className={`form-input ${errors.host ? 'error' : ''}`}
                value={formData.host}
                onChange={(e) => updateField('host', e.target.value)}
                placeholder="192.168.1.1"
              />
              {errors.host && <span className="form-error">{errors.host}</span>}
            </div>
            <div className="form-group flex-1">
              <label className="form-label" htmlFor="qc-port">Port</label>
              <input
                id="qc-port"
                type="number"
                className={`form-input ${errors.port ? 'error' : ''}`}
                value={formData.port}
                onChange={(e) => updateField('port', parseInt(e.target.value) || 22)}
                min={1}
                max={65535}
              />
              {errors.port && <span className="form-error">{errors.port}</span>}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="qc-username">Username</label>
            <input
              id="qc-username"
              type="text"
              className={`form-input ${errors.username ? 'error' : ''}`}
              value={formData.username}
              onChange={(e) => updateField('username', e.target.value)}
              placeholder="root"
            />
            {errors.username && <span className="form-error">{errors.username}</span>}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="qc-password">Password</label>
            <input
              id="qc-password"
              type="password"
              className={`form-input ${errors.password ? 'error' : ''}`}
              value={formData.password}
              onChange={(e) => updateField('password', e.target.value)}
              placeholder="Enter password"
            />
            {errors.password && <span className="form-error">{errors.password}</span>}
          </div>

          {errors.submit && (
            <div className="form-error submit-error">{errors.submit}</div>
          )}

          <div className="dialog-footer">
            <button type="button" className="dialog-btn cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="dialog-btn primary" disabled={connecting}>
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default QuickConnect;