import express from 'express';
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  cancelRun,
  createClaudeStream,
  detectClaudeCommand,
  getClaudeModels,
  isDirectoryAccessible,
  type ClaudePermissionMode,
} from './lib/claude-service.js';
import {
  canPreviewWorkspaceFile,
  createProject,
  createThread,
  getProjectGitSummary,
  getThreadHistory,
  getWorkspaceBootstrap,
  openProjectInEditor,
  openProjectInExplorer,
  removeProject,
  removeThread,
  renameProject,
  renameThread,
  saveThreadHistory,
  setActiveSelection,
  updatePanelState,
  updateThreadMetadata,
} from './lib/workspace-store.js';
import { selectDirectory } from './lib/system-dialog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const port = Number(process.env.PORT ?? 3001);

const app = express();

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_request, response) => {
  const result = await detectClaudeCommand();
  response.json(result);
});

app.get('/api/claude/models', (_request, response) => {
  response.json(getClaudeModels());
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
    openProjectInEditor(request.params.projectId);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '打开编辑器失败');
  }
});

app.get('/api/projects/:projectId/git', (request, response) => {
  try {
    response.json(getProjectGitSummary(request.params.projectId));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取 Git 状态失败');
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
  const clientSubmitAtMs =
    typeof request.body?.clientSubmitAtMs === 'number' && Number.isFinite(request.body.clientSubmitAtMs)
      ? request.body.clientSubmitAtMs
      : undefined;

  if (!prompt) {
    response.status(400).send('prompt 不能为空');
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
    prompt,
    workingDirectory: resolvedDirectory,
    sessionId,
    permissionMode,
    model,
    requestReceivedAtMs,
    clientSubmitAtMs,
  });
  let currentRunId: string | undefined;

  response.on('close', () => {
    if (currentRunId) {
      cancelRun(currentRunId);
    }
  });

  for await (const message of stream) {
    currentRunId ??= message.runId;

    if (response.writableEnded || response.destroyed) {
      if (currentRunId) {
        cancelRun(currentRunId);
      }
      break;
    }

    response.write(`${JSON.stringify(message)}\n`);
    (response as typeof response & { flush?: () => void }).flush?.();
  }

  response.end();
});

app.delete('/api/claude/run/:runId', (request, response) => {
  const cancelled = cancelRun(request.params.runId);
  response.json({ cancelled });
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
