import express, { type ErrorRequestHandler } from 'express';
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  acknowledgeRunEvents,
  cancelRun,
  closeThreadRuntime,
  createClaudeStream,
  detectClaudeCommand,
  getActiveRunForThread,
  getClaudeModels,
  isDirectoryAccessible,
  markRunDetached,
  markThreadRunDetached,
  reconnectClaudeRunEvents,
  submitRunApprovalDecision,
  submitRunRequestUserInput,
  type ClaudePermissionMode,
} from './lib/claude-service.js';
import {
  canPreviewWorkspaceFile,
  createProject,
  createThread,
  getProjectGitSummary,
  getThreadHistory,
  getUsageStats,
  getWorkspaceBootstrap,
  listOpenTargets,
  listProjectGitBranches,
  openProjectInEditor,
  openProjectInExplorer,
  removeProject,
  removeThread,
  renameProject,
  renameThread,
  saveThreadHistory,
  setActiveSelection,
  switchProjectGitBranch,
  updatePanelState,
  updateThreadMetadata,
} from './lib/workspace-store.js';
import {
  getAppSettings,
  updateAppearanceSettings,
  updateGeneralSettings,
  updateModelSettings,
  updateOpenWithSettings,
  updateShortcutSettings,
} from './lib/settings-store.js';
import {
  readClaudeGlobalPrompt,
  saveClaudeGlobalPrompt,
} from './lib/claude-global-prompt.js';
import { listMcpServers } from './lib/mcp-inspector.js';
import { listSkills } from './lib/skills-scanner.js';
import { selectDirectory } from './lib/system-dialog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const port = Number(process.env.PORT ?? 3001);
const jsonBodyLimit = process.env.CODEM_JSON_BODY_LIMIT ?? '25mb';

const app = express();

app.use(express.json({ limit: jsonBodyLimit }));
app.use(createJsonBodyErrorHandler());

app.get('/api/health', async (_request, response) => {
  const result = await detectClaudeCommand();
  response.json(result);
});

app.get('/api/claude/models', (_request, response) => {
  response.json(getClaudeModels());
});

app.get('/api/claude/system-prompt', (_request, response) => {
  try {
    response.json(readClaudeGlobalPrompt());
  } catch (error) {
    console.error('读取 Claude 全局提示词失败', error);
    response.status(500).json({ error: '读取 Claude 全局提示词失败' });
  }
});

app.put('/api/claude/system-prompt', (request, response) => {
  try {
    response.json(saveClaudeGlobalPrompt(request.body?.content));
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存 Claude 全局提示词失败';
    console.error('保存 Claude 全局提示词失败', error);
    response.status(400).json({ error: message });
  }
});

app.get('/api/settings', (_request, response) => {
  try {
    response.json(getAppSettings());
  } catch (error) {
    console.error('读取设置失败', error);
    response.status(500).json({ error: '读取设置失败' });
  }
});

app.put('/api/settings/appearance', (request, response) => {
  try {
    response.json(updateAppearanceSettings(request.body));
  } catch (error) {
    console.error('保存外观设置失败', error);
    response.status(500).json({ error: '保存外观设置失败' });
  }
});

app.put('/api/settings/general', (request, response) => {
  try {
    response.json(updateGeneralSettings(request.body));
  } catch (error) {
    console.error('保存基础设置失败', error);
    response.status(500).json({ error: '保存基础设置失败' });
  }
});

app.put('/api/settings/models', (request, response) => {
  try {
    response.json(updateModelSettings(request.body));
  } catch (error) {
    console.error('保存模型设置失败', error);
    response.status(500).json({ error: '保存模型设置失败' });
  }
});

app.put('/api/settings/shortcuts', (request, response) => {
  try {
    response.json(updateShortcutSettings(request.body));
  } catch (error) {
    console.error('保存快捷键设置失败', error);
    response.status(500).json({ error: '保存快捷键设置失败' });
  }
});

