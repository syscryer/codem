import { GitBranch, LayoutPanelLeft } from 'lucide-react';
import type { ProjectSummary, ThreadDetail } from '../types';

type WorkspaceStatusProps = {
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
};

export function WorkspaceStatus({ activeProject, activeThread }: WorkspaceStatusProps) {
  return (
    <footer className="workspace-status">
      <span className="status-item status-workspace">
        <LayoutPanelLeft size={12} />
        <span>本地工作</span>
      </span>
      <span className="status-item status-branch">
        <GitBranch size={12} />
        <span>{activeProject?.gitBranch ?? '未检测到 Git'}</span>
        {activeProject?.gitBranch ? <span className="footer-chevron" aria-hidden="true" /> : null}
      </span>
      <span className="status-spacer" />
      <span>{activeThread?.sessionId ? 'session 已连接' : '新会话'}</span>
    </footer>
  );
}
