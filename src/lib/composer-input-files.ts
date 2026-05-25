const MAX_INLINE_TEXT_BYTES = 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.env',
  '.go',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.properties',
  '.py',
  '.rs',
  '.scss',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGE_MIME_TYPE_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

export const supportedComposerUploadAccept = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.css',
  '.csv',
  '.env',
  '.go',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.properties',
  '.py',
  '.rs',
  '.scss',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
].join(',');

type ComposerUploadFileLike = {
  name: string;
  type: string;
  size: number;
};

export type ComposerFileClassification =
  | {
      kind: 'image';
      mimeType: string;
    }
  | {
      kind: 'text';
      mimeType: string;
    }
  | {
      kind: 'reference';
      reason: 'too_large';
    }
  | {
      kind: 'unsupported';
      reason: 'unsupported';
    };

export function classifyComposerFile(file: ComposerUploadFileLike): ComposerFileClassification {
  const mimeType = file.type.trim().toLowerCase();
  const extension = getLowercaseExtension(file.name);

  if (IMAGE_MIME_TYPES.has(mimeType)) {
    return { kind: 'image', mimeType };
  }
  if (IMAGE_MIME_TYPE_BY_EXTENSION.has(extension)) {
    return {
      kind: 'image',
      mimeType: IMAGE_MIME_TYPE_BY_EXTENSION.get(extension)!,
    };
  }

  if (!isTextLikeFile(file)) {
    return {
      kind: 'unsupported',
      reason: 'unsupported',
    };
  }

  if (file.size > MAX_INLINE_TEXT_BYTES) {
    return {
      kind: 'reference',
      reason: 'too_large',
    };
  }

  return {
    kind: 'text',
    mimeType: mimeType || 'text/plain',
  };
}

export function isSmallTextLikeFile(file: ComposerUploadFileLike) {
  return isTextLikeFile(file) && file.size <= MAX_INLINE_TEXT_BYTES;
}

function isTextLikeFile(file: ComposerUploadFileLike) {
  const mimeType = file.type.trim().toLowerCase();
  if (mimeType) {
    if (mimeType.startsWith('text/')) {
      return true;
    }
    if (mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('yaml')) {
      return true;
    }
  }

  return TEXT_EXTENSIONS.has(getLowercaseExtension(file.name));
}

function getLowercaseExtension(fileName: string) {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex < 0) {
    return '';
  }
  return fileName.slice(lastDotIndex).toLowerCase();
}
