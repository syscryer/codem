import { ExternalLink, Plus, RotateCcw, Save, Server, Settings2, ShieldAlert, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { normalizeMcpConfig, fetchMcpManagement, openMcpConfig, saveMcpConfig } from '../../lib/mcp';
import type {
  AgentProviderId,
  McpConfigFile,
  McpManagedScope,
  McpManagementResponse,
  McpServerConfig,
  McpServerSummary,
} from '../../types';
import { AgentSettingsProviderTabs } from './AgentSettingsProviderTabs';

type EditableServerScope = 'global' | 'project' | 'claude-json-global';
type ServerScope = EditableServerScope | 'claude-json-project';

type ValueRow = {
  id: string;
  value: string;
};

type PairRow = {
  id: string;
  key: string;
  value: string;
};

type ServerRow = {
  key: string;
  name: string;
  scope: ServerScope;
  config: McpServerConfig;
  sourcePath: string;
  readOnly: boolean;
  overridesGlobal: boolean;
  summary?: McpServerSummary;
  duplicateOf?: string;
};

type EditorState = {
  originalName: string | null;
  originalScope: EditableServerScope | null;
  scope: EditableServerScope;
  name: string;
  enabled: boolean;
  type: 'stdio' | 'http';
  command: string;
  args: ValueRow[];
  env: PairRow[];
  envPassthrough: ValueRow[];
  cwd: string;
  url: string;
  headers: PairRow[];
  auth: 'none' | 'bearer' | 'oauth';
  extra: Record<string, unknown>;
};

type NoticeState = {
  tone: 'success' | 'error' | 'info';
  text: string;
};

const KNOWN_SERVER_KEYS = new Set([
  'type',
  'command',
  'args',
  'env',
  'envPassthrough',
  'cwd',
  'url',
  'headers',
  'auth',
  'disabled',
]);

const EDIT_SCOPE_OPTIONS: Array<{ value: EditableServerScope; label: string }> = [
  { value: 'global', label: '用户级 mcp.json' },
  { value: 'project', label: '项目级 .mcp.json' },
  { value: 'claude-json-global', label: 'Claude Code 全局' },
];

const AUTH_OPTIONS: Array<{ value: EditorState['auth']; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'bearer', label: 'Bearer' },
  { value: 'oauth', label: 'OAuth' },
];

