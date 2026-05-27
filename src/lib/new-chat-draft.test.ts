import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOBAL_NEW_CHAT_DRAFT_KEY,
  buildNewChatTitleFromSubmission,
  resolveNewChatDraftProjectId,
  shouldAutoRenameThreadTitle,
} from './new-chat-draft.js';

test('global new chat draft key stays stable across projects and threads', () => {
  assert.equal(GLOBAL_NEW_CHAT_DRAFT_KEY, 'global:new-chat-draft');
});

test('buildNewChatTitleFromSubmission prefers display text and normalizes whitespace', () => {
  assert.equal(
    buildNewChatTitleFromSubmission({
      prompt: '   帮我修一下设置页的主题切换   ',
      displayText: '  帮我修一下设置页的主题切换  ',
    }),
    '帮我修一下设置页的主题切换',
  );
});

test('buildNewChatTitleFromSubmission falls back to content block text and truncates long titles', () => {
  assert.equal(
    buildNewChatTitleFromSubmission({
      prompt: '',
      displayText: '',
      contentBlocks: [
        { type: 'text', text: '请帮我排查一个非常长非常长非常长非常长非常长非常长的问题，并给出修复方案' },
      ],
    }),
    '请帮我排查一个非常长非常长非常长非常长非常长非...',
  );
});

test('buildNewChatTitleFromSubmission returns default title when no readable text exists', () => {
  assert.equal(
    buildNewChatTitleFromSubmission({
      prompt: '',
      displayText: '',
      contentBlocks: [{ type: 'image', name: 'screenshot.png' }],
    }),
    '新建聊天',
  );
});

test('shouldAutoRenameThreadTitle only allows replacing the untouched default title', () => {
  assert.equal(shouldAutoRenameThreadTitle('新建聊天', '修复设置页'), true);
  assert.equal(shouldAutoRenameThreadTitle('我自己改过名字', '修复设置页'), false);
  assert.equal(shouldAutoRenameThreadTitle('新建聊天', '   '), false);
});

test('resolveNewChatDraftProjectId keeps the visible project when workspace refresh returns stale selection', () => {
  assert.equal(
    resolveNewChatDraftProjectId({
      currentProjectId: 'project-b',
      payloadProjectId: 'project-a',
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
    }),
    'project-b',
  );
});

test('resolveNewChatDraftProjectId falls back to workspace selection if the visible project disappeared', () => {
  assert.equal(
    resolveNewChatDraftProjectId({
      currentProjectId: 'project-b',
      payloadProjectId: 'project-a',
      projects: [{ id: 'project-a' }],
    }),
    'project-a',
  );
});
