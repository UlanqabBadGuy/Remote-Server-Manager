import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

// ===== Model Configuration =====
export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
}

// ===== Tool Calling =====
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  status: 'pending' | 'success' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  model?: string;
  thought?: string;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  modelId: string;
  systemPrompt?: string;
}

interface TerminalReference {
  text: string;
  startLine: number;
  endLine: number;
}

// ===== Tool Definitions =====
const OPENAI_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'run_command',
      description: 'Execute a shell command on the connected remote server and return the output. Use this to inspect files, check processes, run scripts, etc.',
      parameters: {
        type: 'object' as const,
        properties: {
          command: { type: 'string' as const, description: 'The shell command to execute on the remote server' },
        },
        required: ['command'] as const,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the contents of a file on the remote server',
      parameters: {
        type: 'object' as const,
        properties: {
          path: { type: 'string' as const, description: 'The absolute or relative file path to read' },
        },
        required: ['path'] as const,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_directory',
      description: 'List files and directories in a path on the remote server',
      parameters: {
        type: 'object' as const,
        properties: {
          path: { type: 'string' as const, description: 'The directory path to list (default: current directory)' },
        },
        required: [] as const,
      },
    },
  },
];

const ANTHROPIC_TOOLS = [
  {
    name: 'run_command',
    description: 'Execute a shell command on the connected remote server and return the output.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'The shell command to execute' } },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file on the remote server',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'The file path to read' } },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a path on the remote server',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'The directory path to list' } },
      required: [],
    },
  },
];

// ===== HTTP Proxy Helpers (bypass CORS via Rust backend) =====

async function proxyFetch(url: string, method: string, headers: Record<string, string>, body?: string): Promise<string> {
  return await invoke('proxy_fetch', {
    request: { url, method, headers, body: body ?? null },
  });
}

async function* proxyFetchSSE(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): AsyncGenerator<string> {
  const streamId = crypto.randomUUID();
  let unlistenData: UnlistenFn | null = null;
  let unlistenDone: UnlistenFn | null = null;
  let unlistenError: UnlistenFn | null = null;

  const chunks: string[] = [];
  let done = false;
  let error: string | null = null;
  let resolveNext: (() => void) | null = null;

  unlistenData = await listen<string>(`proxy-stream-data-${streamId}`, (event) => {
    chunks.push(event.payload);
    resolveNext?.();
  });

  unlistenDone = await listen<string>(`proxy-stream-done-${streamId}`, () => {
    done = true;
    resolveNext?.();
  });

  unlistenError = await listen<string>(`proxy-stream-error-${streamId}`, (event) => {
    error = event.payload;
    done = true;
    resolveNext?.();
  });

  // Start the stream request
  invoke('proxy_fetch_stream', {
    request: { url, method, headers, body: body ?? null },
    streamId,
  }).catch((e) => {
    error = String(e);
    done = true;
    resolveNext?.();
  });

  let buffer = '';
  let chunkIndex = 0;

  try {
    while (!done) {
      // Wait for new chunks
      if (chunkIndex >= chunks.length) {
        await new Promise<void>((resolve) => { resolveNext = resolve; });
      }

      // Process new chunks
      while (chunkIndex < chunks.length) {
        buffer += chunks[chunkIndex];
        chunkIndex++;

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6).trim();
            if (data && data !== '[DONE]') {
              yield data;
            }
          }
        }
      }
    }

    if (error) {
      throw new Error(error);
    }
  } finally {
    unlistenData?.();
    unlistenDone?.();
    unlistenError?.();
  }
}

interface StreamChunk {
  type: 'content' | 'thought' | 'tool_start' | 'tool_args' | 'done';
  text?: string;
  toolCallId?: string;
  toolCallName?: string;
  toolCallArgs?: string;
}

async function* processOpenAIStream(url: string, headers: Record<string, string>, body: string): AsyncGenerator<StreamChunk> {
  for await (const raw of proxyFetchSSE(url, 'POST', headers, body)) {
    try {
      const data = JSON.parse(raw);
      const delta = data.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.reasoning_content) {
        yield { type: 'thought', text: delta.reasoning_content };
      }
      if (delta.content) {
        yield { type: 'content', text: delta.content };
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            yield { type: 'tool_start', toolCallId: tc.id, toolCallName: tc.function?.name ?? '' };
          }
          if (tc.function?.arguments) {
            yield { type: 'tool_args', toolCallArgs: tc.function.arguments };
          }
        }
      }
    } catch {}
  }
  yield { type: 'done' };
}

