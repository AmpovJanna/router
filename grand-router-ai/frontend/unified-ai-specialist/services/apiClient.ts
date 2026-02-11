import type {
  AgentInvokeResponse,
  ExecuteRequest,
  ExecuteResponse,
  GetChatResponse,
  ListChatsResponse,
} from '../types';
import { extractCodeAsFiles } from './codeExtract';

export type ExecuteResponseWithChatId = ExecuteResponse & { chat_id?: string | null };

export type ExecuteRequestBody = ExecuteRequest;

export type InvokeAgentResponse = AgentInvokeResponse;

const getApiBaseUrl = (): string => {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (!base || typeof base !== 'string') {
    throw new Error('Missing VITE_API_BASE_URL. Set it in .env.local');
  }
  return base;
};

export const buildUrl = (base: string, path: string): string => {
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${res.statusText}: ${text}`);
  }

  return (await res.json()) as T;
};

export const executeQuery = async (query: string, chatId?: string): Promise<ExecuteResponseWithChatId> => {
  const base = getApiBaseUrl();
  const url = buildUrl(base, '/api/v1/router/execute');

  const extracted = extractCodeAsFiles(query);

  const body: ExecuteRequestBody = {
    query,
    persist: true,
    ...(chatId ? { chat_id: chatId } : {}),
    ...(extracted.files.length > 0
      ? {
          context: {
            files: extracted.files.map((f) => ({ filename: f.filename, content: f.content })),
            ...(extracted.inferred_language ? { language: extracted.inferred_language } : {}),
            ...(extracted.goal ? { goal: extracted.goal } : {}),
          },
        }
      : {}),
  };

  return await fetchJson<ExecuteResponseWithChatId>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

export type InvokeAgentRequest = {
  agent_id: string;
  task: string;
  context?: Record<string, unknown>;
  output_format?: string | null;
  chat_id?: string | null;
  persist?: boolean;
};

export const invokeAgent = async (
  agentId: string,
  task: string,
  chatId?: string | null,
  persist: boolean = true
): Promise<InvokeAgentResponse> => {
  const base = getApiBaseUrl();
  const url = buildUrl(base, `/api/v1/agents/${encodeURIComponent(agentId)}/invoke`);

  const body: InvokeAgentRequest = {
    agent_id: agentId as any,
    task,
    context: {},
    ...(chatId ? { chat_id: chatId } : {}),
    persist,
  };

  return await fetchJson<InvokeAgentResponse>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

export const listChats = async (): Promise<ListChatsResponse['chats']> => {
  const base = getApiBaseUrl();
  const url = buildUrl(base, '/api/v1/chats');
  const data = await fetchJson<ListChatsResponse>(url);
  return data.chats;
};

export const getChat = async (chatId: string): Promise<GetChatResponse> => {
  const base = getApiBaseUrl();
  const url = buildUrl(base, `/api/v1/chats/${encodeURIComponent(chatId)}`);
  return await fetchJson<GetChatResponse>(url);
};

export const deleteChat = async (chatId: string): Promise<void> => {
  const base = getApiBaseUrl();
  const url = buildUrl(base, `/api/v1/chats/${encodeURIComponent(chatId)}`);
  await fetch(url, { method: 'DELETE' });
};

export const persistPlannerPlan = async (chatId: string, plan: any, risks?: string[] | null): Promise<void> => {
  const base = getApiBaseUrl();
  const url = buildUrl(base, `/api/v1/chats/${encodeURIComponent(chatId)}/planner/plan`);
  await fetchJson(url, {
    method: 'POST',
    body: JSON.stringify({ plan, risks: risks ?? null, note: 'Saved changes to the plan.' }),
  });
};
