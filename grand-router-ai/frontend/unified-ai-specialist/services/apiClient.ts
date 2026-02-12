import type {
  AgentInvokeResponse,
  ExecuteRequest,
  ExecuteResponse,
  GetChatResponse,
  ListChatsResponse,
  RouteRequest,
  RouteResponse,
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
  const controller = (init as any)?.signal ? null : new AbortController();
  const res = await fetch(url, {
    ...init,
    ...(controller ? { signal: controller.signal } : {}),
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

export type CancelablePromise<T> = {
  promise: Promise<T>;
  cancel: () => void;
};

const fetchJsonCancelable = <T>(url: string, init?: RequestInit): CancelablePromise<T> => {
  const controller = new AbortController();
  const promise = fetchJson<T>(url, { ...(init || {}), signal: controller.signal });
  return { promise, cancel: () => controller.abort() };
};

export type ExecuteQueryOptions = {
  chatId?: string;
  mode?: 'auto' | 'forced';
  forcedAgentId?: string | null;
  context?: Record<string, unknown>;
};

export const executeQuery = async (query: string, chatIdOrOptions?: string | ExecuteQueryOptions): Promise<ExecuteResponseWithChatId> => {
  const base = getApiBaseUrl();
  const url = buildUrl(base, '/api/v1/router/execute');

  const opts: ExecuteQueryOptions =
    typeof chatIdOrOptions === 'string'
      ? { chatId: chatIdOrOptions }
      : (chatIdOrOptions ?? {});

  const extracted = extractCodeAsFiles(query);

  const providedContext = (opts.context || {}) as Record<string, unknown>;
  const providedFilesRaw = (providedContext as any).files;
  const providedFiles: Array<{ path: string; content: string }> = Array.isArray(providedFilesRaw)
    ? providedFilesRaw
        .map((f: any) => ({
          path: String(f?.path || ''),
          content: String(f?.content || ''),
        }))
        .filter((f) => f.path.trim() && f.content)
    : [];

  const mergedFiles = (() => {
    const seen = new Map<string, { path: string; content: string }>();
    for (const f of providedFiles) seen.set(f.path, f);
    for (const f of extracted.files) seen.set(f.path, { path: f.path, content: f.content });
    return Array.from(seen.values()).slice(0, 12);
  })();

  const body: ExecuteRequestBody = {
    query,
    persist: true,
    ...(opts.chatId ? { chat_id: opts.chatId } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
    ...(opts.forcedAgentId ? { forced_agent_id: opts.forcedAgentId as any } : {}),
    ...(Object.keys(providedContext).length > 0 || mergedFiles.length > 0
      ? {
          context: {
            ...providedContext,
            ...(mergedFiles.length > 0 ? { files: mergedFiles } : {}),
            ...(!('language' in providedContext) && extracted.inferred_language ? { language: extracted.inferred_language } : {}),
            ...(!('goal' in providedContext) && extracted.goal ? { goal: extracted.goal } : {}),
          },
        }
      : {}),
  };

  return await fetchJson<ExecuteResponseWithChatId>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

export const executeQueryCancelable = (query: string, chatIdOrOptions?: string | ExecuteQueryOptions): CancelablePromise<ExecuteResponseWithChatId> => {
  const base = getApiBaseUrl();
  const url = buildUrl(base, '/api/v1/router/execute');

  const opts: ExecuteQueryOptions =
    typeof chatIdOrOptions === 'string'
      ? { chatId: chatIdOrOptions }
      : (chatIdOrOptions ?? {});

  const extracted = extractCodeAsFiles(query);

  const providedContext = (opts.context || {}) as Record<string, unknown>;
  const providedFilesRaw = (providedContext as any).files;
  const providedFiles: Array<{ path: string; content: string }> = Array.isArray(providedFilesRaw)
    ? providedFilesRaw
        .map((f: any) => ({
          path: String(f?.path || ''),
          content: String(f?.content || ''),
        }))
        .filter((f) => f.path.trim() && f.content)
    : [];

  const mergedFiles = (() => {
    const seen = new Map<string, { path: string; content: string }>();
    for (const f of providedFiles) seen.set(f.path, f);
    for (const f of extracted.files) seen.set(f.path, { path: f.path, content: f.content });
    return Array.from(seen.values()).slice(0, 12);
  })();

  const body: ExecuteRequestBody = {
    query,
    persist: true,
    ...(opts.chatId ? { chat_id: opts.chatId } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
    ...(opts.forcedAgentId ? { forced_agent_id: opts.forcedAgentId as any } : {}),
    ...(Object.keys(providedContext).length > 0 || mergedFiles.length > 0
      ? {
          context: {
            ...providedContext,
            ...(mergedFiles.length > 0 ? { files: mergedFiles } : {}),
            ...(!('language' in providedContext) && extracted.inferred_language ? { language: extracted.inferred_language } : {}),
            ...(!('goal' in providedContext) && extracted.goal ? { goal: extracted.goal } : {}),
          },
        }
      : {}),
  };

  return fetchJsonCancelable<ExecuteResponseWithChatId>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

export const routeQuery = async (req: RouteRequest): Promise<RouteResponse> => {
  const base = getApiBaseUrl();
  const url = buildUrl(base, '/api/v1/router/route');
  return await fetchJson<RouteResponse>(url, {
    method: 'POST',
    body: JSON.stringify(req),
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
  persist: boolean = true,
  context: Record<string, unknown> = {},
  outputFormat: string | null = null
): Promise<InvokeAgentResponse> => {
  const base = getApiBaseUrl();
  const url = buildUrl(base, `/api/v1/agents/${encodeURIComponent(agentId)}/invoke`);

  const body: InvokeAgentRequest = {
    agent_id: agentId as any,
    task,
    context,
    ...(outputFormat ? { output_format: outputFormat } : {}),
    ...(chatId ? { chat_id: chatId } : {}),
    persist,
  };

  return await fetchJson<InvokeAgentResponse>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

export const invokeAgentCancelable = (
  agentId: string,
  task: string,
  chatId?: string | null,
  persist: boolean = true,
  context: Record<string, unknown> = {},
  outputFormat: string | null = null
): CancelablePromise<InvokeAgentResponse> => {
  const base = getApiBaseUrl();
  const url = buildUrl(base, `/api/v1/agents/${encodeURIComponent(agentId)}/invoke`);

  const body: InvokeAgentRequest = {
    agent_id: agentId as any,
    task,
    context,
    ...(outputFormat ? { output_format: outputFormat } : {}),
    ...(chatId ? { chat_id: chatId } : {}),
    persist,
  };

  const controller = new AbortController();
  const promise = fetchJson<InvokeAgentResponse>(url, {
    method: 'POST',
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  return { promise, cancel: () => controller.abort() };
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
