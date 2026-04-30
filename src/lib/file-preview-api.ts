export type WorkspaceFilePreview = {
  path: string;
  content: string;
};

async function readError(response: Response) {
  const message = await response.text();
  return message || '文件预览失败';
}

export async function fetchWorkspaceFilePreview(filePath: string) {
  const response = await fetch(`/api/system/file-preview?path=${encodeURIComponent(filePath)}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as WorkspaceFilePreview;
}
