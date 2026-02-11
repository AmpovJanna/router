import React, { useEffect, useMemo, useState } from 'react';
import { DiffBlock } from './DiffBlock';
import { CodeFromDiff, CodeViewer } from './CodeViewer';

const stripUnifiedDiffNoise = (diff: string): string => {
  const text = (diff || '').replace(/\r\n/g, '\n');
  const out: string[] = [];

  for (const line of text.split('\n')) {
    // Remove noisy headers
    if (line.startsWith('diff --git')) continue;
    if (line.startsWith('index ')) continue;
    if (line.startsWith('---')) continue;
    if (line.startsWith('+++')) continue;
    // Keep hunk headers + +/-/ context lines
    out.push(line);
  }

  return out.join('\n').trimEnd();
};

const normalizePath = (p: string): string => (p || '').trim().replace(/\\/g, '/');

type PatchFile = {
  kind: 'patch';
  path: string;
  diff: string;
};

type SnippetFile = {
  kind: 'snippet';
  path: string;
  code: string;
};

type NotesBlock = {
  kind: 'notes';
  path: string;
  text: string;
};

type TabItem = PatchFile | SnippetFile | NotesBlock;

const fileLabel = (p: string): string => {
  const n = normalizePath(p);
  const segs = n.split('/').filter(Boolean);

  // Avoid multiple tabs with the same leaf filename: show last two segments when possible.
  if (segs.length >= 2) return `${segs[segs.length - 2]}/${segs[segs.length - 1]}`;

  return segs[segs.length - 1] || n || '(unknown)';
};

const splitUnifiedDiffByFile = (diffText: string): PatchFile[] => {
  const text = (diffText || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  const out: PatchFile[] = [];

  let curPath = '';
  let curLines: string[] = [];

  const flush = () => {
    const body = curLines.join('\n').trimEnd();
    if (!body) return;

    out.push({
      kind: 'patch',
      path: curPath || '(unknown)',
      diff: body,
    });
  };

  for (const line of lines) {
    const m = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+?)\s*$/);
    if (m) {
      // flush previous
      flush();
      curLines = [line];
      curPath = normalizePath(m[2] || m[1] || '');
      continue;
    }

    if (curLines.length === 0) {
      // Skip any leading noise before first file header.
      continue;
    }

    curLines.push(line);
  }

  flush();
  return out;
};

const splitSnippetByFile = (
  snippetText: string
): {
  files: SnippetFile[];
  trailingNotes?: string;
} => {
  const text = (snippetText || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  const files: SnippetFile[] = [];

  let curPath = '';
  let curLines: string[] = [];

  const flush = () => {
    if (!curPath) return;
    const code = curLines.join('\n').trimEnd();
    files.push({ kind: 'snippet', path: curPath, code });
  };

  let started = false;

  for (const line of lines) {
    const m = line.match(/^\/\/\s*File:\s*(.+?)\s*$/);
    if (m) {
      if (started) flush();
      started = true;
      curPath = normalizePath(m[1]);
      curLines = [];
      continue;
    }

    if (!started) {
      // ignore any preamble before first file header
      continue;
    }

    curLines.push(line);
  }

  flush();

  // If there is a NOTES/REPORT section after the last file, try to split it out.
  // Heuristic: if the last file contains a marker line, split at first occurrence.
  let trailingNotes: string | undefined;
  const last = files[files.length - 1];
  if (last) {
    const codeLines = last.code.split('\n');
    const idx = codeLines.findIndex((l) => /^\s*(NOTES|REPORT)\s*:?\s*$/i.test(l.trim()));
    if (idx >= 0) {
      const before = codeLines.slice(0, idx).join('\n').trimEnd();
      const after = codeLines.slice(idx).join('\n').trimEnd();
      last.code = before;
      trailingNotes = after;
    }
  }

  return { files, trailingNotes };
};

const inferLanguageFromPath = (path: string): string => {
  const p = normalizePath(path);
  const ext = (p.split('.').pop() || '').toLowerCase();

  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'tsx';
    case 'js':
    case 'jsx':
      return 'jsx';
    case 'json':
      return 'json';
    case 'py':
      return 'python';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'md':
      return 'markdown';
    case 'txt':
      return 'text';
    case 'toml':
      return 'toml';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    default:
      return 'text';
  }
};

