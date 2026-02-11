import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { Artifact, Message as UnifiedMessage } from '../types';
import type { PlannerMessage, PlannerProjectPlan, PlannerTaskStatus } from '../plannerTypes';

import { invokeAgent, persistPlannerPlan } from '../services/apiClient';

import ChatSidebar from './ChatSidebar';
import type { Message as ChatSidebarMessage } from '../types';
import Workspace from './Workspace';

// PlannerView renders artifacts from the unified router flow.

type Props = {
  // The unified app's chat history; we use it to seed the planner prompt + UI messages.
  unifiedMessages: UnifiedMessage[];
  chatId?: string | null;
  onSendMessage?: (text: string) => void;
  isGenerating?: boolean;
};

const toTime = (iso: string | undefined): string => {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const toPlannerMessages = (msgs: UnifiedMessage[]): PlannerMessage[] => {
  // Keep only user/assistant.
  const filtered = msgs.filter((m) => m.role === 'user' || m.role === 'assistant');

  return filtered.map((m, idx) => ({
    id: m.message_id || String(idx),
    text: m.content,
    sender: m.role === 'user' ? 'user' : 'ai',
    timestamp: toTime(m.created_at) || String(idx),
  }));
};

// (legacy) extractLatestPlannerInput was used when PlannerView invoked the planner agent directly.

const findLatestProjectPlan = (msgs: UnifiedMessage[]): PlannerProjectPlan | null => {
  // The backend persists agent artifacts on messages.
  // Planner state updates may be stored as `system` messages to keep the visible chat clean.
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    const arts = m.artifacts || [];
    const a = arts.find((x) => x.type === 'project_plan') as Extract<Artifact, { type: 'project_plan' }> | undefined;
    if (a?.plan) return a.plan;
  }
  return null;
};

const findLatestRisks = (msgs: UnifiedMessage[]): string[] | null => {
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    const arts = m.artifacts || [];
    const a = arts.find((x) => x.type === 'risks') as Extract<Artifact, { type: 'risks' }> | undefined;
    if (a?.risks && a.risks.length > 0) return a.risks;
  }
  return null;
};

export const PlannerView: React.FC<Props> = ({ unifiedMessages, chatId, onSendMessage, isGenerating = false }) => {
  const [plan, setPlan] = useState<PlannerProjectPlan | null>(null);
  const [risks, setRisks] = useState<string[] | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // ChatSidebar expects unified Message[] (with created_at, routing_meta, etc).
  // Planner UI “messages” are a different shape; keep them separate.
  const plannerMessages = useMemo(() => toPlannerMessages(unifiedMessages), [unifiedMessages]);
  const messages: ChatSidebarMessage[] = unifiedMessages;

  // When the unified chat history changes, try to sync plan from latest artifact.
  useEffect(() => {
    const p = findLatestProjectPlan(unifiedMessages);
    if (p) {
      setPlan(p);
      setIsDirty(false);
    }

    const r = findLatestRisks(unifiedMessages);
    if (r) setRisks(r);
  }, [unifiedMessages]);

  useEffect(() => {
    if (!chatId) return;
    if (!plan) return;
    if (!isDirty) return;

    const t = window.setTimeout(() => {
      void persistPlannerPlan(chatId, plan, risks);
      setIsDirty(false);
    }, 700);

    return () => window.clearTimeout(t);
  }, [chatId, plan, risks, isDirty]);

  const calculateProgress = useCallback((phases: any[]) => {
    const allTasks = phases.flatMap((p: any) => p.tasks);
    if (allTasks.length === 0) return 0;
    const completedTasks = allTasks.filter((t: any) => t.status === 'done' || t.completed).length;
    return Math.round((completedTasks / allTasks.length) * 100);
  }, []);

  const handleSendMessage = useCallback(
    async (text: string) => {
      // Planner side-chat must NOT go through router (no re-routing).
      // If we have a chatId, invoke planner directly and persist into the same chat.
      if (chatId) {
        await invokeAgent('planner', text, chatId, true);
        return;
      }

      // Fallback: if no chat exists yet, let the unified routing flow create one.
      if (!onSendMessage) return;
      onSendMessage(text);
    },
    [chatId, onSendMessage]
  );

  const handleToggleTask = useCallback((phaseId: string, taskId: string) => {
    setPlan((prev) => {
      if (!prev) return null;

      const newPhases = prev.phases.map((phase) => {
        if (phase.id !== phaseId) return phase;
        return {
          ...phase,
          tasks: phase.tasks.map((task) => {
            if (task.id !== taskId) return task;
            const isDone = task.status !== 'done';
            return {
              ...task,
              completed: isDone,
              status: (isDone ? 'done' : 'todo') as PlannerTaskStatus,
            };
          }),
        };
      });

      return {
        ...prev,
        phases: newPhases,
        currentProgress: calculateProgress(newPhases),
      };
    });

    setIsDirty(true);
  }, [calculateProgress]);

  const handleUpdateTaskStatus = useCallback(
    (phaseId: string, taskId: string, status: PlannerTaskStatus) => {
      setPlan((prev) => {
        if (!prev) return null;

        const newPhases = prev.phases.map((phase) => {
          if (phase.id !== phaseId) return phase;
          return {
            ...phase,
            tasks: phase.tasks.map((task) => {
              if (task.id !== taskId) return task;
              return { ...task, status, completed: status === 'done' };
            }),
          };
        });

        return {
          ...prev,
          phases: newPhases,
          currentProgress: calculateProgress(newPhases),
        };
      });

      setIsDirty(true);
    },
    [calculateProgress]
  );

  // If we do not have a plan artifact yet, we wait for the unified router flow
  // to return an assistant message with a `project_plan` artifact.
  // (No direct backend calls from this view.)
  useEffect(() => {
    // no-op (kept to document intent)
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden bg-beige-bg font-display text-text-main">
      <ChatSidebar
        messages={messages}
        onSendMessage={handleSendMessage}
        isGenerating={isGenerating}
        routedLabel="Project Planner"
        inputPlaceholder="Refine the plan..."
      />
      <Workspace plan={plan} risks={risks} onToggleTask={handleToggleTask} onUpdateTaskStatus={handleUpdateTaskStatus} />
    </div>
  );
};

export default PlannerView;
