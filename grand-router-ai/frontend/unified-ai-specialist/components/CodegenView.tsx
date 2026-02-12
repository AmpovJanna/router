import React, { useCallback } from 'react';

import type { Message } from '../types';
import ChatSidebar from './ChatSidebar';
import { PatchTabs } from './PatchTabs';
import type { ContextFile } from '../types';

type Props = {
  messages: Message[];
  chatId: string | null;
  isGenerating: boolean;
  onInitialRoutedSendMessage: (text: string) => void;
  onDirectSendMessage: (text: string) => Promise<void>;
  onFilesChange?: (files: ContextFile[]) => void;
  onCancelGenerating?: () => void;
};

const findLatestPatchOrSnippet = (messages: Message[]): { kind: 'patch'; content: string } | { kind: 'snippet'; content: string } | null => {
  const assistantMsgs = [...messages].filter((m) => m.role === 'assistant');
  for (let i = assistantMsgs.length - 1; i >= 0; i -= 1) {
    const a = assistantMsgs[i];
    const patch = (a.artifacts || []).find((x) => x.type === 'patch') as any;
    if (patch && (patch.patch || '').trim()) {
      const cleaned = String(patch.patch)
        .trim()
        .replace(/\r\n/g, '\n');
      return { kind: 'patch', content: cleaned };
    }

    const snippet = (a.artifacts || []).find((x) => x.type === 'snippet') as any;
    if (snippet && (snippet.snippet || '').trim()) {
      return { kind: 'snippet', content: String(snippet.snippet).trim() };
    }
  }
  return null;
};

export const CodegenView: React.FC<Props> = ({
  messages,
  chatId,
  isGenerating,
  onInitialRoutedSendMessage,
  onDirectSendMessage,
  onFilesChange,
  onCancelGenerating,
}) => {
  const handleSendMessage = useCallback(
    async (text: string) => {
      // Codegen side-chat must NOT go through router (no re-routing).
      // If we have a chatId, invoke codegen directly and persist into the same chat.
      if (chatId) {
        await onDirectSendMessage(text);
        return;
      }

      // Fallback: if no chat exists yet, let the unified routing flow create one.
      onInitialRoutedSendMessage(text);
    },
    [chatId, onDirectSendMessage, onInitialRoutedSendMessage]
  );

  const latest = findLatestPatchOrSnippet(messages);

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#FDFBF7] dark:bg-[#1C1917]">
      <ChatSidebar
        messages={messages}
        chatId={chatId}
        onSendMessage={(t) => void handleSendMessage(t)}
        isGenerating={isGenerating}
        onCancel={onCancelGenerating}
        routedLabel="CodeGen"
        inputPlaceholder="Ask about the code / request a patch..."
        onFilesChange={onFilesChange}
      />

      <div className="flex-1 min-h-0 max-w-[900px]">
        <div className="min-h-0 overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/90 px-4 py-3 backdrop-blur">
            <div className="text-xs font-bold uppercase tracking-widest text-gray-500">Code</div>
            <div className="text-[11px] text-gray-400">Latest patch/snippet artifact</div>
          </div>
          <div className="p-4 pb-40">
            {latest ? (
              latest.kind === 'patch' ? (
                <PatchTabs patch={latest.content} />
              ) : (
                <PatchTabs patch={latest.content} />
              )
            ) : (
              <div className="rounded-xl border border-gray-200 bg-[#FBFBF9] p-4 text-[12px] leading-relaxed text-gray-500">No patch/snippet artifact yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CodegenView;
