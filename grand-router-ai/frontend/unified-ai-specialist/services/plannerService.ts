import type { PlannerProjectPlan } from '../plannerTypes';

// Keep frontend self-contained; no external system prompt import.
const PLANNER_SYSTEM_PROMPT = `You are a project planning assistant. Produce a concise project plan as structured data.`;

type Artifact = {
  type: string;
  // project_plan
  plan?: PlannerProjectPlan;
  // other artifact shapes are ignored by this client
  [k: string]: unknown;
};

type AgentInvokeResponse = {
  agent_id: string;
  status: 'ok' | 'error' | 'needs_clarification';
  artifacts: Artifact[];
  notes?: string[];
  clarifying_questions?: string[];
};

const getApiBaseUrl = (): string => {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (!base || typeof base !== 'string') {
    throw new Error('Missing VITE_API_BASE_URL. Set it in .env.local');
  }
  return base;
};

const buildUrl = (base: string, path: string): string => {
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

const extractProjectPlan = (data: AgentInvokeResponse): PlannerProjectPlan => {
  const artifact = data.artifacts.find((a) => a.type === 'project_plan');
  const plan = artifact?.plan;
  if (!plan) {
    throw new Error('Backend did not return a project_plan artifact with a plan');
  }
  return plan;
};

export const generatePlan = async (userText: string): Promise<PlannerProjectPlan> => {
  const base = getApiBaseUrl();
  // Backend agent lives under services/agents/projplan but is typically registered as 'planner'.
  // If your backend uses 'projplan' instead, update this path/agent_id accordingly.
  const url = buildUrl(base, '/api/v1/agents/planner/invoke');

  const body = {
    api_version: 'v1',
    agent_id: 'planner',
    task: userText,
  };

  const data = await fetchJson<AgentInvokeResponse>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return extractProjectPlan(data);
};
