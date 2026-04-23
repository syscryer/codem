import { Code2, Home, MoreHorizontal, Play, SquareSplitHorizontal, TerminalSquare } from 'lucide-react';
import type { ProjectSummary, ThreadDetail } from '../types';

type ChatHeaderProps = {
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  onToggleDebug: () => void;
  onOpenEditor: () => void;
  onRefreshGitDiff: () => void;
  onUseProjectWorkspace: () => void;
};

export function ChatHeader({
  activeProject,
  activeThread,
  onToggleDebug,
  onOpenEditor,
  onRefreshGitDiff,
  onUseProjectWorkspace,
}: ChatHeaderProps) {
  const gitDiff = activeProject?.gitDiff ?? { additions: 0, deletions: 0, filesChanged: 0 };
  const diffTitle = !activeProject
    ? '未选择项目'
    : activeProject.isGitRepo
      ? `${gitDiff.filesChanged} 个文件变更（点击刷新）`
      : '当前目录不是 Git 仓库';

  return (
    <header className="chat-header">
      <div className="thread-title">
        <h2>{activeThread?.title ?? '选择一个聊天'}</h2>
        <span className="thread-project">{activeProject?.name ?? '未选择项目'}</span>
        <button type="button" className="more-button thread-more-button" aria-label="更多">
          <MoreHorizontal size={15} />
        </button>
      </div>
      <div className="header-actions">
        <button type="button" className="icon-button" title="运行">
          <Play size={14} />
        </button>
        <button
          type="button"
          className="editor-button"
          title="用编辑器打开"
          disabled={!activeProject}
          onClick={onOpenEditor}
        >
          <Code2 className="editor-mark" size={16} />
          <span className="header-chevron" aria-hidden="true" />
        </button>
        <button type="button" className="pill-button">
          提交
          <span className="header-chevron" aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={onToggleDebug}>
          <TerminalSquare size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="使用当前项目目录"
          onClick={onUseProjectWorkspace}
        >
          <Home size={14} />
        </button>
        <button
          type="button"
          className="diff-chip"
          title={diffTitle}
          disabled={!activeProject?.isGitRepo}
          onClick={onRefreshGitDiff}
        >
          <span className="add">+{gitDiff.additions}</span>
          <span className="del">-{gitDiff.deletions}</span>
        </button>
        <button type="button" className="icon-button" title="布局">
          <SquareSplitHorizontal size={14} />
        </button>
      </div>
    </header>
  );
}
