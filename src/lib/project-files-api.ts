import type { ProjectFileEntry } from '../types';

async function readError(response: Response) {
  const message = await response.text();
  return message || '读取项目文件失败';
}

export async function fetchProjectFiles(projectId: string, directory = '') {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : '';
  const response = await fetch(`/api/projects/${projectId}/files${query}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as ProjectFileEntry[];
}
