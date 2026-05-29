import type {
  GitBranchCompareResult,
  GitFileDiffPreview,
  GitBranchCreateResult,
  GitBranchDeleteResult,
  GitCommitFilePreview,
  GitConflictFileDetail,
  GitCommitResult,
  GitHistoryCommit,
  GitHistoryCommitDetails,
  GitHistoryLogResponse,
  GitOperationState,
  GitPullMode,
  GitPushPreview,
  GitPushResult,
  GitRefCheckoutResult,
  GitRemoteSyncResult,
  GitTagCreateResult,
  GitStatusSnapshot,
  UndoConversationChange,
  UndoConversationChangeResult,
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

  return (await response.json()) as GitFileDiffPreview;
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

export async function pullGitBranch(
  projectId: string,
  remote?: string,
  branch?: string,
  mode?: GitPullMode,
) {
  const response = await fetch(`/api/projects/${projectId}/git/pull`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ remote, branch, mode }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitRemoteSyncResult;
}

export async function fetchGitOperationState(projectId: string) {
  const response = await fetch(`/api/projects/${projectId}/git/operation-state`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitOperationState;
}

export async function fetchGitConflictFile(projectId: string, filePath: string) {
  const response = await fetch(`/api/projects/${projectId}/git/conflicts/file?path=${encodeURIComponent(filePath)}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitConflictFileDetail;
}

export async function saveGitConflictResult(projectId: string, filePath: string, content: string) {
  const response = await fetch(`/api/projects/${projectId}/git/conflicts/save-result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: filePath, content }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitConflictFileDetail;
}

export async function markGitConflictResolved(projectId: string, filePath: string) {
  const response = await fetch(`/api/projects/${projectId}/git/conflicts/mark-resolved`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: filePath }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitOperationState;
}

export async function continueGitOperation(projectId: string) {
  const response = await fetch(`/api/projects/${projectId}/git/operation/continue`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitOperationState;
}

export async function abortGitOperation(projectId: string) {
  const response = await fetch(`/api/projects/${projectId}/git/operation/abort`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitOperationState;
}

export async function createGitBranch(projectId: string, branch: string) {
  return createGitBranchFromSource(projectId, branch);
}

export async function createGitBranchFromSource(projectId: string, branch: string, source?: string) {
  const response = await fetch(`/api/projects/${projectId}/git/branch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ branch, source }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitBranchCreateResult;
}

export async function createGitTag(projectId: string, tag: string, source?: string) {
  const response = await fetch(`/api/projects/${projectId}/git/tag`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tag, source }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitTagCreateResult;
}

export async function cherryPickGitCommit(projectId: string, sha: string) {
  const response = await fetch(`/api/projects/${projectId}/git/cherry-pick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sha }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitRefCheckoutResult;
}

export async function checkoutGitDetachedRef(projectId: string, ref: string) {
  const response = await fetch(`/api/projects/${projectId}/git/checkout-detached`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitRefCheckoutResult;
}

export async function deleteGitBranch(
  projectId: string,
  branch: { name: string; remoteName?: string | null },
) {
  const response = await fetch(`/api/projects/${projectId}/git/branch/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ branch: branch.name, remote: branch.remoteName ?? undefined }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitBranchDeleteResult;
}

export async function fetchGitHistory(projectId: string, options?: { ref?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (options?.ref) {
    params.set('ref', options.ref);
  }
  if (options?.limit) {
    params.set('limit', String(options.limit));
  }
  const query = params.toString();
  const response = await fetch(`/api/projects/${projectId}/git/history${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitHistoryCommit[];
}

export async function fetchGitHistoryLog(
  projectId: string,
  options?: {
    refs?: string[];
    authors?: string[];
    dateFrom?: string;
    dateTo?: string;
    paths?: string[];
    search?: string;
    limit?: number;
    cursor?: string | null;
  },
) {
  const params = new URLSearchParams();
  for (const ref of options?.refs ?? []) {
    if (ref.trim()) {
      params.append('refs', ref.trim());
    }
  }
  for (const author of options?.authors ?? []) {
    if (author.trim()) {
      params.append('authors', author.trim());
    }
  }
  for (const filePath of options?.paths ?? []) {
    if (filePath.trim()) {
      params.append('paths', filePath.trim());
    }
  }
  if (options?.dateFrom) {
    params.set('dateFrom', options.dateFrom);
  }
  if (options?.dateTo) {
    params.set('dateTo', options.dateTo);
  }
  if (options?.search) {
    params.set('search', options.search);
  }
  if (options?.limit) {
    params.set('limit', String(options.limit));
  }
  if (options?.cursor) {
    params.set('cursor', options.cursor);
  }

  const query = params.toString();
  const response = await fetch(`/api/projects/${projectId}/git/history/log${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitHistoryLogResponse;
}

export async function compareGitBranches(projectId: string, targetBranch: string, compareBranch: string) {
  const response = await fetch(
    `/api/projects/${projectId}/git/history/compare?targetBranch=${encodeURIComponent(targetBranch)}&compareBranch=${encodeURIComponent(compareBranch)}`,
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitBranchCompareResult;
}

export async function fetchGitCommitDetails(projectId: string, sha: string) {
  const response = await fetch(`/api/projects/${projectId}/git/history/commit?sha=${encodeURIComponent(sha)}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitHistoryCommitDetails;
}

export async function fetchGitCommitFilePreview(projectId: string, sha: string, filePath: string) {
  const response = await fetch(
    `/api/projects/${projectId}/git/history/file?sha=${encodeURIComponent(sha)}&path=${encodeURIComponent(filePath)}`,
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as GitCommitFilePreview;
}

export async function undoConversationChanges(projectId: string, changes: UndoConversationChange[]) {
  const response = await fetch(`/api/projects/${projectId}/git/undo-turn-changes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ changes }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as UndoConversationChangeResult;
}
