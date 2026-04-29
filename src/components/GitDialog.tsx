import {
  CheckSquare,
  CloudUpload,
  FileText,
  GitCommitHorizontal,
  LoaderCircle,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  commitGitChanges,
  fetchGitFileDiff,
  fetchGitPushPreview,
  fetchGitStatus,
  pushGitBranch,
} from '../lib/git-api';
import type { GitFileStatus, GitPushPreview, GitStatusSnapshot, ProjectSummary } from '../types';

type GitDialogMode = 'commit' | 'push';

type GitDialogProps = {
  mode: GitDialogMode;
  project: ProjectSummary;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export function GitDialog({ mode, project, onClose, onChanged, showToast }: GitDialogProps) {
  const [activeMode, setActiveMode] = useState<GitDialogMode>(mode);
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);
  const [pushPreview, setPushPreview] = useState<GitPushPreview | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState('');
  const [diff, setDiff] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [diffLoading, setDiffLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const files = status?.files ?? [];
  const selectedFiles = useMemo(
    () => files.filter((file) => selectedPaths.has(file.path)),
    [files, selectedPaths],
  );
  const allSelected = files.length > 0 && selectedFiles.length === files.length;
  const submitDisabled = working || selectedFiles.length === 0 || !message.trim();

  useEffect(() => {
    setActiveMode(mode);
  }, [mode]);

  useEffect(() => {
    void loadData(activeMode);
  }, [activeMode, project.id]);

  useEffect(() => {
    if (!activePath) {
      setDiff('');
      return;
    }

    let cancelled = false;
    setDiffLoading(true);
    fetchGitFileDiff(project.id, activePath)
      .then((payload) => {
        if (!cancelled) {
          setDiff(payload.content);
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setDiff(caughtError instanceof Error ? caughtError.message : '读取差异失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDiffLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePath, project.id]);

  async function loadData(nextMode = activeMode) {
    setLoading(true);
    setError('');
    try {
      const nextStatus = await fetchGitStatus(project.id);
      setStatus(nextStatus);
      setSelectedPaths(new Set(nextStatus.files.map((file) => file.path)));
      setActivePath(nextStatus.files[0]?.path ?? '');

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

  function toggleFile(file: GitFileStatus) {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(file.path)) {
        next.delete(file.path);
      } else {
        next.add(file.path);
      }
      return next;
    });
  }

  function toggleAllFiles() {
    setSelectedPaths(allSelected ? new Set() : new Set(files.map((file) => file.path)));
  }

  async function handleCommit(thenPush: boolean) {
    if (submitDisabled) {
      return;
    }

    setWorking(true);
    setError('');
    try {
      await commitGitChanges(project.id, selectedFiles.map((file) => file.path), message);
      if (thenPush) {
        const preview = await fetchGitPushPreview(project.id);
        await pushGitBranch(project.id, preview.remote, preview.targetBranch);
        finishSuccessfulOperation('提交并推送完成');
      } else {
        finishSuccessfulOperation('提交完成');
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '提交失败');
    } finally {
      setWorking(false);
    }
  }

  async function handlePush() {
    if (!pushPreview || working) {
      return;
    }

    setWorking(true);
    setError('');
    try {
      await pushGitBranch(project.id, pushPreview.remote, pushPreview.targetBranch);
      finishSuccessfulOperation('推送完成');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '推送失败');
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
          <div>
            <span className="git-dialog-kicker">Git 操作</span>
            <h3>{activeMode === 'commit' ? '提交变更' : '推送提交'}</h3>
            <p>{project.name} · {status?.branch ?? project.gitBranch ?? '未检测到分支'}</p>
          </div>
          <div className="git-dialog-head-actions">
            <button
              type="button"
              className="git-refresh-button"
              disabled={loading || working}
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

        <div className="git-dialog-tabs" role="tablist" aria-label="Git 操作">
          <button
            type="button"
            className={activeMode === 'commit' ? 'active' : ''}
            onClick={() => setActiveMode('commit')}
          >
            <GitCommitHorizontal size={16} />
            提交
          </button>
          <button
            type="button"
            className={activeMode === 'push' ? 'active' : ''}
            onClick={() => setActiveMode('push')}
          >
            <CloudUpload size={16} />
            推送
          </button>
        </div>

        {error ? <div className="dialog-error git-dialog-error">{error}</div> : null}

        {loading ? (
          <div className="git-dialog-loading">
            <LoaderCircle className="spin" size={18} />
            正在读取 Git 信息...
          </div>
        ) : activeMode === 'commit' ? (
          <CommitPanel
            files={files}
            allSelected={allSelected}
            selectedPaths={selectedPaths}
            activePath={activePath}
            diff={diff}
            diffLoading={diffLoading}
            message={message}
            submitDisabled={submitDisabled}
            onToggleAll={toggleAllFiles}
            onToggleFile={toggleFile}
            onSelectFile={setActivePath}
            onMessageChange={setMessage}
            onCommit={() => void handleCommit(false)}
            onCommitAndPush={() => void handleCommit(true)}
          />
        ) : (
          <PushPanel preview={pushPreview} working={working} onPush={() => void handlePush()} />
        )}
      </section>
    </div>
  );
}

function CommitPanel({
  files,
  allSelected,
  selectedPaths,
  activePath,
  diff,
  diffLoading,
  message,
  submitDisabled,
  onToggleAll,
  onToggleFile,
  onSelectFile,
  onMessageChange,
  onCommit,
  onCommitAndPush,
}: {
  files: GitFileStatus[];
  allSelected: boolean;
  selectedPaths: Set<string>;
  activePath: string;
  diff: string;
  diffLoading: boolean;
  message: string;
  submitDisabled: boolean;
  onToggleAll: () => void;
  onToggleFile: (file: GitFileStatus) => void;
  onSelectFile: (path: string) => void;
  onMessageChange: (message: string) => void;
  onCommit: () => void;
  onCommitAndPush: () => void;
}) {
  return (
    <div className="git-commit-layout">
      <aside className="git-file-pane">
        <button type="button" className="git-file-head" onClick={onToggleAll}>
          {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
          <span>变更文件</span>
          <small>{files.length} 个文件</small>
        </button>
        <div className="git-file-list">
          {files.length === 0 ? (
            <div className="git-empty">当前没有可提交变更。</div>
          ) : (
            files.map((file) => (
              <button
                key={file.path}
                type="button"
                className={`git-file-row${activePath === file.path ? ' active' : ''}`}
                onClick={() => onSelectFile(file.path)}
              >
                <span
                  className="git-file-check"
                  role="checkbox"
                  aria-checked={selectedPaths.has(file.path)}
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFile(file);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      onToggleFile(file);
                    }
                  }}
                >
                  {selectedPaths.has(file.path) ? <CheckSquare size={15} /> : <Square size={15} />}
                </span>
                <FileText size={15} />
                <span className="git-file-path" title={file.path}>{file.path}</span>
                <small>{file.status}</small>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="git-diff-pane">
        <div className="git-diff-head">
          <strong>{activePath || '未选择文件'}</strong>
          {diffLoading ? <span>读取中...</span> : null}
        </div>
        <DiffPreview content={diff || '选择左侧文件查看差异。'} />
      </main>

      <footer className="git-commit-footer">
        <textarea
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          placeholder="提交消息"
          rows={3}
        />
        <div className="git-commit-actions">
          <button type="button" className="dialog-button secondary" disabled={submitDisabled} onClick={onCommitAndPush}>
            提交并推送
          </button>
          <button type="button" className="dialog-button primary" disabled={submitDisabled} onClick={onCommit}>
            提交
          </button>
        </div>
      </footer>
    </div>
  );
}

function DiffPreview({ content }: { content: string }) {
  return (
    <div className="git-diff-content" role="region" aria-label="文件差异预览">
      {content.split('\n').map((line, index) => (
        <div key={`${index}-${line}`} className={`git-diff-line ${getDiffLineClass(line)}`}>
          <span className="git-diff-line-no">{index + 1}</span>
          <span className="git-diff-line-text">{line || ' '}</span>
        </div>
      ))}
    </div>
  );
}

function getDiffLineClass(line: string) {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'added';
  }

  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'removed';
  }

  if (line.startsWith('@@')) {
    return 'hunk';
  }

  if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
    return 'meta';
  }

  return '';
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
          推送
        </button>
      </div>
    </div>
  );
}
