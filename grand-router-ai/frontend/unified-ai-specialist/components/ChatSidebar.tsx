
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ContextFile, Message } from '../types';

import { invokeAgent } from '../services/apiClient';

interface ChatSidebarProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  isGenerating: boolean;
  onCancel?: () => void;
  routedLabel?: string;
  chatId?: string | null;
  inputPlaceholder?: string;
  onBackToHome?: () => void;
  onFilesChange?: (files: ContextFile[]) => void;
}

const formatMessageTime = (createdAt: unknown): string | null => {
  // Robust against undefined/null/non-ISO values.
  // Return null to hide the timestamp entirely (prevents “Invalid Date”).
  if (typeof createdAt !== 'string' || createdAt.trim().length === 0) return null;

  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;

  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const LONG_ASSISTANT_MESSAGE_CHAR_THRESHOLD = 700;
const LONG_ASSISTANT_MESSAGE_LINE_THRESHOLD = 12;

const REWRITE_ASSISTANT_MESSAGE_CHAR_THRESHOLD = 240;

const countLines = (s: string): number => {
  // Normalize newlines and count. Empty string => 0 lines.
  const norm = s.replace(/\r\n/g, '\n');
  if (norm.length === 0) return 0;
  return norm.split('\n').length;
};

const isLikelyLongAssistantMessage = (content: string): boolean => {
  return (
    content.length > LONG_ASSISTANT_MESSAGE_CHAR_THRESHOLD ||
    countLines(content) > LONG_ASSISTANT_MESSAGE_LINE_THRESHOLD
  );
};

const shouldRewriteAssistantMessage = (content: string): boolean => {
  return (content || '').trim().length >= REWRITE_ASSISTANT_MESSAGE_CHAR_THRESHOLD;
};

type AssistantSummary = {
  paragraph: string;
  highlights: string[];
};

const stripMarkdown = (s: string): string => {
  // Heuristic plain-text cleanup (not a full markdown parser).
  return s
    .replace(/```[\s\S]*?```/g, '') // code fences
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s*[-*+]\s+/gm, '') // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, '') // ordered list markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1') // links
    .replace(/\s+/g, ' ')
    .trim();
};

const prettyHeading = (h: string): string => {
  const map: Record<string, string> = {
    'KEY POINTS ACHIEVED': 'Key Points',
    'WHAT CHANGED (BY FILE)': 'What Changed',
    'WHY / ROOT CAUSE': 'Why',
    'DESIGN NOTES (SOLID / PATTERNS)': 'Design Notes',
    'TEST SCENARIOS': 'Test Scenarios',
    SUMMARY: 'Summary',
    'PROJECT STRUCTURE': 'Project Structure',
  };
  const hit = map[h];
  if (hit) return hit;

  return h
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
};

const normalizeLooseMarkdown = (input: string): string => {
  // Some LLM outputs glue headings/lists onto the previous sentence:
  // "...text### Heading- **Item:** ..." which breaks markdown rendering.
  // Normalize only outside fenced code blocks.
  const s = (input || '').replace(/\r\n/g, '\n');
  if (!s.trim()) return '';

  const parts = s.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith('```')) return part;

      let p = part;

      // Ensure headings start on their own line.
      p = p.replace(/([^\n])\s*(#{1,6}\s+)/g, '$1\n\n$2');

      // Ensure list markers start on their own line when glued.
      p = p.replace(/([^\n])\s*(-\s+)/g, '$1\n$2');
      p = p.replace(/([^\n])\s*(\d+\.\s+)/g, '$1\n$2');

      // Avoid excessive spacing.
      p = p.replace(/\n{3,}/g, '\n\n');
      return p;
    })
    .join('')
    .trim();
};

