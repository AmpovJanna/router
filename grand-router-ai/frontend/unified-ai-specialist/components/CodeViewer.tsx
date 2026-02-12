import React from 'react';
import { LightAsync as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomOneLight } from 'react-syntax-highlighter/dist/esm/styles/hljs';

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const stripDiffMarkers = (diff: string, opts: { includeRemoved: boolean }): string => {
  const { includeRemoved } = opts;
  const text = (diff || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith('@@')) continue;
    if (line.startsWith('diff --git')) continue;
    if (line.startsWith('index ')) continue;
    if (line.startsWith('---')) continue;
    if (line.startsWith('+++')) continue;

    // Old lines ("-"):
    // - when toggle is OFF: skip entirely
    // - when toggle is ON: keep and mark with a leading "- " so it remains visible in the code view
    if (line.startsWith('-')) {
      if (!includeRemoved) continue;
      out.push(`- ${line.slice(1)}`);
      continue;
    }

    // New lines ("+") and context lines (" "):
    // - always keep, remove the leading marker
    if (line.startsWith('+') || line.startsWith(' ')) {
      out.push(line.slice(1));
      continue;
    }

    // Any remaining lines: keep as-is.
    out.push(line);
  }

  return out.join('\n').trimEnd();
};

export const CodeViewer: React.FC<{ title?: string; code: string; language?: string }> = ({
  title,
  code,
  language,
}) => {
  const effectiveLanguage = language && language !== 'text' ? language : undefined;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 overflow-hidden max-w-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-emerald-200 bg-emerald-100">
        <div className="text-xs font-bold uppercase tracking-widest text-emerald-900">{title || 'Code'}</div>
        <button className="text-emerald-700 hover:text-emerald-900 transition-colors" onClick={() => navigator.clipboard.writeText(code)}>
          <CopyIcon />
        </button>
      </div>
      <div className="text-sm text-emerald-950 overflow-auto max-h-[calc(100vh-320px)] max-w-full">
        <SyntaxHighlighter
          // When language is omitted, highlight.js will auto-detect (best-effort).
          language={effectiveLanguage as any}
          style={atomOneLight as any}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            background: '#ECFDF5',
            color: '#052E2B',
            overflow: 'visible',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 12,
              lineHeight: 1.7,
            },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

export const CodeFromDiff: React.FC<{ diff: string; language: string; includeRemoved?: boolean }> = ({ diff, language, includeRemoved = false }) => {
  const code = stripDiffMarkers(diff, { includeRemoved });
  return <CodeViewer title="Code" code={code} language={language} />;
};
