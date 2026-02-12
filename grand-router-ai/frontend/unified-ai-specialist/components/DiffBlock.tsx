import React, { useMemo, useState } from 'react';

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({
  checked,
  onChange,
  label,
}) => (
  <label className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500 select-none">
    <span>{label}</span>
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={
        `relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ` +
        (checked ? 'bg-cyan-500 border-cyan-500' : 'bg-gray-200 border-gray-300')
      }
    >
      <span
        className={
          `inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ` +
          (checked ? 'translate-x-4' : 'translate-x-0.5')
        }
      />
    </button>
  </label>
);

/**
 * Unified diff renderer tuned for readability:
 * - keeps diff metadata intact (diff/@@/---/+++)
 * - can hide removed lines for “old code” toggle
 */
export const DiffBlock: React.FC<{ diff: string; light?: boolean; defaultShowRemoved?: boolean; showRemoved?: boolean }> = ({
  diff,
  light = false,
  defaultShowRemoved = true,
  // When provided, DiffBlock becomes controlled.
  showRemoved,
}) => {
  const [internalShowRemoved, setInternalShowRemoved] = useState<boolean>(defaultShowRemoved);

  const effectiveShowRemoved = typeof showRemoved === 'boolean' ? showRemoved : internalShowRemoved;

  const lines = useMemo(() => (diff || '').replace(/\r\n/g, '\n').split('\n'), [diff]);

  const visibleLines = useMemo(() => {
    if (effectiveShowRemoved) return lines;
    return lines.filter((line) => {
      const isMeta =
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('@@');

      // Always hide noisy git headers; tabs already show the filename.
      if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        return false;
      }

      // Keep hunk headers (line ranges), they’re useful context.
      if (line.startsWith('@@')) return true;

      // Hide removed lines only.
      if (line.startsWith('-')) return false;
      return !isMeta;
    });
  }, [lines, effectiveShowRemoved]);

  const shellBg = light ? 'bg-[#FFF4EA] border-[#FFD3B3]' : 'bg-[#FFEFE3] border-[#FFDFC2]';
  const headerBg = light ? 'bg-[#FFEFE3] border-[#FFD3B3]' : 'bg-[#FFE5D0] border-[#FFDFC2]';
  const metaText = light ? 'text-slate-500 font-semibold' : 'text-slate-600 font-semibold';
  const normalText = light ? 'text-slate-900' : 'text-[#2D2424]';

  return (
    <div className={`my-4 rounded-xl overflow-hidden border shadow-sm ${shellBg}`}>
      <div className={`flex items-center justify-between px-4 py-2 border-b ${headerBg}`}>
        <div className="flex items-center gap-4">
          <span className="text-[10px] uppercase font-bold tracking-widest text-[#6B3F37]">DIFF</span>
        </div>
        <button className="text-[#6B3F37] hover:text-[#2D2424] transition-colors" onClick={() => navigator.clipboard.writeText(diff)}>
          <CopyIcon />
        </button>
      </div>
      <pre className="p-4 overflow-auto max-h-[calc(100vh-320px)]">
        <code className="font-mono text-sm leading-relaxed block">
          {visibleLines.map((line, i) => {
            const isMeta =
              line.startsWith('diff --git') ||
              line.startsWith('index ') ||
              line.startsWith('new file mode') ||
              line.startsWith('deleted file mode') ||
              line.startsWith('---') ||
              line.startsWith('+++') ||
              line.startsWith('@@');

            const isNoisyGitHeader =
              line.startsWith('diff --git') ||
              line.startsWith('index ') ||
              line.startsWith('---') ||
              line.startsWith('+++');

            if (isNoisyGitHeader) return null;

            const isAdd = !isMeta && line.startsWith('+');
            const isDel = !isMeta && line.startsWith('-');

            const cls = isMeta
              ? metaText
              : isAdd
                ? 'text-emerald-700'
                : isDel
                  ? 'text-rose-700'
                  : normalText;

            // Keep +/- markers so it’s obvious what’s old/new when toggle is enabled.
            const display = line;

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
