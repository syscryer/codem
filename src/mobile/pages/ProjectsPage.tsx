import { useState } from 'react';
import { ChevronDown, FolderKanban } from 'lucide-react';
import type { MobileProject } from '../types';

export function ProjectsPage({ projects, onOpen }: { projects: MobileProject[]; onOpen: (id: string) => void; onNew: () => void }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(projects.filter((project) => project.recentTasks.length > 0).map((project) => project.id)),
  );
  const toggleProject = (projectId: string) => setExpandedIds((current) => {
    const next = new Set(current);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    return next;
  });

  return <section className="prototype-section prototype-first-section"><h2>本地项目</h2><div className="prototype-grouped-list">{projects.length ? projects.map((project) => {
    const expanded = expandedIds.has(project.id);
    const contentId = `mobile-project-${project.id}`;
    return <div className={`prototype-project-block ${expanded ? 'expanded' : ''}`} key={project.id}><button type="button" className="prototype-project-row" aria-expanded={expanded} aria-controls={contentId} onClick={() => toggleProject(project.id)}><span className={`prototype-task-icon ${project.runningTaskCount ? 'status-running' : 'neutral'}`}><FolderKanban size={18} /></span><span><strong>{project.name}</strong><small>{project.pathLabel} · {project.branch || '未识别分支'} · {project.dirty ? '有改动' : '工作区干净'}</small></span><span className="mobile-project-state">{project.runningTaskCount ? <b>{project.runningTaskCount} 运行中</b> : null}<ChevronDown size={17} aria-hidden="true" /></span></button>{expanded ? <div id={contentId} className="mobile-project-content">{project.recentTasks.length ? project.recentTasks.slice(0, 3).map((task) => <button className="mobile-project-task" key={task.threadId} onClick={() => onOpen(task.threadId)}><span>{task.title}</span><small>{task.providerLabel}</small></button>) : <div className="mobile-project-empty">暂无最近会话</div>}</div> : null}</div>;
  }) : <div className="mobile-empty-row">电脑端还没有项目</div>}</div></section>;
}
