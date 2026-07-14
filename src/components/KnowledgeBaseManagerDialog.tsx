import { BookOpen, FilePlus2, FolderPlus, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pickDesktopDirectory, pickDesktopFiles } from '../lib/desktop-dialog';
import {
  createAiKnowledgeBase,
  deleteAiKnowledgeBase,
  deleteAiKnowledgeSource,
  importAiKnowledgeSources,
  loadAiKnowledgeBase,
  rebuildAiKnowledgeBase,
} from '../lib/ordinary-chat-api';
import type { AiKnowledgeBaseDetail, AiKnowledgeBaseSummary } from '../types';

type KnowledgeBaseManagerDialogProps = {
  open: boolean;
  knowledgeBases: AiKnowledgeBaseSummary[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export function KnowledgeBaseManagerDialog({
  open,
  knowledgeBases,
  onClose,
  onChanged,
  showToast,
}: KnowledgeBaseManagerDialogProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AiKnowledgeBaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');

  useEffect(() => {
    if (!open) return;
    const nextId = activeId && knowledgeBases.some((item) => item.id === activeId)
      ? activeId
      : knowledgeBases[0]?.id ?? null;
    setActiveId(nextId);
  }, [activeId, knowledgeBases, open]);

  useEffect(() => {
    if (!open || !activeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void loadAiKnowledgeBase(activeId)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : '知识库加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, open]);

  if (!open) return null;

  async function refreshDetail(knowledgeBaseId = activeId) {
    await onChanged();
    if (knowledgeBaseId) {
      setDetail(await loadAiKnowledgeBase(knowledgeBaseId));
    }
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '知识库操作失败';
      setError(message);
      showToast(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    const name = createName.trim();
    if (!name) {
      setError('请输入知识库名称。');
      return;
    }
    await run(async () => {
      const created = await createAiKnowledgeBase({ name, description: createDescription.trim() });
      setCreateName('');
      setCreateDescription('');
      setCreating(false);
      setActiveId(created.summary.id);
      setDetail(created);
      await onChanged();
      showToast('知识库已创建');
    });
  }

  async function handleImportPaths(paths: string[]) {
    if (!activeId || paths.length === 0) return;
    await run(async () => {
      for (const path of paths) {
        await importAiKnowledgeSources(activeId, { path });
      }
      await refreshDetail(activeId);
      showToast(paths.length > 1 ? `已导入 ${paths.length} 个来源` : '知识库来源已导入');
    });
  }

  async function handlePasteImport() {
    if (!activeId || !pasteText.trim()) return;
    await run(async () => {
      await importAiKnowledgeSources(activeId, {
        text: pasteText,
        name: pasteName.trim() || '粘贴文本',
      });
      setPasteName('');
      setPasteText('');
      await refreshDetail(activeId);
      showToast('文本已加入知识库');
    });
  }

  async function handleDeleteBase() {
    if (!activeId || !detail) return;
    await run(async () => {
      await deleteAiKnowledgeBase(activeId);
      setDetail(null);
      setActiveId(null);
      await onChanged();
      showToast('知识库已删除');
    });
  }

  return (
    <div className="dialog-backdrop knowledge-manager-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <section className="knowledge-manager-dialog" role="dialog" aria-modal="true" aria-label="知识库管理" onClick={(event) => event.stopPropagation()}>
        <header className="knowledge-manager-head">
          <div>
            <span className="settings-eyebrow">普通聊天</span>
            <h2>知识库</h2>
            <p>本地导入、切片和检索，不依赖当前聊天供应商。</p>
          </div>
          <button type="button" className="plain-icon" aria-label="关闭知识库管理" disabled={busy} onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="knowledge-manager-body">
          <aside className="knowledge-manager-list">
            <button type="button" className="knowledge-create-button" onClick={() => setCreating(true)}>
              <Plus size={14} /> 新建知识库
            </button>
            {creating ? (
              <div className="knowledge-create-form">
                <input value={createName} placeholder="知识库名称" autoFocus onChange={(event) => setCreateName(event.target.value)} />
                <textarea value={createDescription} placeholder="说明（可选）" rows={3} onChange={(event) => setCreateDescription(event.target.value)} />
                <div className="knowledge-inline-actions">
                  <button type="button" onClick={() => setCreating(false)}>取消</button>
                  <button type="button" className="primary" disabled={busy || !createName.trim()} onClick={() => void handleCreate()}>创建</button>
                </div>
              </div>
            ) : null}
            <div className="knowledge-base-list" role="listbox" aria-label="知识库列表">
              {knowledgeBases.map((knowledgeBase) => (
                <button
                  key={knowledgeBase.id}
                  type="button"
                  className={knowledgeBase.id === activeId ? 'active' : ''}
                  role="option"
                  aria-selected={knowledgeBase.id === activeId}
                  onClick={() => setActiveId(knowledgeBase.id)}
                >
                  <BookOpen size={15} />
                  <span>
                    <strong>{knowledgeBase.name}</strong>
                    <small>{knowledgeBase.sourceCount} 个来源 · {knowledgeBase.chunkCount} 个片段</small>
                  </span>
                </button>
              ))}
              {knowledgeBases.length === 0 && !creating ? <p className="knowledge-empty-copy">创建知识库后，可从聊天输入框多选使用。</p> : null}
            </div>
          </aside>

          <main className="knowledge-manager-content">
            {loading ? (
              <div className="knowledge-manager-empty"><Loader2 className="spin" size={20} /> 正在读取知识库</div>
            ) : !detail ? (
              <div className="knowledge-manager-empty"><BookOpen size={24} /><span>选择或创建一个知识库</span></div>
            ) : (
              <>
                <div className="knowledge-detail-head">
                  <div>
                    <h3>{detail.summary.name}</h3>
                    <p>{detail.summary.description || '暂无说明'}</p>
                  </div>
                  <div className="knowledge-detail-actions">
                    <button type="button" disabled={busy} onClick={() => void run(async () => {
                      await rebuildAiKnowledgeBase(detail.summary.id);
                      await refreshDetail(detail.summary.id);
                      showToast('知识库索引已重建');
                    })}><RefreshCw size={13} /> 重建</button>
                    <button type="button" className="danger" disabled={busy} onClick={() => void handleDeleteBase()}><Trash2 size={13} /> 删除</button>
                  </div>
                </div>

                <div className="knowledge-stats">
                  <span><strong>{detail.summary.sourceCount}</strong> 来源</span>
                  <span><strong>{detail.summary.chunkCount}</strong> 片段</span>
                  <span><strong>{detail.summary.chunkSize}</strong> 字符/片段</span>
                  <span><strong>本地</strong> 特征哈希索引</span>
                </div>

                <section className="knowledge-import-panel">
                  <div className="knowledge-import-actions">
                    <button type="button" disabled={busy} onClick={() => void pickDesktopFiles().then((paths) => paths ? handleImportPaths(paths) : undefined)}>
                      <FilePlus2 size={14} /> 导入文件
                    </button>
                    <button type="button" disabled={busy} onClick={() => void pickDesktopDirectory().then((path) => path ? handleImportPaths([path]) : undefined)}>
                      <FolderPlus size={14} /> 导入目录
                    </button>
                  </div>
                  <div className="knowledge-paste-form">
                    <input value={pasteName} placeholder="粘贴来源名称（可选）" onChange={(event) => setPasteName(event.target.value)} />
                    <textarea value={pasteText} rows={5} placeholder="也可以直接粘贴文本、Markdown 或代码" onChange={(event) => setPasteText(event.target.value)} />
                    <button type="button" className="primary" disabled={busy || !pasteText.trim()} onClick={() => void handlePasteImport()}>加入知识库</button>
                  </div>
                </section>

                <section className="knowledge-source-section">
                  <div className="knowledge-source-head"><h4>来源</h4><span>{detail.sources.length}</span></div>
                  <div className="knowledge-source-list">
                    {detail.sources.map((source) => (
                      <div key={source.id} className="knowledge-source-row">
                        <FilePlus2 size={14} />
                        <div>
                          <strong>{source.name}</strong>
                          <small title={source.sourcePath}>{source.sourcePath || '粘贴文本'} · {source.chunkCount} 个片段</small>
                          {source.errorMessage ? <em>{source.errorMessage}</em> : null}
                        </div>
                        <span className={`knowledge-source-status ${source.status}`}>{source.status === 'ready' ? '已索引' : source.status === 'error' ? '失败' : '处理中'}</span>
                        <button
                          type="button"
                          className="plain-icon danger"
                          aria-label={`删除来源 ${source.name}`}
                          disabled={busy}
                          onClick={() => void run(async () => {
                            await deleteAiKnowledgeSource(detail.summary.id, source.id);
                            await refreshDetail(detail.summary.id);
                            showToast('知识库来源已删除');
                          })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    {detail.sources.length === 0 ? <div className="knowledge-manager-empty compact">还没有来源，导入文件、目录或粘贴文本。</div> : null}
                  </div>
                </section>
              </>
            )}
            {error ? <div className="assistant-runtime-error knowledge-manager-error">{error}</div> : null}
          </main>
        </div>
      </section>
    </div>
  );
}