const formatAssistantForSidebar = (content: string): string => {
  const norm = (content || '').replace(/\r\n/g, '\n').trim();
  if (!norm) return '';

  // If the agent output is a structured report with headings, show a compact
  // and readable outline in the sidebar.
  const headings = [
    'KEY POINTS ACHIEVED',
    'WHAT CHANGED (BY FILE)',
    'WHY / ROOT CAUSE',
    'DESIGN NOTES (SOLID / PATTERNS)',
    'TEST SCENARIOS',
    'SUMMARY',
    'PROJECT STRUCTURE',
  ];

  const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Some agent outputs are emitted as a single paragraph (no newlines).
  // Make them readable by splitting known section headings onto their own lines.
  const normalizedForSplit = (() => {
    let s = norm;
    for (const h of headings) {
      const re = new RegExp(`\\b${escapeRegExp(h)}\\b`, 'g');
      s = s.replace(re, `\n${h}\n`);
    }
    // Improve readability for per-file sections.
    s = s.replace(/\s+FILE\s*:\s*/g, '\nFILE: ');
    return s.replace(/\n{3,}/g, '\n\n').trim();
  })();

  const isStructured = headings.some((h) => norm.includes(h));
  if (!isStructured) return norm;

  const lines = normalizedForSplit.split('\n');
  const out: string[] = [];
  let curHeading: string | null = null;
  let countUnder = 0;

  const pushHeading = (h: string) => {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
    out.push(`### ${prettyHeading(h)}`);
    curHeading = h;
    countUnder = 0;
  };

  const normalizeLine = (l: string): string => {
    const cleaned = l.replace(/^\s*(SUMMARY|PROJECT STRUCTURE)\s*:?\s*/i, '').trim();
    return stripMarkdown(cleaned);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Heading detection
    const matchedHeading = headings.find((h) => line === h);
    if (matchedHeading) {
      pushHeading(matchedHeading);
      continue;
    }

    if (line.startsWith('FILE:')) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      const path = stripMarkdown(line.replace(/^FILE:\s*/i, '')).trim();
      out.push(`#### FILE: \`${path}\``);
      continue;
    }

    // Only keep a few bullets / sentences under each section.
    if (curHeading) {
      if (countUnder >= 3) continue;

      // Prefer existing bullets.
      const isBullet = /^[-*•]\s+/.test(line);
      if (isBullet) {
        const b = normalizeLine(line);
        if (b && b.toLowerCase() !== 'not applicable.') {
          out.push(`- ${b}`);
          countUnder += 1;
        }
        continue;
      }

      // Handle numbered steps (common in TEST SCENARIOS).
      const isNumbered = /^\d+[\.)]\s+/.test(line);
      if (isNumbered) {
        const b = normalizeLine(line);
        if (b && b.toLowerCase() !== 'not applicable.') {
          out.push(`- ${b}`);
          countUnder += 1;
        }
        continue;
      }

      // Otherwise take the first sentence-ish line.
      const plain = normalizeLine(line);
      if (plain && plain.toLowerCase() !== 'not applicable.') {
        out.push(`- ${plain}`);
        countUnder += 1;
      }
      continue;
    }

    // If no heading yet, keep a first line snippet.
    if (out.length === 0) out.push(normalizeLine(line));
  }

  return out.join('\n').trim();
};

const extractAssistantSummary = (content: string): AssistantSummary => {
  const norm = content.replace(/\r\n/g, '\n');
  const rawLines = norm.split('\n');

  const nonEmptyLines = rawLines.map((l) => l.trim()).filter(Boolean);

  // First paragraph: consecutive non-empty lines until a blank line.
  const firstParaLines: string[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    if (line.trim().length === 0) {
      if (firstParaLines.length > 0) break;
      continue;
    }
    firstParaLines.push(line.trim());
  }

  const paragraph = stripMarkdown(firstParaLines.join(' '));

  // Highlights: up to 3 from headings / list items (first occurrences)
  const highlights: string[] = [];
  for (const l of nonEmptyLines) {
    if (highlights.length >= 3) break;

    const isHeading = /^#{1,6}\s+/.test(l);
    const isBullet = /^[-*+]\s+/.test(l) || /^\d+\.\s+/.test(l);

    if (!isHeading && !isBullet) continue;

    const cleaned = stripMarkdown(l);
    if (!cleaned) continue;
    if (paragraph && cleaned.toLowerCase() === paragraph.toLowerCase()) continue;

    // Deduplicate.
    const key = cleaned.toLowerCase();
    if (highlights.some((h) => h.toLowerCase() === key)) continue;

    highlights.push(cleaned);
  }

  return { paragraph, highlights };
};

