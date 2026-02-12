import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { PatchTabs } from './components/PatchTabs';
import type { Chat, ContextFile, Message } from './types';
import { deleteChat, executeQueryCancelable, getChat, invokeAgent, invokeAgentCancelable, listChats, routeQuery } from './services/apiClient';
import HistoryView from './components/HistoryView';
import PlannerView from './components/PlannerView';
import CodegenView from './components/CodegenView';

// Icons
const HistoryIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </svg>
);

const SendIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNewChat: () => void;
  chats: Chat[];
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  currentChatId: string | null;
}

const formatDayBucket = (iso: string): 'TODAY' | 'YESTERDAY' | 'OLDER' => {
  const t = new Date(iso);
  const ts = Number.isNaN(t.getTime()) ? Date.now() : t.getTime();
  const today = new Date().setHours(0, 0, 0, 0);
  const yesterday = today - 86400000;
  if (ts >= today) return 'TODAY';
  if (ts >= yesterday) return 'YESTERDAY';
  return 'OLDER';
};

const HistorySidebar: React.FC<HistorySidebarProps> = ({
  isOpen,
  onClose,
  onNewChat,
  chats,
  onSelectChat,
  onDeleteChat,
  currentChatId,
}) => {
  const groupedChats = useMemo(() => {
    const groups: Record<'TODAY' | 'YESTERDAY' | 'OLDER', Chat[]> = { TODAY: [], YESTERDAY: [], OLDER: [] };
    for (const c of chats) {
      groups[formatDayBucket(c.updated_at)].push(c);
    }
    return groups;
  }, [chats]);

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/30 backdrop-blur-[2px] z-[60] transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 left-0 h-full w-[320px] bg-[#FDFBF7] dark:bg-[#1C1917] shadow-2xl z-[70] transform transition-transform duration-300 ease-out flex flex-col ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-6 py-6 border-b border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors text-gray-400">
            <CloseIcon />
          </button>
          <h2 className="text-gray-400 font-bold text-xs tracking-[0.3em] uppercase">History</h2>
          <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-8">
          {chats.length > 0 ? (
            <div className="space-y-10">
              {(Object.keys(groupedChats) as Array<keyof typeof groupedChats>).map((group) =>
                groupedChats[group].length > 0 ? (
                  <div key={group}>
                    <h3 className="text-gray-400 text-[11px] font-bold tracking-widest mb-6">{group}</h3>
                    <div className="space-y-4">
                      {groupedChats[group].map((chat) => (
                        <div
                          key={chat.chat_id}
                          className={`flex items-center gap-4 group transition-all p-2 -m-2 rounded-xl ${currentChatId === chat.chat_id ? 'bg-black/[0.03] dark:bg-white/[0.03]' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'}`}
                        >
                          <button
                            onClick={() => {
                              onSelectChat(chat.chat_id);
                              onClose();
                            }}
                            className="size-10 shrink-0 rounded-2xl flex items-center justify-center bg-slate-50 text-slate-400 shadow-sm ring-1 ring-black/5 transition-transform group-hover:scale-105"
                            title="Open chat"
                          >
                            {(() => {
                              // Prefer persisted routing signal (more reliable than title heuristics).
                              const routed = chat.routed_agent_id ? String(chat.routed_agent_id).toLowerCase() : '';
                              const pending = chat.pending_continuation?.agent_id ? String(chat.pending_continuation.agent_id).toLowerCase() : '';
                              const meta = routed || pending;
                              const isPlannerByMeta = meta === 'planner' || meta === 'planchat' || meta === 'projplan';

                              // Fallback: title heuristic for older chats.
                              const t = (chat.title || '').toLowerCase();
                              const isPlannerByTitle =
                                t.includes('plan') || t.includes('roadmap') || t.includes('mvp') || t.includes('project') || t.includes('planner');

                              const isPlanner = isPlannerByMeta || isPlannerByTitle;

                              return isPlanner ? (
                                // Planner: keep existing icon (clipboard/checklist in a chat bubble)
                                <svg
                                  width="20"
                                  height="20"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M9 3h6a2 2 0 0 1 2 2v1h-2.5a2.5 2.5 0 0 1-5 0H7V5a2 2 0 0 1 2-2z" />
                                  <path d="M7 6h10v12a2 2 0 0 1-2 2H9l-4 4V8a2 2 0 0 1 2-2z" />
                                  <path d="M9 12h6" />
                                  <path d="M9 15h4" />
                                  <path d="M9 9h6" />
                                </svg>
                              ) : (
                                // Code chats: render ONLY the code icon (no extra bubble/badge/overlay)
                                <svg
                                  width="20"
                                  height="20"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M16 18l6-6-6-6" />
                                  <path d="M8 6l-6 6 6 6" />
                                </svg>
                              );
                            })()}
                          </button>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-[#4A403A] dark:text-gray-200 font-semibold text-sm truncate">{chat.title}</h4>
                            <p className="text-gray-400 text-xs truncate mt-0.5">Updated: {new Date(chat.updated_at).toLocaleString()}</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteChat(chat.chat_id);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold text-rose-600 hover:text-rose-700 px-2 py-1 rounded-lg hover:bg-rose-50"
                            title="Delete chat"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <span className="text-sm font-medium opacity-60">No history yet</span>
            </div>
          )}
        </div>

        <div className="p-6">
          <button
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="w-full bg-[#4A403A] text-white py-4 rounded-xl font-medium flex items-center justify-center gap-3 hover:bg-[#3D3530] transition-all shadow-md active:scale-[0.98]"
          >
            <PlusIcon />
            <span className="text-sm">New Chat</span>
          </button>
        </div>
      </aside>
    </>
  );
};

const getMostRecentlyUpdatedChat = (chats: Chat[]): Chat | null => {
  if (chats.length === 0) return null;
  return (
    [...chats].sort((a, b) => {
      const au = a.updated_at ?? a.created_at;
      const bu = b.updated_at ?? b.created_at;
      return new Date(bu).getTime() - new Date(au).getTime();
    })[0] || null
  );
};

const App: React.FC = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingContinuation, setPendingContinuation] = useState<Chat['pending_continuation']>(null);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const activeRequestCancelRef = useRef<null | (() => void)>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // While router.execute is in-flight for the *current* user submit, keep the UI neutral
  // until we have a route decision for that interaction.
  const [pendingRoutedAgentId, setPendingRoutedAgentId] = useState<'codegen' | 'planner' | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [codegenContextFiles, setCodegenContextFiles] = useState<ContextFile[]>([]);
  const codegenContextFilesRef = useRef<ContextFile[]>([]);
  const [globalContextFiles, setGlobalContextFiles] = useState<ContextFile[]>([]);
  const globalContextFilesRef = useRef<ContextFile[]>([]);

  const mergeContextFiles = useCallback((a: ContextFile[], b: ContextFile[]): ContextFile[] => {
    const seen = new Map<string, ContextFile>();
    for (const f of a || []) {
      if (f?.path) seen.set(f.path, f);
    }
    for (const f of b || []) {
      if (f?.path) seen.set(f.path, f);
    }
    return Array.from(seen.values()).slice(0, 12);
  }, []);

  const setGlobalContextFilesSafe = useCallback((next: ContextFile[]) => {
    const n = Array.isArray(next) ? next : [];
    globalContextFilesRef.current = n;
    setGlobalContextFiles(n);
  }, []);

  const setCodegenContextFilesSafe = useCallback((next: ContextFile[]) => {
    const n = Array.isArray(next) ? next : [];
    codegenContextFilesRef.current = n;
    setCodegenContextFiles(n);
  }, []);

  const handlePickGlobalFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      const loaded = await Promise.all(
        files.map(async (f) => {
          const text = await f.text();
          const p = (f as any).webkitRelativePath || f.name;
          return { path: String(p || f.name), content: text } as ContextFile;
        })
      );
      setGlobalContextFiles((prev) => {
        const next = mergeContextFiles(prev, loaded);
        globalContextFilesRef.current = next;
        return next;
      });
    },
    [mergeContextFiles]
  );

  // Map side-chat agents (codechat/planchat) to their owning workspace mode.
  // This prevents the UI from flipping modes after a sidebar Q&A response.
  const normalizeAgentIdToMode = useCallback(
    (agentId: unknown): 'codegen' | 'planner' | null => {
      const a = String(agentId || '').toLowerCase();
      if (!a) return null;
      if (a === 'planner' || a === 'planchat' || a === 'projplan') return 'planner';
      if (a === 'codegen' || a === 'codechat') return 'codegen';
      return null;
    },
    []
  );

  const routingStatuses = useMemo(
    () => ['Detecting intent…', 'Checking context…', 'Selecting best agent…', 'Warming up tools…', 'Finalizing route…'],
    []
  );
  const [routingStatusIndex, setRoutingStatusIndex] = useState(0);

  const refreshChats = useCallback(async () => {
    const next = await listChats();
    setChats(next);
    return next;
  }, []);

  const loadChatMessages = useCallback(async (chatId: string) => {
    const res = await getChat(chatId);
    setMessages(res.messages);
    setPendingContinuation(res.chat.pending_continuation ?? null);
  }, []);

  const lastAssistantRoutedAgentId = useMemo(() => {
    // Prefer inferring mode from the latest "work product" artifact.
    // This is more reliable than routing_meta because planner state updates are persisted
    // as `system` messages (and some chats can contain mixed agent messages).
    const artifactMode = (() => {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const arts = messages[i]?.artifacts || [];
        if (arts.some((a) => a.type === 'project_plan')) return 'planner' as const;
        if (arts.some((a) => a.type === 'patch' || a.type === 'snippet')) return 'codegen' as const;
      }
      return null;
    })();

    if (artifactMode) return artifactMode;

    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    return normalizeAgentIdToMode(lastAssistant?.routing_meta?.agent_id ?? null);
  }, [messages, normalizeAgentIdToMode]);

  // When routing is pending for a new submit, stay neutral until we learn the route.
  // Once resolved, prefer the most recent route decision for the in-flight request,
  // otherwise fall back to the last persisted assistant routing_meta.
  const effectiveRoutedAgentId = isRouting ? pendingRoutedAgentId : pendingRoutedAgentId ?? lastAssistantRoutedAgentId;

  useEffect(() => {
    void (async () => {
      try {
        // On refresh, do not auto-open the last chat; just populate the list.
        await refreshChats();
      } catch (e) {
        console.error('Failed to load chats:', e);
      }
    })();
  }, [refreshChats]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handleNewChat = () => {
    setCurrentChatId(null);
    setMessages([]);
    setPendingContinuation(null);
    setInput('');
    setPendingRoutedAgentId(null);
    setIsRouting(false);
  };

  const handleSelectChat = useCallback(
    async (id: string) => {
      setCurrentChatId(id);
      setPendingRoutedAgentId(null);
      setIsRouting(false);
      try {
        await loadChatMessages(id);
      } catch (e) {
        console.error('Failed to load chat:', e);
      }
    },
    [loadChatMessages]
  );

  const autosizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;

    // Reset then set to scrollHeight for auto-grow.
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, 240);
    el.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    autosizeTextarea();
  }, [input, autosizeTextarea]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent, customPrompt?: string) => {
      if (e) e.preventDefault();
      const userPrompt = (customPrompt ?? input).trimEnd();
      if (!userPrompt.trim() || isLoading) return;

      if (!customPrompt) setInput('');
      setIsLoading(true);
      setIsRouting(true);
      setPendingRoutedAgentId(null);
      activeRequestCancelRef.current = null;

      // Optimistic user message
      const optimisticUser: Message = {
        message_id: `local-${Date.now()}`,
        chat_id: currentChatId || 'pending',
        role: 'user',
        content: userPrompt,
        created_at: new Date().toISOString(),
        routing_meta: null,
        artifacts: [],
      };
      setMessages((prev) => [...prev, optimisticUser]);

      try {
        const extracted = (await import('./services/codeExtract.ts')).extractCodeAsFiles(userPrompt);

        // Optional file context (global attach + codegen attach + inline fenced blocks).
        const mergedFiles = mergeContextFiles(
          mergeContextFiles(globalContextFilesRef.current, codegenContextFilesRef.current),
          extracted.files
        );

        if (extracted.files.length > 0) {
          console.log('[codeExtract] attached context.files', {
            count: extracted.files.length,
            source: extracted.source,
            language: extracted.inferred_language,
            goal: extracted.goal,
            filenames: extracted.files.map((f) => f.path),
          });
        }

        const q = (userPrompt || '').trim().toLowerCase();
        const looksLikeQuestion =
          q.includes('?') ||
          q.startsWith('what ') ||
          q.startsWith('why ') ||
          q.startsWith('how ') ||
          q.startsWith('when ') ||
          q.startsWith('where ') ||
          q.startsWith('can you ') ||
          q.includes('explain') ||
          q.includes('meaning') ||
          q.includes('difference');

        const looksLikeChangeRequest =
          q.includes('patch') ||
          q.includes('fix') ||
          q.includes('implement') ||
          q.includes('refactor') ||
          q.includes('add ') ||
          q.includes('remove ') ||
          q.includes('update ') ||
          q.includes('modify ');

        const forceCodeChat = looksLikeQuestion && !looksLikeChangeRequest;

        // UI-first routing: as soon as the backend selects an agent, switch the UI mode
        // immediately (without waiting for the full /execute to finish). This is purely
        // a UX optimization; the actual work is still done by /execute.
        try {
          const contextForRouting =
            mergedFiles.length > 0
              ? {
                  files: mergedFiles.map((f) => ({ path: f.path, content: f.content })),
                  ...(extracted.inferred_language ? { language: extracted.inferred_language } : {}),
                  ...(extracted.goal ? { goal: extracted.goal } : {}),
                }
              : {};

          const routeResp = await routeQuery({
            query: userPrompt,
            ...(currentChatId ? { chat_id: currentChatId } : {}),
            ...(Object.keys(contextForRouting).length > 0 ? { context: contextForRouting } : {}),
            ...(forceCodeChat ? { selected_agent_id: 'codechat' as any } : {}),
          });

          const routed = routeResp?.routes?.[0]?.agent_id;
          const routedMode = normalizeAgentIdToMode(routed);
          if (routedMode) setPendingRoutedAgentId(routedMode);
        } catch (e) {
          // Best-effort: if /route fails, fall back to the /execute result.
          console.warn('routeQuery failed (continuing with execute):', e);
        }

        const { promise, cancel } = executeQueryCancelable(userPrompt, {
          chatId: currentChatId ?? undefined,
          ...(forceCodeChat ? { mode: 'forced', forcedAgentId: 'codechat' } : {}),
          ...(mergedFiles.length > 0 ? { context: { files: mergedFiles } } : {}),
        });
        activeRequestCancelRef.current = cancel;
        const exec = await promise;
        const routed = exec.route_response?.routes?.[0]?.agent_id;
        const routedMode = normalizeAgentIdToMode(routed);
        if (routedMode) setPendingRoutedAgentId(routedMode);

        // Always prefer server-returned chat_id going forward.
        // This is required for clarification continuations and any multi-turn persistence.
        const serverChatId = exec.chat_id ?? null;
        if (serverChatId) {
          setCurrentChatId(serverChatId);
        }

        // Refresh chats + load messages. If serverChatId is available, load it directly;
        // otherwise fall back to most-recent heuristic for backward compatibility.
        const nextChats = await refreshChats();
        const targetChatId = serverChatId ?? getMostRecentlyUpdatedChat(nextChats)?.chat_id ?? null;
        if (targetChatId) {
          await loadChatMessages(targetChatId);
          // Once messages are loaded from persistence, routing_meta becomes the source of truth.
          setPendingRoutedAgentId(null);
        }
      } catch (error) {
        if ((error as any)?.name === 'AbortError') {
          // User cancelled.
          return;
        }
        console.error('Execute failed:', error);
        const errMsg: Message = {
          message_id: `local-err-${Date.now()}`,
          chat_id: currentChatId || 'pending',
          role: 'assistant',
          content: 'Oops! Something went wrong while calling the backend router.',
          created_at: new Date().toISOString(),
          routing_meta: null,
          artifacts: [],
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        activeRequestCancelRef.current = null;
        setIsLoading(false);
        setIsRouting(false);
      }
    },
    [
      input,
      isLoading,
      currentChatId,
      refreshChats,
      loadChatMessages,
      mergeContextFiles,
      normalizeAgentIdToMode,
    ]
  );

  const handleCancelActiveRequest = useCallback(() => {
    try {
      activeRequestCancelRef.current?.();
    } finally {
      activeRequestCancelRef.current = null;
      setIsRouting(false);
      setIsLoading(false);
    }
  }, []);

  const handleDirectInvoke = useCallback(
    async (opts: { agentId: 'planner' | 'codegen' | 'codechat' | 'planchat'; text: string; context?: Record<string, unknown> }) => {
      if (!currentChatId) return;
      const userPrompt = (opts.text || '').trimEnd();
      if (!userPrompt.trim() || isLoading) return;

      setIsLoading(true);

      const optimisticUser: Message = {
        message_id: `local-side-${Date.now()}`,
        chat_id: currentChatId,
        role: 'user',
        content: userPrompt,
        created_at: new Date().toISOString(),
        routing_meta: null,
        artifacts: [],
      };

      const placeholderAssistantId = `local-side-assistant-${Date.now()}`;
      const optimisticAssistant: Message = {
        message_id: placeholderAssistantId,
        chat_id: currentChatId,
        role: 'assistant',
        content: 'Thinking...',
        created_at: new Date().toISOString(),
        routing_meta: null,
        artifacts: [],
      };

      setMessages((prev) => [...prev, optimisticUser, optimisticAssistant]);

      const { promise, cancel } = invokeAgentCancelable(opts.agentId, userPrompt, currentChatId, true, opts.context ?? {});
      activeRequestCancelRef.current = cancel;

      try {
        await promise;
        await loadChatMessages(currentChatId);
      } catch (e) {
        if ((e as any)?.name === 'AbortError') {
          setMessages((prev) =>
            prev.map((m) =>
              m.message_id === placeholderAssistantId
                ? { ...m, content: 'Request cancelled.' }
                : m
            )
          );
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.message_id === placeholderAssistantId
                ? { ...m, content: 'Oops! Something went wrong while calling the backend agent.' }
                : m
            )
          );
        }
      } finally {
        activeRequestCancelRef.current = null;
        setIsLoading(false);
      }
    },
    [currentChatId, isLoading, loadChatMessages]
  );

  const isChatActive = messages.length > 0;
  const shouldShowNeutralRoutingScreen = isChatActive && isRouting && !pendingRoutedAgentId;
  const shouldShowClarificationScreen = Boolean(pendingContinuation);

  const clarificationTargetMode = useMemo(() => {
    return normalizeAgentIdToMode(pendingContinuation?.agent_id ?? null);
  }, [pendingContinuation, normalizeAgentIdToMode]);

  useEffect(() => {
    if (!shouldShowNeutralRoutingScreen) {
      setRoutingStatusIndex(0);
      return;
    }

    const t = window.setInterval(() => {
      setRoutingStatusIndex((i) => (i + 1) % routingStatuses.length);
    }, 1150);

    return () => window.clearInterval(t);
  }, [shouldShowNeutralRoutingScreen, routingStatuses.length]);

  // Global routing input should appear ONLY on the landing / new-chat screen.
  // Once a chat is active and routed (planner OR codegen), the active mode view
  // must own its input (planner sidebar / codegen sidebar).
  // Global routing input should appear on the landing / new-chat screen.
  // During clarification, prefer answering in the chosen agent UI when available;
  // otherwise fall back to the global input.
  const shouldShowGlobalRoutingInput = !isChatActive || (shouldShowClarificationScreen && !clarificationTargetMode);

  const getClarificationQuestions = useCallback((): string[] => {
    if (!shouldShowClarificationScreen) return [];

    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const raw = (lastAssistant?.content || '').trim();
    if (!raw) return [];

    // Backend stores clarifying questions as newline-separated text.
    const qs = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return qs.slice(0, 8);
  }, [messages, shouldShowClarificationScreen]);

  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      try {
        await deleteChat(chatId);
        const nextChats = await refreshChats();

        if (currentChatId === chatId) {
          // If the current chat was deleted, go back to main screen.
          setCurrentChatId(null);
          setMessages([]);
          setInput('');
        } else {
          // If another chat was deleted, keep current view as-is.
          // (Optionally we could validate currentChatId exists, but keep minimal.)
          void nextChats;
        }
      } catch (e) {
        console.error('Failed to delete chat:', e);
      }
    },
    [currentChatId, refreshChats]
  );

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-[#FDFBF7] dark:bg-[#1C1917]">
      <HistorySidebar
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onNewChat={handleNewChat}
        chats={chats}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        currentChatId={currentChatId}
      />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 absolute top-0 w-full z-20 bg-[#FDFBF7]/80 dark:bg-[#1C1917]/80 backdrop-blur-md">
        <div className="flex items-center gap-5">
          <div className="flex items-center">
            <button onClick={() => setIsHistoryOpen(true)} className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
              <HistoryIcon />
            </button>
            <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-3"></div>
          </div>
          <div className="flex flex-col">
            <h1 className="text-[#2D2424] dark:text-white font-bold text-lg leading-tight">Unified AI Specialist</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="size-2 rounded-full bg-[#A3E635]"></span>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Backend Router</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Hide mode indicator on base/landing screen (no active chat). */}
          {isChatActive && (
            <div className="hidden sm:flex items-center gap-2 mr-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Mode</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-[#2D2424] dark:text-gray-200">
                {(() => {
                  return effectiveRoutedAgentId === 'planner' ? 'Project Planner' : 'CodeGen';
                })()}
              </span>
            </div>
          )}
          <button className="size-9 rounded-full overflow-hidden border border-gray-100 ring-2 ring-white/50">
            <img src="https://picsum.photos/seed/profile/100/100" className="w-full h-full object-cover" />
          </button>
        </div>
      </header>

      <main className="flex-1 w-full pt-24 pb-40 px-6">
        {!isChatActive ? (
          <div className="max-w-3xl mx-auto h-full flex flex-col items-center justify-center text-center space-y-8">
            <div className="relative group">
              <div className="absolute -inset-1.5 bg-primary/40 rounded-[2rem] blur-2xl opacity-40 group-hover:opacity-60 transition duration-1000 group-hover:duration-200 animate-pulse"></div>
              <div className="absolute -inset-4 bg-primary/20 rounded-[2.5rem] blur-3xl opacity-20 group-hover:opacity-40 transition duration-1000"></div>

              <div className="relative size-24 rounded-3xl bg-white dark:bg-gray-800 flex items-center justify-center text-primary shadow-[0_10px_30px_-5px_rgba(255,142,114,0.4)] border border-primary/20 transition-transform hover:scale-105 duration-300">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="filter drop-shadow-[0_0_8px_rgba(255,142,114,0.6)]"
                >
                  <circle cx="12" cy="12" r="3" />
                  <circle cx="19" cy="5" r="2" />
                  <circle cx="5" cy="19" r="2" />
                  <circle cx="19" cy="19" r="2" />
                  <circle cx="5" cy="5" r="2" />
                  <path d="M12 9V5" />
                  <path d="M12 15v4" />
                  <path d="M15 12h4" />
                  <path d="M9 12H5" />
                </svg>
              </div>
            </div>

            <div className="space-y-4 animate-fade-in-up">
              <h2 className="text-4xl sm:text-5xl font-extrabold text-[#2D2424] dark:text-white tracking-tight leading-tight">How can I help you today?</h2>
              <p className="text-gray-500 max-w-sm mx-auto font-medium text-lg">I route your query to backend agents and persist chats on the server.</p>
            </div>
          </div>
        ) : (
          // When the backend routes to the planner agent, render the Planner UI.
          // Otherwise, render the standard codegen workspace (chat + patch/snippet view).
          <div className="h-[calc(100vh-9.5rem)] min-h-0">
            {(() => {
              // If we already submitted a clarification answer, the backend will clear
              // pending_continuation after it finishes. During that in-flight window,
              // show the routing/progress UI instead of keeping the user stuck on the
              // clarification panel.
              if (shouldShowClarificationScreen && !isRouting && !clarificationTargetMode) {
                // If the router did not provide a specific target agent, keep the dedicated
                // clarification panel as a safe fallback.

                const qs = getClarificationQuestions();
                const suggestions: Array<{ label: string; value: string }> = [];

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full min-h-0">
                    <div className="min-h-0 overflow-y-auto pr-1 rounded-2xl border border-black/5 bg-white/70 dark:bg-[#26201C]/60 shadow-[0_18px_45px_-30px_rgba(0,0,0,0.35)] ring-1 ring-white/60 dark:ring-white/10 backdrop-blur-md">
                      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/5 bg-white/70 dark:bg-[#26201C]/60 px-4 py-3 backdrop-blur-md">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-500 dark:text-gray-300">Conversation</div>
                        <div className="text-[11px] text-gray-400 dark:text-gray-400">Context preserved</div>
                      </div>
                      <div className="p-4">
                        <HistoryView messages={messages} />
                      </div>
                    </div>

                    <div className="min-h-0 overflow-y-auto rounded-2xl border border-black/5 bg-white/70 dark:bg-[#26201C]/60 shadow-[0_18px_45px_-30px_rgba(0,0,0,0.35)] ring-1 ring-white/60 dark:ring-white/10 backdrop-blur-md">
                      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/5 bg-white/70 dark:bg-[#26201C]/60 px-4 py-3 backdrop-blur-md">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-500 dark:text-gray-300">Clarification</div>
                        <div className="text-[11px] text-gray-400 dark:text-gray-400">Answer to continue</div>
                      </div>
                      <div className="p-6 space-y-6">
                        <div>
                          <div className="text-[#2D2424] dark:text-white text-xl font-semibold tracking-tight">A few quick questions</div>
                          <p className="text-sm text-gray-500 dark:text-gray-300 mt-1">
                            Answer what you can. Short responses are fine.
                          </p>
                        </div>

                        <div className="rounded-2xl border border-black/5 bg-white/50 dark:bg-white/5 p-5">
                          {qs.length > 0 ? (
                            <ol className="space-y-3 text-sm text-[#2D2424] dark:text-gray-100">
                              {qs.map((q, idx) => (
                                <li key={idx} className="leading-relaxed">
                                  <span className="font-semibold text-gray-400 mr-2">{idx + 1}.</span>
                                  {q}
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <div className="text-sm text-gray-500 dark:text-gray-300">No structured questions found. Reply with any missing details and I’ll continue.</div>
                          )}
                        </div>

                        {suggestions.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {suggestions.map((s) => (
                              <button
                                key={s.label}
                                type="button"
                                onClick={() => void handleSubmit(undefined, s.value)}
                                disabled={isLoading}
                                className="px-4 py-2 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-[#2D2424] text-xs font-bold uppercase tracking-widest shadow-sm active:scale-[0.98] disabled:opacity-50"
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500">
                            Reply in your own words to continue.
                          </div>
                        )}

                        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
                          <div className="text-[11px] font-black uppercase tracking-widest text-primary">Tip</div>
                          <div className="text-sm text-[#2D2424] mt-1">
                            You don’t need to answer everything at once. Start with the most important constraint (deadline, platform, integrations), and we’ll iterate.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              if (shouldShowNeutralRoutingScreen) {
                const stepLabel = routingStatuses[routingStatusIndex] || 'Working…';
                const progress = Math.min(92, 22 + routingStatusIndex * 18);
                return (
                  <div className="h-full min-h-0 rounded-2xl border border-black/5 bg-white/70 dark:bg-[#26201C]/60 shadow-[0_18px_45px_-30px_rgba(0,0,0,0.35)] ring-1 ring-white/60 dark:ring-white/10 overflow-hidden backdrop-blur-md">
                    <div className="sticky top-0 z-10 border-b border-black/5 bg-white/70 dark:bg-[#26201C]/60 px-4 py-3 backdrop-blur-md">
                      <div className="flex items-center justify-between gap-4">
                        <div className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/60 dark:bg-white/5 px-3 py-1 text-[11px] font-semibold tracking-wide text-gray-500 dark:text-gray-300">
                          <span className="relative inline-flex size-2">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-primary/40 opacity-70 animate-ping" />
                            <span className="relative inline-flex size-2 rounded-full bg-primary/70" />
                          </span>
                          Routing
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-300 font-medium" aria-live="polite">
                          {stepLabel}
                        </div>
                      </div>

                      <div className="mt-3 h-1 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary/55 via-primary/75 to-primary/55 transition-[width] duration-500 ease-out"
                          style={{ width: `${progress}%` }}
                          aria-hidden="true"
                        />
                      </div>
                    </div>

                    <div className="h-full min-h-0 overflow-y-auto p-4">
                      <HistoryView messages={messages} />
                    </div>
                  </div>
                );
              }

                const resolvedMode = clarificationTargetMode ?? effectiveRoutedAgentId;

                if (resolvedMode === 'planner' || resolvedMode === 'fullstack') {
                  return (
                    <PlannerView
                      unifiedMessages={messages}
                      chatId={currentChatId}
                      onInitialRoutedSendMessage={(t) => void handleSubmit(undefined, t)}
                      onDirectSendMessage={async (t) => {
                        const q = (t || '').trim().toLowerCase();
                        const looksLikeQuestion =
                          q.includes('?') ||
                          q.startsWith('what ') ||
                          q.startsWith('why ') ||
                          q.startsWith('how ') ||
                          q.startsWith('when ') ||
                          q.startsWith('where ') ||
                          q.startsWith('can you ') ||
                          q.includes('explain') ||
                          q.includes('meaning') ||
                          q.includes('difference');

                        const looksLikeChangeRequest =
                          q.includes('update ') ||
                          q.includes('change ') ||
                          q.includes('modify ') ||
                          q.includes('add ') ||
                          q.includes('remove ') ||
                          q.includes('refine ') ||
                          q.includes('adjust ');

                        const agent: 'planner' | 'planchat' = looksLikeQuestion && !looksLikeChangeRequest ? 'planchat' : 'planner';

                        const latestPlan = (() => {
                          for (let i = messages.length - 1; i >= 0; i -= 1) {
                            const m = messages[i];
                            const a = (m.artifacts || []).find((x) => x.type === 'project_plan') as any;
                            if (a?.plan) return a.plan;
                          }
                          return null;
                        })();

                        const latestRisks = (() => {
                          for (let i = messages.length - 1; i >= 0; i -= 1) {
                            const m = messages[i];
                            const a = (m.artifacts || []).find((x) => x.type === 'risks') as any;
                            if (a?.risks && Array.isArray(a.risks)) return a.risks;
                          }
                          return null;
                        })();

                        const ctx = agent === 'planchat' && latestPlan ? { last_project_plan: latestPlan, last_risks: latestRisks } : {};
                        await handleDirectInvoke({ agentId: agent as any, text: t, context: ctx });
                      }}
                      isGenerating={isLoading}
                      onCancelGenerating={handleCancelActiveRequest}
                    />
                  );
                }

                return (
                  <div className="h-full min-h-0">
                    <CodegenView
                      messages={messages}
                      chatId={currentChatId}
                      isGenerating={isLoading}
                      onInitialRoutedSendMessage={(t) => void handleSubmit(undefined, t)}
                      onCancelGenerating={handleCancelActiveRequest}
                      onFilesChange={(files) => {
                        setCodegenContextFilesSafe(files);
                      }}
                      onDirectSendMessage={async (t) => {
                      const q = (t || '').trim().toLowerCase();
                      const looksLikeQuestion =
                        q.includes('?') ||
                        q.startsWith('what ') ||
                        q.startsWith('why ') ||
                        q.startsWith('how ') ||
                        q.startsWith('when ') ||
                        q.startsWith('where ') ||
                        q.startsWith('can you ') ||
                        q.includes('explain') ||
                        q.includes('meaning') ||
                        q.includes('difference');

                      const looksLikeChangeRequest =
                        q.includes('patch') ||
                        q.includes('fix') ||
                        q.includes('implement') ||
                        q.includes('refactor') ||
                        q.includes('add ') ||
                        q.includes('remove ') ||
                        q.includes('update ') ||
                        q.includes('modify ');

                      const agent: 'codechat' | 'codegen' = looksLikeQuestion && !looksLikeChangeRequest ? 'codechat' : 'codegen';

                      const attachedFiles = mergeContextFiles(globalContextFilesRef.current, codegenContextFilesRef.current);

                      // Inject the latest patch/snippet artifact so Q&A can be precise even
                      // when the backend chat memory doesn't include snippet artifacts.
                      const latestPatchOrSnippet = (() => {
                        const assistantMsgs = [...messages].filter((m) => m.role === 'assistant');
                        for (let i = assistantMsgs.length - 1; i >= 0; i -= 1) {
                          const a = assistantMsgs[i];
                          const patch = (a.artifacts || []).find((x) => x.type === 'patch') as any;
                          if (patch && (patch.patch || '').trim()) return String(patch.patch).trim();
                          const snippet = (a.artifacts || []).find((x) => x.type === 'snippet') as any;
                          if (snippet && (snippet.snippet || '').trim()) return String(snippet.snippet).trim();
                        }
                        return '';
                      })();

                      const ctx = {
                        ...(agent === 'codechat' && latestPatchOrSnippet ? { last_patch: latestPatchOrSnippet } : {}),
                        ...(attachedFiles.length > 0 ? { files: attachedFiles } : {}),
                      };
                      await handleDirectInvoke({ agentId: agent, text: t, context: ctx });
                      }}
                    />
                  </div>
                );
            })()}
          </div>
        )}

        {shouldShowGlobalRoutingInput && (
          <div className="fixed inset-x-0 bottom-0 z-30 px-6 pb-6">
            <div className="max-w-3xl mx-auto">
              <form onSubmit={(e) => void handleSubmit(e)} className="relative">
                <div className="absolute inset-0 -top-3 -bottom-3 bg-gradient-to-t from-[#FDFBF7] via-[#FDFBF7]/90 to-transparent dark:from-[#1C1917] dark:via-[#1C1917]/90 pointer-events-none" />

                <div className="group relative rounded-3xl border border-black/5 bg-white/75 dark:bg-[#26201C]/70 backdrop-blur-md shadow-[0_16px_38px_-18px_rgba(0,0,0,0.35)] ring-1 ring-white/60 dark:ring-white/10 transition-shadow flex flex-col">
                  {/* Optional file attach (applies to the next message) */}
                  <div className="flex items-center gap-2 px-5 pt-4 pb-2 border-b border-black/5">
                    <label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-3 py-2 text-[11px] font-bold text-gray-700 hover:bg-white cursor-pointer shadow-sm">
                      <span className="material-symbols-outlined !text-[18px] text-gray-500">attach_file</span>
                      Attach
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          void handlePickGlobalFiles(e.target.files);
                          // Allow picking the same file again.
                          e.currentTarget.value = '';
                        }}
                        accept=".ts,.tsx,.js,.jsx,.py,.json,.md,.txt,.toml,.yml,.yaml,.html,.css"
                        disabled={isLoading}
                      />
                    </label>

                    {globalContextFiles.length > 0 && (
                      <>
                        <div className="h-4 w-px bg-black/10 mx-1" />
                        <div className="flex items-center gap-2 flex-wrap">
                          {globalContextFiles.map((file) => (
                            <span
                              key={file.path}
                              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-3 py-1.5 text-[11px] font-medium text-primary"
                              title={file.path}
                            >
                              <span className="material-symbols-outlined !text-[14px]">description</span>
                              <span className="max-w-[150px] truncate">{file.path}</span>
                            </span>
                          ))}
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-gray-500 hover:text-gray-700 ml-1"
                            onClick={() => setGlobalContextFilesSafe([])}
                            disabled={isLoading}
                            title="Clear all attached files"
                          >
                            Clear all
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <textarea
                    ref={inputRef}
                    className="w-full resize-none bg-transparent px-6 py-4 pr-20 text-[15px] leading-relaxed text-[#2D2424] dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FDFBF7] dark:focus-visible:ring-offset-[#1C1917] rounded-b-3xl"
                    placeholder={shouldShowClarificationScreen ? 'Answer the clarification to continue…' : !isChatActive ? 'Describe your project or paste code to get started…' : 'Ask for a project plan or a code patch…'}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    rows={1}
                    disabled={isLoading}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSubmit();
                      }
                    }}
                  />

                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    aria-label="Send"
                    className={
                      "absolute right-4 top-1/2 -translate-y-1/2 grid size-11 place-items-center rounded-full " +
                      "bg-primary text-white shadow-md ring-1 ring-white/40 transition " +
                      "hover:shadow-lg hover:brightness-[1.03] active:scale-[0.98] " +
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 " +
                      "focus-visible:ring-offset-[#FDFBF7] dark:focus-visible:ring-offset-[#1C1917] " +
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    }
                  >
                    <span className="pointer-events-none flex items-center justify-center">
                      <SendIcon />
                    </span>
                  </button>
                </div>
              </form>
              <div className="h-2" />
            </div>
          </div>
        )}
      </main>

    </div>
  );
};

export default App;
