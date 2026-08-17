import { useState } from 'react';
import { ArrowUp, ChevronDown, Paperclip } from 'lucide-react';
import { ConversationTurnView } from '../../components/ConversationTurn';
import { openExternalUrl } from '../../lib/markdown-link';
import type { ConversationTurn } from '../../types';
import { prototypeConversationTurns } from './prototype-data';

export function PrototypeConversation() {
  const [turns, setTurns] = useState(prototypeConversationTurns);
  const [draft, setDraft] = useState('');

  function submitDraft() {
    const text = draft.trim();
    if (!text) return;

    const now = Date.now();
    const turn: ConversationTurn = {
      id: `prototype-local-${now}`,
      userText: text,
      workspace: 'D:\\ai_proj\\codem',
      assistantText: '',
      tools: [],
      items: [
        {
          id: `prototype-local-${now}-text`,
          type: 'text',
          text: '这是本地 UI 原型消息。视觉确认后，这里会接回 CodeM 的真实流式会话。',
        },
      ],
      status: 'done',
      providerId: 'claude-code',
      providerName: 'Claude Code',
      modelName: 'Claude Sonnet',
      startedAtMs: now,
      durationMs: 480,
    };
    setTurns((current) => [...current.map((item) => item.status === 'running' ? { ...item, status: 'done' as const } : item), turn]);
    setDraft('');
    requestAnimationFrame(() => document.querySelector('.prototype-conversation-end')?.scrollIntoView({ behavior: 'smooth' }));
  }

  return (
    <>
      <div className="prototype-conversation" aria-label="原型会话内容">
        {turns.map((turn, index) => (
          <ConversationTurnView
            key={turn.id}
            turn={turn}
            nowMs={Date.now()}
            isLiveRunning={turn.status === 'running'}
            isLatest={index === turns.length - 1}
            previousTurns={turns.slice(0, index)}
            canUndoChangedFiles={false}
            activeProject={null}
            providerId={turn.providerId}
            attachmentPreviewScope="workspace"
            collapseIntermediateProcess
            thinkingLabel="思考"
            onOpenWorkbenchPreview={() => undefined}
            onOpenOutputPath={async () => undefined}
            onRevealOutputPath={async () => undefined}
            onOpenWebLink={async (url) => { await openExternalUrl(url); }}
            onCopyWebLink={async (url) => { await navigator.clipboard.writeText(url); }}
            onUndoChangedFiles={() => undefined}
            onSubmitRequestUserInput={async () => true}
            onSubmitRuntimeRecoveryAction={async () => true}
            onSubmitApprovalDecision={async () => true}
          />
        ))}
        <div className="prototype-conversation-end" />
      </div>

      <section className="prototype-composer" aria-label="消息输入">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submitDraft();
            }
          }}
          placeholder="继续当前任务…"
          rows={1}
        />
        <div className="prototype-composer-toolbar">
          <button type="button" className="prototype-icon-button" aria-label="添加附件">
            <Paperclip size={18} />
          </button>
          <button type="button" className="prototype-model-button">
            Claude Sonnet
            <ChevronDown size={14} />
          </button>
          <span className="prototype-composer-mode">默认权限</span>
          <button
            type="button"
            className="prototype-send-button"
            disabled={!draft.trim()}
            onClick={submitDraft}
            aria-label="发送消息"
          >
            <ArrowUp size={19} />
          </button>
        </div>
      </section>
    </>
  );
}