async function* processAnthropicStream(url: string, headers: Record<string, string>, body: string): AsyncGenerator<StreamChunk> {
  for await (const raw of proxyFetchSSE(url, 'POST', headers, body)) {
    try {
      const data = JSON.parse(raw);
      if (data.type === 'content_block_delta') {
        const delta = data.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          yield { type: 'content', text: delta.text };
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          yield { type: 'thought', text: delta.thinking };
        } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
          yield { type: 'tool_args', toolCallArgs: delta.partial_json };
        }
      } else if (data.type === 'content_block_start') {
        const block = data.content_block;
        if (block?.type === 'tool_use') {
          yield { type: 'tool_start', toolCallId: block.id, toolCallName: block.name ?? '' };
        }
      } else if (data.type === 'message_stop') {
        yield { type: 'done' };
      }
    } catch {}
  }
  yield { type: 'done' };
}

// ===== Tool Execution =====
async function captureCommandOutput(sessionId: string, command: string, timeoutMs = 4000): Promise<string> {
  let output = '';
  let unlisten: UnlistenFn | null = null;

  try {
    unlisten = await listen<{ session_id: string; data: string }>('ssh-output', (event) => {
      if (event.payload.session_id === sessionId) {
        output += event.payload.data;
      }
    });

    await invoke('ssh_write', { sessionId, data: command + '\n' });
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  } finally {
    if (unlisten) unlisten();
  }

  // Trim leading echo of the command itself
  const lines = output.split('\n');
  if (lines.length > 1 && lines[0].trim() === command.trim()) {
    lines.shift();
  }
  return lines.join('\n').trim();
}

