import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileClock, Filter, ListOrdered, RefreshCw, Search } from 'lucide-react';
import type { ToastState } from '../../types';
import {
  formatLogSize,
  type LogFilesResponse,
  type LogTailResponse,
} from '../../lib/log-viewer';
import { StandardSelect, type StandardSelectOption } from '../StandardSelect';
import { SegmentedControl, SettingsGroup, SettingsRow } from './SettingsControls';

type LevelFilter = 'all' | 'error' | 'warn' | 'info';
type TailSize = '200' | '1000' | '5000';

const MAX_RENDERED_LINES = 1000;

type Props = {
  showToast: (message: string, tone?: ToastState['tone']) => void;
};

export function LogsSettingsSection({ showToast }: Props) {
  const [files, setFiles] = useState<LogFilesResponse['files']>([]);
  const [directory, setDirectory] = useState('');
  const [selectedFile, setSelectedFile] = useState('');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [tailSize, setTailSize] = useState<TailSize>('1000');
  const [search, setSearch] = useState('');
  const [content, setContent] = useState<LogTailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fetchSeq = useRef(0);

  const loadFiles = useCallback(async () => {
    try {
      const response = await fetch('/api/logs/files');
      const payload = (await response.json()) as LogFilesResponse & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || '读取日志列表失败');
      setFiles(payload.files ?? []);
      setDirectory(payload.directory ?? '');
      setSelectedFile((current) => {
        if (current && payload.files.some((file) => file.name === current)) return current;
        return payload.files[0]?.name ?? '';
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取日志列表失败');
    }
  }, []);

  const loadContent = useCallback(async () => {
    if (!selectedFile) {
      setContent(null);
      return;
    }
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        file: selectedFile,
        lines: tailSize,
        level,
      });
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/logs/tail?${params.toString()}`);
      const payload = (await response.json()) as LogTailResponse & { error?: string };
      if (seq !== fetchSeq.current) return;
      if (!response.ok || payload.error) throw new Error(payload.error || '读取日志失败');
      setContent(payload);
      setError('');
    } catch (cause) {
      if (seq !== fetchSeq.current) return;
      setError(cause instanceof Error ? cause.message : '读取日志失败');
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [selectedFile, tailSize, level, search]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    const timer = setTimeout(() => void loadContent(), search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [loadContent, search]);

  useEffect(() => {
    if (!autoRefresh || !selectedFile) return;
    const timer = setInterval(() => void loadContent(), 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, selectedFile, loadContent]);

  const fileOptions: StandardSelectOption<string>[] = useMemo(
    () =>
      files.map((file) => ({
        value: file.name,
        label: `${file.name}（${formatLogSize(file.sizeBytes)}）`,
      })),
    [files],
  );

  const renderedLines = useMemo(() => {
    const lines = content?.lines ?? [];
    return lines.slice(-MAX_RENDERED_LINES);
  }, [content]);

  async function exportDiagnostics() {
    setExporting(true);
    try {
      const response = await fetch('/api/logs/export', { method: 'POST' });
      const payload = (await response.json()) as { path?: string; opened?: boolean; error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || '导出诊断包失败');
      const openedHint = payload.opened ? '，已在文件管理器中定位' : '';
      showToast(`诊断包已导出${openedHint}：${payload.path ?? ''}`);
      void loadFiles();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '导出诊断包失败', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>日志与诊断</h1>
        <p>查看后端运行日志，定位 Agent 启动、渠道连接等问题；报障时可导出诊断包一并反馈。日志不包含 API Key 与对话内容。</p>
      </header>

      <SettingsGroup title="日志文件">
        <SettingsRow icon={FileClock} title="文件" description={directory || '日志目录暂不可用'}>
          <StandardSelect
            value={selectedFile}
            options={fileOptions}
            ariaLabel="选择日志文件"
            placeholder={files.length ? '选择日志文件' : '暂无日志文件'}
            disabled={!files.length}
            onChange={setSelectedFile}
          />
        </SettingsRow>
        <SettingsRow icon={Filter} title="级别过滤" description="只看该级别及更严重的日志">
          <SegmentedControl<LevelFilter>
            value={level}
            options={[
              { value: 'all', label: '全部' },
              { value: 'info', label: 'INFO' },
              { value: 'warn', label: 'WARN' },
              { value: 'error', label: 'ERROR' },
            ]}
            onChange={setLevel}
          />
        </SettingsRow>
        <SettingsRow icon={ListOrdered} title="尾部行数" description="从文件末尾最多读取多少行">
          <SegmentedControl<TailSize>
            value={tailSize}
            options={[
              { value: '200', label: '200' },
              { value: '1000', label: '1000' },
              { value: '5000', label: '5000' },
            ]}
            onChange={setTailSize}
          />
        </SettingsRow>
        <SettingsRow icon={Search} title="关键词" description="按关键词过滤日志行" stack>
          <input
            className="settings-text-input"
            value={search}
            placeholder="例如：OpenCode、渠道测试失败"
            onChange={(event) => setSearch(event.target.value)}
          />
        </SettingsRow>
        <SettingsRow icon={RefreshCw} title="自动刷新" description="每 5 秒刷新一次日志尾部">
          <label className="settings-toggle" aria-label="自动刷新日志">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.currentTarget.checked)}
            />
            <span aria-hidden="true" />
          </label>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="日志内容">
        <div className="logs-viewer-toolbar">
          <button
            type="button"
            className="settings-action-button"
            disabled={!selectedFile || loading}
            onClick={() => void loadContent()}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            刷新
          </button>
          <span className="logs-viewer-meta">
            {content
              ? `匹配 ${content.matchedLines} 行${content.truncatedByBytes ? '（文件过大，仅扫描末尾 8MB）' : ''}`
              : '暂无内容'}
            {content && content.lines.length > MAX_RENDERED_LINES
              ? `，仅渲染最近 ${MAX_RENDERED_LINES} 行`
              : ''}
          </span>
        </div>
        {error ? <div className="logs-viewer-error">{error}</div> : null}
        <div className="logs-viewer" role="log" aria-label="日志内容">
          {renderedLines.length ? (
            renderedLines.map((line, index) => (
              <div key={`${index}-${line.slice(0, 32)}`} className={logLineClassName(line)}>
                {line}
              </div>
            ))
          ) : (
            <div className="logs-viewer-empty">当前过滤条件下没有日志行</div>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup title="诊断">
        <SettingsRow
          icon={Download}
          title="导出诊断包"
          description="打包最近日志文件与版本环境信息（zip），用于问题反馈；不包含任何密钥"
        >
          <button
            type="button"
            className="settings-action-button primary"
            disabled={exporting}
            onClick={() => void exportDiagnostics()}
          >
            {exporting ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
            导出诊断包
          </button>
        </SettingsRow>
      </SettingsGroup>
    </section>
  );
}

function logLineClassName(line: string): string {
  if (line.includes('[ERROR]')) return 'log-line log-error';
  if (line.includes('[WARN]')) return 'log-line log-warn';
  if (line.includes('[INFO]')) return 'log-line log-info';
  return 'log-line';
}