const Tab: React.FC<{
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
}> = ({ active, label, title, onClick }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={
      `px-3 py-2 text-xs font-bold rounded-t-lg border-b-2 transition-colors ` +
      (active
        ? 'text-cyan-800 border-cyan-500 bg-cyan-50'
        : 'text-gray-500 border-transparent hover:text-gray-800 hover:bg-gray-50')
    }
  >
    {label}
  </button>
);

export const PatchTabs: React.FC<{ patch: string }> = ({ patch }) => {
  const items = useMemo<TabItem[]>(() => {
    const raw = (patch || '').trim();
    if (!raw) return [];

    // DEBUG: detect whether we are losing content at parsing time (vs rendering/CSS).
    // eslint-disable-next-line no-console
    console.debug('[PatchTabs] patch diagnostics', {
      rawChars: raw.length,
      rawLines: raw.split('\n').length,
      hasUnifiedDiff: /^diff --git\s+a\//m.test(raw),
      hasSnippetSentinel: /^\/\/\s*File:\s*.+$/m.test(raw),
      rawTail: raw.slice(Math.max(0, raw.length - 300)),
    });

    // Prefer unified diff if present.
    if (/^diff --git\s+a\//m.test(raw)) {
      const perFile = splitUnifiedDiffByFile(raw);
      // eslint-disable-next-line no-console
      console.debug('[PatchTabs] unified diff split', {
        files: perFile.length,
        fileSummaries: perFile.map((f) => ({ path: f.path, chars: f.diff.length, lines: f.diff.split('\n').length })),
      });
      return perFile;
    }

    // Snippet format: // File: path
    if (/^\/\/\s*File:\s*.+$/m.test(raw)) {
      const { files, trailingNotes } = splitSnippetByFile(raw);
      // eslint-disable-next-line no-console
      console.debug('[PatchTabs] snippet split', {
        files: files.length,
        fileSummaries: files.map((f) => ({ path: f.path, chars: f.code.length, lines: f.code.split('\n').length })),
        trailingNotesChars: trailingNotes?.length ?? 0,
      });
      const tabs: TabItem[] = [...files];
      if (trailingNotes && trailingNotes.trim()) {
        tabs.push({ kind: 'notes', path: 'NOTES', text: trailingNotes });
      }
      return tabs;
    }

    // Fallback: show as notes.
    return [{ kind: 'notes', path: 'OUTPUT', text: raw }];
  }, [patch]);

  const [activePath, setActivePath] = useState<string>(() => (items[0]?.path ? items[0].path : ''));
  const [showOldLines, setShowOldLines] = useState<boolean>(false);

  useEffect(() => {
    if (!items.length) {
      setActivePath('');
      return;
    }

    if (activePath && items.some((t) => t.path === activePath)) return;
    setActivePath(items[0].path);
  }, [items, activePath]);

  if (!patch.trim()) return null;

  const active = items.find((t) => t.path === activePath) || items[0];

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white">
      <div className="flex items-center justify-between gap-2 px-2 pt-2 border-b border-gray-200 bg-[#FBFBF9]">
        <div className="flex gap-1 overflow-x-auto">
          {(items.length ? items : [{ kind: 'notes', path: '(empty)', text: '' }]).map((t) => (
            <Tab
              key={t.path}
              active={t.path === active.path}
              label={t.kind === 'notes' ? t.path : fileLabel(t.path)}
              title={t.path}
              onClick={() => setActivePath(t.path)}
            />
          ))}
        </div>

        {active.kind === 'patch' ? (
          <div className="flex items-center gap-3 pr-2 pb-2">
            <label className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500 select-none">
              <span>Old</span>
              <button
                type="button"
                aria-pressed={showOldLines}
                onClick={() => setShowOldLines((v) => !v)}
                className={
                  `relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ` +
                  (showOldLines ? 'bg-cyan-500 border-cyan-500' : 'bg-gray-200 border-gray-300')
                }
              >
                <span
                  className={
                    `inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ` +
                    (showOldLines ? 'translate-x-4' : 'translate-x-0.5')
                  }
                />
              </button>
            </label>
          </div>
        ) : null}
      </div>

      <div className="p-2 space-y-3">
        {active.kind === 'patch' ? (
          <CodeFromDiff
            diff={active.diff}
            includeRemoved={showOldLines}
            language={inferLanguageFromPath(active.path)}
          />
        ) : active.kind === 'snippet' ? (
          <CodeViewer title="Code" code={active.code} language={inferLanguageFromPath(active.path)} />
        ) : (
          <CodeViewer title={active.path} code={active.text} language="text" />
        )}
      </div>
    </div>
  );
};