async function executeTool(sessionId: string | null, toolCall: ToolCall): Promise<string> {
  if (!sessionId) {
    return 'Error: No active SSH session. Please connect to a server first.';
  }

  try {
    const args = JSON.parse(toolCall.arguments || '{}');

    switch (toolCall.name) {
      case 'run_command': {
        const cmd = args.command ?? '';
        if (!cmd) return 'Error: Empty command';
        return await captureCommandOutput(sessionId, cmd);
      }
      case 'read_file': {
        const path = args.path ?? '';
        if (!path) return 'Error: Empty file path';
        return await captureCommandOutput(sessionId, `cat "${path.replace(/"/g, '\\"')}"`);
      }
      case 'list_directory': {
        const path = args.path ?? '.';
        return await captureCommandOutput(sessionId, `ls -la "${path.replace(/"/g, '\\"')}"`);
      }
      default:
        return `Error: Unknown tool "${toolCall.name}"`;
    }
  } catch (err) {
    return `Error executing tool: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ===== Store =====
interface PendingToolConfirmation {
  toolCalls: ToolCall[];
  sessionId: string;
  assistantMsgId: string;
  resolve: (approved: boolean) => void;
}

interface AIState {
  visible: boolean;
  activeSessionId: string | null;
  sessions: ChatSession[];
  models: ModelConfig[];
  inputText: string;
  loading: boolean;
  error: string | null;
  terminalReference: TerminalReference | null;
  activeSshSessionId: string | null;
  pendingToolConfirmation: PendingToolConfirmation | null;

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
  stopGeneration: () => void;
  undoLastTurn: () => void;
  revertToBeforeTurn: (messageId: string) => void;
  retryTurn: (userMessageId: string) => void;
  addTerminalOutput: (text: string, startLine: number, endLine: number) => void;
  clearTerminalReference: () => void;
  setActiveSshSession: (id: string | null) => void;
  setError: (e: string | null) => void;
  confirmToolCalls: (approved: boolean) => void;
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
  return { models: [], sessions: [], activeSessionId: null };
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
  let abortController: AbortController | null = null;

  return {
    visible: false,
    activeSessionId: initial.activeSessionId,
    sessions: initial.sessions,
    models: initial.models,
    inputText: '',
    loading: false,
    error: null,
    terminalReference: null,
    activeSshSessionId: null,
    pendingToolConfirmation: null,

    toggleVisible: () => set((s) => ({ visible: !s.visible })),
    setVisible: (v) => set({ visible: v }),

    addModel: (model) => {
      const newModel: ModelConfig = { ...model, id: crypto.randomUUID() };
      set((s) => ({ models: [...s.models, newModel] }));
      saveConfig(get());
    },

    updateModel: (id, config) => {
      set((s) => ({
        models: s.models.map((m) => (m.id === id ? { ...m, ...config } : m)),
      }));
      saveConfig(get());
    },

    removeModel: (id) => {
      set((s) => ({ models: s.models.filter((m) => m.id !== id) }));
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
          const text = await proxyFetch(url, 'GET', {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          });
          const data = JSON.parse(text);
          models = (data.data ?? []).map((m: any) => m.id).filter(Boolean);
        } else if (provider === 'google') {
          const url = `${baseUrl}?key=${apiKey}`;
          const text = await proxyFetch(url, 'GET', {});
          const data = JSON.parse(text);
          models = (data.models ?? [])
            .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m: any) => m.name.replace('models/', ''));
        } else {
          // OpenAI-compatible (openai, deepseek, bailian, custom)
          const url = baseUrl.replace('/chat/completions', '/models');
          const text = await proxyFetch(url, 'GET', { Authorization: `Bearer ${apiKey}` });
          const data = JSON.parse(text);
          models = (data.data ?? []).map((m: any) => m.id).filter(Boolean);
        }
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
      const { models, sessions } = get();
      // If latest session has no messages, reuse it
      if (sessions.length > 0 && sessions[0].messages.length === 0) {
        set({ activeSessionId: sessions[0].id });
        saveConfig(get());
        return sessions[0].id;
      }
      const modelId = models[0]?.id ?? '';
      const session: ChatSession = {
        id: crypto.randomUUID(),
        title: title ?? 'New Chat',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        modelId,
      };
      set((s) => ({ sessions: [session, ...s.sessions], activeSessionId: session.id }));
      saveConfig(get());
      return session.id;
    },

    switchSession: (id) => { set({ activeSessionId: id }); saveConfig(get()); },

    deleteSession: (id) => {
      set((s) => {
        const newSessions = s.sessions.filter((sess) => sess.id !== id);
        const newActiveId = s.activeSessionId === id ? (newSessions[0]?.id ?? null) : s.activeSessionId;
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

    setActiveSshSession: (id) => set({ activeSshSessionId: id }),

    sendMessage: async () => {
      const state = get();
      const { inputText, activeSessionId, sessions, models, terminalReference, activeSshSessionId } = state;

      if (!activeSessionId) return;

      // Create abort controller for this generation
      abortController = new AbortController();

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

      // Build user content with optional terminal reference
      let userContent = inputText.trim();
      if (terminalReference) {
        const ref = terminalReference;
        const refTag = `Terminal ${ref.startLine}-${ref.endLine}`;
        userContent = userContent
          ? `${userContent}\n\n[${refTag}]\n\`\`\`\n${ref.text}\n\`\`\``
          : `[${refTag}]\n\`\`\`\n${ref.text}\n\`\`\``;
      }
      if (!userContent) return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: userContent,
        timestamp: Date.now(),
      };

      const updatedSession = {
        ...session,
        title: session.messages.length === 0
          ? (inputText.trim().slice(0, 40) || 'Chat')
          : session.title,
        messages: [...session.messages, userMessage],
        updatedAt: Date.now(),
      };

      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === activeSessionId ? updatedSession : sess
        ),
        inputText: '',
        terminalReference: null,
        loading: true,
        error: null,
      }));

      // Streaming loop (supports tool calling multi-turn)
      try {
        // Build conversation messages preserving tool_calls/tool_call_id
        const conversationMessages: any[] = [];

        if (session.systemPrompt) {
          conversationMessages.push({ role: 'system', content: session.systemPrompt });
        }

        for (const m of updatedSession.messages) {
          if (m.role === 'system') continue;
          if (m.role === 'tool') {
            // Only include tool messages that are part of a tool call chain
            // They need tool_call_id to be valid
            continue;
          }
          if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
            conversationMessages.push({
              role: 'assistant',
              content: m.content || null,
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments },
              })),
            });
            // Include the corresponding tool result messages
            for (const tc of m.toolCalls) {
              if (tc.result) {
                conversationMessages.push({
                  role: 'tool',
                  content: tc.result,
                  tool_call_id: tc.id,
                });
              }
            }
          } else {
            conversationMessages.push({ role: m.role as string, content: m.content });
          }
        }

        let maxToolRounds = 5;

        while (maxToolRounds-- > 0) {
          // Create streaming assistant message
          const assistantMsgId = crypto.randomUUID();
          const assistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            thought: '',
            toolCalls: [],
            isStreaming: true,
            timestamp: Date.now(),
            model: model.name,
          };

          set((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === activeSessionId
                ? { ...sess, messages: [...sess.messages, assistantMsg], updatedAt: Date.now() }
                : sess
            ),
          }));

          // Build API request body
          let requestBody: any;
          let headers: Record<string, string> = { 'Content-Type': 'application/json' };

          if (model.provider === 'anthropic') {
            // Convert messages to Anthropic format
            const anthropicMessages: any[] = [];
            for (const msg of conversationMessages) {
              if (msg.role === 'tool') {
                // Find the last assistant message and add tool_result to it
                // For simplicity, add as user message with tool_result content block
                anthropicMessages.push({
                  role: 'user',
                  content: [{ type: 'tool_result', tool_use_id: (msg as any).tool_call_id ?? '', content: msg.content }],
                });
              } else {
                anthropicMessages.push({ role: msg.role, content: msg.content });
              }
            }

            requestBody = {
              model: model.name,
              max_tokens: 8192,
              messages: anthropicMessages,
              stream: true,
              tools: ANTHROPIC_TOOLS,
            };
            headers['x-api-key'] = model.apiKey;
            headers['anthropic-version'] = '2023-06-01';
          } else {
            // OpenAI-compatible format
            const openaiMessages: any[] = [];
            for (const msg of conversationMessages) {
              if (msg.role === 'tool') {
                openaiMessages.push({
                  role: 'tool',
                  content: msg.content,
                  tool_call_id: (msg as any).tool_call_id ?? '',
                });
              } else if (msg.role === 'assistant' && (msg as any).tool_calls) {
                openaiMessages.push({
                  role: 'assistant',
                  content: (msg as any).content || null,
                  tool_calls: (msg as any).tool_calls,
                });
              } else {
                openaiMessages.push({ role: msg.role, content: msg.content });
              }
            }

            requestBody = {
              model: model.name,
              messages: openaiMessages,
              stream: true,
              tools: OPENAI_TOOLS,
            };
            headers['Authorization'] = `Bearer ${model.apiKey}`;
          }

          const body = JSON.stringify(requestBody);

          // Process stream via Rust proxy (bypasses CORS)
          const processor = model.provider === 'anthropic'
            ? processAnthropicStream(model.baseUrl, headers, body)
            : processOpenAIStream(model.baseUrl, headers, body);

          let streamContent = '';
          let streamThought = '';
          const streamToolCalls: ToolCall[] = [];
          let currentToolCallIndex = -1;

          for await (const chunk of processor) {
            if (chunk.type === 'content') {
              streamContent += chunk.text ?? '';
            } else if (chunk.type === 'thought') {
              streamThought += chunk.text ?? '';
            } else if (chunk.type === 'tool_start') {
              currentToolCallIndex = streamToolCalls.length;
              streamToolCalls.push({
                id: chunk.toolCallId ?? `tool_${streamToolCalls.length}`,
                name: chunk.toolCallName ?? '',
                arguments: '',
                status: 'pending',
              });
            } else if (chunk.type === 'tool_args') {
              if (currentToolCallIndex >= 0) {
                streamToolCalls[currentToolCallIndex].arguments += chunk.toolCallArgs ?? '';
              }
            } else if (chunk.type === 'done') {
              break;
            }

            // Update streaming message in real-time
            set((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === activeSessionId
                  ? {
                      ...sess,
                      messages: sess.messages.map((m) =>
                        m.id === assistantMsgId
                          ? { ...m, content: streamContent, thought: streamThought, toolCalls: [...streamToolCalls] }
                          : m
                      ),
                    }
                  : sess
              ),
            }));
          }

          // Finalize assistant message
          const finalizedAssistant: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: streamContent,
            thought: streamThought || undefined,
            toolCalls: streamToolCalls.length > 0 ? streamToolCalls : undefined,
            isStreaming: false,
            timestamp: Date.now(),
            model: model.name,
          };

          // If no tool calls, we're done
          if (streamToolCalls.length === 0) {
            set((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === activeSessionId
                  ? {
                      ...sess,
                      messages: sess.messages.map((m) => (m.id === assistantMsgId ? finalizedAssistant : m)),
                      updatedAt: Date.now(),
                    }
                  : sess
              ),
              loading: false,
            }));
            saveConfig(get());
            break;
          }

          // Execute tool calls with confirmation
          const executedToolCalls: ToolCall[] = [];
          const toolResultMessages: ChatMessage[] = [];

          // Show pending state for all tool calls
          for (const tc of streamToolCalls) {
            tc.status = 'pending';
          }
          set((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === activeSessionId
                ? {
                    ...sess,
                    messages: sess.messages.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, toolCalls: [...streamToolCalls] }
                        : m
                    ),
                  }
                : sess
            ),
          }));

          // Wait for user confirmation
          const approved = await new Promise<boolean>((resolve) => {
            set({
              pendingToolConfirmation: {
                toolCalls: streamToolCalls,
                sessionId: activeSshSessionId ?? '',
                assistantMsgId,
                resolve,
              },
            });
          });

          set({ pendingToolConfirmation: null });

          if (!approved) {
            // User denied - mark all as cancelled
            for (const tc of streamToolCalls) {
              tc.status = 'error';
              tc.result = 'Cancelled by user';
            }
            set((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === activeSessionId
                  ? {
                      ...sess,
                      messages: sess.messages.map((m) =>
                        m.id === assistantMsgId
                          ? { ...m, toolCalls: [...streamToolCalls], isStreaming: false }
                          : m
                      ),
                      updatedAt: Date.now(),
                    }
                  : sess
              ),
              loading: false,
            }));
            saveConfig(get());
            break;
          }

          // Execute approved tool calls
          for (const tc of streamToolCalls) {
            tc.status = 'pending';
            set((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === activeSessionId
                  ? {
                      ...sess,
                      messages: sess.messages.map((m) =>
                        m.id === assistantMsgId
                          ? { ...m, toolCalls: streamToolCalls.map((t) => (t.id === tc.id ? { ...t, status: 'pending' as const } : t)) }
                          : m
                      ),
                    }
                  : sess
              ),
            }));

            const result = await executeTool(activeSshSessionId, tc);
            tc.result = result;
            tc.status = 'success';
            executedToolCalls.push(tc);

            const toolMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'tool',
              content: result,
              timestamp: Date.now(),
            };
            (toolMsg as any).tool_call_id = tc.id;
            (toolMsg as any).name = tc.name;
            toolResultMessages.push(toolMsg);

            set((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === activeSessionId
                  ? {
                      ...sess,
                      messages: [
                        ...sess.messages.map((m) =>
                          m.id === assistantMsgId
                            ? { ...m, toolCalls: streamToolCalls.map((t) => (t.id === tc.id ? { ...t, status: 'success' as const, result } : t)) }
                            : m
                        ),
                        toolMsg,
                      ],
                    }
                  : sess
              ),
            }));
          }

          // Update conversation messages for next round
          // Add the assistant message with tool_calls in API format
          if (model.provider === 'anthropic') {
            const apiAssistantMsg: any = {
              role: 'assistant',
              content: streamToolCalls.map((tc) => ({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: JSON.parse(tc.arguments || '{}'),
              })),
            };
            if (streamContent) {
              apiAssistantMsg.content = [{ type: 'text', text: streamContent }, ...apiAssistantMsg.content];
            }
            conversationMessages.push(apiAssistantMsg);
            // Tool results already in conversationMessages as user messages with tool_result
            for (const tr of toolResultMessages) {
              conversationMessages.push({
                role: 'user' as const,
                content: JSON.stringify([{ type: 'tool_result', tool_use_id: (tr as any).tool_call_id, content: tr.content }]),
              });
            }
          } else {
            const apiAssistantMsg: any = {
              role: 'assistant',
              content: streamContent || null,
              tool_calls: streamToolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments },
              })),
            };
            conversationMessages.push(apiAssistantMsg);
            for (const tr of toolResultMessages) {
              conversationMessages.push({
                role: 'tool',
                content: tr.content,
                tool_call_id: (tr as any).tool_call_id,
              } as any);
            }
          }
        }
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (isAbort) {
          // Finalize any streaming message on abort
          const { activeSessionId: sid } = get();
          if (sid) {
            set((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === sid
                  ? {
                      ...sess,
                      messages: sess.messages.map((m) =>
                        m.isStreaming ? { ...m, isStreaming: false } : m
                      ),
                      updatedAt: Date.now(),
                    }
                  : sess
              ),
              loading: false,
            }));
            saveConfig(get());
          } else {
            set({ loading: false });
          }
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          set({ error: msg, loading: false });
        }
      } finally {
        abortController = null;
        // Dismiss any pending tool confirmation
        const { pendingToolConfirmation } = get();
        if (pendingToolConfirmation) {
          pendingToolConfirmation.resolve(false);
          set({ pendingToolConfirmation: null });
        }
      }
    },

    addTerminalOutput: (text, startLine, endLine) => {
      set({ terminalReference: { text, startLine, endLine }, visible: true });
    },

    clearTerminalReference: () => set({ terminalReference: null }),

    setError: (e) => set({ error: e }),

    stopGeneration: () => {
      if (abortController) {
        abortController.abort();
      }
    },

    undoLastTurn: () => {
      const { activeSessionId } = get();
      if (!activeSessionId) return;

      set((s) => ({
        sessions: s.sessions.map((sess) => {
          if (sess.id !== activeSessionId) return sess;
          const msgs = [...sess.messages];
          // Remove the last assistant message (if exists)
          if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
            msgs.pop();
            // Also remove trailing tool messages
            while (msgs.length > 0 && msgs[msgs.length - 1].role === 'tool') {
              msgs.pop();
            }
          }
          // Remove the last user message
          if (msgs.length > 0 && msgs[msgs.length - 1].role === 'user') {
            msgs.pop();
          }
          return { ...sess, messages: msgs, updatedAt: Date.now() };
        }),
      }));
      saveConfig(get());
    },

    revertToBeforeTurn: (messageId) => {
      const { activeSessionId } = get();
      if (!activeSessionId) return;

      set((s) => ({
        sessions: s.sessions.map((sess) => {
          if (sess.id !== activeSessionId) return sess;
          const idx = sess.messages.findIndex((m) => m.id === messageId);
          if (idx < 0) return sess;
          // Keep only messages before this user message
          const msgs = sess.messages.slice(0, idx);
          return { ...sess, messages: msgs, updatedAt: Date.now() };
        }),
      }));
      saveConfig(get());
    },

    retryTurn: async (userMessageId) => {
      const { activeSessionId } = get();
      if (!activeSessionId) return;
      const session = get().sessions.find((s) => s.id === activeSessionId);
      if (!session) return;
      const userMsg = session.messages.find((m) => m.id === userMessageId);
      if (!userMsg || userMsg.role !== 'user') return;
      // Extract plain text (strip terminal reference tags)
      const plainContent = userMsg.content.replace(/\[Terminal \d+-\d+\]\s*```[\s\S]*?```/g, '').trim();
      // Revert to before this user message
      get().revertToBeforeTurn(userMessageId);
      // Set input and trigger send
      set({ inputText: plainContent });
      // Small delay to ensure state is updated
      await new Promise((r) => setTimeout(r, 50));
      await get().sendMessage();
    },

    confirmToolCalls: (approved) => {
      const { pendingToolConfirmation } = get();
      if (pendingToolConfirmation) {
        pendingToolConfirmation.resolve(approved);
      }
    },
  };
});
