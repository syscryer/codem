import { Code2, Home, MoreHorizontal, Play, SquareSplitHorizontal, TerminalSquare } from 'lucide-react';
import type { ProjectSummary, ThreadDetail } from '../types';

type ChatHeaderProps = {
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  onToggleDebug: () => void;
  onUseProjectWorkspace: () => void;
};

export function ChatHeader({
  activeProject,
  activeThread,
  onToggleDebug,
  onUseProjectWorkspace,
}: ChatHeaderProps) {
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
        <button type="button" className="editor-button" title="用编辑器打开">
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
        <button type="button" className="diff-chip">
          <span className="add">+407</span>
          <span className="del">-66</span>
        </button>
        <button type="button" className="icon-button" title="布局">
          <SquareSplitHorizontal size={14} />
        </button>
      </div>
    </header>
  );
}
