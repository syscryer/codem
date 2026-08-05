import type { ProjectSummary } from '../types';

export type AgentMuxWorkspaceGroup<T> = {
  key: string;
  name: string;
  path: string;
  runs: T[];
};

export function groupAgentMuxRunsByWorkspace<T extends { workingDirectory?: string | null }>(
  runs: T[],
  projects: Array<Pick<ProjectSummary, 'name' | 'path'>>,
) {
  const projectsByPath = new Map(projects.map((project) => [normalizeWorkspacePath(project.path), project]));
  const groups = new Map<string, AgentMuxWorkspaceGroup<T>>();

  for (const run of runs) {
    const path = run.workingDirectory?.trim() || '';
    const key = path ? normalizeWorkspacePath(path) : '__unassigned__';
    const project = projectsByPath.get(key);
    const group = groups.get(key) ?? {
      key,
      name: project?.name ?? workspaceNameFromPath(path),
      path: path || '未记录工作目录',
      runs: [],
    };
    group.runs.push(run);
    groups.set(key, group);
  }

  return [...groups.values()];
}

function normalizeWorkspacePath(path: string) {
  return path.trim().replace(/[\\/]+$/, '').replace(/\//g, '\\').toLocaleLowerCase();
}

function workspaceNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || '未关联工作区';
}
