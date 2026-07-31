import { create } from 'zustand';

// ===== Model Configuration =====
export interface ModelConfig {
  id: string;
  name: string;
  provider: string; // e.g., 'openai', 'anthropic', 'google', 'deepseek', 'custom'
  baseUrl: string;
  apiKey: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  modelId: string; // Reference to ModelConfig.id
  systemPrompt?: string;
}

interface AIState {
  visible: boolean;
  activeSessionId: string | null;
  sessions: ChatSession[];
  models: ModelConfig[];
  inputText: string;
  loading: boolean;
  error: string | null;

  toggleVisible: () => void;
  setVisible: (v: boolean) => void;
  addModel: (model: Omit<ModelConfig, 'id'>) => void;
  updateModel: (id: string, config: Partial<ModelConfig>) => void;
  removeModel: (id: string) => void;
  fetchModelsForProvider: (provider: string, baseUrl: string, apiKey: string) => Promise<string[]>;
  createSession: (title?: string) => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  clearSessionMessages: (id: string) => void;
  updateSessionModel: (sessionId: string, modelId: string) => void;
  setInputText: (text: string) => void;
  sendMessage: () => Promise<void>;
  addTerminalOutput: (text: string) => void;
  setError: (e: string | null) => void;
}

const STORAGE_KEY = 'ssh-manager-ai-config-v3';

interface PersistedConfig {
  models: ModelConfig[];
  sessions: ChatSession[];
  activeSessionId: string | null;
}

function loadConfig(): PersistedConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        models: parsed.models ?? [],
        sessions: parsed.sessions ?? [],
        activeSessionId: parsed.activeSessionId ?? null,
      };
    }
  } catch {}
  return {
    models: [],
    sessions: [],
    activeSessionId: null,
  };
}

function saveConfig(state: Pick<AIState, 'models' | 'sessions' | 'activeSessionId'>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    models: state.models,
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
  }));
}

