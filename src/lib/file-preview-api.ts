import { resolveApiUrl } from './api-fetch-bridge.js';

export type WorkspaceFilePreview =
  | {
      path: string;
      content: string;
      mode?: 'code' | 'markdown';
    }
  | {
      path: string;
      content: string;
      mode: 'image';
      previewUrl: string;
    };

async function readError(response: Response) {
  const message = await response.text();
  return message || '文件预览失败';
}

export function buildWorkspaceImagePreviewUrl(filePath: string) {
  return resolveApiUrl(`/api/system/image-preview?path=${encodeURIComponent(filePath)}`);
}

export function buildDesktopImagePreviewUrl(filePath: string) {
  return resolveApiUrl(`/api/system/attachments/image-preview?path=${encodeURIComponent(filePath)}`);
}

export async function fetchWorkspaceFilePreview(filePath: string) {
  const response = await fetch(`/api/system/file-preview?path=${encodeURIComponent(filePath)}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const preview = (await response.json()) as WorkspaceFilePreview;
  if (preview.mode === 'image') {
    return {
      ...preview,
      previewUrl: resolveApiUrl(preview.previewUrl),
    } satisfies WorkspaceFilePreview;
  }

  return preview;
}
