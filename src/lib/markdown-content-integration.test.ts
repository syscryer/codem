import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const conversationTurnSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');
const agentMuxSource = readFileSync(new URL('../components/AgentMuxPrototype.tsx', import.meta.url), 'utf8');
const markdownContentSource = readFileSync(new URL('../components/MarkdownContent.tsx', import.meta.url), 'utf8');

test('共享 Markdown 展示接入 GFM、代码复制和统一链接渲染', () => {
  assert.match(markdownContentSource, /remarkPlugins=\{\[remarkGfm, remarkLocalFileLinks\]\}/);
  assert.match(markdownContentSource, /return renderMarkdownLink\(\{/);
  assert.match(markdownContentSource, /pre: MarkdownCodeBlock/);
  assert.match(markdownContentSource, /className=\{`inline-copy-button code-copy-button/);
});

test('聊天与 Agent Mux 共用标准事件 reducer 和会话展示组件', () => {
  assert.match(conversationTurnSource, /import \{ MarkdownContent \} from '\.\/MarkdownContent';/);
  assert.match(conversationTurnSource, /<MarkdownContent[\s\S]*?onOpenLocalFile=/);
  assert.match(agentMuxSource, /import \{ ConversationTurnView \} from '\.\/ConversationTurn';/);
  assert.match(agentMuxSource, /buildAgentMuxConversationTurn\(run, events\)/);
  assert.match(agentMuxSource, /<ConversationTurnView/);
  assert.match(agentMuxSource, /transcriptTurn = applyAgentRunEventToTurn\(transcriptTurn, event\);[\s\S]{0,180}setLiveRunTurns/);
  assert.match(agentMuxSource, /liveTurn=\{selectedRun\?\.status === 'running'/);
  assert.doesNotMatch(agentMuxSource, /useConversation/);
});
