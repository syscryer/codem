import type { GitCreateWorktreeResult, GitWorktreeList, WorkspaceBootstrap } from '../types';

export type CreateWorktreePayload = {
  branch: string;
  path: string;
  base: string;
  addProject: boolean;
};

export async function fetchProjectWorktrees(projectId: string): Promise<GitWorktreeList> {
  const response = await fetch(`/api/projects/${projectId}/git/worktrees`);
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as GitWorktreeList;
}

export async function suggestProjectWorktreePath(projectId: string, branch: string): Promise<string> {
  const response = await fetch(
    `/api/projects/${projectId}/git/worktrees/suggest-path?branch=${encodeURIComponent(branch)}`,
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return ((await response.json()) as { path: string }).path;
}

export async function createProjectWorktree(
  projectId: string,
  payload: CreateWorktreePayload,
): Promise<GitCreateWorktreeResult> {
  const response = await fetch(`/api/projects/${projectId}/git/worktrees`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as GitCreateWorktreeResult;
}

export async function removeProjectWorktree(projectId: string, worktreePath: string): Promise<WorkspaceBootstrap> {
  const response = await fetch(`/api/projects/${projectId}/git/worktrees`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: worktreePath }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return ((await response.json()) as { workspace: WorkspaceBootstrap }).workspace;
}
