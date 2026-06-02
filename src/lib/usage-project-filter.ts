import type { UsageProjectRow } from '../types';

export function filterUsageProjects(projects: UsageProjectRow[], query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return projects;
  }

  return projects.filter((project) => {
    const searchable = `${project.projectName} ${project.projectPath} ${project.projectId}`.toLowerCase();
    return searchable.includes(keyword);
  });
}