app.put('/api/settings/open-with', (request, response) => {
  try {
    response.json(updateOpenWithSettings(request.body));
  } catch (error) {
    console.error('保存打开方式失败', error);
    response.status(500).json({ error: '保存打开方式失败' });
  }
});

app.get('/api/open-with/targets', (_request, response) => {
  try {
    const settings = getAppSettings();
    response.json({
      targets: listOpenTargets(),
      selectedTargetId: settings.openWith.selectedTargetId,
    });
  } catch (error) {
    console.error('读取打开工具失败', error);
    response.status(500).json({ error: '读取打开工具失败' });
  }
});

app.get('/api/usage', (_request, response) => {
  try {
    response.json(getUsageStats());
  } catch (error) {
    console.error('读取使用情况失败', error);
    response.status(500).json({ error: '读取使用情况失败' });
  }
});

app.get('/api/mcp/servers', (_request, response) => {
  try {
    response.json(listMcpServers());
  } catch (error) {
    console.error('读取 MCP 配置失败', error);
    response.status(500).json({ error: '读取 MCP 配置失败' });
  }
});

app.get('/api/skills', (_request, response) => {
  try {
    response.json(listSkills({ projectDirectory: projectRoot }));
  } catch (error) {
    console.error('读取 Skills 失败', error);
    response.status(500).json({ error: '读取 Skills 失败' });
  }
});

app.get('/api/workspace/bootstrap', (_request, response) => {
  response.json(getWorkspaceBootstrap());
});

app.post('/api/workspace/selection', (request, response) => {
  const projectId =
    typeof request.body?.projectId === 'string' && request.body.projectId.trim()
      ? request.body.projectId.trim()
      : null;
  const threadId =
    typeof request.body?.threadId === 'string' && request.body.threadId.trim()
      ? request.body.threadId.trim()
      : null;

  setActiveSelection(projectId, threadId);
  response.json({ ok: true });
});

app.patch('/api/workspace/panel', (request, response) => {
  updatePanelState({
    organizeBy: typeof request.body?.organizeBy === 'string' ? request.body.organizeBy : undefined,
    sortBy: typeof request.body?.sortBy === 'string' ? request.body.sortBy : undefined,
    visibility: typeof request.body?.visibility === 'string' ? request.body.visibility : undefined,
  });
  response.json({ ok: true });
});

app.post('/api/system/select-directory', async (request, response) => {
  const initialPath =
    typeof request.body?.initialPath === 'string' && request.body.initialPath.trim()
      ? request.body.initialPath.trim()
      : undefined;

  try {
    const selectedPath = await selectDirectory(initialPath);
    response.json({
      ok: true,
      path: selectedPath,
    });
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : '目录选择失败');
  }
});

app.post('/api/projects', async (request, response) => {
  const projectPath =
    typeof request.body?.path === 'string' && request.body.path.trim()
      ? request.body.path.trim()
      : '';

  if (!projectPath) {
    response.status(400).send('path 不能为空');
    return;
  }

  const resolvedPath = path.resolve(projectPath);
  const accessible = await isDirectoryAccessible(resolvedPath);
  if (!accessible) {
    response.status(400).send(`目录不存在或不可访问：${resolvedPath}`);
    return;
  }

  const projectId = createProject(resolvedPath);
  response.json({
    ok: true,
    projectId,
    workspace: getWorkspaceBootstrap(),
  });
});

app.patch('/api/projects/:projectId', (request, response) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
  if (!name) {
    response.status(400).send('name 不能为空');
    return;
  }

  try {
    renameProject(request.params.projectId, name);
    response.json({
      ok: true,
      workspace: getWorkspaceBootstrap(),
    });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '项目修改失败');
  }
});

app.delete('/api/projects/:projectId', (request, response) => {
  removeProject(request.params.projectId);
  response.json({
    ok: true,
    workspace: getWorkspaceBootstrap(),
  });
});

