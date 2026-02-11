
import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Message } from '../types';

interface ChatSidebarProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  isGenerating: boolean;
  routedLabel?: string;
  inputPlaceholder?: string;
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
      out.push(`#### ${stripMarkdown(line)}`);
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
  routedLabel = 'Project Planner',
  inputPlaceholder = 'Refine the plan...',
}) => {
  const [inputValue, setInputValue] = useState('');

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && !isGenerating) {
      onSendMessage(inputValue.trim());
      setInputValue('');
    }
  };

  return (
    <section className="flex flex-col w-[38%] border-r border-black/5 glass-chat relative z-10 h-full min-h-0 overflow-hidden">
      <header className="p-6 flex flex-col gap-4 border-b border-black/5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="p-2 hover:bg-black/5 rounded-full transition-colors"
            aria-label="Back"
          >
            <span className="material-symbols-outlined text-gray-400 text-[20px]">arrow_back_ios</span>
          </button>
          <div className="flex items-center gap-2 bg-emerald-light text-primary px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border border-primary/20 shadow-sm">
            <span className="material-symbols-outlined !text-[14px]">verified</span>
            Routed to: {routedLabel}
          </div>
          <button
            type="button"
            className="p-2 hover:bg-black/5 rounded-full transition-colors"
            aria-label="Menu"
          >
            <span className="material-symbols-outlined text-gray-400">more_horiz</span>
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar">
        {messages.map((msg) => {
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

          const summary = shouldSummarize ? assistantSummaries.get(msg.message_id) || null : null;

          const detailsId = `assistant-msg-${msg.message_id}`;

          return (
            <div key={msg.message_id} className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end ml-10' : 'mr-10'}`}>
              <div
                className={`p-4 rounded-3xl shadow-sm text-sm leading-relaxed border ${
                  msg.role === 'user'
                    ? 'bg-coral-pastel rounded-tr-none text-[#5D2B1F] border-white/20'
                    : 'bg-white/90 rounded-tl-none border-black/5 text-text-main'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <div className="chat-markdown">
                    {shouldSummarize ? (
                      <details className="group" aria-label="Toggle full assistant message" aria-controls={detailsId}>
                        <summary
                          className="cursor-pointer select-none text-[12px] font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                          aria-label="Show or hide full message"
                        >
                          <span className="group-open:hidden">Show full</span>
                          <span className="hidden group-open:inline">Hide</span>
                        </summary>

                        <div id={detailsId} className="mt-3">
                          <ReactMarkdown skipHtml>
                            {typeof msg.content === 'string' ? formatAssistantForSidebar(msg.content) : String(msg.content)}
                          </ReactMarkdown>
                        </div>
                      </details>
                    ) : (
                      <ReactMarkdown skipHtml>
                        {typeof msg.content === 'string' ? formatAssistantForSidebar(msg.content) : String(msg.content)}
                      </ReactMarkdown>
                    )}
                  </div>
                ) : (
                  msg.content
                )}
              </div>

              {pills.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pills.map((text) => (
                    <button
                      key={text}
                      type="button"
                      className="text-[11px] px-3 py-1.5 rounded-full bg-white/70 hover:bg-white/90 border border-black/5 shadow-sm transition-colors"
                      onClick={() => {
                        if (!isGenerating) onSendMessage(text);
                      }}
                      disabled={isGenerating}
                      title={text}
                    >
                      {text}
                    </button>
                  ))}
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
        {isGenerating && (
          <div className="flex flex-col gap-2 mr-10 animate-pulse">
            <div className="bg-white/90 p-4 rounded-3xl rounded-tl-none shadow-sm border border-black/5 h-16 w-full"></div>
            <span className="text-[10px] text-gray-400 ml-2 uppercase font-medium tracking-tight">Thinking...</span>
          </div>
        )}
      </div>

      <div className="p-6 bg-white/20">
        <form onSubmit={handleSubmit} className="relative flex items-center group">
          <input
            className="w-full bg-white/80 border-none rounded-2xl py-4 pl-5 pr-14 text-sm shadow-lg ring-1 ring-black/5 focus:ring-primary/40 transition-all backdrop-blur-sm"
            placeholder={inputPlaceholder}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isGenerating}
          />
          <button
            type="submit"
            className="absolute right-2 p-2 bg-primary text-white rounded-xl shadow-md hover:shadow-lg hover:scale-105 transition-all disabled:opacity-50"
            disabled={isGenerating}
          >
            <span className="material-symbols-outlined !text-[20px]">send</span>
          </button>
        </form>
      </div>
    </section>
  );
};

export default ChatSidebar;
