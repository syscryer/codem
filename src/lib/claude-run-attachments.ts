import type { InputContentBlock, InputContentBlockSummary, UserImageAttachment } from '../types';
import { normalizeInputContentBlocks, stripTransientInputBlockData } from './input-content-blocks';

export type RunImageAttachment = {
  mimeType: string;
  data: string;
};

type RunContentBlocksOptions = {
  prompt?: string | null;
  attachments?: UserImageAttachment[] | null;
  contentBlocks?: InputContentBlock[] | null;
};

export function buildRunContentBlocks(options: RunContentBlocksOptions): InputContentBlock[] {
  return normalizeInputContentBlocks({
    prompt: options.prompt,
    imageAttachments: options.attachments,
    contentBlocks: options.contentBlocks,
  });
}

export function stripTransientContentBlockData(
  blocks: InputContentBlock[] | null | undefined,
): InputContentBlockSummary[] | null | undefined {
  return stripTransientInputBlockData(blocks);
}

export function buildHistoryContentBlocks(
  options: RunContentBlocksOptions,
): InputContentBlockSummary[] {
  return stripTransientContentBlockData(buildRunContentBlocks(options)) ?? [];
}

export function stripTransientAttachmentData(attachments: UserImageAttachment[] | undefined) {
  if (!attachments?.length) {
    return attachments;
  }

  return attachments.map((attachment) => ({
    id: attachment.id,
    path: attachment.path,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
  }));
}

export function buildRunImageAttachments(attachments: UserImageAttachment[] | undefined): RunImageAttachment[] {
  if (!attachments?.length) {
    return [];
  }

  return attachments
    .map((attachment) => {
      const mimeType = attachment.mimeType?.trim();
      const data = attachment.data?.trim();
      return mimeType && data ? { mimeType, data } : null;
    })
    .filter((attachment): attachment is RunImageAttachment => Boolean(attachment));
}
