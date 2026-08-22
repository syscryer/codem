import { useState } from 'react';
import { ChevronDown, FolderKanban } from 'lucide-react';
import type { MobileProject } from '../types';

const EXPANDED_PROJECTS_STORAGE_KEY = 'codem-mobile-expanded-projects';

function loadExpandedProjectIds(): Set<string> {
  try {
    const stored = localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY);
    const ids: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(ids)) return new Set();
    return new Set(ids.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

export function ProjectsPage({ projects, onOpen }: { projects: MobileProject[]; onOpen: (id: string) => void; onNew: () => void }) {
  // 默认全部收起，仅记住用户手动展开过的项目
  const [expandedIds, setExpandedIds] = useState<Set<string>>(loadExpandedProjectIds);
  const toggleProject = (projectId: string) => setExpandedIds((current) => {
    const next = new Set(current);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    const knownIds = new Set(projects.map((project) => project.id));
    try {
      localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify([...next].filter((id) => knownIds.has(id))));
    } catch {
      // 存储不可用时仅保留本次会话内的展开状态
    }
    return next;
  });

  return <section className="prototype-section prototype-first-section"><h2>本地项目</h2><div className="prototype-grouped-list">{projects.length ? projects.map((project) => {
    const expanded = expandedIds.has(project.id);
    const contentId = `mobile-project-${project.id}`;
    return <div className={`prototype-project-block ${expanded ? 'expanded' : ''}`} key={project.id}><button type="button" className="prototype-project-row" aria-expanded={expanded} aria-controls={contentId} onClick={() => toggleProject(project.id)}><span className={`prototype-task-icon ${project.runningTaskCount ? 'status-running' : 'neutral'}`}><FolderKanban size={18} /></span><span><strong>{project.name}</strong><small>{project.pathLabel} · {project.branch || '未识别分支'} · {project.dirty ? '有改动' : '工作区干净'}</small></span><span className="mobile-project-state">{project.runningTaskCount ? <b>{project.runningTaskCount} 运行中</b> : null}<ChevronDown size={17} aria-hidden="true" /></span></button>{expanded ? <div id={contentId} className="mobile-project-content">{project.recentTasks.length ? project.recentTasks.slice(0, 3).map((task) => <button className="mobile-project-task" key={task.threadId} onClick={() => onOpen(task.threadId)}><span>{task.title}</span><small>{task.providerLabel}</small></button>) : <div className="mobile-project-empty">暂无最近会话</div>}</div> : null}</div>;
  }) : <div className="mobile-empty-row">电脑端还没有项目</div>}</div></section>;
}