export const useAIStore = create<AIState>((set, get) => {
  const initial = loadConfig();

  return {
    visible: false,
    activeSessionId: initial.activeSessionId,
    sessions: initial.sessions,
    models: initial.models,
    inputText: '',
    loading: false,
    error: null,

    toggleVisible: () => set((s) => ({ visible: !s.visible })),
    setVisible: (v) => set({ visible: v }),

    addModel: (model) => {
      const newModel: ModelConfig = {
        ...model,
        id: crypto.randomUUID(),
      };
      set((s) => ({ models: [...s.models, newModel] }));
      saveConfig(get());
    },

    updateModel: (id, config) => {
      set((s) => ({
        models: s.models.map((m) =>
          m.id === id ? { ...m, ...config } : m
        ),
      }));
      saveConfig(get());
    },

    removeModel: (id) => {
      set((s) => ({
        models: s.models.filter((m) => m.id !== id),
      }));
      saveConfig(get());
    },

    fetchModelsForProvider: async (provider, baseUrl, apiKey) => {
      if (!apiKey) {
        set({ error: 'Please enter API Key first' });
        return [];
      }

      try {
        let models: string[] = [];

        if (provider === 'anthropic') {
          const url = baseUrl.replace('/v1/messages', '/v1/models');
          const response = await fetch(url, {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
          });
          if (!response.ok) throw new Error(`API ${response.status}`);
          const data = await response.json();
          models = (data.data ?? []).map((m: any) => m.id).filter(Boolean);
        } else if (provider === 'google') {
          const url = `${baseUrl}?key=${apiKey}`;
          const response = await fetch(url);
          if (!response.ok) throw new Error(`API ${response.status}`);
          const data = await response.json();
          models = (data.models ?? [])
            .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m: any) => m.name.replace('models/', ''));
        } else {
          // OpenAI-compatible (openai, deepseek, custom)
          const url = baseUrl.replace('/chat/completions', '/models');
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!response.ok) throw new Error(`API ${response.status}`);
          const data = await response.json();
          models = (data.data ?? []).map((m: any) => m.id).filter(Boolean);
        }

        // Filter out non-chat models
        models = models.filter((m) => {
          const lower = m.toLowerCase();
          return !lower.includes('embedding') && !lower.includes('tts')
            && !lower.includes('whisper') && !lower.includes('dall-e')
            && !lower.includes('moderation');
        });

        return models;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ error: `Failed to fetch models: ${msg}` });
        return [];
      }
    },

    createSession: (title) => {
      const { models } = get();
      const modelId = models[0]?.id ?? '';
      const session: ChatSession = {
        id: crypto.randomUUID(),
        title: title ?? 'New Chat',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        modelId,
      };
      set((s) => ({
        sessions: [session, ...s.sessions],
        activeSessionId: session.id,
      }));
      saveConfig(get());
      return session.id;
    },

    switchSession: (id) => {
      set({ activeSessionId: id });
      saveConfig(get());
    },

    deleteSession: (id) => {
      set((s) => {
        const newSessions = s.sessions.filter((sess) => sess.id !== id);
        const newActiveId = s.activeSessionId === id
          ? (newSessions[0]?.id ?? null)
          : s.activeSessionId;
        return { sessions: newSessions, activeSessionId: newActiveId };
      });
      saveConfig(get());
    },

    clearSessionMessages: (id) => {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === id ? { ...sess, messages: [], updatedAt: Date.now() } : sess
        ),
      }));
      saveConfig(get());
    },

    updateSessionModel: (sessionId, modelId) => {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, modelId, updatedAt: Date.now() } : sess
        ),
      }));
      saveConfig(get());
    },

    setInputText: (text) => set({ inputText: text }),

    sendMessage: async () => {
      const state = get();
      const { inputText, activeSessionId, sessions, models } = state;

      if (!inputText.trim() || !activeSessionId) return;

      const session = sessions.find((s) => s.id === activeSessionId);
      if (!session) return;

      const model = models.find((m) => m.id === session.modelId);
      if (!model) {
        set({ error: 'No model configured. Please add a model first.' });
        return;
      }

      if (!model.apiKey) {
        set({ error: `Please configure API key for ${model.name}` });
        return;
      }

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: inputText.trim(),
        timestamp: Date.now(),
      };

      const updatedSession = {
        ...session,
        messages: [...session.messages, userMessage],
        updatedAt: Date.now(),
      };

      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === activeSessionId ? updatedSession : sess
        ),
        inputText: '',
        loading: true,
        error: null,
      }));

      try {
        // Use updatedSession.messages to include the user message we just added
        const apiMessages = updatedSession.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, content: m.content }));

        if (session.systemPrompt) {
          apiMessages.unshift({ role: 'system' as const, content: session.systemPrompt });
        }

        let response: Response;

        if (model.provider === 'anthropic') {
          response = await fetch(model.baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': model.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: model.name,
              max_tokens: 4096,
              messages: apiMessages,
            }),
          });
        } else if (model.provider === 'google') {
          const url = `${model.baseUrl}/${model.name}:generateContent?key=${model.apiKey}`;
          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: apiMessages.map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
              })),
            }),
          });
        } else {
          // OpenAI-compatible
          response = await fetch(model.baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${model.apiKey}`,
            },
            body: JSON.stringify({
              model: model.name,
              messages: apiMessages,
              stream: false,
            }),
          });
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`API error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        let reply = '';

        if (model.provider === 'anthropic') {
          reply = data.content?.[0]?.text ?? 'No response received.';
        } else if (model.provider === 'google') {
          reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response received.';
        } else {
          reply = data.choices?.[0]?.message?.content ?? 'No response received.';
        }

        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply,
          timestamp: Date.now(),
          model: model.name,
        };

        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === activeSessionId
              ? { ...sess, messages: [...sess.messages, assistantMessage], updatedAt: Date.now() }
              : sess
          ),
          loading: false,
        }));
        saveConfig(get());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ error: msg, loading: false });
      }
    },

    addTerminalOutput: (text) => {
      const state = get();
      let sessionId = state.activeSessionId;

      if (!sessionId) {
        sessionId = get().createSession('Terminal Output');
      }

      const prompt = `Here is the terminal output I need help with:\n\n\`\`\`\n${text}\n\`\`\`\n\nPlease help me understand or resolve this.`;

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };

      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId
            ? { ...sess, messages: [...sess.messages, message], updatedAt: Date.now() }
            : sess
        ),
        visible: true,
      }));
      saveConfig(get());
    },

    setError: (e) => set({ error: e }),
  };
});
