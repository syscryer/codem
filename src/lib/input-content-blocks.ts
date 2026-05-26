import type {
  InputContentBlock,
  InputContentBlockSummary,
  InputReferenceReason,
  UserImageAttachment,
} from '../types.js';

type NormalizeInputContentBlocksOptions = {
  prompt?: string | null;
  imageAttachments?: UserImageAttachment[] | null;
  contentBlocks?: InputContentBlock[] | null;
};

export function normalizeInputContentBlocks(options: NormalizeInputContentBlocksOptions): InputContentBlock[] {
  const normalizedContentBlocks = normalizeProvidedContentBlocks(options.contentBlocks);
  if (normalizedContentBlocks.length > 0) {
    return normalizedContentBlocks;
  }

  const blocks: InputContentBlock[] = [];
  const trimmedPrompt = options.prompt?.trim();
  if (trimmedPrompt) {
    blocks.push({
      type: 'text',
      text: trimmedPrompt,
    });
  }

  for (const attachment of options.imageAttachments ?? []) {
    const imageBlock = normalizeLegacyImageAttachment(attachment);
    if (imageBlock) {
      blocks.push(imageBlock);
    }
  }

  return blocks;
}

export function stripTransientInputBlockData(
  blocks: InputContentBlock[] | null | undefined,
): InputContentBlockSummary[] | null | undefined {
  if (!blocks) {
    return blocks;
  }

  return blocks.map((block) => {
    switch (block.type) {
      case 'text':
        return {
          type: 'text',
          text: block.text,
        };
      case 'image': {
        const imageBytes = getBinaryBlockBytes(block.data, block.size);
        const size = normalizeSize(block.size);
        const { data: _data, ...safeBlock } = block;
        return {
          ...safeBlock,
          ...(size !== undefined ? { size } : {}),
          ...(block.data?.trim() || size !== undefined ? { imageBytes } : {}),
        };
      }
      case 'file_text': {
        const textBytes = block.textBytes ?? getUtf8ByteLength(block.text ?? '');
        const { text: _text, ...safeBlock } = block;
        return {
          ...safeBlock,
          textBytes,
        };
      }
      case 'file_reference':
      case 'attachment_metadata':
        return { ...block };
      default:
        return assertNever(block);
    }
  });
}

export function summarizeInputContentBlocksForTrace(
  blocks: InputContentBlock[] | null | undefined,
): string {
  let text = 0;
  let images = 0;
  let fileText = 0;
  let fileReferences = 0;
  let metadata = 0;
  let imageBytes = 0;

  for (const block of blocks ?? []) {
    switch (block.type) {
      case 'text':
        text += 1;
        break;
      case 'image':
        images += 1;
        imageBytes += getBinaryBlockBytes(block.data, block.size);
        break;
      case 'file_text':
        fileText += 1;
        break;
      case 'file_reference':
        fileReferences += 1;
        break;
      case 'attachment_metadata':
        metadata += 1;
        break;
      default:
        assertNever(block);
    }
  }

  return `text=${text}, images=${images}, fileText=${fileText}, fileReferences=${fileReferences}, metadata=${metadata}, imageBytes=${imageBytes}`;
}

function getBinaryBlockBytes(data?: string, size?: number) {
  const normalizedBase64 = normalizeBase64(data);
  if (normalizedBase64) {
    return getBase64ByteLength(normalizedBase64);
  }

  const normalizedSize = normalizeSize(size);
  return normalizedSize ?? 0;
}

function assertNever(value: never): never {
  const blockType =
    value && typeof value === 'object' && 'type' in value && typeof (value as { type?: unknown }).type === 'string'
      ? (value as { type: string }).type
      : 'unknown';
  throw new Error(`Unsupported input content block: ${blockType}`);
}

function normalizeProvidedContentBlocks(contentBlocks: InputContentBlock[] | null | undefined): InputContentBlock[] {
  if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
    return [];
  }

  return contentBlocks.flatMap((block) => {
    const normalizedBlock = normalizeContentBlock(block);
    return normalizedBlock ? [normalizedBlock] : [];
  });
}

