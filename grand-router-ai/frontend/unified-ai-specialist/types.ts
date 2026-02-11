// Backend-aligned types for the Unified AI Specialist frontend.
// Source of truth:
// - grand-router-ai/shared/src/grand_router_contracts/*.py
// - grand-router-ai/backend/src/grand_router_api/api/v1/*.py
//
// NOTE: The JSON samples under grand-router-ai/samples/ may be stale.

import type { PlannerProjectPlan } from './plannerTypes';

export type ApiVersion = 'v1';

// Keep in sync with backend registry: service_directory/agents.json
export type AgentId = 'codegen' | 'planner';

export type MessageRole = 'user' | 'assistant' | 'system';

export type RoutingMetaMode = 'auto' | 'forced';

export interface RoutingMeta {
  agent_id: AgentId;
  confidence: number; // 0..1
  mode: RoutingMetaMode;
}

export type ArtifactType =
  | 'patch'
  | 'snippet'
  | 'verification_steps'
  | 'project_plan'
  | 'risks'
  | 'next_steps';

export interface PatchArtifact {
  type: 'patch';
  patch: string;
}

export interface SnippetArtifact {
  type: 'snippet';
  snippet: string;
}

export interface VerificationStepsArtifact {
  type: 'verification_steps';
  verification_steps: string[];
}

export interface ProjectPlanArtifact {
  type: 'project_plan';
  plan: PlannerProjectPlan;
}

export interface RisksArtifact {
  type: 'risks';
  // List of strings like "Risk: ... Mitigation: ..."
  risks: string[];
}

export interface NextStepsArtifact {
  type: 'next_steps';
  next_steps: string[];
}

export type Artifact =
  | PatchArtifact
  | SnippetArtifact
  | VerificationStepsArtifact
  | ProjectPlanArtifact
  | RisksArtifact
  | NextStepsArtifact;

export interface Chat {
  chat_id: string;
  title: string;
  created_at: string; // datetime ISO string
  updated_at: string; // datetime ISO string
  pending_continuation?: {
    agent_id: AgentId;
    original_query: string;
    context_snapshot: Record<string, unknown>;
  } | null;
}

export interface Message {
  message_id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  created_at: string; // datetime ISO string
  // Backend contract stores routing_meta as nullable.
  routing_meta: RoutingMeta | null;
  // Backend contract defaults artifacts to [].
  artifacts: Artifact[];
  // Optional UI hints: quick-reply suggestions for clarification flows.
  suggested_replies?: string[] | null;
}

export interface ListChatsResponse {
  api_version?: ApiVersion;
  chats: Chat[];
}

export interface GetChatResponse {
  api_version?: ApiVersion;
  chat: Chat;
  messages: Message[];
}

export type RoutingMode = 'auto' | 'forced';

export interface ExecuteRequest {
  query: string;
  chat_id?: string | null;
  message_id?: string | null;
  context?: Record<string, unknown>;
  mode?: RoutingMode;
  forced_agent_id?: AgentId | null;
  persist?: boolean;
}

export interface RouteItem {
  agent_id: AgentId;
  confidence: number; // 0..1
  subtask: string;
}

export interface RouteResponse {
  api_version?: ApiVersion;
  routes: RouteItem[];
  needs_clarification: boolean;
  clarifying_questions: string[];
  routing_rationale: string | null;
}

export type AgentStatus = 'ok' | 'error' | 'needs_clarification';

export interface AgentInvokeResponse {
  api_version?: ApiVersion;
  agent_id: AgentId;
  status: AgentStatus;
  artifacts: Artifact[];
  notes: string[];
  clarifying_questions: string[];
}

export interface ExecuteResponse {
  api_version?: ApiVersion;
  route_response: RouteResponse;
  agent_response: AgentInvokeResponse | null;
  chat_id?: string | null;
}