app.post('/api/projects/:projectId/open', (request, response) => {
  try {
    openProjectInExplorer(request.params.projectId);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '打开目录失败');
  }
});

app.get('/api/system/file-preview', (request, response) => {
  const filePath =
    typeof request.query.path === 'string' && request.query.path.trim()
      ? path.resolve(request.query.path.trim())
      : '';

  if (!filePath) {
    response.status(400).send('path 不能为空');
    return;
  }

  if (!canPreviewWorkspaceFile(filePath)) {
    response.status(403).send('无权访问该路径');
    return;
  }

  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      response.status(400).send('目标不是文件');
      return;
    }
    if (stats.size > 200 * 1024) {
      response.status(400).send('文件过大，暂不预览');
      return;
    }

    const buffer = readFileSync(filePath);
    if (buffer.includes(0)) {
      response.status(400).send('二进制文件暂不预览');
      return;
    }

    response.json({
      path: filePath,
      content: buffer.toString('utf8'),
    });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '文件预览失败');
  }
});

app.post('/api/projects/:projectId/open-editor', (request, response) => {
  try {
    const targetId =
      typeof request.body?.targetId === 'string' && request.body.targetId.trim()
        ? request.body.targetId.trim()
        : undefined;
    openProjectInEditor(request.params.projectId, targetId);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '打开编辑器失败');
  }
});

app.get('/api/projects/:projectId/git', async (request, response) => {
  try {
    response.json(await getProjectGitSummary(request.params.projectId));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取 Git 状态失败');
  }
});

app.get('/api/projects/:projectId/git/branches', async (request, response) => {
  try {
    response.json(await listProjectGitBranches(request.params.projectId));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取 Git 分支失败');
  }
});

app.post('/api/projects/:projectId/git/switch', async (request, response) => {
  const branch = typeof request.body?.branch === 'string' ? request.body.branch.trim() : '';
  if (!branch) {
    response.status(400).send('branch 不能为空');
    return;
  }

  try {
    response.json(await switchProjectGitBranch(request.params.projectId, branch));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '切换 Git 分支失败');
  }
});

app.post('/api/projects/:projectId/threads', (request, response) => {
  const title =
    typeof request.body?.title === 'string' && request.body.title.trim()
      ? request.body.title.trim()
      : undefined;

  try {
    const threadId = createThread(request.params.projectId, title);
    response.json({
      ok: true,
      threadId,
      workspace: getWorkspaceBootstrap(),
    });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '新建聊天失败');
  }
});

app.patch('/api/threads/:threadId', (request, response) => {
  try {
    const nextTitle =
      typeof request.body?.title === 'string' && request.body.title.trim()
        ? request.body.title.trim()
        : undefined;
    const shouldRefreshWorkspace = Boolean(nextTitle);

    if (nextTitle) {
      renameThread(request.params.threadId, nextTitle);
    }

    updateThreadMetadata(request.params.threadId, {
      sessionId:
        typeof request.body?.sessionId === 'string' && request.body.sessionId.trim()
          ? request.body.sessionId.trim()
          : undefined,
      workingDirectory:
        typeof request.body?.workingDirectory === 'string' && request.body.workingDirectory.trim()
          ? request.body.workingDirectory.trim()
          : undefined,
      model:
        typeof request.body?.model === 'string' && request.body.model.trim()
          ? request.body.model.trim()
          : undefined,
      permissionMode:
        typeof request.body?.permissionMode === 'string' && request.body.permissionMode.trim()
          ? request.body.permissionMode.trim()
          : undefined,
    });

    if (shouldRefreshWorkspace) {
      response.json({
        ok: true,
        workspace: getWorkspaceBootstrap(),
      });
      return;
    }

    response.json({ ok: true });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '聊天更新失败');
  }
});

app.delete('/api/threads/:threadId', (_request, response) => {
  try {
    removeThread(_request.params.threadId);
    closeThreadRuntime(_request.params.threadId);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '聊天删除失败');
  }
});

