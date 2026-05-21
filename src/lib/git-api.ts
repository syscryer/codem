import type {
  GitBranchCreateResult,
  GitCommitResult,
  GitPushPreview,
  GitPushResult,
  GitRemoteSyncResult,
  GitStatusSnapshot,
} from '../types';

async function readError(response: Response) {
  const message = await response.text();
  return message || 'Git 操作失败';
}

export async function fetchGitStatus(projectId: string) {
  const response = await fetch(`/api/projects/${projectId}/git/status`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitStatusSnapshot;
}

export async function fetchGitFileDiff(projectId: string, filePath: string) {
  const response = await fetch(`/api/projects/${projectId}/git/diff?path=${encodeURIComponent(filePath)}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as { path: string; content: string };
}

export async function fetchGitPushPreview(projectId: string) {
  const response = await fetch(`/api/projects/${projectId}/git/push-preview`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitPushPreview;
}

export async function commitGitChanges(projectId: string, files: string[], message: string) {
  const response = await fetch(`/api/projects/${projectId}/git/commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files, message }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitCommitResult;
}

export async function pushGitBranch(projectId: string, remote?: string, branch?: string) {
  const response = await fetch(`/api/projects/${projectId}/git/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ remote, branch }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitPushResult;
}

export async function fetchGitRemote(projectId: string, remote?: string) {
  const response = await fetch(`/api/projects/${projectId}/git/fetch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ remote }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitRemoteSyncResult;
}

export async function pullGitBranch(projectId: string, remote?: string, branch?: string) {
  const response = await fetch(`/api/projects/${projectId}/git/pull`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ remote, branch }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitRemoteSyncResult;
}

export async function createGitBranch(projectId: string, branch: string) {
  const response = await fetch(`/api/projects/${projectId}/git/branch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ branch }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitBranchCreateResult;
}
