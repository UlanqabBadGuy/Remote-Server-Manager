import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { useI18nStore } from '../store/useI18nStore';
import { t } from '../i18n/translations';
import type { ConnectionConfig, Group } from '../store/useAppStore';

function buildGroupOptions(groups: Group[]): { id: string; label: string }[] {
  const opts: { id: string; label: string }[] = [];
  function walk(parentId: string | null, prefix: string) {
    const children = groups
      .filter((g) => g.parent_id === parentId)
      .sort((a, b) => a.order - b.order);
    for (const g of children) {
      opts.push({ id: g.id, label: `${prefix}${g.name}` });
      walk(g.id, `${prefix}${g.name} / `);
    }
  }
  walk(null, '');
  return opts;
}

interface ConnectionDialogProps {
  connection: ConnectionConfig | null;
  defaultGroupId?: string | null;
  onClose: () => void;
}

interface FormData {
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: 'password' | 'keyfile';
  password: string;
  key_path: string;
  group_id: string;
  note: string;
}

function ConnectionDialog({ connection, defaultGroupId, onClose }: ConnectionDialogProps) {
  const { addConnection, updateConnection, groups, loadGroups } = useAppStore();
  const { addToast } = useToastStore();

  const [formData, setFormData] = useState<FormData>({
    name: '',
    host: '',
    port: 22,
    username: '',
    auth_type: 'password',
    password: '',
    key_path: '',
    group_id: defaultGroupId || '',
    note: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const { lang } = useI18nStore();
  const tr = (key: string) => t[lang][key] ?? key;

  useEffect(() => {
    loadGroups();
    if (connection) {
      setFormData({
        name: connection.name,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        auth_type: connection.auth_type,
        password: '',
        key_path: connection.key_path || '',
        group_id: connection.group_id || '',
        note: connection.note,
      });
    }
  }, [connection, loadGroups]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) newErrors.name = tr('conn.errNameRequired');
    if (!formData.host.trim()) newErrors.host = tr('conn.errHostRequired');
    if (!formData.port || formData.port < 1 || formData.port > 65535)
      newErrors.port = tr('conn.errPortRange');
    if (!formData.username.trim()) newErrors.username = tr('conn.errUsernameRequired');
    if (formData.auth_type === 'password' && !connection && !formData.password.trim()) {
      newErrors.password = tr('conn.errPasswordRequired');
    }
    if (formData.auth_type === 'keyfile' && !formData.key_path.trim()) {
      newErrors.key_path = tr('conn.errKeyRequired');
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const config = {
        id: connection?.id || '',
        name: formData.name.trim(),
        host: formData.host.trim(),
        port: formData.port,
        username: formData.username.trim(),
        auth_type: formData.auth_type,
        key_path: formData.auth_type === 'keyfile' ? formData.key_path.trim() : null,
        group_id: formData.group_id || null,
        note: formData.note.trim(),
      };

      if (connection) {
        await updateConnection({
          ...config,
          id: connection.id,
          created_at: connection.created_at,
          updated_at: new Date().toISOString(),
        });
        if (config.auth_type === 'password' && formData.password) {
          await invoke('store_password', {
            connectionId: connection.id,
            password: formData.password,
          });
        }
      } else {
        const newConn = await addConnection(
          config as Omit<ConnectionConfig, 'id' | 'created_at' | 'updated_at'>
        );
        if (config.auth_type === 'password' && formData.password && newConn) {
          await invoke('store_password', {
            connectionId: newConn.id,
            password: formData.password,
          });
        }
      }
      onClose();
    } catch (error) {
      console.error('Failed to save connection:', error);
      addToast('error', `${tr('conn.saveFailed')}: ${error}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyFilePick = async () => {
    try {
      const selected = await open({
        multiple: false,
        title: tr('conn.selectKeyFile'),
      });
      if (selected) {
        setFormData((prev) => ({ ...prev, key_path: selected as string }));
      }
    } catch (error) {
      console.error('Failed to pick key file:', error);
    }
  };

  const updateField = <K extends keyof FormData>(field: K, value: FormData[K]) => {
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
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{connection ? tr('conn.titleEdit') : tr('conn.titleNew')}</h3>
          <button className="dialog-close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form className="dialog-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="conn-name">{tr('conn.name')}</label>
            <input
              id="conn-name"
              type="text"
              className={`form-input ${errors.name ? 'error' : ''}`}
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder={tr('conn.namePlaceholder')}
            />
            {errors.name && <span className="form-error">{errors.name}</span>}
          </div>

          <div className="form-row">
            <div className="form-group flex-3">
              <label className="form-label" htmlFor="conn-host">{tr('conn.host')}</label>
              <input
                id="conn-host"
                type="text"
                className={`form-input ${errors.host ? 'error' : ''}`}
                value={formData.host}
                onChange={(e) => updateField('host', e.target.value)}
                placeholder={tr('conn.hostPlaceholder')}
              />
              {errors.host && <span className="form-error">{errors.host}</span>}
            </div>
            <div className="form-group flex-1">
              <label className="form-label" htmlFor="conn-port">{tr('conn.port')}</label>
              <input
                id="conn-port"
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
            <label className="form-label" htmlFor="conn-username">{tr('conn.username')}</label>
            <input
              id="conn-username"
              type="text"
              className={`form-input ${errors.username ? 'error' : ''}`}
              value={formData.username}
              onChange={(e) => updateField('username', e.target.value)}
              placeholder={tr('conn.usernamePlaceholder')}
            />
            {errors.username && <span className="form-error">{errors.username}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">{tr('conn.auth')}</label>
            <div className="radio-group">
              <label className="radio-label">
                <input
                  type="radio"
                  name="auth_type"
                  value="password"
                  checked={formData.auth_type === 'password'}
                  onChange={() => updateField('auth_type', 'password')}
                />
                <span>{tr('conn.authPassword')}</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="auth_type"
                  value="keyfile"
                  checked={formData.auth_type === 'keyfile'}
                  onChange={() => updateField('auth_type', 'keyfile')}
                />
                <span>{tr('conn.authKeyFile')}</span>
              </label>
            </div>
          </div>

          {formData.auth_type === 'password' ? (
            <div className="form-group">
              <label className="form-label" htmlFor="conn-password">{tr('conn.password')}</label>
              <input
                id="conn-password"
                type="password"
                className={`form-input ${errors.password ? 'error' : ''}`}
                value={formData.password}
                onChange={(e) => updateField('password', e.target.value)}
                placeholder={connection ? tr('conn.passwordKeepPlaceholder') : tr('conn.passwordPlaceholder')}
              />
              {errors.password && <span className="form-error">{errors.password}</span>}
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label" htmlFor="conn-keypath">{tr('conn.keyPath')}</label>
              <div className="file-picker">
                <input
                  id="conn-keypath"
                  type="text"
                  className={`form-input ${errors.key_path ? 'error' : ''}`}
                  value={formData.key_path}
                  onChange={(e) => updateField('key_path', e.target.value)}
                  placeholder={tr('conn.keyPathPlaceholder')}
                />
                <button
                  type="button"
                  className="browse-btn"
                  onClick={handleKeyFilePick}
                >
                  {tr('conn.browse')}
                </button>
              </div>
              {errors.key_path && <span className="form-error">{errors.key_path}</span>}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="conn-group">{tr('conn.group')}</label>
            <select
              id="conn-group"
              className="form-input"
              value={formData.group_id}
              onChange={(e) => updateField('group_id', e.target.value)}
            >
              <option value="">{tr('conn.noGroup')}</option>
              {buildGroupOptions(groups).map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="conn-note">{tr('conn.note')}</label>
            <textarea
              id="conn-note"
              className="form-input form-textarea"
              value={formData.note}
              onChange={(e) => updateField('note', e.target.value)}
              placeholder={tr('conn.notePlaceholder')}
              rows={3}
            />
          </div>

          {errors.submit && (
            <div className="form-error submit-error">{errors.submit}</div>
          )}

          <div className="dialog-footer">
            <button type="button" className="dialog-btn cancel" onClick={onClose}>
              {tr('conn.cancel')}
            </button>
            <button type="submit" className="dialog-btn primary" disabled={submitting}>
              {submitting ? tr('conn.saving') : connection ? tr('conn.update') : tr('conn.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ConnectionDialog;