app.get('/api/threads/:threadId/history', (request, response) => {
  try {
    response.json(getThreadHistory(request.params.threadId));
  } catch (error) {
    response.status(404).send(error instanceof Error ? error.message : '聊天不存在');
  }
});

app.put('/api/threads/:threadId/history', (request, response) => {
  try {
    if (!Array.isArray(request.body?.turns)) {
      response.status(400).send('turns 必须是数组');
      return;
    }

    saveThreadHistory(request.params.threadId, request.body.turns);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '聊天历史保存失败');
  }
});

app.post('/api/claude/run', async (request, response) => {
  const requestReceivedAtMs = Date.now();
  const threadId = typeof request.body?.threadId === 'string' ? request.body.threadId.trim() : '';
  const turnId =
    typeof request.body?.turnId === 'string' && request.body.turnId.trim()
      ? request.body.turnId.trim()
      : undefined;
  const prompt = typeof request.body?.prompt === 'string' ? request.body.prompt.trim() : '';
  const workingDirectory =
    typeof request.body?.workingDirectory === 'string' ? request.body.workingDirectory.trim() : '';
  const sessionId =
    typeof request.body?.sessionId === 'string' && request.body.sessionId.trim()
      ? request.body.sessionId.trim()
      : undefined;
  const permissionMode = (
    typeof request.body?.permissionMode === 'string' ? request.body.permissionMode : 'bypassPermissions'
  ) as ClaudePermissionMode;
  const model =
    typeof request.body?.model === 'string' && request.body.model.trim()
      ? request.body.model.trim()
      : undefined;
  const toolResultPayload =
    request.body?.toolResult && typeof request.body.toolResult === 'object' ? request.body.toolResult : undefined;
  const toolResult =
    toolResultPayload &&
    typeof toolResultPayload.requestId === 'string' &&
    toolResultPayload.requestId.trim() &&
    typeof toolResultPayload.content === 'string'
      ? {
          requestId: toolResultPayload.requestId.trim(),
          content: toolResultPayload.content,
          isError: toolResultPayload.isError === true,
        }
      : undefined;
  const clientSubmitAtMs =
    typeof request.body?.clientSubmitAtMs === 'number' && Number.isFinite(request.body.clientSubmitAtMs)
      ? request.body.clientSubmitAtMs
      : undefined;

  if (!prompt) {
    response.status(400).send('prompt 不能为空');
    return;
  }

  if (!threadId) {
    response.status(400).send('threadId 不能为空');
    return;
  }

  if (!workingDirectory) {
    response.status(400).send('workingDirectory 不能为空');
    return;
  }

  const resolvedDirectory = path.resolve(workingDirectory);
  const accessible = await isDirectoryAccessible(resolvedDirectory);
  if (!accessible) {
    response.status(400).send(`目录不存在或不可访问：${resolvedDirectory}`);
    return;
  }

  response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  const stream = await createClaudeStream({
    threadId,
    turnId,
    prompt,
    workingDirectory: resolvedDirectory,
    sessionId,
    permissionMode,
    model,
    toolResult,
    requestReceivedAtMs,
    clientSubmitAtMs,
  });
  let currentRunId: string | undefined;
  let streamCompleted = false;

  response.on('close', () => {
    if (!streamCompleted) {
      if (currentRunId) {
        markRunDetached(currentRunId);
      } else {
        markThreadRunDetached(threadId);
      }
    }
  });

  for await (const message of stream) {
    currentRunId ??= message.runId;

    if (response.writableEnded || response.destroyed) {
      if (currentRunId) {
        markRunDetached(currentRunId);
      } else {
        markThreadRunDetached(threadId);
      }
      break;
    }

    response.write(`${JSON.stringify(message)}\n`);
    (response as typeof response & { flush?: () => void }).flush?.();
  }

  streamCompleted = true;
  response.end();
});

