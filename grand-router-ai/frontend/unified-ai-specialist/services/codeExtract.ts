export type CodeLanguage = 'python' | 'java' | 'javascript' | 'typescript' | 'csharp' | 'unknown';

export type ContextFile = {
  filename: string;
  content: string;
  language?: string;
};

export type CodeExtractionResult = {
  files: ContextFile[];
  inferred_language?: string;
  goal?: string;
  source: 'fenced' | 'paste' | 'none';
};

const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

const extForLang = (lang: CodeLanguage): string => {
  switch (lang) {
    case 'python':
      return '.py';
    case 'java':
      return '.java';
    case 'javascript':
      return '.js';
    case 'typescript':
      return '.ts';
    case 'csharp':
      return '.cs';
    default:
      return '.txt';
  }
};

const normalizeFenceLang = (raw: string | undefined): CodeLanguage => {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return 'unknown';

  if (v === 'py' || v === 'python') return 'python';
  if (v === 'java') return 'java';
  if (v === 'js' || v === 'javascript' || v === 'node') return 'javascript';
  if (v === 'ts' || v === 'typescript') return 'typescript';
  if (v === 'c#' || v === 'csharp' || v === 'cs') return 'csharp';

  return 'unknown';
};

const looksLikeCodeIndicators = (text: string): boolean => {
  const t = text;

  // This is ONLY for clearly-pasted code without fences.
  // Avoid false positives on normal English prompts that contain "{ }" or ";" (e.g., JSON-ish text,
  // Spring annotations mentioned inline, etc.).

  // 1) Strong indicators: stack traces, diff headers, or multi-line code structure.
  const strongIndicators = [
    /^\s*(Traceback \(most recent call last\):|Exception in thread)\b/m,
    /^\s*at\s+\S+\s*\(.*\)\s*$/m, // JS stack
    /^\s*\w+Error\b.*$/m,
    /^diff\s+--git\s+a\//m,
    /^@@\s+[-+]\d+(?:,\d+)?\s+[-+]\d+(?:,\d+)?\s+@@/m,
    /^\s*(package\s+[\w.]+\s*;|import\s+\w|using\s+System\b)\s*$/m,
  ];

  if (strongIndicators.some((re) => re.test(t))) return true;

  // 2) Token-density check: require BOTH multiple code-like keywords and multiple typical symbols.
  // This greatly reduces accidental matches on plain-language requests.
  const keywordHits = [
    /\b(class|interface|enum)\b/,
    /\b(public|private|protected|static|final|void|new)\b/,
    /\b(def|return|import|from)\b/,
    /\b(function|const|let|var|export|import)\b/,
  ].reduce((n, re) => (re.test(t) ? n + 1 : n), 0);

  const symbolHits = [
    /\{[\s\S]*\}/,
    /;\s*$/m,
    /\(.*\)\s*\{/m,
    /^\s*}\s*$/m,
  ].reduce((n, re) => (re.test(t) ? n + 1 : n), 0);

  return keywordHits >= 2 && symbolHits >= 2;
};

export const inferLanguage = (text: string): CodeLanguage => {
  const t = normalizeNewlines(text);

  // python
  if (/^\s*def\s+\w+\s*\(/m.test(t) || /^\s*class\s+\w+\s*\(/m.test(t) || /^\s*import\s+\w+/m.test(t)) {
    return 'python';
  }

  // csharp
  if (/^\s*using\s+System\b/m.test(t) || /\bnamespace\s+\w+/m.test(t) || /\bConsole\.Write(Line)?\s*\(/.test(t)) {
    return 'csharp';
  }

  // java
  if (/\bpublic\s+class\s+\w+\b/.test(t) || /\bSystem\.out\.println\s*\(/.test(t) || /\bpackage\s+[\w.]+\s*;/.test(t)) {
    return 'java';
  }

  // typescript
  if (/\binterface\s+\w+\b/.test(t) || /\btype\s+\w+\s*=/.test(t) || /:\s*(string|number|boolean|unknown|any)\b/.test(t)) {
    return 'typescript';
  }

  // javascript
  if (/\bmodule\.exports\b/.test(t) || /\brequire\s*\(/.test(t) || /\bfunction\s+\w+\s*\(/.test(t)) {
    return 'javascript';
  }

  // generic JS/TS via import/export (biased to TS if we saw TS hints above)
  if (/^\s*(import|export)\b/m.test(t)) {
    return 'javascript';
  }

  return 'unknown';
};

export const inferGoal = (prompt: string): string | undefined => {
  const t = (prompt || '').toLowerCase();

  if (/(refactor|cleanup|clean up|restructure|re-organize|improve readability|simplify)/.test(t)) {
    return 'refactor';
  }

  if (/(fix|bug|error|exception|stack trace|traceback|crash|failing|fails|broken)/.test(t)) {
    return 'fix';
  }

  return undefined;
};

export const extractCodeAsFiles = (rawPrompt: string): CodeExtractionResult => {
  const prompt = normalizeNewlines(rawPrompt || '');

  // Parse triple-backtick fenced blocks with optional language tag.
  // Matches: ```lang\n...\n```
  const fenceRe = /```\s*([A-Za-z0-9#+-_.]*)\s*\n([\s\S]*?)\n```/g;

  const files: ContextFile[] = [];
  const langs: CodeLanguage[] = [];

  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = fenceRe.exec(prompt)) !== null) {
    const tag = m[1] || '';
    const content = (m[2] || '').trimEnd();
    if (!content.trim()) continue;

    const lang = normalizeFenceLang(tag);
    langs.push(lang);

    const ext = extForLang(lang);
    const suffix = i === 0 ? '' : `_${i + 1}`;
    files.push({
      filename: `snippet${suffix}${ext}`,
      content,
      language: lang !== 'unknown' ? lang : undefined,
    });
    i++;
  }

  if (files.length > 0) {
    const inferred_language = langs.find((l) => l !== 'unknown') || inferLanguage(files[0].content);
    return {
      files,
      inferred_language: inferred_language !== 'unknown' ? inferred_language : undefined,
      goal: inferGoal(prompt),
      source: 'fenced',
    };
  }

  // Fallback: large paste without fences.
  // Intentionally conservative: only attach context.files for clear multi-line code pastes.
  const trimmed = prompt.trim();
  const lineCount = trimmed ? trimmed.split('\n').length : 0;
  if (trimmed.length > 800 && lineCount >= 12 && looksLikeCodeIndicators(trimmed)) {
    const lang = inferLanguage(trimmed);
    return {
      files: [
        {
          filename: `snippet${extForLang(lang)}`,
          content: trimmed,
          language: lang !== 'unknown' ? lang : undefined,
        },
      ],
      inferred_language: lang !== 'unknown' ? lang : undefined,
      goal: inferGoal(prompt),
      source: 'paste',
    };
  }

  return { files: [], source: 'none' };
};
