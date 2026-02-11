import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { PatchTabs } from './components/PatchTabs';
import type { Chat, Message } from './types';
import { deleteChat, executeQuery, getChat, invokeAgent, listChats } from './services/apiClient';
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
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
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
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // While router.execute is in-flight for the *current* user submit, keep the UI neutral
  // until we have a route decision for that interaction.
  const [pendingRoutedAgentId, setPendingRoutedAgentId] = useState<'codegen' | 'planner' | null>(null);
  const [isRouting, setIsRouting] = useState(false);

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
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    return (lastAssistant?.routing_meta?.agent_id ?? null) as 'codegen' | 'planner' | null;
  }, [messages]);

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
        const extracted = (await import('./services/codeExtract')).extractCodeAsFiles(userPrompt);
        if (extracted.files.length > 0) {
          console.log('[codeExtract] attached context.files', {
            count: extracted.files.length,
            source: extracted.source,
            language: extracted.inferred_language,
            goal: extracted.goal,
            filenames: extracted.files.map((f) => f.filename),
          });
        }

        const exec = await executeQuery(userPrompt, currentChatId ?? undefined);
        const routed = exec.route_response?.routes?.[0]?.agent_id;
        if (routed === 'planner' || routed === 'codegen') {
          setPendingRoutedAgentId(routed);
        }

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
        setIsLoading(false);
        setIsRouting(false);
      }
    },
    [input, isLoading, currentChatId, refreshChats, loadChatMessages]
  );

  const isChatActive = messages.length > 0;
  const shouldShowNeutralRoutingScreen = isChatActive && isRouting && !pendingRoutedAgentId;
  const shouldShowClarificationScreen = Boolean(pendingContinuation);

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
  const shouldShowGlobalRoutingInput = !isChatActive;

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
          <div className="hidden sm:flex items-center gap-2 mr-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Mode</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-[#2D2424] dark:text-gray-200">
              {(() => {
                return effectiveRoutedAgentId === 'planner' ? 'Project Planner' : 'CodeGen';
              })()}
            </span>
          </div>
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
              if (shouldShowClarificationScreen) {
                const qs = getClarificationQuestions();
                const suggestions: Array<{ label: string; value: string }> = [
                  { label: 'Project plan', value: 'I want a project plan (scope, milestones, risks, tasks).' },
                  { label: 'Code changes', value: 'I want code changes / implementation details / a patch.' },
                  { label: 'Both', value: 'I want both: a project plan and code changes.' },
                ];

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full min-h-0">
                    <div className="min-h-0 overflow-y-auto pr-1 rounded-2xl border border-gray-100 bg-white shadow-sm">
                      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/90 px-4 py-3 backdrop-blur">
                        <div className="text-xs font-bold uppercase tracking-widest text-gray-500">Conversation</div>
                        <div className="text-[11px] text-gray-400">Context preserved</div>
                      </div>
                      <div className="p-4">
                        <HistoryView messages={messages} />
                      </div>
                    </div>

                    <div className="min-h-0 overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
                      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/90 px-4 py-3 backdrop-blur">
                        <div className="text-xs font-bold uppercase tracking-widest text-gray-500">Clarification</div>
                        <div className="text-[11px] text-gray-400">Answer to continue</div>
                      </div>
                      <div className="p-6 space-y-6">
                        <div>
                          <div className="text-[#2D2424] dark:text-white text-xl font-extrabold tracking-tight">A few quick questions</div>
                          <p className="text-sm text-gray-500 mt-1">
                            I can keep your context and produce a better result if you answer these. Reply in your own words or tap a quick option.
                          </p>
                        </div>

                        <div className="rounded-2xl border border-gray-100 bg-[#FBFBF9] p-5">
                          {qs.length > 0 ? (
                            <ol className="space-y-3 text-sm text-[#2D2424]">
                              {qs.map((q, idx) => (
                                <li key={idx} className="leading-relaxed">
                                  <span className="font-bold text-gray-400 mr-2">{idx + 1}.</span>
                                  {q}
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <div className="text-sm text-gray-500">No structured questions found. Reply with any missing details and I’ll continue.</div>
                          )}
                        </div>

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
                return (
                  <div className="max-w-3xl mx-auto h-full flex flex-col items-center justify-center text-center space-y-5">
                    <div className="inline-flex items-center gap-2.5 rounded-full border border-black/5 bg-white/60 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-gray-400 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
                      <span className="inline-flex items-center gap-1" aria-hidden="true">
                        <span className="size-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:-0.2s]" />
                        <span className="size-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:-0.1s]" />
                        <span className="size-1.5 rounded-full bg-primary/70 animate-bounce" />
                      </span>
                      <span>Analyzing</span>
                      <span className="text-gray-300" aria-hidden="true">
                        ·
                      </span>
                      <span className="normal-case font-semibold tracking-normal text-gray-500" aria-live="polite">
                        {routingStatuses[routingStatusIndex]}
                      </span>
                    </div>

                    <div className="text-[#2D2424] dark:text-white text-2xl sm:text-3xl font-extrabold tracking-tight">
                      Figuring out the best next step
                    </div>

                    <div className="text-gray-500 font-medium max-w-xl">
                      I’m checking your request for intent (planning vs code), scanning any attached context, and selecting the right agent.
                    </div>
                  </div>
                );
              }

                if (effectiveRoutedAgentId === 'planner') {
                  return (
                    <PlannerView
                      unifiedMessages={messages}
                      chatId={currentChatId}
                      onInitialRoutedSendMessage={(t) => void handleSubmit(undefined, t)}
                      onDirectSendMessage={async (t) => {
                        if (!currentChatId) return;
                        await invokeAgent('planner', t, currentChatId, true);
                        await loadChatMessages(currentChatId);
                      }}
                      isGenerating={isLoading}
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
                    onDirectSendMessage={async (t) => {
                      if (!currentChatId) return;
                      await invokeAgent('codegen', t, currentChatId, true);
                      await loadChatMessages(currentChatId);
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

                <div className="group relative rounded-3xl border border-black/5 bg-white/75 dark:bg-[#26201C]/70 backdrop-blur-md shadow-[0_16px_38px_-18px_rgba(0,0,0,0.35)] ring-1 ring-white/60 dark:ring-white/10 transition-shadow">
                  <textarea
                    ref={inputRef}
                    className="w-full resize-none bg-transparent px-6 py-5 pr-16 text-[15px] leading-relaxed text-[#2D2424] dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FDFBF7] dark:focus-visible:ring-offset-[#1C1917] rounded-3xl"
                    placeholder={shouldShowClarificationScreen ? 'Answer the clarification to continue…' : 'Ask for a project plan or a code patch…'}
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
                    className="absolute right-4 top-1/2 -translate-y-1/2 size-10 rounded-2xl bg-primary text-white shadow-md hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Send"
                  >
                    <SendIcon />
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