app.get('/api/claude/runs/active/:threadId', (request, response) => {
  const activeRun = getActiveRunForThread(request.params.threadId);
  if (!activeRun) {
    response.status(404).json({ active: false });
    return;
  }

  response.json({ active: true, ...activeRun });
});

app.get('/api/claude/run/:runId/events', async (request, response) => {
  const after =
    typeof request.query.after === 'string' && request.query.after.trim()
      ? Number.parseInt(request.query.after, 10)
      : 0;

  response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  const abortController = new AbortController();
  response.on('close', () => {
    abortController.abort();
  });

  for await (const message of reconnectClaudeRunEvents(
    request.params.runId,
    Number.isFinite(after) ? after : 0,
    { signal: abortController.signal },
  )) {
    if (response.writableEnded || response.destroyed) {
      break;
    }

    response.write(`${JSON.stringify(message)}\n`);
    (response as typeof response & { flush?: () => void }).flush?.();
  }

  response.end();
});

app.post('/api/claude/run/:runId/ack', (request, response) => {
  const acknowledged = acknowledgeRunEvents(request.params.runId);
  response.json({ acknowledged });
});

app.post('/api/claude/run/:runId/request-user-input', (request, response) => {
  const requestId = typeof request.body?.requestId === 'string' ? request.body.requestId.trim() : '';
  const rawAnswers = request.body?.answers;
  const answers =
    rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers)
      ? Object.fromEntries(
          Object.entries(rawAnswers)
            .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''])
            .filter(([key, value]) => key.trim() && value),
        )
      : {};

  if (!requestId) {
    response.status(400).json({ submitted: false, error: '缺少提问请求 ID。' });
    return;
  }

  if (Object.keys(answers).length === 0) {
    response.status(400).json({ submitted: false, error: '缺少有效回答。' });
    return;
  }

  const result = submitRunRequestUserInput(request.params.runId, requestId, answers);
  if (!result.submitted) {
    response.status(409).json(result);
    return;
  }

  response.json(result);
});

app.post('/api/claude/run/:runId/approval-decision', (request, response) => {
  const requestId = typeof request.body?.requestId === 'string' ? request.body.requestId.trim() : '';
  const decision = request.body?.decision === 'reject' ? 'reject' : 'approve';
  const content =
    typeof request.body?.content === 'string' && request.body.content.trim()
      ? request.body.content.trim()
      : decision === 'approve'
        ? 'The user approved this request. Continue the original task.'
        : 'The user rejected this request. Do not perform the requested action.';

  if (!requestId) {
    response.status(400).json({ submitted: false, error: '缺少批准请求 ID。' });
    return;
  }

  const result = submitRunApprovalDecision(request.params.runId, requestId, decision, content);
  if (!result.submitted) {
    response.status(409).json(result);
    return;
  }

  response.json(result);
});

app.delete('/api/claude/run/:runId', (request, response) => {
  const cancelled = cancelRun(request.params.runId);
  response.json({ cancelled });
});

app.post('/api/claude/runtime/:threadId/close', (request, response) => {
  const closed = closeThreadRuntime(request.params.threadId);
  response.json({ closed });
});

if (await isDirectoryAccessible(distRoot)) {
  app.use(express.static(distRoot));
  app.get('*all', (_request, response) => {
    response.sendFile(path.join(distRoot, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`CodeM bridge listening at http://127.0.0.1:${port}`);
});

function createJsonBodyErrorHandler(): ErrorRequestHandler {
  return (error, _request, response, next) => {
    if (isPayloadTooLargeError(error)) {
      response
        .status(413)
        .send(`请求内容过大，当前 JSON 上限为 ${jsonBodyLimit}。请缩短会话历史或调高 CODEM_JSON_BODY_LIMIT。`);
      return;
    }

    next(error);
  };
}

function isPayloadTooLargeError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown; type?: unknown };
  return candidate.status === 413 || candidate.statusCode === 413 || candidate.type === 'entity.too.large';
}
