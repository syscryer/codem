import {
  AlertTriangle,
  CloudUpload,
  Copy,
  ChevronDown,
  GitBranchPlus,
  LoaderCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  createGitBranch,
  fetchGitPushPreview,
  fetchGitStatus,
} from '../lib/git-api';
import type { GitPushPreview, GitStatusSnapshot, ProjectSummary } from '../types';

type GitDialogMode = 'push' | 'branch';

type GitDialogProps = {
  mode: GitDialogMode;
  project: ProjectSummary;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onPush: (project: ProjectSummary, preview: GitPushPreview) => Promise<void>;
  pushRunning: boolean;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export function GitDialog({ mode, project, onClose, onChanged, onPush, pushRunning, showToast }: GitDialogProps) {
  const [activeMode, setActiveMode] = useState<GitDialogMode>(mode);
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);
  const [pushPreview, setPushPreview] = useState<GitPushPreview | null>(null);
  const [branchName, setBranchName] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const branchSubmitDisabled = working || !branchName.trim();

  useEffect(() => {
    setActiveMode(mode);
  }, [mode]);

  useEffect(() => {
    void loadData(activeMode);
  }, [activeMode, project.id]);

  async function loadData(nextMode = activeMode) {
    setLoading(true);
    setError('');
    try {
      const nextStatus = await fetchGitStatus(project.id);
      setStatus(nextStatus);

      if (nextMode === 'push') {
        setPushPreview(await fetchGitPushPreview(project.id));
      } else {
        setPushPreview(null);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '读取 Git 信息失败');
    } finally {
      setLoading(false);
    }
  }

  async function handlePush() {
    if (!pushPreview || working || pushRunning) {
      return;
    }

    setWorking(true);
    setError('');
    try {
      await onPush(project, pushPreview);
      onClose();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '推送失败');
    } finally {
      setWorking(false);
    }
  }

  async function handleCreateBranch() {
    if (branchSubmitDisabled) {
      return;
    }

    setWorking(true);
    setError('');
    try {
      const result = await createGitBranch(project.id, branchName.trim());
      finishSuccessfulOperation(`已创建并切换到分支 ${result.branch}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '创建分支失败');
    } finally {
      setWorking(false);
    }
  }

  function finishSuccessfulOperation(messageText: string) {
    onClose();
    showToast(messageText);
    void Promise.resolve(onChanged()).catch((caughtError: unknown) => {
      showToast(caughtError instanceof Error ? caughtError.message : '刷新 Git 状态失败', 'error');
    });
  }

  return (
    <div className="dialog-backdrop git-dialog-backdrop" role="presentation">
      <section className="dialog-card git-dialog-card" role="dialog" aria-modal="true" aria-label="Git 操作">
        <header className="git-dialog-head">
          <div className="git-dialog-title-block">
            <div className="git-dialog-title-row">
              <div className="git-dialog-heading">
                <span className="git-dialog-kicker">Git 操作</span>
                <h3>{activeMode === 'push' ? '推送提交' : '创建分支'}</h3>
              </div>
              <div className="git-dialog-mode-strip" role="tablist" aria-label="Git 操作">
                <button
                  type="button"
                  className={activeMode === 'push' ? 'active' : ''}
                  onClick={() => setActiveMode('push')}
                >
                  <CloudUpload size={15} />
                  推送
                </button>
                <button
                  type="button"
                  className={activeMode === 'branch' ? 'active' : ''}
                  onClick={() => setActiveMode('branch')}
                >
                  <GitBranchPlus size={15} />
                  分支
                </button>
              </div>
            </div>
            <p className="git-dialog-meta">{project.name} · {status?.branch ?? project.gitBranch ?? '未检测到分支'}</p>
          </div>
          <div className="git-dialog-head-actions">
            <button
              type="button"
              className="git-refresh-button"
              disabled={loading || working || pushRunning}
              onClick={() => void loadData(activeMode)}
            >
              <RefreshCw size={15} />
              刷新
            </button>
            <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
              <X size={17} />
            </button>
          </div>
        </header>

        {error ? <GitDialogNotice message={error} /> : null}

        {loading ? (
          <div className="git-dialog-loading">
            <LoaderCircle className="spin" size={18} />
            正在读取 Git 信息...
          </div>
        ) : error && activeMode === 'push' && !pushPreview ? (
          <div className="git-empty git-push-empty">修复上方提示后刷新，即可重新读取推送信息。</div>
        ) : activeMode === 'push' ? (
          <PushPanel preview={pushPreview} working={working || pushRunning} onPush={() => void handlePush()} />
        ) : (
          <BranchPanel
            project={project}
            currentBranch={status?.branch ?? project.gitBranch ?? '未检测到分支'}
            branchName={branchName}
            working={working}
            submitDisabled={branchSubmitDisabled}
            onBranchNameChange={setBranchName}
            onCreateBranch={() => void handleCreateBranch()}
          />
        )}
      </section>
    </div>
  );
}

function GitDialogNotice({ message }: { message: string }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const summary = summarizeGitDialogNotice(message);

  async function copyDetail() {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      // 复制失败时保留原提示，不额外打扰用户。
    }
  }

  return (
    <section className="git-dialog-notice" aria-label="Git 提示">
      <AlertTriangle size={17} />
      <div className="git-dialog-notice-main">
        <strong>{summary.title}</strong>
        <span>{summary.description}</span>
        <div className="git-dialog-notice-actions">
          <button type="button" onClick={() => setDetailOpen((value) => !value)}>
            <ChevronDown size={13} className={detailOpen ? 'expanded' : undefined} />
            {detailOpen ? '收起详情' : '查看详情'}
          </button>
          <button type="button" onClick={() => void copyDetail()}>
            <Copy size={13} />
            复制详情
          </button>
        </div>
        {detailOpen ? (
          <div className="git-dialog-notice-detail">
            <pre>{message}</pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function summarizeGitDialogNotice(message: string) {
  const normalizedMessage = message.toLowerCase();
  if (normalizedMessage.includes('filename too long') || normalizedMessage.includes('could not open directory')) {
    return {
      title: '部分路径过长，Git 状态读取受限',
      description: '通常是缓存或依赖目录路径过深导致。详细日志已折叠，可展开查看或复制。',
    };
  }

  return {
    title: 'Git 操作失败',
    description: getFirstGitDialogNoticeLine(message) || '请展开详情查看 Git 返回的完整信息。',
  };
}

function getFirstGitDialogNoticeLine(message: string) {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function PushPanel({
  preview,
  working,
  onPush,
}: {
  preview: GitPushPreview | null;
  working: boolean;
  onPush: () => void;
}) {
  if (!preview) {
    return <div className="git-empty git-push-empty">没有可显示的推送信息。</div>;
  }

  return (
    <div className="git-push-panel">
      <div className="git-push-target">
        <CloudUpload size={20} />
        <div>
          <strong>{preview.branch} → {preview.remote}/{preview.targetBranch}</strong>
          <span>待推送 {preview.commits.length || preview.ahead} 个提交</span>
        </div>
      </div>
      <div className="git-push-commits">
        {preview.commits.length === 0 ? (
          <div className="git-empty">当前没有本地领先提交。</div>
        ) : (
          preview.commits.map((commit) => <code key={commit}>{commit}</code>)
        )}
      </div>
      <div className="git-commit-actions">
        <button type="button" className="dialog-button primary" disabled={working} onClick={onPush}>
          {working ? (
            <>
              <LoaderCircle className="spin" size={14} />
              推送中
            </>
          ) : (
            '推送'
          )}
        </button>
      </div>
    </div>
  );
}

function BranchPanel({
  project,
  currentBranch,
  branchName,
  working,
  submitDisabled,
  onBranchNameChange,
  onCreateBranch,
}: {
  project: ProjectSummary;
  currentBranch: string;
  branchName: string;
  working: boolean;
  submitDisabled: boolean;
  onBranchNameChange: (value: string) => void;
  onCreateBranch: () => void;
}) {
  return (
    <div className="git-branch-panel">
      <div className="git-branch-summary">
        <GitBranchPlus size={20} />
        <div>
          <strong>从当前分支创建新分支</strong>
          <span>{project.name} · 当前分支 {currentBranch}</span>
        </div>
      </div>
      <label className="git-branch-field">
        <span>分支名</span>
        <input
          className="dialog-input git-branch-input"
          value={branchName}
          placeholder="例如 feature/login-refactor"
          onChange={(event) => onBranchNameChange(event.target.value)}
        />
      </label>
      <div className="git-commit-actions">
        <button type="button" className="dialog-button primary" disabled={submitDisabled || working} onClick={onCreateBranch}>
          创建并切换
        </button>
      </div>
    </div>
  );
}
