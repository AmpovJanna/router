// grand-router-ai/frontend/unified-ai-specialist/services/codeExtract.ts
// Lightweight helper for extracting code blocks from a user prompt into "context.files".
// This is consumed by both [`services.apiClient.ts`](grand-router-ai/frontend/unified-ai-specialist/services/apiClient.ts:1)
// and a dynamic import in [`App.tsx`](grand-router-ai/frontend/unified-ai-specialist/App.tsx:1).

export type ExtractedFile = {
  path: string;
  content: string;
};

export type ExtractedCode = {
  files: ExtractedFile[];
  inferred_language?: string;
  goal?: string;
  source: 'none' | 'fenced';
};

const inferLanguageFromPath = (path: string): string | undefined => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.cs')) return 'csharp';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  return undefined;
};

// Supports markdown fences:
// ```lang
// [code]
// ```
// and an optional filename line right after the opening fence:
// ```ts
// filename: src/foo.ts
// [code]
// ```
const FENCE_RE = /```([a-zA-Z0-9_+-]*)\s*\r?\n([\s\S]*?)\r?\n```/g;
const FILENAME_LINE_RE = /^\s*(?:filename|file|path)\s*:\s*(.+?)\s*$/i;

export const extractCodeAsFiles = (input: string): ExtractedCode => {
  const files: ExtractedFile[] = [];
  let match: RegExpExecArray | null;

  while ((match = FENCE_RE.exec(input)) !== null) {
    const fenceLangRaw = (match[1] || '').trim();
    const body = match[2] ?? '';

    const lines = body.split(/\r?\n/);
    let path: string | undefined;
    let contentLines = lines;

    const maybeFilename = lines[0] ? lines[0].match(FILENAME_LINE_RE) : null;
    if (maybeFilename && maybeFilename[1]) {
      path = maybeFilename[1].trim();
      contentLines = lines.slice(1);
    }

    const content = contentLines.join('\n').trimEnd();
    if (!content.trim()) continue;

    // If no filename is provided, generate a stable-ish one.
    const ext = fenceLangRaw ? `.${fenceLangRaw.replace(/[^a-zA-Z0-9]+/g, '')}` : '';
    const idx = files.length + 1;
    const fallbackName = `snippet-${idx}${ext || '.txt'}`;

    files.push({
      path: path || fallbackName,
      content,
    });
  }

  const inferred_language =
    (files.length > 0 && inferLanguageFromPath(files[0]!.path)) ||
    (files.length > 0 ? undefined : undefined);

  return {
    files,
    inferred_language,
    // Goal inference is intentionally conservative; leaving undefined avoids misleading routing.
    goal: undefined,
    source: files.length > 0 ? 'fenced' : 'none',
  };
};
