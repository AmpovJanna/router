
import React from 'react';
import type { Artifact, Message } from '../types';

const ListIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

interface HistoryViewProps {
  messages: Message[];
}

const CodeBlock: React.FC<{ code: string; language: string }> = ({ code, language }) => (
  <div className="my-4 rounded-xl overflow-hidden bg-[#FFEFE3] border border-[#FFDFC2] shadow-sm">
    <div className="flex items-center justify-between px-4 py-2 border-b border-[#FFDFC2] bg-[#FFE5D0]">
      <span className="text-[10px] uppercase font-bold tracking-widest text-[#6B3F37]">{language || 'CODE'}</span>
      <button className="text-[#6B3F37] hover:text-[#2D2424] transition-colors" onClick={() => navigator.clipboard.writeText(code)}>
        <CopyIcon />
      </button>
    </div>
    <pre className="p-4 overflow-x-auto">
      <code className="text-[#2D2424] font-mono text-sm leading-relaxed block">
        {code.trim()}
      </code>
    </pre>
  </div>
);

/**
 * Diff renderer tuned for readability:
 * - keeps diff metadata intact (diff/@@/---/+++)
 * - removes leading +/- markers for add/del lines (cleaner)
 */
const DiffBlock: React.FC<{ diff: string }> = ({ diff }) => {
  const lines = (diff || '').replace(/\r\n/g, '\n').split('\n');

  return (
    <div className="my-4 rounded-xl overflow-hidden bg-[#FFEFE3] border border-[#FFDFC2] shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#FFDFC2] bg-[#FFE5D0]">
        <span className="text-[10px] uppercase font-bold tracking-widest text-[#6B3F37]">DIFF</span>
        <button className="text-[#6B3F37] hover:text-[#2D2424] transition-colors" onClick={() => navigator.clipboard.writeText(diff)}>
          <CopyIcon />
        </button>
      </div>
      <pre className="p-4 overflow-x-auto">
        <code className="text-[#2D2424] font-mono text-sm leading-relaxed block">
          {lines.map((line, i) => {
            const isMeta =
              line.startsWith('diff --git') ||
              line.startsWith('index ') ||
              line.startsWith('new file mode') ||
              line.startsWith('deleted file mode') ||
              line.startsWith('---') ||
              line.startsWith('+++') ||
              line.startsWith('@@');
            const isAdd = !isMeta && line.startsWith('+');
            const isDel = !isMeta && line.startsWith('-');

            const cls = isMeta
              ? 'text-slate-600 font-semibold'
              : isAdd
                ? 'text-emerald-800'
                : isDel
                  ? 'text-rose-800'
                  : 'text-[#2D2424]';

            const display = isAdd || isDel ? line.slice(1) : line;

            return (
              <div key={i} className={cls}>
                {display}
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
};

const FormattedContent: React.FC<{ content: string }> = ({ content }) => {
  const parts = content.split(/```(\w+)?/);

  // Note: Avoid console spam in production.

  return (
    <div className="space-y-4">
      {parts.map((part, i) => {
        if (i % 2 === 1) return null; // language tag
        const language = parts[i - 1] || '';
        const isCode = i > 0 && i % 2 === 0;

        if (isCode) {
          return <CodeBlock key={i} code={part} language={language} />;
        }

        return <div key={i} className="whitespace-pre-wrap">{part}</div>;
      })}
    </div>
  );
};

type StructuredReport = {
  summary: string[];
  projectStructure: string[];
  keyPoints: string[];
  whatChanged: string[];
  why: string[];
  design: string[];
  tests: string[];
  byFile: Record<string, string[]>;
};

const normalizePath = (p: string): string => (p || '').trim().replace(/\\/g, '/');

const fileNameFromPath = (p: string): string => {
  const n = normalizePath(p);
  const segs = n.split('/').filter(Boolean);
  return (segs[segs.length - 1] || '').trim();
};

const pushIfNonEmpty = (arr: string[], line: string) => {
  const s = (line || '').trim();
  if (s) arr.push(s);
};

/**
 * Parses the backend reporter's structured plain-text report.
 *
 * Headings (one per line):
 * - KEY POINTS ACHIEVED
 * - WHAT CHANGED (BY FILE)
 * - WHY / ROOT CAUSE
 * - DESIGN NOTES (SOLID / PATTERNS)
 * - TEST SCENARIOS
 */
const parseStructuredReport = (content: string): StructuredReport => {
  const out: StructuredReport = {
    summary: [],
    projectStructure: [],
    keyPoints: [],
    whatChanged: [],
    why: [],
    design: [],
    tests: [],
    byFile: {},
  };

  const text = (content || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  type Heading = 'summary' | 'structure' | 'key' | 'changed' | 'why' | 'design' | 'tests' | 'other';

  const headingForLine = (line: string): Heading => {
    const t = (line || '').trim().toUpperCase();
    if (t === 'SUMMARY') return 'summary';
    if (t === 'PROJECT STRUCTURE') return 'structure';
    if (t === 'KEY POINTS ACHIEVED') return 'key';
    if (t === 'WHAT CHANGED (BY FILE)') return 'changed';
    if (t === 'WHY / ROOT CAUSE') return 'why';
    if (t === 'DESIGN NOTES (SOLID / PATTERNS)') return 'design';
    if (t === 'TEST SCENARIOS') return 'tests';
    return 'other';
  };

  let section: Heading = 'other';
  let currentFileKey: string | null = null;

  for (const raw of lines) {
    const trimmed = (raw || '').trim();

    // Headings reset file parsing.
    const maybeHeading = headingForLine(trimmed);
    if (maybeHeading !== 'other') {
      section = maybeHeading;
      currentFileKey = null;
      continue;
    }

    // Blank line: separator only.
    if (!trimmed) {
      if (section === 'changed') currentFileKey = null;
      continue;
    }

    if (section === 'summary') {
      pushIfNonEmpty(out.summary, trimmed);
      continue;
    }

    if (section === 'structure') {
      pushIfNonEmpty(out.projectStructure, trimmed);
      continue;
    }

    if (section === 'key') {
      pushIfNonEmpty(out.keyPoints, trimmed);
      continue;
    }

    if (section === 'why') {
      pushIfNonEmpty(out.why, trimmed);
      continue;
    }

    if (section === 'design') {
      pushIfNonEmpty(out.design, trimmed);
      continue;
    }

    if (section === 'tests') {
      pushIfNonEmpty(out.tests, trimmed);
      continue;
    }

    if (section === 'changed') {
      const fileMatch = trimmed.match(/^FILE:\s*(.+)\s*$/i);
      if (fileMatch) {
        const rawPath = (fileMatch[1] || '').trim();
        if (!rawPath) {
          currentFileKey = null;
          continue;
        }

        const normalized = normalizePath(rawPath);
        const key = normalized.toLowerCase();
        out.byFile[key] = out.byFile[key] || [];
        currentFileKey = key;
        continue;
      }

      // Allow a brief non-file section under WHAT CHANGED (BY FILE) (older reporter variants)
      // by collecting bullets until the first FILE: sentinel.
      if (!currentFileKey) {
        pushIfNonEmpty(out.whatChanged, trimmed);
        continue;
      }

      pushIfNonEmpty(out.byFile[currentFileKey], trimmed);
      continue;
    }

    // Ignore unknown sections / narrative.
  }

  return out;
};

/**
 * Split a unified diff into per-file chunks by `diff --git` boundaries.
 */
const splitUnifiedDiffByFile = (diffText: string): Array<{ path: string; diff: string }> => {
  const text = (diffText || '').trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const result: Array<{ path: string; diff: string }> = [];

  let currentPath = 'diff';
  let currentLines: string[] = [];

  const flush = () => {
    const body = currentLines.join('\n').trim();
    if (body) result.push({ path: currentPath, diff: body + '\n' });
    currentLines = [];
  };

  for (const line of lines) {
    const m = line.match(/^diff --git a\/(.+?) b\/(.+?)\s*$/);
    if (m) {
      flush();
      currentPath = (m[2] || m[1] || 'diff').trim();
      currentLines.push(line);
      continue;
    }
    currentLines.push(line);
  }
  flush();

  return result;
};

/**
 * Split snippet-mode text into per-file blocks using `// File: <path>` sentinels.
 *
 * Example snippet format:
 *   // File: grand-router-ai/frontend/App.tsx
 *   // Explanation: grand-router-ai/frontend/App.tsx Add new button
 *   export const App = () => ...
 */
const splitSnippetByFile = (snippetText: string): Array<{ path: string; code: string }> => {
  const raw = (snippetText || '').replace(/\r\n/g, '\n');
  const text = raw.trim();
  if (!text) return [];

  const fileSentinel = /^\/\/\s*File:\s*(.+)\s*$/gm;
  const matches = Array.from(text.matchAll(fileSentinel));

  // If there are no file sentinels, render the whole thing as a single snippet.
  // (We cannot reliably separate code vs notes without the sentinel.)
  if (matches.length === 0) {
    return [{ path: 'snippet', code: text }];
  }

  const blocks: Array<{ path: string; code: string }> = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const path = (m[1] || 'file').trim();

    // Start at the *next* line after the sentinel.
    const start = (m.index ?? 0) + m[0].length;

    // End at the next sentinel, or end-of-text. Any trailing NOTES/REPORT after the last file
    // will be sliced off below.
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;

    const section = text.slice(start, end).replace(/^\s*\n/, '');

    const lines = section.split('\n');
    const out: string[] = [];

    let skippingPerFileExplanation = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Allow (but strip) a per-file explanation comment header.
      if (!skippingPerFileExplanation && /^\/\/\s*Explanation:\s*/.test(trimmed)) {
        skippingPerFileExplanation = true;
        continue;
      }

      if (skippingPerFileExplanation) {
        // Keep skipping comment-only lines under the Explanation header.
        if (!trimmed) continue;
        if (trimmed.startsWith('//')) continue;
        skippingPerFileExplanation = false;
      }

      out.push(line);
    }

    // Trim trailing NOTES/REPORT or other narrative that the LLM might append after code.
    // Only apply this to the *last* file block.
    let code = out.join('\n').trimEnd();
    if (i === matches.length - 1) {
      const noteStart = code.search(/^\s*(?:#{1,6}\s+)?(?:NOTES|NOTE|REPORT|EXPLANATION)\b\s*:?.*$/im);
      if (noteStart >= 0) {
        code = code.slice(0, noteStart).trimEnd();
      }
    }

    blocks.push({ path, code });
  }

  return blocks;
};

const inferLanguageFromPath = (path: string): string => {
  const p = (path || '').trim().toLowerCase();
  if (!p) return 'text';

  const ext = p.includes('.') ? p.slice(p.lastIndexOf('.') + 1) : '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'py':
      return 'python';
    case 'md':
      return 'markdown';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'html':
      return 'html';
    case 'toml':
      return 'toml';
    case 'sh':
    case 'bash':
      return 'bash';
    case 'diff':
    case 'patch':
      return 'diff';
    default:
      return ext || 'text';
  }
};

const formatTimestamp = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Verification rendering removed (per requirement).

const PerFileExplanation: React.FC<{ lines: string[] }> = ({ lines }) => {
  if (!lines || lines.length === 0) return null;
  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-black tracking-widest text-slate-500 uppercase mb-1">What changed</div>
      <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
        {lines.map((l, i) => (
          <li key={i} className="leading-relaxed">{l}</li>
        ))}
      </ul>
    </div>
  );
};

const lookupByFileExplanation = (byFile: Record<string, string[]>, snippetPath: string): string[] => {
  const normalized = normalizePath(snippetPath);
  const normalizedKey = normalized.toLowerCase();

  // 1) exact normalized path (case-insensitive)
  if (byFile[normalizedKey]?.length) return byFile[normalizedKey];

  // 2) try matching by filename
  const base = fileNameFromPath(normalized).toLowerCase();
  if (!base) return [];

  // Quick hit: if a FILE: entry itself used just the filename.
  if (byFile[base]?.length) return byFile[base];

  // Otherwise scan keys to find same basename.
  for (const [k, v] of Object.entries(byFile)) {
    if (fileNameFromPath(k).toLowerCase() === base && v.length > 0) return v;
  }

  return [];
};

const ArtifactsView: React.FC<{ artifacts: Artifact[]; report: StructuredReport }> = ({ artifacts, report }) => {
  const patchArtifacts = artifacts.filter((a) => a.type === 'patch');
  const planArtifacts = artifacts.filter((a) => a.type === 'project_plan');
  const risksArtifacts = artifacts.filter((a) => a.type === 'risks');
  const nextStepsArtifacts = artifacts.filter((a) => a.type === 'next_steps');
  const hasAnything =
    patchArtifacts.length + planArtifacts.length + risksArtifacts.length + nextStepsArtifacts.length > 0;
  if (!hasAnything) return null;

  return (
    <div className="mt-4 space-y-3">
      <div className="text-[10px] font-black tracking-widest text-gray-400 uppercase">Artifacts</div>

      {/* Code section */}
      {(patchArtifacts.length > 0 || planArtifacts.length > 0) && (
        <div className="space-y-3">
          <div className="text-[10px] font-bold text-gray-500 mb-1">Code</div>

          {patchArtifacts.map((a, idx) => {
            const patch = (a.patch || '').trim();
            const isUnifiedDiff = /^diff --git /m.test(patch);

            const perFile = isUnifiedDiff
              ? splitUnifiedDiffByFile(patch).map((p) => ({ path: p.path, diff: p.diff, kind: 'diff' as const }))
              : splitSnippetByFile(patch).map((p) => ({ path: p.path, code: p.code, language: inferLanguageFromPath(p.path), kind: 'code' as const }));

            return (
              <div key={idx} className="space-y-3">
                {perFile.map((f, i) => {
                  const expl = lookupByFileExplanation(report.byFile, f.path);

                  return (
                    <div key={`${idx}-${i}`}>
                      <div className="text-[10px] font-bold text-gray-500 mb-1">{f.path}</div>

                      <PerFileExplanation lines={expl} />

                      {f.kind === 'diff' ? (
                        <DiffBlock diff={f.diff} />
                      ) : (
                        <CodeBlock code={f.code} language={f.language} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {planArtifacts.map((a, idx) => (
            <div key={`plan-${idx}`}>
              <div className="text-[10px] font-bold text-gray-500 mb-1">project_plan</div>
              <CodeBlock code={typeof a.plan === 'string' ? a.plan : JSON.stringify(a.plan, null, 2)} language="json" />
            </div>
          ))}
        </div>
      )}

      {/* Non-code artifacts remain as simple lists (render after Test Scenarios in HistoryView) */}
      {risksArtifacts.map((a, idx) => (
        <div key={`risks-${idx}`} className="text-sm text-gray-600">
          <div className="text-[10px] font-bold text-gray-500 mb-1">risks</div>
          <ul className="list-disc pl-5 space-y-1">
            {a.risks.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ))}

      {nextStepsArtifacts.map((a, idx) => (
        <div key={`next-${idx}`} className="text-sm text-gray-600">
          <div className="text-[10px] font-bold text-gray-500 mb-1">next_steps</div>
          <ul className="list-disc pl-5 space-y-1">
            {a.next_steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ))}

    </div>
  );
};

const SectionCard: React.FC<{ title: string; lines: string[] }> = ({ title, lines }) => {
  if (!lines || lines.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="text-[10px] font-black tracking-widest text-gray-400 uppercase mb-2">{title}</div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
          {lines.map((l, i) => (
            <li key={i} className="leading-relaxed">{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const hasStructuredHeadings = (content: string): boolean => {
  const t = (content || '').toUpperCase();
  return (
    t.includes('SUMMARY') ||
    t.includes('PROJECT STRUCTURE') ||
    t.includes('KEY POINTS ACHIEVED') ||
    t.includes('WHAT CHANGED (BY FILE)') ||
    t.includes('WHY / ROOT CAUSE') ||
    t.includes('DESIGN NOTES (SOLID / PATTERNS)') ||
    t.includes('TEST SCENARIOS')
  );
};

const HistoryView: React.FC<HistoryViewProps> = ({ messages }) => {
  if (messages.length === 0) return null;

  // Rendering order for assistant messages:
  // - Key points achieved (top)
  // - Why / Root cause
  // - Per-file code with per-file explanation above each snippet
  // - Design notes
  // - Test scenarios
  // - Other artifacts (risks, next_steps, verification) remain below

  return (
    <div className="w-full max-w-5xl mx-auto space-y-12 pb-48 animate-fade-in-up">
      {messages.map((msg) => {

        return (
          <div key={msg.message_id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            {/* User Side */}
            {msg.role === 'user' && (
              <div className="flex gap-4 max-w-[85%]">
                <div className="flex flex-col items-end">
                  <div className="bg-[#FFE2CC] text-[#4A403A] rounded-2xl rounded-tr-none p-5 shadow-sm text-base font-medium leading-tight whitespace-pre-wrap border border-[#FFD3B3]">
                    {msg.content}
                  </div>
                  <div className="flex items-center gap-2 mt-2 px-1">
                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">
                      You • {formatTimestamp(msg.created_at)}
                    </span>
                    <img src="https://picsum.photos/seed/profile/100/100" className="size-8 rounded-full border border-gray-100 object-cover" alt="User" />
                  </div>
                </div>
              </div>
            )}

            {/* Assistant Side */}
            {msg.role === 'assistant' && (
              <div className="flex flex-col items-start w-full">
                <div className="flex items-center gap-3 mb-4">
                  <div className="size-10 rounded-full bg-slate-100 flex items-center justify-center border border-gray-100 overflow-hidden shadow-sm">
                    <img src={`https://api.dicebear.com/7.x/bottts/svg?seed=${msg.routing_meta?.agent_id || 'assistant'}`} alt="Bot" className="size-8" />
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[#4ADE80]">AI Assistant</span>
                      <span className="text-[9px] font-black bg-[#F0FDF4] text-[#166534] px-1.5 py-0.5 rounded tracking-widest uppercase">Bot</span>
                    </div>

                    {msg.routing_meta?.agent_id ? (
                      <div className="mt-1">
                        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-800">
                          <span className="size-1.5 rounded-full bg-cyan-500" />
                          Routed to: {msg.routing_meta.agent_id}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="ml-12 w-full">
                  {!msg.routing_meta?.agent_id ? null : null}

                  {(() => {
                    const content = msg.content || '';
                    const isStructured = hasStructuredHeadings(content);
                    const report = isStructured
                      ? parseStructuredReport(content)
                      : { summary: [], projectStructure: [], keyPoints: [], whatChanged: [], why: [], design: [], tests: [], byFile: {} };

                    return (
                      <div className="bg-white border border-gray-100 dark:border-white/5 rounded-2xl rounded-tl-none p-6 shadow-sm text-[#2D2424] dark:text-gray-100 text-base leading-relaxed max-w-[98%]">
                        {isStructured ? (
                          <div>
                            <SectionCard title="SUMMARY" lines={report.summary} />
                            <SectionCard title="PROJECT STRUCTURE" lines={report.projectStructure} />
                            <SectionCard title="KEY POINTS ACHIEVED" lines={report.keyPoints} />
                            <SectionCard title="WHAT CHANGED (BY FILE)" lines={report.whatChanged} />
                            <SectionCard title="WHY / ROOT CAUSE" lines={report.why} />
                            <SectionCard title="DESIGN NOTES" lines={report.design} />
                            <SectionCard title="TEST SCENARIOS" lines={report.tests} />
                          </div>
                        ) : (
                          <FormattedContent content={content} />
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default HistoryView;
