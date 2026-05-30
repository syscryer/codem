import type { InputContentBlock } from '../types';

export const DEFAULT_NEW_CHAT_TITLE = '新建聊天';
export const GLOBAL_NEW_CHAT_DRAFT_KEY = 'global:new-chat-draft';
const MAX_NEW_CHAT_TITLE_LENGTH = 23;

type NewChatTitleInput = {
  prompt?: string;
  displayText?: string;
  contentBlocks?: InputContentBlock[];
};

type NewChatDraftProjectInput = {
  currentProjectId: string | null;
  payloadProjectId: string | null;
  projects: Array<{ id: string }>;
};

type EmptyConversationCopyInput = {
  threadTitle?: string | null;
  activeProjectName?: string;
};

type EmptyConversationCopy = {
  title: string;
  description: string;
};

export function buildNewChatTitleFromSubmission(input: NewChatTitleInput) {
  const candidate = [
    normalizeTitleText(input.displayText),
    normalizeTitleText(readFirstTextBlock(input.contentBlocks)),
    normalizeTitleText(input.prompt),
  ].find(Boolean);

  if (!candidate) {
    return DEFAULT_NEW_CHAT_TITLE;
  }

  if (candidate.length <= MAX_NEW_CHAT_TITLE_LENGTH) {
    return candidate;
  }

  return `${candidate.slice(0, MAX_NEW_CHAT_TITLE_LENGTH)}...`;
}

export function shouldAutoRenameThreadTitle(currentTitle: string, nextTitle: string) {
  return currentTitle.trim() === DEFAULT_NEW_CHAT_TITLE && nextTitle.trim().length > 0;
}

export function resolveNewChatDraftProjectId(input: NewChatDraftProjectInput) {
  if (input.currentProjectId && input.projects.some((project) => project.id === input.currentProjectId)) {
    return input.currentProjectId;
  }

  return input.payloadProjectId;
}

export function resolveEmptyConversationCopy(input: EmptyConversationCopyInput): EmptyConversationCopy {
  if ((input.threadTitle ?? '').trim() === DEFAULT_NEW_CHAT_TITLE) {
    return {
      title: input.activeProjectName ? `在「${input.activeProjectName}」中创建会话` : '创建新会话',
      description: '第一句话会落进当前项目，新的会话会从这里自然展开。',
    };
  }

  return {
    title: '开始一次工作会话',
    description: '输入需求后，助手的正文会连续显示，工具调用会以轻量步骤内嵌在回答中。',
  };
}

function readFirstTextBlock(contentBlocks?: InputContentBlock[]) {
  if (!contentBlocks?.length) {
    return '';
  }

  for (const block of contentBlocks) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      return block.text;
    }
  }

  return '';
}

function normalizeTitleText(value?: string) {
  if (!value) {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
}