const ChatSidebar: React.FC<ChatSidebarProps> = ({
  messages,
  onSendMessage,
  isGenerating,
  onCancel,
  routedLabel = 'Project Planner',
  chatId = null,
  inputPlaceholder = 'Refine the plan...',
  onBackToHome,
  onFilesChange,
}) => {
  const shouldOutlineStructuredContent = routedLabel === 'CodeGen';
  const [inputValue, setInputValue] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<ContextFile[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);

  useEffect(() => {
    if (onFilesChange) onFilesChange(attachedFiles);
  }, [attachedFiles, onFilesChange]);

  // LLM rewrites for long assistant messages (keyed by message_id).
  const [rewrites, setRewrites] = useState<Record<string, string>>({});
  const pendingRewriteIds = useRef<Set<string>>(new Set());
  const rewriteInitialized = useRef<boolean>(false);
  const knownAssistantIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    // When switching chats, treat the loaded history as "known" so we don't
    // fire chatwriter rewrites for every historical message.
    rewriteInitialized.current = false;
    knownAssistantIds.current = new Set();
    pendingRewriteIds.current = new Set();
    setRewrites({});
  }, [chatId, routedLabel]);

  const assistantSummaries = useMemo(() => {
    const out = new Map<string, AssistantSummary>();
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      if (typeof m.content !== 'string') continue;
      if (!isLikelyLongAssistantMessage(m.content)) continue;
      out.set(m.message_id, extractAssistantSummary(m.content));
    }
    return out;
  }, [messages]);

  const hasPendingPlaceholder = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last) return false;
    return last.role === 'assistant' && last.message_id.startsWith('local-side-assistant-') && last.content === 'Thinking...';
  }, [messages]);

  useEffect(() => {
    // Only run the rewrite agent in the CodeGen chat sidebar.
    // This avoids extra LLM calls when browsing old planner chats.
    if (routedLabel !== 'CodeGen') return;

    // On first load (e.g., opening an older chat), don't rewrite historical messages.
    // Only rewrite newly arriving assistant messages to avoid delays/flicker.
    if (!rewriteInitialized.current) {
      for (const m of messages) {
        if (m.role === 'assistant') knownAssistantIds.current.add(m.message_id);
      }
      rewriteInitialized.current = true;
      return;
    }

    const candidates = messages.filter((m) => {
      if (m.role !== 'assistant') return false;
      if (typeof m.content !== 'string') return false;

      // Rewrite more aggressively than the collapse/summary heuristic.
      return shouldRewriteAssistantMessage(m.content);
    });

    for (const m of candidates) {
      if (knownAssistantIds.current.has(m.message_id)) continue;
      knownAssistantIds.current.add(m.message_id);
      if (rewrites[m.message_id]) continue;
      if (pendingRewriteIds.current.has(m.message_id)) continue;
      pendingRewriteIds.current.add(m.message_id);

      void (async () => {
        try {
          const res = await invokeAgent(
            'chatwriter',
            'Rewrite this response for the sidebar (keep it detailed).',
            null,
            false,
            {
              original_message: m.content,
              routed_label: routedLabel,
              original_agent_id: m.routing_meta?.agent_id ?? null,
            },
            null
          );

          const rewritten = (res.notes || []).join('\n').trim();
          if (rewritten) {
            setRewrites((prev) => ({ ...prev, [m.message_id]: rewritten }));
          }
        } catch (e) {
          // If rewrite fails, fall back to local summary (no hard error in UI).
        } finally {
          pendingRewriteIds.current.delete(m.message_id);
        }
      })();
    }
  }, [messages, rewrites, routedLabel]);

  const formatAssistantForDisplay = useCallback(
    (content: string): string => {
      return shouldOutlineStructuredContent ? formatAssistantForSidebar(content) : content;
    },
    [shouldOutlineStructuredContent]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && !isGenerating) {
      if (onFilesChange) onFilesChange(attachedFiles);
      // If answering a specific question, format the message
      const messageToSend = activeQuestion
        ? `Question: ${activeQuestion}\n\nAnswer: ${inputValue.trim()}`
        : inputValue.trim();
      onSendMessage(messageToSend);
      setInputValue('');
      setActiveQuestion(null);
    }
  };

  const handlePickFiles = useCallback(
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

      setAttachedFiles((prev) => {
        const merged: ContextFile[] = [...prev];
        for (const nf of loaded) {
          const i = merged.findIndex((x) => x.path === nf.path);
          if (i >= 0) merged[i] = nf;
          else merged.push(nf);
        }
        return merged.slice(0, 8);
      });
    },
    []
  );

  return (
    <section className="flex flex-col w-[38%] border-r border-black/5 glass-chat relative z-10 h-full min-h-0 overflow-hidden">
      <header className="p-6 flex flex-col gap-4 border-b border-black/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 bg-emerald-light text-primary px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border border-primary/20 shadow-sm">
            <span className="material-symbols-outlined !text-[14px]">verified</span>
            Routed to: {routedLabel}
          </div>
        </div>
      </header>

      {routedLabel === 'CodeGen' && (
        <div className="px-6 pt-5">
          <div className="rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Context files</div>
                <div className="mt-1 text-xs text-gray-600">Attach files so the agent can reference them.</div>
              </div>

              <label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-[11px] font-bold text-gray-700 hover:bg-gray-50 cursor-pointer">
                <span className="material-symbols-outlined !text-[18px] text-gray-500">attach_file</span>
                Add files
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handlePickFiles(e.target.files);
                    // Allow picking the same file again.
                    e.currentTarget.value = '';
                  }}
                  accept=".ts,.tsx,.js,.jsx,.py,.json,.md,.txt,.toml,.yml,.yaml,.html,.css"
                />
              </label>
            </div>

            {attachedFiles.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {attachedFiles.map((f) => (
                  <span key={f.path} className="inline-flex items-center gap-2 rounded-full bg-white/80 border border-black/5 px-3 py-1.5 text-[11px] text-gray-700">
                    <span className="material-symbols-outlined !text-[16px] text-gray-400">description</span>
                    <span className="max-w-[220px] truncate" title={f.path}>{f.path}</span>
                    <button
                      type="button"
                      className="text-gray-400 hover:text-gray-700"
                      aria-label={`Remove ${f.path}`}
                      onClick={() => {
                        setAttachedFiles((prev) => prev.filter((x) => x.path !== f.path));
                      }}
                    >
                      <span className="material-symbols-outlined !text-[16px]">close</span>
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="text-[11px] font-semibold text-gray-500 hover:text-gray-700"
                  onClick={() => setAttachedFiles([])}
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar">
        {messages.filter((msg) => msg.role !== 'system' && (msg.content || (msg.artifacts && msg.artifacts.length > 0))).map((msg) => {
          const pills = (() => {
            if (msg.role !== 'assistant') return [];
            const raw = (msg.suggested_replies || [])
              .map((s) => (typeof s === 'string' ? s.trim() : ''))
              .filter(Boolean);
            const deduped: string[] = [];
            const seen = new Set<string>();
            for (const s of raw) {
              const key = s.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              deduped.push(s);
              if (deduped.length >= 4) break;
            }
            return deduped;
          })();

          const shouldSummarize =
            msg.role === 'assistant' && typeof msg.content === 'string' && isLikelyLongAssistantMessage(msg.content);

          const shouldRewrite =
            msg.role === 'assistant' && typeof msg.content === 'string' && shouldRewriteAssistantMessage(msg.content);

          const summary = shouldSummarize ? assistantSummaries.get(msg.message_id) || null : null;
          const rewrite = shouldRewrite ? rewrites[msg.message_id] || '' : '';
          const localOutline =
            shouldSummarize &&
            !rewrite &&
            shouldOutlineStructuredContent &&
            typeof msg.content === 'string'
              ? formatAssistantForSidebar(normalizeLooseMarkdown(msg.content))
              : '';

          const detailsId = `assistant-msg-${msg.message_id}`;

          return (
            <div key={msg.message_id} className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end ml-10' : 'mr-10'}`}>
              <div
                className={`p-4 rounded-3xl shadow-sm text-sm leading-relaxed border whitespace-pre-wrap break-words overflow-hidden ${
                  msg.role === 'user'
                    ? 'bg-coral-pastel rounded-tr-none text-[#5D2B1F] border-white/20'
                    : 'bg-white/90 rounded-tl-none border-black/5 text-text-main'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <div className="chat-markdown">
                    {msg.message_id.startsWith('local-side-assistant-') && msg.content === 'Thinking...' ? (
                      <div className="flex items-center">
                        <span className="inline-block h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                        {isGenerating && onCancel ? (
                          <button
                            type="button"
                            onClick={onCancel}
                            className="ml-3 text-[11px] font-semibold text-gray-500 hover:text-gray-700"
                          >
                            Stop
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      shouldSummarize ? (
                        <div className="space-y-3">
                          {rewrite ? (
                            <ReactMarkdown skipHtml>
                              {formatAssistantForDisplay(normalizeLooseMarkdown(rewrite))}
                            </ReactMarkdown>
                          ) : localOutline ? (
                            <ReactMarkdown skipHtml>{localOutline}</ReactMarkdown>
                          ) : (
                            <>
                              {summary?.paragraph ? <div className="text-sm">{summary.paragraph}</div> : null}
                              {summary?.highlights && summary.highlights.length > 0 ? (
                                <ul className="list-disc pl-5 text-[12px] text-gray-600 space-y-1">
                                  {summary.highlights.map((h) => (
                                    <li key={h}>{h}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </>
                          )}

                          <details
                            className="group"
                            aria-label="Toggle full assistant message"
                            aria-controls={detailsId}
                          >
                            <summary
                              className="cursor-pointer select-none text-[12px] font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                              aria-label="Show or hide full message"
                            >
                              <span className="group-open:hidden">Show full</span>
                              <span className="hidden group-open:inline">Hide</span>
                            </summary>

                            <div id={detailsId} className="mt-3">
                              <ReactMarkdown skipHtml>
                                {typeof msg.content === 'string'
                                  ? formatAssistantForDisplay(normalizeLooseMarkdown(msg.content))
                                  : String(msg.content)}
                              </ReactMarkdown>
                            </div>
                          </details>
                        </div>
                      ) : rewrite ? (
                        <ReactMarkdown skipHtml>
                          {formatAssistantForDisplay(normalizeLooseMarkdown(rewrite))}
                        </ReactMarkdown>
                      ) : (
                        <ReactMarkdown skipHtml>
                          {typeof msg.content === 'string'
                            ? formatAssistantForDisplay(normalizeLooseMarkdown(msg.content))
                            : String(msg.content)}
                        </ReactMarkdown>
                      )
                    )}
                  </div>
                ) : pills.length > 0 ? (
                  <div className="text-sm font-medium text-gray-600">
                    I need some clarification to proceed. Please select a question below to answer:
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">
                    {typeof msg.content === 'string' ? msg.content : String(msg.content)}
                  </div>
                )}
              </div>

              {pills.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-primary">
                    <span className="material-symbols-outlined !text-[14px]">help</span>
                    Click a question to answer:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pills.map((text) => (
                      <button
                        key={text}
                        type="button"
                        className={`text-[11px] px-3 py-1.5 rounded-full border shadow-sm transition-all cursor-pointer ${
                          isGenerating
                            ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                            : activeQuestion === text
                              ? 'bg-primary text-white border-primary ring-2 ring-primary/30'
                              : 'bg-white/70 hover:bg-primary hover:text-white hover:border-primary text-gray-700 border-black/5'
                        }`}
                        onClick={() => {
                          if (!isGenerating && text.trim()) {
                            setActiveQuestion(text);
                          }
                        }}
                        disabled={isGenerating}
                        title={isGenerating ? 'Wait for current response...' : `Click to answer: "${text}"`}
                      >
                        <span className="flex items-center gap-1">
                          {!isGenerating && (
                            <span className="material-symbols-outlined !text-[12px]">
                              {activeQuestion === text ? 'check_circle' : 'help_outline'}
                            </span>
                          )}
                          {text}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(() => {
                const time = formatMessageTime(msg.created_at);
                if (!time) return null;

                return (
                  <span
                    className={`text-[10px] text-gray-400 uppercase font-medium tracking-tight ${
                      msg.role === 'user' ? 'mr-2' : 'ml-2'
                    }`}
                  >
                    {msg.role === 'user' ? 'Sent ' : `${routedLabel} • `}
                    {time}
                  </span>
                );
              })()}
            </div>
          );
        })}
        {isGenerating && !hasPendingPlaceholder && (
          <div className="flex flex-col gap-2 mr-10 animate-pulse">
            <div className="bg-white/90 p-4 rounded-3xl rounded-tl-none shadow-sm border border-black/5 h-16 w-full flex items-center">
              <span className="inline-block h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            </div>
          </div>
        )}
      </div>

      <div className="p-6 bg-white/20">
        {activeQuestion && (
          <div className="mb-3 px-4 py-2 bg-primary/10 border border-primary/20 rounded-xl">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold text-primary uppercase tracking-wider">Answering:</div>
                <div className="text-sm text-text-main truncate">{activeQuestion}</div>
              </div>
              <button
                type="button"
                onClick={() => setActiveQuestion(null)}
                className="p-1 hover:bg-primary/20 rounded-full text-primary transition-colors"
                title="Clear question"
              >
                <span className="material-symbols-outlined !text-[18px]">close</span>
              </button>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit} className="relative flex items-center group">
          <input
            className="w-full bg-white/80 border-none rounded-2xl py-4 pl-5 pr-14 text-sm shadow-lg ring-1 ring-black/5 focus:ring-primary/40 transition-all backdrop-blur-sm"
            placeholder={activeQuestion ? 'Type your answer...' : inputPlaceholder}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isGenerating}
          />
          {isGenerating && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="absolute right-2 size-11 bg-red-500 text-white rounded-full shadow-md hover:shadow-lg hover:scale-105 transition-all flex items-center justify-center"
              title="Stop generating"
            >
              <span className="material-symbols-outlined !text-[20px]">stop</span>
            </button>
          ) : (
            <button
              type="submit"
              className="absolute right-2 size-11 bg-primary text-white rounded-full shadow-md hover:shadow-lg hover:scale-105 transition-all disabled:opacity-50 flex items-center justify-center"
              disabled={isGenerating}
            >
              <span className="material-symbols-outlined !text-[20px]">send</span>
            </button>
          )}
        </form>
      </div>
    </section>
  );
};

export default ChatSidebar;
