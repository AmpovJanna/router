import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { prism } from 'react-syntax-highlighter/dist/esm/styles/prism';

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

    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
      // Removed lines: include only when toggle is enabled.
      if (line.startsWith('-') && !includeRemoved) continue;

      out.push(line.slice(1));
      continue;
    }

    // Any remaining lines: keep as-is.
    out.push(line);
  }

  return out.join('\n').trimEnd();
};

export const CodeViewer: React.FC<{ title?: string; code: string; language: string }> = ({
  title,
  code,
  language,
}) => {
  return (
    <div className="rounded-2xl border border-[#FFD3B3] bg-[#FFF4EA] overflow-hidden max-w-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#FFD3B3] bg-[#FFEFE3]">
        <div className="text-xs font-bold uppercase tracking-widest text-[#6B4E3D]">{title || 'Code'}</div>
        <button className="text-[#A07A67] hover:text-[#6B4E3D] transition-colors" onClick={() => navigator.clipboard.writeText(code)}>
          <CopyIcon />
        </button>
      </div>
      <div className="text-sm text-[#1F2937] overflow-auto max-h-[calc(100vh-320px)] max-w-full">
        <SyntaxHighlighter
          language={language}
          style={prism}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            background: '#FFF4EA',
            color: '#1F2937',
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