export function McpSettingsSection({
  defaultProviderId,
  projectPath,
}: {
  defaultProviderId: AgentProviderId;
  projectPath?: string | null;
}) {
  const [providerId, setProviderId] = useState<AgentProviderId>(defaultProviderId);
  const [payload, setPayload] = useState<McpManagementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingDeleteKey, setPendingDeleteKey] = useState('');

  useEffect(() => {
    void loadManagement();
  }, [projectPath, providerId]);

  const rows = useMemo(() => buildManagedRows(payload), [payload]);

  async function loadManagement(successMessage = '') {
    setLoading(true);
    setError('');
    if (!successMessage) {
      setNotice(null);
    }

    try {
      const nextPayload = await fetchMcpManagement(providerId, projectPath);
      setPayload(nextPayload);
      setEditor(null);
      setDirty(false);
      setPendingDeleteKey('');
      if (successMessage) {
        setNotice({ tone: 'success', text: successMessage });
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取 MCP 管理配置失败');
    } finally {
      setLoading(false);
    }
  }

  function startAdd() {
    const defaultScope: EditableServerScope = payload?.hasProject ? 'project' : 'global';
    setEditor(createEmptyEditor(defaultScope, uniqueServerName(rows, 'new-server')));
    setDirty(true);
    setPendingDeleteKey('');
    setNotice(null);
  }

  function startEdit(row: ServerRow) {
    if (row.readOnly || !isEditableScope(row.scope)) {
      return;
    }

    setEditor(createEditorState(row.name, row.scope, row.config));
    setDirty(false);
    setPendingDeleteKey('');
    setNotice(null);
  }

  function updateEditor(patch: Partial<EditorState>) {
    setEditor((current) => current ? { ...current, ...patch } : current);
    setDirty(true);
  }

  async function saveEditor() {
    if (!payload || !editor) {
      return;
    }

    const name = editor.name.trim();
    if (!name) {
      setNotice({ tone: 'error', text: '请填写服务器名称。' });
      return;
    }
    if (editor.scope === 'project' && !payload.hasProject) {
      setNotice({ tone: 'error', text: '当前没有活动项目，不能保存项目级 MCP 配置。' });
      return;
    }
    if (editor.type === 'stdio' && !editor.command.trim()) {
      setNotice({ tone: 'error', text: 'STDIO 类型需要填写启动命令。' });
      return;
    }
    if (editor.type === 'http' && !editor.url.trim()) {
      setNotice({ tone: 'error', text: 'HTTP 类型需要填写 URL。' });
      return;
    }

    const nextServerConfig = buildServerConfig(editor);
    const conflict = rows.find((row) =>
      row.name === name &&
      !(row.scope === editor.originalScope && row.name === editor.originalName),
    );
    if (conflict) {
      setNotice({ tone: 'error', text: `已存在同名服务器：${name}（${scopeLabel(conflict.scope)}）。` });
      return;
    }

    const nextFingerprint = serverFingerprint(nextServerConfig);
    const duplicate = nextFingerprint
      ? rows.find((row) =>
          serverFingerprint(row.config) === nextFingerprint &&
          !(row.scope === editor.originalScope && row.name === editor.originalName),
        )
      : undefined;
    if (duplicate) {
      setNotice({
        tone: 'error',
        text: `检测到等价服务器：${duplicate.name}（${scopeLabel(duplicate.scope)}），请避免重复配置。`,
      });
      return;
    }

    setSaving(true);
    try {
      const changed = new Map<EditableServerScope, McpConfigFile>();
      const getDraft = (scope: EditableServerScope) => {
        if (!payload) {
          return { mcpServers: {} };
        }

        const existing = changed.get(scope) ?? getConfigForScope(payload, scope);
        const draft = normalizeMcpConfig(existing);
        draft.mcpServers = { ...(draft.mcpServers ?? {}) };
        changed.set(scope, draft);
        return draft;
      };

      if (editor.originalName && editor.originalScope) {
        const originalDraft = getDraft(editor.originalScope);
        delete originalDraft.mcpServers?.[editor.originalName];
      }

      const targetDraft = getDraft(editor.scope);
      targetDraft.mcpServers = {
        ...(targetDraft.mcpServers ?? {}),
        [name]: nextServerConfig,
      };

      for (const [scope, config] of changed) {
        await saveMcpConfig(scope, config, providerId, projectPath);
      }

      await loadManagement('MCP 服务器配置已保存。');
    } catch (saveError) {
      setNotice({ tone: 'error', text: saveError instanceof Error ? saveError.message : '保存 MCP 配置失败' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleRow(row: ServerRow, enabled: boolean) {
    if (!payload || row.readOnly || !isEditableScope(row.scope)) {
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const next = normalizeMcpConfig(getConfigForScope(payload, row.scope));
      next.mcpServers = { ...(next.mcpServers ?? {}) };
      const nextServer = { ...row.config };
      if (enabled) {
        delete nextServer.disabled;
      } else {
        nextServer.disabled = true;
      }
      next.mcpServers[row.name] = nextServer;
      await saveMcpConfig(row.scope, next, providerId, projectPath);
      await loadManagement(enabled ? `已启用 ${row.name}。` : `已停用 ${row.name}。`);
    } catch (toggleError) {
      setNotice({ tone: 'error', text: toggleError instanceof Error ? toggleError.message : '更新 MCP 状态失败' });
    } finally {
      setSaving(false);
    }
  }

  async function deleteRow(row: ServerRow) {
    if (!payload || row.readOnly || !isEditableScope(row.scope)) {
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const next = normalizeMcpConfig(getConfigForScope(payload, row.scope));
      next.mcpServers = { ...(next.mcpServers ?? {}) };
      delete next.mcpServers[row.name];
      await saveMcpConfig(row.scope, next, providerId, projectPath);
      await loadManagement(`已删除 ${row.name}。`);
    } catch (deleteError) {
      setNotice({ tone: 'error', text: deleteError instanceof Error ? deleteError.message : '删除 MCP 服务器失败' });
    } finally {
      setSaving(false);
    }
  }

  async function openConfig(scope: McpManagedScope) {
    setNotice(null);
    try {
      await openMcpConfig(scope, providerId, projectPath);
      setNotice({ tone: 'info', text: '已请求系统打开配置文件。' });
    } catch (openError) {
      setNotice({ tone: 'error', text: openError instanceof Error ? openError.message : '打开配置文件失败' });
    }
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>MCP 管理</h1>
      </header>

      <AgentSettingsProviderTabs
        value={providerId}
        disabled={loading || saving}
        onChange={(nextProviderId) => {
          setProviderId(nextProviderId);
          setEditor(null);
          setNotice(null);
        }}
      />

      <div className="settings-panel settings-editor-panel mcp-suite-panel">
        <div className="settings-editor-head">
          <div className="settings-row-label">
            <Server size={15} />
            <span>
              <strong>{editor ? '编辑 MCP 服务器' : 'MCP 服务器列表'}</strong>
              <small>管理当前 Agent 的用户级与项目级原生 MCP 配置。</small>
            </span>
          </div>
          <div className="settings-editor-actions">
            <button
              type="button"
              className="settings-action-button"
              onClick={() => void loadManagement()}
              disabled={loading || saving}
            >
              <RotateCcw size={14} />
              <span>刷新</span>
            </button>
            {!editor ? (
              <button
                type="button"
                className="settings-action-button primary"
                onClick={startAdd}
                disabled={loading || saving}
              >
                <Plus size={14} />
                <span>添加服务器</span>
              </button>
            ) : (
              <button
                type="button"
                className="settings-action-button primary"
                onClick={() => void saveEditor()}
                disabled={loading || saving || !dirty}
              >
                <Save size={14} />
                <span>保存</span>
              </button>
            )}
          </div>
        </div>

        {notice ? (
          <div className={notice.tone === 'error' ? 'plugins-error-panel' : 'plugins-help-panel'}>
            {notice.tone === 'error' ? <strong>{notice.text}</strong> : <span>{notice.text}</span>}
          </div>
        ) : null}

        {error ? (
          <div className="plugins-error-panel">
            <strong>{error}</strong>
            <small>请先确认当前 Agent 的配置文件可读。</small>
          </div>
        ) : null}

        <div className="plugins-help-panel">
          <span>
            {mcpLocationDescription(providerId)}
          </span>
        </div>

        <div className="mcp-file-actions">
          <button
            type="button"
            className="settings-action-button"
            onClick={() => void openConfig('global')}
            disabled={loading || saving}
          >
            <ExternalLink size={14} />
            <span>打开用户级配置</span>
          </button>
          <button
            type="button"
            className="settings-action-button"
            onClick={() => void openConfig('project')}
            disabled={loading || saving || !payload?.hasProject}
          >
            <ExternalLink size={14} />
            <span>打开项目级配置</span>
          </button>
          {providerId === 'claude-code' ? <button
            type="button"
            className="settings-action-button"
            onClick={() => void openConfig('claude-json-global')}
            disabled={loading || saving}
          >
            <ExternalLink size={14} />
            <span>打开 Claude Code 配置</span>
          </button> : null}
        </div>

        {editor ? (
          <EditorPanel
            editor={editor}
            dirty={dirty}
            saving={saving}
            hasProject={Boolean(payload?.hasProject)}
            providerId={providerId}
            onCancel={() => {
              setEditor(null);
              setDirty(false);
              setPendingDeleteKey('');
            }}
            onUpdate={updateEditor}
          />
        ) : (
          <>
            <div className="settings-list settings-list-spaced mcp-managed-list">
              {loading ? <div className="settings-list-empty">正在读取 MCP 配置</div> : null}
              {!loading && rows.length === 0 ? (
                <div className="settings-list-empty">还没有可管理的 MCP 服务器，点击右上角开始添加。</div>
              ) : null}
              {rows.map((row) => (
                <ManagedRow
                  key={row.key}
                  row={row}
                  pendingDelete={pendingDeleteKey === row.key}
                  saving={saving}
                  onEdit={() => startEdit(row)}
                  onToggle={(enabled) => void toggleRow(row, enabled)}
                  onDelete={() => {
                    if (pendingDeleteKey === row.key) {
                      void deleteRow(row);
                      return;
                    }
                    setPendingDeleteKey(row.key);
                    setNotice({
                      tone: 'info',
                      text: `再次点击“删除”即可移除 ${row.name}。`,
                    });
                  }}
                  onCancelDelete={() => {
                    setPendingDeleteKey('');
                    setNotice(null);
                  }}
                />
              ))}
            </div>

            {payload?.overview.errors.length ? (
              <div className="settings-list settings-list-spaced">
                {payload.overview.errors.map((item) => (
                  <div key={`${item.source}:${item.path}`} className="settings-list-row settings-list-row-tall">
                    <div>
                      <strong>{item.source}</strong>
                      <small>{item.path}</small>
                      <small>{item.message}</small>
                    </div>
                    <span className="settings-badge error">解析失败</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function ManagedRow({
  row,
  pendingDelete,
  saving,
  onEdit,
  onToggle,
  onDelete,
  onCancelDelete,
}: {
  row: ServerRow;
  pendingDelete: boolean;
  saving: boolean;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onCancelDelete: () => void;
}) {
  const type = serverType(row.config);
  const disabled = row.config.disabled === true;
  const status = disabled ? 'disabled' : normalizeManagedStatus(row.summary?.status);
  return (
    <div className="settings-list-row settings-list-row-tall mcp-list-row">
      <div className="mcp-row-main">
        <div className="mcp-row-title">
          <strong>{row.name}</strong>
          <div className="mcp-row-badges">
            <span className={`settings-badge ${mcpStatusClass(status)}`}>{mcpStatusText(status)}</span>
            <span className="settings-badge">{scopeLabel(row.scope)}</span>
            <span className="settings-badge">{type === 'http' ? 'HTTP' : 'STDIO'}</span>
            {row.readOnly ? <span className="settings-badge">只读</span> : null}
            {row.overridesGlobal ? <span className="settings-badge">覆盖用户级</span> : null}
            {row.duplicateOf ? <span className="settings-badge error">可能重复：{row.duplicateOf}</span> : null}
          </div>
        </div>
        <small className="mcp-row-summary" title={row.sourcePath}>
          {type === 'http'
            ? row.config.url || '未配置 URL'
            : [row.config.command, ...(row.config.args ?? [])].filter(Boolean).join(' ') || '未配置启动命令'}
        </small>
        {pendingDelete ? (
          <small className="mcp-warning-inline">
            再点一次删除将立即移除该服务器。
            <button type="button" onClick={onCancelDelete}>取消</button>
          </small>
        ) : null}
      </div>
      <div className="settings-list-actions mcp-list-actions">
        <div className="mcp-action-row">
          <Toggle
            checked={!disabled}
            onChange={onToggle}
            label={`${disabled ? '启用' : '停用'} ${row.name}`}
            disabled={saving || row.readOnly}
          />
          <button type="button" className="settings-action-button" onClick={onEdit} disabled={saving || row.readOnly}>
            <Settings2 size={14} />
            <span>编辑</span>
          </button>
          <button type="button" className="settings-action-button danger" onClick={onDelete} disabled={saving || row.readOnly}>
            <Trash2 size={14} />
            <span>{pendingDelete ? '确认删除' : '删除'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function EditorPanel({
  editor,
  dirty,
  saving,
  hasProject,
  providerId,
  onCancel,
  onUpdate,
}: {
  editor: EditorState;
  dirty: boolean;
  saving: boolean;
  hasProject: boolean;
  providerId: AgentProviderId;
  onCancel: () => void;
  onUpdate: (patch: Partial<EditorState>) => void;
}) {
  return (
    <div className="mcp-editor-grid">
      <div className="mcp-editor-section">
        <div className="settings-row-label">
          <Server size={15} />
          <span>
            <strong>基本信息</strong>
            <small>先确定名称、作用域、启用状态和传输类型。</small>
          </span>
        </div>

        <div className="mcp-form-grid">
          <label className="mcp-form-field">
            <span>名称</span>
            <input
              className="settings-input"
              value={editor.name}
              onChange={(event) => onUpdate({ name: event.currentTarget.value })}
              disabled={saving}
            />
          </label>

          <label className="mcp-form-field">
            <span>保存位置</span>
            <select
              className="settings-select"
              value={editor.scope}
              onChange={(event) => onUpdate({ scope: event.currentTarget.value as EditableServerScope })}
              disabled={saving}
            >
              {EDIT_SCOPE_OPTIONS.filter((option) =>
                (option.value !== 'project' || hasProject)
                && (option.value !== 'claude-json-global' || providerId === 'claude-code'),
              ).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="mcp-form-field">
            <span>启用</span>
            <Toggle
              checked={editor.enabled}
              onChange={(enabled) => onUpdate({ enabled })}
              label="启用当前服务器"
              disabled={saving}
            />
          </div>

          <div className="mcp-form-field">
            <span>类型</span>
            <div className="settings-segmented">
              <button
                type="button"
                className={editor.type === 'stdio' ? 'active' : ''}
                onClick={() => onUpdate({ type: 'stdio' })}
                disabled={saving}
              >
                <span>STDIO</span>
              </button>
              <button
                type="button"
                className={editor.type === 'http' ? 'active' : ''}
                onClick={() => onUpdate({ type: 'http' })}
                disabled={saving}
              >
                <span>HTTP</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {editor.type === 'stdio' ? (
        <div className="mcp-editor-section">
          <div className="settings-row-label">
            <Settings2 size={15} />
            <span>
              <strong>STDIO 配置</strong>
              <small>适用于本地命令启动的 MCP server。</small>
            </span>
          </div>

          <div className="mcp-form-grid">
            <label className="mcp-form-field mcp-span-full">
              <span>启动命令</span>
              <input
                className="settings-input"
                value={editor.command}
                onChange={(event) => onUpdate({ command: event.currentTarget.value })}
                placeholder="npx"
                disabled={saving}
              />
            </label>

            <label className="mcp-form-field mcp-span-full">
              <span>工作目录</span>
              <input
                className="settings-input"
                value={editor.cwd}
                onChange={(event) => onUpdate({ cwd: event.currentTarget.value })}
                placeholder="可选"
                disabled={saving}
              />
            </label>
          </div>

          <ValueListEditor
            label="参数"
            addLabel="添加参数"
            placeholder="-y @playwright/mcp"
            rows={editor.args}
            disabled={saving}
            onChange={(args) => onUpdate({ args })}
          />
          <PairListEditor
            label="环境变量"
            addLabel="添加环境变量"
            keyPlaceholder="API_KEY"
            valuePlaceholder="value"
            rows={editor.env}
            disabled={saving}
            onChange={(env) => onUpdate({ env })}
          />
          <ValueListEditor
            label="透传变量"
            addLabel="添加透传变量"
            placeholder="GITHUB_TOKEN"
            rows={editor.envPassthrough}
            disabled={saving}
            onChange={(envPassthrough) => onUpdate({ envPassthrough })}
          />
        </div>
      ) : (
        <div className="mcp-editor-section">
          <div className="settings-row-label">
            <ShieldAlert size={15} />
            <span>
              <strong>HTTP 配置</strong>
              <small>适用于远端或流式 HTTP MCP server。</small>
            </span>
          </div>

          <div className="mcp-form-grid">
            <label className="mcp-form-field mcp-span-full">
              <span>URL</span>
              <input
                className="settings-input"
                value={editor.url}
                onChange={(event) => onUpdate({ url: event.currentTarget.value })}
                placeholder="https://example.com/mcp"
                disabled={saving}
              />
            </label>

            <label className="mcp-form-field">
              <span>鉴权方式</span>
              <select
                className="settings-select"
                value={editor.auth}
                onChange={(event) => onUpdate({ auth: event.currentTarget.value as EditorState['auth'] })}
                disabled={saving}
              >
                {AUTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <PairListEditor
            label="Headers"
            addLabel="添加 Header"
            keyPlaceholder="Authorization"
            valuePlaceholder="Bearer ..."
            rows={editor.headers}
            disabled={saving}
            onChange={(headers) => onUpdate({ headers })}
          />
        </div>
      )}

      <div className="settings-editor-status">
        <small>{dirty ? '有未保存的修改。' : '当前内容已保存。'}</small>
        <button type="button" className="settings-action-button" onClick={onCancel} disabled={saving}>
          <X size={14} />
          <span>返回列表</span>
        </button>
      </div>
    </div>
  );
}

function ValueListEditor({
  label,
  addLabel,
  placeholder,
  rows,
  disabled,
  onChange,
}: {
  label: string;
  addLabel: string;
  placeholder: string;
  rows: ValueRow[];
  disabled: boolean;
  onChange: (rows: ValueRow[]) => void;
}) {
  return (
    <div className="mcp-editor-list">
      <div className="mcp-editor-list-head">
        <strong>{label}</strong>
        <button
          type="button"
          className="settings-action-button"
          onClick={() => onChange([...rows, { id: createId(), value: '' }])}
          disabled={disabled}
        >
          <Plus size={14} />
          <span>{addLabel}</span>
        </button>
      </div>
      <div className="mcp-form-list">
        {rows.length === 0 ? <div className="settings-list-empty">暂未配置</div> : null}
        {rows.map((row) => (
          <div key={row.id} className="mcp-form-list-row">
            <input
              className="settings-input"
              value={row.value}
              onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, value: event.currentTarget.value } : item))}
              placeholder={placeholder}
              disabled={disabled}
            />
            <button
              type="button"
              className="settings-icon-button"
              onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
              disabled={disabled}
              aria-label={`删除${label}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PairListEditor({
  label,
  addLabel,
  keyPlaceholder,
  valuePlaceholder,
  rows,
  disabled,
  onChange,
}: {
  label: string;
  addLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  rows: PairRow[];
  disabled: boolean;
  onChange: (rows: PairRow[]) => void;
}) {
  return (
    <div className="mcp-editor-list">
      <div className="mcp-editor-list-head">
        <strong>{label}</strong>
        <button
          type="button"
          className="settings-action-button"
          onClick={() => onChange([...rows, { id: createId(), key: '', value: '' }])}
          disabled={disabled}
        >
          <Plus size={14} />
          <span>{addLabel}</span>
        </button>
      </div>
      <div className="mcp-form-list">
        {rows.length === 0 ? <div className="settings-list-empty">暂未配置</div> : null}
        {rows.map((row) => (
          <div key={row.id} className="mcp-form-list-row pair">
            <input
              className="settings-input"
              value={row.key}
              onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, key: event.currentTarget.value } : item))}
              placeholder={keyPlaceholder}
              disabled={disabled}
            />
            <input
              className="settings-input"
              value={row.value}
              onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, value: event.currentTarget.value } : item))}
              placeholder={valuePlaceholder}
              disabled={disabled}
            />
            <button
              type="button"
              className="settings-icon-button"
              onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
              disabled={disabled}
              aria-label={`删除${label}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="settings-toggle" aria-label={label}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span aria-hidden="true" />
    </label>
  );
}

function buildManagedRows(payload: McpManagementResponse | null) {
  if (!payload) {
    return [] as ServerRow[];
  }

  const rows: ServerRow[] = [];
  const globalNames = new Set<string>();
  const summariesByName = new Map(payload.overview.servers.map((server) => [server.name, server]));

  for (const [name, config] of Object.entries(payload.configs.global.mcpServers ?? {})) {
    globalNames.add(name);
    rows.push({
      key: `global:${name}`,
      name,
      scope: 'global',
      config,
      sourcePath: payload.paths.global,
      readOnly: false,
      overridesGlobal: false,
      summary: summariesByName.get(name),
    });
  }

  for (const [name, config] of Object.entries(payload.configs.claudeJsonGlobal.mcpServers ?? {})) {
    globalNames.add(name);
    rows.push({
      key: `claude-json-global:${name}`,
      name,
      scope: 'claude-json-global',
      config,
      sourcePath: payload.paths.claudeJson,
      readOnly: false,
      overridesGlobal: false,
      summary: summariesByName.get(name),
    });
  }

  for (const [name, config] of Object.entries(payload.configs.project.mcpServers ?? {})) {
    rows.push({
      key: `project:${name}`,
      name,
      scope: 'project',
      config,
      sourcePath: payload.paths.project,
      readOnly: false,
      overridesGlobal: globalNames.has(name),
      summary: summariesByName.get(name),
    });
  }

  for (const [name, config] of Object.entries(payload.configs.claudeJsonProject.mcpServers ?? {})) {
    rows.push({
      key: `claude-json-project:${name}`,
      name,
      scope: 'claude-json-project',
      config,
      sourcePath: payload.paths.claudeJson,
      readOnly: true,
      overridesGlobal: globalNames.has(name),
      summary: summariesByName.get(name),
    });
  }

  const firstByFingerprint = new Map<string, string>();
  for (const row of rows) {
    const fingerprint = serverFingerprint(row.config);
    if (!fingerprint) {
      continue;
    }

    const first = firstByFingerprint.get(fingerprint);
    if (first && first !== row.name) {
      row.duplicateOf = first;
      continue;
    }

    firstByFingerprint.set(fingerprint, row.name);
  }

  return rows.sort((left, right) =>
    left.name.localeCompare(right.name) || scopeLabel(left.scope).localeCompare(scopeLabel(right.scope)),
  );
}

function getConfigForScope(payload: McpManagementResponse, scope: EditableServerScope) {
  if (scope === 'global') {
    return payload.configs.global;
  }
  if (scope === 'project') {
    return payload.configs.project;
  }
  return payload.configs.claudeJsonGlobal;
}

function isEditableScope(scope: ServerScope): scope is EditableServerScope {
  return scope === 'global' || scope === 'project' || scope === 'claude-json-global';
}

function createEditorState(name: string, scope: EditableServerScope, config: McpServerConfig): EditorState {
  const type = serverType(config);
  return {
    originalName: name,
    originalScope: scope,
    scope,
    name,
    enabled: config.disabled !== true,
    type,
    command: config.command ?? '',
    args: toValueRows(config.args),
    env: toPairRows(config.env),
    envPassthrough: toValueRows(config.envPassthrough),
    cwd: config.cwd ?? '',
    url: config.url ?? '',
    headers: toPairRows(config.headers),
    auth: config.auth === 'bearer' || config.auth === 'oauth' ? config.auth : 'none',
    extra: Object.fromEntries(Object.entries(config).filter(([key]) => !KNOWN_SERVER_KEYS.has(key))),
  };
}

function createEmptyEditor(scope: EditableServerScope, name: string): EditorState {
  return {
    originalName: null,
    originalScope: null,
    scope,
    name,
    enabled: true,
    type: 'stdio',
    command: '',
    args: [],
    env: [],
    envPassthrough: [],
    cwd: '',
    url: '',
    headers: [],
    auth: 'none',
    extra: {},
  };
}

function buildServerConfig(editor: EditorState): McpServerConfig {
  const config: McpServerConfig = {
    ...editor.extra,
    type: editor.type,
  };

  if (!editor.enabled) {
    config.disabled = true;
  }

  if (editor.type === 'http') {
    config.url = editor.url.trim();
    const headers = rowsToRecord(editor.headers);
    if (Object.keys(headers).length > 0) {
      config.headers = headers;
    }
    if (editor.auth !== 'none') {
      config.auth = editor.auth;
    }
    return config;
  }

  config.command = editor.command.trim();
  const args = rowsToValues(editor.args);
  const env = rowsToRecord(editor.env);
  const envPassthrough = rowsToValues(editor.envPassthrough);
  if (args.length > 0) {
    config.args = args;
  }
  if (Object.keys(env).length > 0) {
    config.env = env;
  }
  if (envPassthrough.length > 0) {
    config.envPassthrough = envPassthrough;
  }
  if (editor.cwd.trim()) {
    config.cwd = editor.cwd.trim();
  }
  return config;
}

function serverType(config: McpServerConfig): 'stdio' | 'http' {
  return config.type === 'http' || typeof config.url === 'string' ? 'http' : 'stdio';
}

function serverFingerprint(config: McpServerConfig) {
  if (serverType(config) === 'http') {
    const url = config.url?.trim().toLowerCase();
    return url ? `http:${url}` : '';
  }

  let command = config.command?.trim() ?? '';
  let args = Array.isArray(config.args) ? config.args.filter((item): item is string => typeof item === 'string') : [];
  if (commandName(command) === 'cmd' && args[0]?.toLowerCase() === '/c' && args[1]) {
    command = args[1];
    args = args.slice(2);
  }

  const normalizedCommand = commandName(command);
  if (!normalizedCommand) {
    return '';
  }

  return ['stdio', normalizedCommand, ...args.map((arg) => arg.trim())]
    .filter(Boolean)
    .join('\0')
    .toLowerCase();
}

function commandName(command: string) {
  const normalized = command.replace(/\\/g, '/').split('/').pop() ?? command;
  return normalized.toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/i, '');
}

function toValueRows(values: unknown) {
  return Array.isArray(values)
    ? values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => ({ id: createId(), value }))
    : [];
}

function toPairRows(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value).map(([key, item]) => ({
    id: createId(),
    key,
    value: typeof item === 'string' ? item : JSON.stringify(item),
  }));
}

function rowsToValues(rows: ValueRow[]) {
  return rows.map((row) => row.value.trim()).filter(Boolean);
}

function rowsToRecord(rows: PairRow[]) {
  return Object.fromEntries(
    rows
      .map((row) => [row.key.trim(), row.value] as const)
      .filter(([key]) => key),
  );
}

function uniqueServerName(rows: ServerRow[], baseName: string) {
  const names = new Set(rows.map((row) => row.name));
  if (!names.has(baseName)) {
    return baseName;
  }

  for (let index = 2; index < 100; index += 1) {
    const candidate = `${baseName}-${index}`;
    if (!names.has(candidate)) {
      return candidate;
    }
  }

  return `${baseName}-${Date.now()}`;
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function scopeLabel(scope: ServerScope) {
  if (scope === 'global') {
    return '用户级';
  }
  if (scope === 'project') {
    return '项目级';
  }
  if (scope === 'claude-json-global') {
    return 'Claude Code 全局';
  }
  return 'Claude Code 项目';
}

function mcpLocationDescription(providerId: AgentProviderId) {
  if (providerId === 'openai-codex') {
    return <>直接管理 <code>~/.codex/config.toml</code> 与项目内 <code>.codex/config.toml</code> 的 <code>mcp_servers</code>。</>;
  }
  if (providerId === 'grok-build') {
    return <>直接管理 <code>~/.grok/config.toml</code> 与项目内 <code>.grok/config.toml</code> 的 <code>mcp_servers</code>。</>;
  }
  if (providerId === 'opencode') {
    return <>直接管理 <code>~/.config/opencode/opencode.json</code> 与项目内 <code>.opencode/opencode.json</code> 的 <code>mcp</code>，保存时保留其他 OpenCode 配置。</>;
  }
  return <>直接管理 <code>~/.claude/mcp.json</code>、项目 <code>.mcp.json</code> 与 <code>~/.claude.json</code>。</>;
}

function normalizeManagedStatus(status?: McpServerSummary['status']) {
  if (status === 'available') {
    return 'connected';
  }
  if (status === 'error') {
    return 'error';
  }
  return 'unknown';
}

function mcpStatusText(status: 'connected' | 'unknown' | 'error' | 'disabled') {
  if (status === 'connected') {
    return '可用';
  }
  if (status === 'disabled') {
    return '已停用';
  }
  if (status === 'error') {
    return '异常';
  }
  return '未知';
}

function mcpStatusClass(status: 'connected' | 'unknown' | 'error' | 'disabled') {
  if (status === 'connected') {
    return 'available';
  }
  if (status === 'error') {
    return 'error';
  }
  return '';
}