function normalizeContentBlock(block: InputContentBlock): InputContentBlock | null {
  switch (block.type) {
    case 'text': {
      const text = block.text.trim();
      return text
        ? {
            type: 'text',
            text,
          }
        : null;
    }
    case 'image': {
      const path = trimOptionalString(block.path);
      const data = block.data?.trim();
      const mimeType = trimOptionalString(block.mimeType);
      if (!path && !data) {
        return null;
      }
      if (!path && data && !mimeType) {
        return null;
      }
      const name = trimOptionalString(block.name);

      return {
        type: 'image',
        ...(block.id ? { id: block.id } : {}),
        ...(path ? { path } : {}),
        ...(name ? { name } : {}),
        ...(mimeType ? { mimeType } : {}),
        ...(normalizeSize(block.size) !== undefined ? { size: normalizeSize(block.size) } : {}),
        ...(data ? { data } : {}),
      };
    }
    case 'file_text': {
      const path = block.path.trim();
      const name = block.name.trim();
      const text = block.text;
      if (!path || !name || text.length === 0) {
        return null;
      }

      return {
        type: 'file_text',
        ...(block.id ? { id: block.id } : {}),
        path,
        name,
        ...(trimOptionalString(block.mimeType) ? { mimeType: trimOptionalString(block.mimeType) } : {}),
        ...(normalizeSize(block.size) !== undefined ? { size: normalizeSize(block.size) } : {}),
        text,
      };
    }
    case 'file_reference': {
      const path = block.path.trim();
      const name = block.name.trim();
      if (!path || !name) {
        return null;
      }

      return {
        type: 'file_reference',
        ...(block.id ? { id: block.id } : {}),
        path,
        name,
        ...(trimOptionalString(block.mimeType) ? { mimeType: trimOptionalString(block.mimeType) } : {}),
        ...(normalizeSize(block.size) !== undefined ? { size: normalizeSize(block.size) } : {}),
        ...(normalizeReferenceReason(block.reason) ? { reason: normalizeReferenceReason(block.reason) } : {}),
      };
    }
    case 'attachment_metadata': {
      const name = block.name.trim();
      const reason = block.reason?.trim();
      if (!name || !reason) {
        return null;
      }

      return {
        type: 'attachment_metadata',
        ...(block.id ? { id: block.id } : {}),
        name,
        ...(trimOptionalString(block.mimeType) ? { mimeType: trimOptionalString(block.mimeType) } : {}),
        ...(normalizeSize(block.size) !== undefined ? { size: normalizeSize(block.size) } : {}),
        reason,
      };
    }
    default:
      return assertNever(block);
  }
}

function normalizeLegacyImageAttachment(attachment: UserImageAttachment): InputContentBlock | null {
  const path = trimOptionalString(attachment.path);
  const data = attachment.data?.trim();
  const name = trimOptionalString(attachment.name);
  const mimeType = trimOptionalString(attachment.mimeType);
  if ((!mimeType && !path) || (!path && !data)) {
    return null;
  }

  return {
    type: 'image',
    ...(attachment.id ? { id: attachment.id } : {}),
    ...(path ? { path } : {}),
    ...(name ? { name } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(normalizeSize(attachment.size) !== undefined ? { size: normalizeSize(attachment.size) } : {}),
    ...(data ? { data } : {}),
  };
}

function trimOptionalString(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeReferenceReason(value?: InputReferenceReason) {
  return value === 'too_large' || value === 'binary' || value === 'unsupported' || value === 'provider_unsupported'
    ? value
    : undefined;
}

function normalizeSize(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeBase64(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/\s+/g, '');
}

function getBase64ByteLength(base64: string) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const computed = Math.floor((base64.length * 3) / 4) - padding;
  return computed >= 0 ? computed : 0;
}

function getUtf8ByteLength(value: string) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }

  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}
