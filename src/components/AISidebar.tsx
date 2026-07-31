import { useState, useRef, useEffect } from 'react';
import { useAIStore, type ModelConfig } from '../store/useAIStore';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; placeholder: string; hint: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    placeholder: 'gpt-4o, gpt-4o-mini, ...',
    hint: 'OpenAI and compatible APIs (Groq, Together, Fireworks, etc.)',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1/messages',
    placeholder: 'claude-sonnet-4-20250514, ...',
    hint: 'Anthropic Claude API. Key format: sk-ant-...',
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    placeholder: 'gemini-2.5-pro, gemini-2.5-flash, ...',
    hint: 'Google AI Studio / Gemini API. Key from aistudio.google.com',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    placeholder: 'deepseek-chat, deepseek-reasoner, ...',
    hint: 'DeepSeek API. Key from platform.deepseek.com',
  },
  custom: {
    baseUrl: '',
    placeholder: 'model-name',
    hint: 'Any OpenAI-compatible API endpoint',
  },
};

export default function AISidebar() {
  const {
    visible, sessions, activeSessionId, models,
    inputText, loading, error,
    setVisible, addModel, updateModel, removeModel,
    fetchModelsForProvider,
    createSession, switchSession, deleteSession,
    updateSessionModel,
    setInputText, sendMessage, setError,
  } = useAIStore();

  const [showConfig, setShowConfig] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState({
    name: '',
    provider: 'openai',
    baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
    apiKey: '',
  });
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeModel = models.find((m) => m.id === activeSession?.modelId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages.length]);

  useEffect(() => {
    if (visible && !activeSessionId && sessions.length === 0) {
      createSession();
    }
  }, [visible]);

  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible, activeSessionId]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || loading) return;
    if (!activeSessionId) {
      createSession();
      setTimeout(() => {
        setInputText(text);
        sendMessage();
      }, 50);
      return;
    }
    sendMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleProviderChange = (provider: string) => {
    const defaults = PROVIDER_DEFAULTS[provider];
    setModelForm({
      ...modelForm,
      provider,
      baseUrl: defaults?.baseUrl ?? '',
    });
    setFetchedModels([]);
  };

  const handleFetchModels = async () => {
    if (!modelForm.apiKey) {
      set({ error: 'Please enter API Key first' });
      return;
    }
    setFetchingModels(true);
    setError(null);
    const result = await fetchModelsForProvider(modelForm.provider, modelForm.baseUrl, modelForm.apiKey);
    setFetchedModels(result);
    setFetchingModels(false);
  };

  const handleSaveModel = () => {
    const name = modelForm.name.trim();
    if (!name) return;

    if (editingModelId) {
      updateModel(editingModelId, {
        name,
        provider: modelForm.provider,
        baseUrl: modelForm.baseUrl,
        apiKey: modelForm.apiKey,
      });
      setEditingModelId(null);
    } else {
      addModel({
        name,
        provider: modelForm.provider,
        baseUrl: modelForm.baseUrl,
        apiKey: modelForm.apiKey,
      });
    }

    setModelForm({
      name: '',
      provider: 'openai',
      baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
      apiKey: '',
    });
    setFetchedModels([]);
  };

  const handleEditModel = (model: ModelConfig) => {
    setEditingModelId(model.id);
    setModelForm({
      name: model.name,
      provider: model.provider,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
    });
    setFetchedModels([]);
  };

  const handleCancelEdit = () => {
    setEditingModelId(null);
    setModelForm({
      name: '',
      provider: 'openai',
      baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
      apiKey: '',
    });
    setFetchedModels([]);
  };

  const handleSelectFetchedModel = (modelName: string) => {
    setModelForm({ ...modelForm, name: modelName });
  };

  const handleSelectModel = (modelId: string) => {
    if (activeSessionId) {
      updateSessionModel(activeSessionId, modelId);
    }
    setShowModelPicker(false);
  };

  const handleNewChat = () => {
    createSession();
    setShowSessions(false);
  };

  if (!visible) return null;

  return (
    <div className="ai-sidebar">
      {/* Header */}
      <div className="ai-sidebar-header">
        <div className="ai-sidebar-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span>AI Assistant</span>
        </div>
        <div className="ai-sidebar-actions">
          <button className="ai-icon-btn" onClick={handleNewChat} title="New Chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button className="ai-icon-btn" onClick={() => setShowSessions(!showSessions)} title="Chat History">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          <button
            className="ai-icon-btn"
            onClick={() => { handleCancelEdit(); setShowConfig(true); }}
            title="Settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button className="ai-icon-btn" onClick={() => setVisible(false)} title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="ai-messages">
        {(!activeSession || activeSession.messages.length === 0) && (
          <div className="ai-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p>Select text in the terminal and send it here, or type your question below.</p>
            {models.length === 0 && (
              <button className="ai-config-hint" onClick={() => { handleCancelEdit(); setShowConfig(true); }}>
                Configure AI
              </button>
            )}
          </div>
        )}

        {activeSession?.messages.map((msg) => (
          <div key={msg.id} className={`ai-message ${msg.role}`}>
            <div className="ai-message-header">
              <span className="ai-message-role">{msg.role === 'user' ? 'You' : 'AI'}</span>
              {msg.model && <span className="ai-message-model">{msg.model}</span>}
              <span className="ai-message-time">{formatTime(msg.timestamp)}</span>
            </div>
            <div className="ai-message-content">
              <pre>{msg.content}</pre>
            </div>
          </div>
        ))}

        {loading && (
          <div className="ai-message assistant">
            <div className="ai-message-content">
              <div className="ai-typing"><span /><span /><span /></div>
            </div>
          </div>
        )}

        {error && (
          <div className="ai-error">
            <span>{error}</span>
            <button className="ai-error-dismiss" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Model Selector + Input */}
      <div className="ai-input-section">
        {models.length > 0 && (
          <div className="ai-model-selector-row">
            <button
              className="ai-model-select-btn"
              onClick={() => setShowModelPicker(!showModelPicker)}
            >
              <span className="ai-model-select-name">
                {activeModel?.name || 'Select Model'}
              </span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        )}

        {/* Model Picker Dropdown */}
        {showModelPicker && (
          <div className="ai-model-picker-dropdown">
            <div className="ai-model-picker-header">
              <span>Select Model</span>
              <button className="ai-model-picker-close" onClick={() => setShowModelPicker(false)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="ai-model-list">
              {models.length === 0 && (
                <div className="ai-model-empty">
                  No models configured. Click Settings to add one.
                </div>
              )}
              {models.map((m) => (
                <button
                  key={m.id}
                  className={`ai-model-option ${activeSession?.modelId === m.id ? 'active' : ''}`}
                  onClick={() => handleSelectModel(m.id)}
                >
                  <span className="ai-model-option-name">{m.name}</span>
                  <span className="ai-model-option-provider">{m.provider}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ai-input-area">
          <textarea
            ref={inputRef}
            className="ai-input"
            placeholder={models.length > 0 ? "Ask about terminal output..." : "Configure AI to start chatting..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={loading || models.length === 0}
          />
          <button
            className="ai-send-btn"
            onClick={handleSend}
            disabled={loading || !inputText.trim() || models.length === 0}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Session List */}
      {showSessions && (
        <div className="ai-session-list">
          <div className="ai-session-list-header">
            <span>Chat History</span>
            <button className="ai-session-new" onClick={handleNewChat}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New
            </button>
          </div>
          <div className="ai-session-items">
            {sessions.length === 0 && <div className="ai-session-empty">No chats yet</div>}
            {sessions.map((sess) => {
              const sessModel = models.find((m) => m.id === sess.modelId);
              return (
                <div
                  key={sess.id}
                  className={`ai-session-item ${sess.id === activeSessionId ? 'active' : ''}`}
                  onClick={() => { switchSession(sess.id); setShowSessions(false); }}
                >
                  <div className="ai-session-info">
                    <div className="ai-session-title">{sess.title}</div>
                    <div className="ai-session-meta">
                      {sess.messages.length} msgs · {sessModel?.name ?? 'No model'}
                    </div>
                  </div>
                  <button
                    className="ai-session-delete"
                    onClick={(e) => { e.stopPropagation(); deleteSession(sess.id); }}
                    title="Delete"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Config Dialog - Flat Model List */}
      {showConfig && (
        <div className="ai-config-overlay" onClick={() => setShowConfig(false)}>
          <div className="ai-config-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="ai-config-header">
              <span>AI Models</span>
              <button className="ai-config-close" onClick={() => setShowConfig(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="ai-config-models-content">
              {/* Existing models list */}
              <div className="ai-config-model-list">
                {models.length === 0 && (
                  <div className="ai-config-no-models">
                    No models configured yet. Add one below.
                  </div>
                )}
                {models.map((m) => (
                  <div
                    key={m.id}
                    className={`ai-config-model-item ${editingModelId === m.id ? 'editing' : ''}`}
                  >
                    <div className="ai-config-model-info">
                      <span className="ai-config-model-name">{m.name}</span>
                      <span className="ai-config-model-provider">{m.provider}</span>
                    </div>
                    <div className="ai-config-model-actions">
                      <button
                        className="ai-config-model-edit"
                        onClick={() => handleEditModel(m)}
                        title="Edit"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        className="ai-config-model-delete"
                        onClick={() => removeModel(m.id)}
                        title="Delete"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add/Edit model form */}
              <div className="ai-config-model-form">
                <div className="ai-config-model-form-title">
                  {editingModelId ? 'Edit Model' : 'Add Model'}
                </div>

                <label>
                  <span>Provider</span>
                  <select
                    value={modelForm.provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    disabled={!!editingModelId}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>

                <label>
                  <span>API URL</span>
                  <input
                    type="text"
                    value={modelForm.baseUrl}
                    onChange={(e) => setModelForm({ ...modelForm, baseUrl: e.target.value })}
                    placeholder={PROVIDER_DEFAULTS[modelForm.provider]?.baseUrl || 'https://...'}
                  />
                </label>

                <label>
                  <span>API Key</span>
                  <input
                    type="password"
                    value={modelForm.apiKey}
                    onChange={(e) => setModelForm({ ...modelForm, apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                </label>

                <label>
                  <span>Model Name</span>
                  <input
                    type="text"
                    value={modelForm.name}
                    onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })}
                    placeholder={PROVIDER_DEFAULTS[modelForm.provider]?.placeholder || 'model-name'}
                  />
                </label>

                {modelForm.apiKey && (
                  <button
                    className="ai-config-fetch-models-btn"
                    onClick={handleFetchModels}
                    disabled={fetchingModels}
                  >
                    {fetchingModels ? (
                      <>
                        <svg className="ai-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        Fetching...
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                        Fetch Available Models
                      </>
                    )}
                  </button>
                )}

                {fetchedModels.length > 0 && (
                  <div className="ai-config-fetched-list">
                    <span className="ai-config-fetched-label">Available models (click to select):</span>
                    <div className="ai-config-fetched-items">
                      {fetchedModels.map((m) => (
                        <button
                          key={m}
                          className={`ai-config-fetched-item ${modelForm.name === m ? 'selected' : ''}`}
                          onClick={() => handleSelectFetchedModel(m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="ai-config-hint-text">
                  {PROVIDER_DEFAULTS[modelForm.provider]?.hint}
                </p>

                <div className="ai-config-model-form-footer">
                  {editingModelId && (
                    <button className="ai-config-cancel" onClick={handleCancelEdit}>
                      Cancel
                    </button>
                  )}
                  <button
                    className="ai-config-save"
                    onClick={handleSaveModel}
                    disabled={!modelForm.name.trim()}
                  >
                    {editingModelId ? 'Update' : 'Add Model'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
