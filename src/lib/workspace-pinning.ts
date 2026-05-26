import type { PanelState, ProjectSummary, ThreadSummary } from '../types';

export type WorkspaceSidebarSections = {
  filteredProjects: ProjectSummary[];
  pinnedThreads: Array<ThreadSummary & { pinnedAt: string }>;
  pinnedProjects: ProjectSummary[];
  unpinnedProjects: ProjectSummary[];
};

export function buildWorkspaceSidebarSections(
  projects: ProjectSummary[],
  searchQuery: string,
  sortBy: PanelState['sortBy'],
): WorkspaceSidebarSections {
  const sortedProjects = sortProjects(projects, sortBy);
  const filteredProjects = filterProjects(sortedProjects, searchQuery);
  const pinnedThreads = sortedProjects
    .flatMap((project) => project.threads)
    .filter((thread): thread is ThreadSummary & { pinnedAt: string } => Boolean(thread.pinnedAt))
    .sort((left, right) => right.pinnedAt.localeCompare(left.pinnedAt));
  const pinnedThreadIds = new Set(pinnedThreads.map((thread) => thread.id));

  const pinnedProjects = sortedProjects
    .filter((project) => Boolean(project.pinnedAt))
    .map((project) => ({
      ...project,
      threads: project.threads.filter((thread) => !pinnedThreadIds.has(thread.id)),
    }))
    .sort((left, right) => (right.pinnedAt ?? '').localeCompare(left.pinnedAt ?? ''));

  const unpinnedProjects = filteredProjects
    .filter((project) => !project.pinnedAt)
    .map((project) => ({
      ...project,
      threads: project.threads.filter((thread) => !pinnedThreadIds.has(thread.id)),
    }));

  return {
    filteredProjects,
    pinnedThreads,
    pinnedProjects,
    unpinnedProjects,
  };
}

function sortProjects(projects: ProjectSummary[], sortBy: PanelState['sortBy']) {
  return [...projects].sort((left, right) => {
    const leftValue = sortBy === 'created' ? left.createdAt : left.updatedAt;
    const rightValue = sortBy === 'created' ? right.createdAt : right.updatedAt;
    return rightValue.localeCompare(leftValue);
  });
}

function filterProjects(projects: ProjectSummary[], searchQuery: string) {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return projects;
  }

  return projects
    .map((project) => {
      const matchesProject =
        project.name.toLowerCase().includes(normalizedQuery) ||
        project.path.toLowerCase().includes(normalizedQuery) ||
        (project.gitBranch ?? '').toLowerCase().includes(normalizedQuery);
      if (matchesProject) {
        return project;
      }

      const threads = project.threads.filter((thread) => thread.title.toLowerCase().includes(normalizedQuery));
      if (threads.length === 0) {
        return null;
      }

      return {
        ...project,
        threads,
      };
    })
    .filter(Boolean) as ProjectSummary[];
}
