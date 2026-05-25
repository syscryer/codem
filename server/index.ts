import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeInputContentBlocks } from '../src/lib/input-content-blocks.js';
import type { InputContentBlock, InputReferenceReason } from '../src/types.js';
import {
  acknowledgeRunEvents,
  cancelRun,
  closeThreadRuntime,
  createClaudeStream,
  detectClaudeCommand,
  getActiveRunForThread,
  getClaudeModels,
  getThreadRuntimeStatuses,
  isDirectoryAccessible,
  markRunDetached,
  markThreadRunDetached,
  reconnectClaudeRunEvents,
  submitRunApprovalDecision,
  submitRunGuidePrompt,
  submitRunRequestUserInput,
  type ClaudeEffortLevel,
  type ClaudeInputImageAttachment,
  type ClaudePermissionMode,
} from './lib/claude-service.js';
import {
  canPreviewWorkspaceFile,
  createProject,
  createThread,
  commitProjectGitChanges,
  createProjectGitWorktree,
  createProjectGitBranch,
  compareProjectGitBranches,
  fetchProjectGitRemote,
  getProjectGitCommitDetails,
  getProjectGitCommitFilePreview,
  getProjectGitFileDiff,
  listProjectGitHistory,
  listProjectGitHistoryLog,
  getProjectGitPushPreview,
  getProjectGitSummary,
  getProjectGitStatus,
  getThreadHistory,
  getUsageStats,
  getWorkspaceBootstrap,
  listProjectFiles,
  listProjectGitWorktrees,
  listOpenTargets,
  listProjectGitBranches,
  openProjectInEditor,
  openProjectInExplorer,
  removeProject,
  removeProjectGitWorktree,
  removeThread,
  renameProject,
  renameThread,
  saveThreadHistory,
  setActiveSelection,
  suggestProjectGitWorktreePath,
  pullProjectGitBranch,
  pushProjectGitBranch,
  switchProjectGitBranch,
  undoProjectAiTurnChanges,
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
import {
  installBuiltinSkill,
  installSkillFromPath,
  listInstalledPlugins,
  listMarketplaces,
  listSkills as listPluginSkills,
  runPluginCommand,
} from './lib/plugins.js';
import { listMcpServers } from './lib/mcp-inspector.js';
import {
  ensureMcpConfigFile,
  readMcpConfigSnapshot,
  writeClaudeJsonMcpConfig,
  writeMcpConfig,
} from './lib/mcp-manager.js';
import { listSkills } from './lib/skills-scanner.js';
import { listSlashCommands } from './lib/slash-commands.js';
import { openPath, revealPathInExplorer, selectDirectory } from './lib/system-dialog.js';
import { cloneRepository, CloneRepositoryError } from './lib/git-clone.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const port = Number(process.env.CODEM_BACKEND_PORT ?? process.env.PORT ?? 3001);
const jsonBodyLimit = process.env.CODEM_JSON_BODY_LIMIT ?? '25mb';
const MAX_WORKSPACE_FILE_SEARCH_RESULTS = 80;
const MAX_WORKSPACE_FILE_SEARCH_CANDIDATES = 500;

const app = express();

app.use(createLocalCorsHandler());
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

app.get('/api/usage', (request, response) => {
  try {
    const range = resolveUsageRangeDays(request.query.range);
    if (range === 'invalid') {
      response.status(400).json({ error: '不支持的使用情况统计范围' });
      return;
    }
    response.json(getUsageStats(range ?? undefined));
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

app.get('/api/mcp/configs', (request, response) => {
  try {
    const projectPath = resolveProjectPathValue(request.query.projectPath);
    response.json({
      ...readMcpConfigSnapshot({ projectDirectory: projectPath || undefined }),
      overview: listMcpServers({ projectDirectory: projectPath || undefined }),
    });
  } catch (error) {
    console.error('读取 MCP 管理配置失败', error);
    response.status(500).json({ error: '读取 MCP 管理配置失败' });
  }
});

app.put('/api/mcp/configs/:scope', (request, response) => {
  try {
    const projectPath = resolveProjectPathValue(request.query.projectPath);
    const scope = typeof request.params.scope === 'string' ? request.params.scope : '';
    if (scope === 'global' || scope === 'project') {
      response.json(writeMcpConfig(scope, request.body, { projectDirectory: projectPath || undefined }));
      return;
    }

    if (scope === 'claude-json-global' || scope === 'claude-json-project') {
      response.json(
        writeClaudeJsonMcpConfig(scope === 'claude-json-project' ? 'project' : 'global', request.body, {
          projectDirectory: projectPath || undefined,
        }),
      );
      return;
    }

    response.status(400).json({ error: '不支持的 MCP 配置作用域' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存 MCP 配置失败';
    console.error('保存 MCP 配置失败', error);
    response.status(400).json({ error: message });
  }
});

app.post('/api/mcp/open', async (request, response) => {
  try {
    const scope = typeof request.body?.scope === 'string' ? request.body.scope : '';
    const projectPath = resolveProjectPathValue(request.body?.projectPath);
    if (
      scope !== 'global' &&
      scope !== 'project' &&
      scope !== 'claude-json-global' &&
      scope !== 'claude-json-project'
    ) {
      response.status(400).json({ error: '不支持的 MCP 配置作用域' });
      return;
    }

    const filePath = ensureMcpConfigFile(scope, { projectDirectory: projectPath || undefined });
    await openPath(filePath);
    response.json({ ok: true, path: filePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : '打开 MCP 配置失败';
    console.error('打开 MCP 配置失败', error);
    response.status(400).json({ error: message });
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

app.get('/api/plugins/installed', async (_request, response) => {
  try {
    response.json(await listInstalledPlugins());
  } catch (error) {
    console.error('读取已安装插件失败', error);
    response.status(500).json({ error: '读取已安装插件失败' });
  }
});

app.get('/api/plugins/marketplaces', async (_request, response) => {
  try {
    response.json(await listMarketplaces());
  } catch (error) {
    console.error('读取插件市场失败', error);
    response.status(500).json({ error: '读取插件市场失败' });
  }
});

app.get('/api/plugins/skills', async (request, response) => {
  try {
    const projectPath =
      typeof request.query.projectPath === 'string' && request.query.projectPath.trim()
        ? path.resolve(request.query.projectPath.trim())
        : null;
    response.json(await listPluginSkills(projectPath));
  } catch (error) {
    console.error('读取插件 Skills 失败', error);
    response.status(500).json({ error: '读取插件 Skills 失败' });
  }
});

app.post('/api/plugins/skills/install-from-path', async (request, response) => {
  try {
    response.json(await installSkillFromPath(request.body));
  } catch (error) {
    console.error('导入 Skill 失败', error);
    response.status(500).json({ error: '导入 Skill 失败' });
  }
});

app.post('/api/plugins/skills/install-builtin', async (request, response) => {
  try {
    response.json(await installBuiltinSkill(request.body));
  } catch (error) {
    console.error('安装内置 Skill 失败', error);
    response.status(500).json({ error: '安装内置 Skill 失败' });
  }
});

app.post('/api/plugins/command', async (request, response) => {
  try {
    response.json(await runPluginCommand(request.body));
  } catch (error) {
    console.error('执行插件命令失败', error);
    response.status(500).json({ error: '执行插件命令失败' });
  }
});

app.get('/api/slash-commands', (request, response) => {
  try {
    const projectPath =
      typeof request.query.projectPath === 'string' && request.query.projectPath.trim()
        ? path.resolve(request.query.projectPath.trim())
        : projectRoot;

    response.json({
      commands: listSlashCommands({
        projectDirectory: projectPath,
      }),
    });
  } catch (error) {
    console.error('读取 Slash Commands 失败', error);
    response.status(500).json({ error: '读取 Slash Commands 失败' });
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

app.post('/api/git/clone', async (request, response) => {
  const repoUrl =
    typeof request.body?.repoUrl === 'string' && request.body.repoUrl.trim()
      ? request.body.repoUrl.trim()
      : '';
  const baseDirectory =
    typeof request.body?.baseDirectory === 'string' && request.body.baseDirectory.trim()
      ? request.body.baseDirectory.trim()
      : '';
  const folderName =
    typeof request.body?.folderName === 'string' && request.body.folderName.trim()
      ? request.body.folderName.trim()
      : '';

  try {
    response.json({
      ok: true,
      ...(await cloneRepository({
        repoUrl,
        baseDirectory,
        folderName,
      })),
    });
  } catch (error) {
    if (error instanceof CloneRepositoryError) {
      response.status(400).json({
        error: error.message,
        rawLog: error.rawLog,
      });
      return;
    }

    response.status(400).json({
      error: error instanceof Error ? error.message : '克隆仓库失败',
    });
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

app.post('/api/system/open-path', async (request, response) => {
  const targetPath =
    typeof request.body?.path === 'string' && request.body.path.trim()
      ? path.resolve(request.body.path.trim())
      : '';
  const mode = request.body?.mode === 'reveal' ? 'reveal' : 'open';
  if (!targetPath) {
    response.status(400).send('path 不能为空');
    return;
  }

  try {
    if (mode === 'reveal') {
      await revealPathInExplorer(targetPath);
    } else {
      await openPath(targetPath);
    }
    response.json({ ok: true });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '打开路径失败');
  }
});

app.get('/api/system/files/search', async (request, response) => {
  const workingDirectory =
    typeof request.query.workingDirectory === 'string' ? request.query.workingDirectory.trim() : '';
  const query = typeof request.query.query === 'string' ? request.query.query.trim() : '';

  if (!workingDirectory) {
    response.status(400).send('workingDirectory 不能为空');
    return;
  }

  const root = path.resolve(workingDirectory);
  const accessible = await isDirectoryAccessible(root);
  if (!accessible) {
    response.status(400).send(`目录不存在或不可访问：${root}`);
    return;
  }

  try {
    response.json({ files: await searchWorkspaceFiles(root, query) });
  } catch (error) {
    console.error('搜索工作区文件失败', error);
    response.status(500).send(error instanceof Error ? error.message : '搜索工作区文件失败');
  }
});

app.post('/api/system/attachments/image', async (request, response) => {
  const workingDirectory =
    typeof request.body?.workingDirectory === 'string' ? request.body.workingDirectory.trim() : '';
  const fileName = typeof request.body?.fileName === 'string' ? request.body.fileName.trim() : '';
  const mimeType = typeof request.body?.mimeType === 'string' ? request.body.mimeType.trim() : '';
  const dataUrl = typeof request.body?.dataUrl === 'string' ? request.body.dataUrl.trim() : '';

  if (!workingDirectory) {
    response.status(400).send('workingDirectory 不能为空');
    return;
  }

  if (!dataUrl) {
    response.status(400).send('dataUrl 不能为空');
    return;
  }

  const resolvedDirectory = path.resolve(workingDirectory);
  const accessible = await isDirectoryAccessible(resolvedDirectory);
  if (!accessible) {
    response.status(400).send(`目录不存在或不可访问：${resolvedDirectory}`);
    return;
  }

  try {
    const parsedImage = parseImageDataUrl(dataUrl, mimeType);
    const attachmentsDirectory = path.join(resolvedDirectory, '.codem-attachments');
    await mkdir(attachmentsDirectory, { recursive: true });

    const filePath = path.join(attachmentsDirectory, buildAttachmentFileName(parsedImage.extension));
    await writeFile(filePath, parsedImage.buffer);

    response.json({
      path: filePath,
      mimeType: parsedImage.mimeType,
      size: parsedImage.buffer.length,
      name: fileName || path.basename(filePath),
    });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '图片保存失败');
  }
});

app.get('/api/system/image-preview', (request, response) => {
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
    if (stats.size > 15 * 1024 * 1024) {
      response.status(400).send('图片过大，暂不预览');
      return;
    }
    if (!isSupportedImageFilePath(filePath)) {
      response.status(400).send('仅支持图片预览');
      return;
    }

    response.setHeader('Cache-Control', 'no-store');
    response.sendFile(path.basename(filePath), { root: path.dirname(filePath) });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '图片预览失败');
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
    if (isSupportedImageFilePath(filePath)) {
      response.json({
        path: filePath,
        content: '',
        mode: 'image',
        previewUrl: `/api/system/image-preview?path=${encodeURIComponent(filePath)}`,
      });
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

app.get('/api/projects/:projectId/files', (request, response) => {
  const directory = typeof request.query.path === 'string' ? request.query.path.trim() : '';

  try {
    response.json(listProjectFiles(request.params.projectId, directory));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取项目文件失败');
  }
});

app.get('/api/projects/:projectId/git/branches', async (request, response) => {
  try {
    response.json(await listProjectGitBranches(request.params.projectId));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取 Git 分支失败');
  }
});

app.get('/api/projects/:projectId/git/history', async (request, response) => {
  const ref = typeof request.query.ref === 'string' ? request.query.ref.trim() : undefined;
  const limit = typeof request.query.limit === 'string' ? Number(request.query.limit) : undefined;

  try {
    response.json(await listProjectGitHistory(request.params.projectId, { ref, limit }));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取 Git 历史失败');
  }
});

app.get('/api/projects/:projectId/git/history/log', async (request, response) => {
  const refs = readRepeatedQueryValues(request.query.refs);
  const authors = readRepeatedQueryValues(request.query.authors);
  const paths = readRepeatedQueryValues(request.query.paths);
  const dateFrom = typeof request.query.dateFrom === 'string' ? request.query.dateFrom.trim() : undefined;
  const dateTo = typeof request.query.dateTo === 'string' ? request.query.dateTo.trim() : undefined;
  const search = typeof request.query.search === 'string' ? request.query.search.trim() : undefined;
  const cursor = typeof request.query.cursor === 'string' ? request.query.cursor.trim() : undefined;
  const limit = typeof request.query.limit === 'string' ? Number(request.query.limit) : undefined;

  try {
    response.json(
      await listProjectGitHistoryLog(request.params.projectId, {
        refs,
        authors,
        dateFrom,
        dateTo,
        paths,
        search,
        cursor,
        limit,
      }),
    );
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取 Git 日志失败');
  }
});

app.get('/api/projects/:projectId/git/history/compare', async (request, response) => {
  const targetBranch = typeof request.query.targetBranch === 'string' ? request.query.targetBranch.trim() : '';
  const compareBranch = typeof request.query.compareBranch === 'string' ? request.query.compareBranch.trim() : '';
  if (!targetBranch || !compareBranch) {
    response.status(400).send('targetBranch 和 compareBranch 不能为空');
    return;
  }

  try {
    response.json(await compareProjectGitBranches(request.params.projectId, targetBranch, compareBranch));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取分支比较失败');
  }
});

app.get('/api/projects/:projectId/git/history/commit', async (request, response) => {
  const sha = typeof request.query.sha === 'string' ? request.query.sha.trim() : '';
  if (!sha) {
    response.status(400).send('sha 不能为空');
    return;
  }

  try {
    response.json(await getProjectGitCommitDetails(request.params.projectId, sha));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取提交详情失败');
  }
});

app.get('/api/projects/:projectId/git/history/file', async (request, response) => {
  const sha = typeof request.query.sha === 'string' ? request.query.sha.trim() : '';
  const filePath = typeof request.query.path === 'string' ? request.query.path.trim() : '';
  if (!sha || !filePath) {
    response.status(400).send('sha 和 path 不能为空');
    return;
  }

  try {
    response.json(await getProjectGitCommitFilePreview(request.params.projectId, sha, filePath));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取历史文件预览失败');
  }
});

app.get('/api/projects/:projectId/git/status', async (request, response) => {
  try {
    response.json(await getProjectGitStatus(request.params.projectId));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取 Git 状态失败');
  }
});

app.get('/api/projects/:projectId/git/diff', async (request, response) => {
  const filePath = typeof request.query.path === 'string' ? request.query.path.trim() : '';
  if (!filePath) {
    response.status(400).send('path 不能为空');
    return;
  }

  try {
    response.json(await getProjectGitFileDiff(request.params.projectId, filePath));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取 Git 差异失败');
  }
});

app.get('/api/projects/:projectId/git/push-preview', async (request, response) => {
  try {
    response.json(await getProjectGitPushPreview(request.params.projectId));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取推送预览失败');
  }
});

app.post('/api/projects/:projectId/git/commit', async (request, response) => {
  const message = typeof request.body?.message === 'string' ? request.body.message : '';
  const files = Array.isArray(request.body?.files)
    ? request.body.files.filter((filePath: unknown): filePath is string => typeof filePath === 'string')
    : [];

  try {
    response.json(await commitProjectGitChanges(request.params.projectId, files, message));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : 'Git 提交失败');
  }
});

app.post('/api/projects/:projectId/git/push', async (request, response) => {
  const remote = typeof request.body?.remote === 'string' ? request.body.remote.trim() : undefined;
  const branch = typeof request.body?.branch === 'string' ? request.body.branch.trim() : undefined;

  try {
    response.json(await pushProjectGitBranch(request.params.projectId, remote, branch));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : 'Git 推送失败');
  }
});

app.post('/api/projects/:projectId/git/fetch', async (request, response) => {
  const remote = typeof request.body?.remote === 'string' ? request.body.remote.trim() : undefined;

  try {
    response.json(await fetchProjectGitRemote(request.params.projectId, remote));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : 'Git 获取远端失败');
  }
});

app.post('/api/projects/:projectId/git/pull', async (request, response) => {
  const remote = typeof request.body?.remote === 'string' ? request.body.remote.trim() : undefined;
  const branch = typeof request.body?.branch === 'string' ? request.body.branch.trim() : undefined;

  try {
    response.json(await pullProjectGitBranch(request.params.projectId, remote, branch));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : 'Git 拉取失败');
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

app.post('/api/projects/:projectId/git/branch', async (request, response) => {
  const branch = typeof request.body?.branch === 'string' ? request.body.branch.trim() : '';
  const source = typeof request.body?.source === 'string' ? request.body.source.trim() : undefined;
  if (!branch) {
    response.status(400).send('branch 不能为空');
    return;
  }

  try {
    response.json(await createProjectGitBranch(request.params.projectId, branch, source));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '创建分支失败');
  }
});

app.post('/api/projects/:projectId/git/undo-turn-changes', async (request, response) => {
  const changes = Array.isArray(request.body?.changes) ? request.body.changes : [];

  try {
    response.json(await undoProjectAiTurnChanges(request.params.projectId, changes));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '撤销文件改动失败');
  }
});

app.get('/api/projects/:projectId/git/worktrees', async (request, response) => {
  try {
    response.json(await listProjectGitWorktrees(request.params.projectId));
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '读取工作树失败');
  }
});

app.get('/api/projects/:projectId/git/worktrees/suggest-path', async (request, response) => {
  const branch = typeof request.query.branch === 'string' ? request.query.branch.trim() : '';
  try {
    response.json({
      path: await suggestProjectGitWorktreePath(request.params.projectId, branch),
    });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '生成工作树路径失败');
  }
});

app.post('/api/projects/:projectId/git/worktrees', async (request, response) => {
  const branch = typeof request.body?.branch === 'string' ? request.body.branch.trim() : '';
  const worktreePath = typeof request.body?.path === 'string' ? request.body.path.trim() : '';
  const base = typeof request.body?.base === 'string' ? request.body.base.trim() : undefined;
  const addProject = request.body?.addProject !== false;

  if (!branch) {
    response.status(400).send('branch 不能为空');
    return;
  }
  if (!worktreePath) {
    response.status(400).send('path 不能为空');
    return;
  }

  try {
    const result = await createProjectGitWorktree(request.params.projectId, {
      branch,
      path: worktreePath,
      base,
    });
    const projectId = addProject ? createProject(result.path) : null;
    response.json({
      ok: true,
      ...result,
      projectId,
      workspace: addProject ? getWorkspaceBootstrap() : undefined,
    });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '创建工作树失败');
  }
});

app.delete('/api/projects/:projectId/git/worktrees', async (request, response) => {
  const worktreePath = typeof request.body?.path === 'string' ? request.body.path.trim() : '';
  if (!worktreePath) {
    response.status(400).send('path 不能为空');
    return;
  }

  try {
    await removeProjectGitWorktree(request.params.projectId, worktreePath);
    response.json({
      ok: true,
      workspace: getWorkspaceBootstrap(),
    });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '删除工作树失败');
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
  const permissionMode = normalizeClaudePermissionMode(request.body?.permissionMode);
  const model =
    typeof request.body?.model === 'string' && request.body.model.trim()
      ? request.body.model.trim()
      : undefined;
  const effort = normalizeClaudeEffort(request.body?.effort);
  let imageAttachments: ClaudeInputImageAttachment[] = [];
  try {
    imageAttachments = normalizeClaudeRunImageAttachments(request.body?.attachments);
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '图片附件无效');
    return;
  }
  let contentBlocks: InputContentBlock[] = [];
  try {
    contentBlocks = normalizeClaudeRunContentBlocks({
      prompt,
      imageAttachments,
      contentBlocks: request.body?.contentBlocks,
    });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '输入内容无效');
    return;
  }
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

  if (!toolResult && contentBlocks.length === 0) {
    response.status(400).send('发送内容不能为空');
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
    contentBlocks,
    workingDirectory: resolvedDirectory,
    sessionId,
    permissionMode,
    model,
    effort,
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
  const rawQuestions = Array.isArray(request.body?.questions)
    ? (request.body.questions as Record<string, unknown>[])
    : [];
  const questions = rawQuestions
    .filter((item) => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id.trim() : undefined,
      header: typeof item.header === 'string' ? item.header.trim() : undefined,
      question: typeof item.question === 'string' ? item.question.trim() : '',
      options: Array.isArray(item.options)
        ? item.options
            .filter((option) => Boolean(option && typeof option === 'object'))
            .map((option) => ({
              label:
                typeof (option as Record<string, unknown>).label === 'string'
                  ? ((option as Record<string, unknown>).label as string).trim()
                  : '',
              description:
                typeof (option as Record<string, unknown>).description === 'string'
                  ? ((option as Record<string, unknown>).description as string).trim()
                  : undefined,
            }))
            .filter((option) => option.label)
        : undefined,
      multiSelect: Boolean(item.multiSelect),
      required: Boolean(item.required),
      secret: Boolean(item.secret),
      isOther: Boolean(item.isOther),
      placeholder: typeof item.placeholder === 'string' ? item.placeholder.trim() : undefined,
    }))
    .filter((item) => item.question);
  const rawAnswers = request.body?.answers;
  const answers =
    rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers)
      ? Object.fromEntries(
          Object.entries(rawAnswers)
            .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''])
            .filter(([key, value]) => key.trim() && typeof value === 'string' && value),
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

  if (questions.length === 0) {
    response.status(400).json({ submitted: false, error: '缺少提问问题定义。' });
    return;
  }

  const result = submitRunRequestUserInput(request.params.runId, requestId, questions, answers);
  if (!result.submitted) {
    response.status(409).json(result);
    return;
  }

  response.json(result);
});

app.post('/api/claude/run/:runId/guide', (request, response) => {
  const prompt = typeof request.body?.prompt === 'string' ? request.body.prompt.trim() : '';
  let guideImageAttachments: ClaudeInputImageAttachment[] = [];
  try {
    guideImageAttachments = normalizeClaudeRunImageAttachments(request.body?.attachments);
  } catch (error) {
    response.status(400).json({
      submitted: false,
      error: error instanceof Error ? error.message : '图片附件无效',
    });
    return;
  }

  const guideContentBlocks = normalizeClaudeRunContentBlocks({
    prompt,
    imageAttachments: guideImageAttachments,
    contentBlocks: request.body?.contentBlocks,
  });

  const result = submitRunGuidePrompt(request.params.runId, prompt, guideImageAttachments, guideContentBlocks);
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

app.get('/api/claude/runtimes', (_request, response) => {
  response.json(getThreadRuntimeStatuses());
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

function createLocalCorsHandler(): RequestHandler {
  return (request, response, next) => {
    const origin = request.get('origin');
    if (origin && isAllowedLocalOrigin(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }

    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.sendStatus(204);
      return;
    }

    next();
  };
}

function isAllowedLocalOrigin(origin: string) {
  if (origin === 'http://tauri.localhost' || origin === 'https://tauri.localhost') {
    return true;
  }

  try {
    const url = new URL(origin);
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

function resolveProjectPathValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? path.resolve(value.trim()) : '';
}

function readRepeatedQueryValues(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function resolveUsageRangeDays(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === 'all') {
    return null;
  }
  if (trimmed === '7' || trimmed === '30' || trimmed === '90') {
    return Number(trimmed) as 7 | 30 | 90;
  }
  return 'invalid' as const;
}

function isPayloadTooLargeError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown; type?: unknown };
  return candidate.status === 413 || candidate.statusCode === 413 || candidate.type === 'entity.too.large';
}

function normalizeClaudePermissionMode(value: unknown): ClaudePermissionMode {
  const configuredDefault = getAppSettings().general.defaultPermissionMode;
  if (typeof value !== 'string' || !value.trim()) {
    return configuredDefault;
  }

  const trimmed = value.trim();
  return isClaudePermissionMode(trimmed) ? trimmed : configuredDefault;
}

function isClaudePermissionMode(value: string): value is ClaudePermissionMode {
  return value === 'default' ||
    value === 'plan' ||
    value === 'acceptEdits' ||
    value === 'auto' ||
    value === 'dontAsk' ||
    value === 'bypassPermissions';
}

function normalizeClaudeEffort(value: unknown): ClaudeEffortLevel | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  return isClaudeEffortLevel(trimmed) ? trimmed : undefined;
}

function isClaudeEffortLevel(value: string): value is ClaudeEffortLevel {
  return value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max';
}

function normalizeClaudeRunImageAttachments(value: unknown): ClaudeInputImageAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeClaudeRunImageAttachment(item))
    .filter((item): item is ClaudeInputImageAttachment => Boolean(item));
}

function normalizeClaudeRunImageAttachment(value: unknown): ClaudeInputImageAttachment | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const item = value as Record<string, unknown>;
  const data = typeof item.data === 'string' ? item.data.trim() : '';
  const mimeType =
    typeof item.mimeType === 'string' && item.mimeType.trim()
      ? item.mimeType.trim()
      : typeof item.mime_type === 'string' && item.mime_type.trim()
        ? item.mime_type.trim()
        : '';
  if (!data || !mimeType) {
    return null;
  }

  extensionFromImageMimeType(mimeType);
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) {
    throw new Error('图片附件不是有效的 base64 内容。');
  }

  const buffer = Buffer.from(data, 'base64');
  if (buffer.length === 0) {
    throw new Error('图片内容为空。');
  }
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error('图片过大，请控制在 10MB 以内。');
  }

  return {
    mimeType,
    data,
  };
}

function normalizeClaudeRunContentBlocks(options: {
  prompt?: string;
  imageAttachments?: ClaudeInputImageAttachment[];
  contentBlocks?: unknown;
}) {
  return normalizeInputContentBlocks({
    prompt: options.prompt,
    imageAttachments: buildLegacyImageAttachmentsForContentBlocks(options.imageAttachments),
    contentBlocks: normalizeProvidedClaudeRunContentBlocks(options.contentBlocks),
  });
}

function buildLegacyImageAttachmentsForContentBlocks(
  imageAttachments: ClaudeInputImageAttachment[] | undefined,
) {
  return (imageAttachments ?? []).map((attachment, index) => ({
    id: `request-image-${index}`,
    path: '',
    name: '',
    mimeType: attachment.mimeType,
    data: attachment.data,
  }));
}

function normalizeProvidedClaudeRunContentBlocks(value: unknown): InputContentBlock[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item) => normalizeProvidedClaudeRunContentBlock(item))
    .filter((item): item is InputContentBlock => Boolean(item));
}

function normalizeProvidedClaudeRunContentBlock(value: unknown): InputContentBlock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const item = value as Record<string, unknown>;
  const type = normalizeOptionalString(item.type);
  if (!type) {
    return null;
  }

  if (type === 'text') {
    const text = typeof item.text === 'string' ? item.text : '';
    return text.trim()
      ? {
          type: 'text',
          text,
        }
      : null;
  }

  if (type === 'image') {
    const pathValue = normalizeOptionalString(item.path);
    const dataValue = normalizeOptionalString(item.data);
    const mimeTypeValue = normalizeOptionalString(item.mimeType);
    if ((!pathValue && !dataValue) || (!pathValue && dataValue && !mimeTypeValue)) {
      return null;
    }

    return {
      type: 'image',
      ...(normalizeOptionalString(item.id) ? { id: normalizeOptionalString(item.id) } : {}),
      ...(pathValue ? { path: pathValue } : {}),
      ...(normalizeOptionalString(item.name) ? { name: normalizeOptionalString(item.name) } : {}),
      ...(mimeTypeValue ? { mimeType: mimeTypeValue } : {}),
      ...(normalizeNonNegativeNumber(item.size) !== undefined ? { size: normalizeNonNegativeNumber(item.size) } : {}),
      ...(dataValue ? { data: dataValue } : {}),
    };
  }

  if (type === 'file_text') {
    const pathValue = normalizeOptionalString(item.path);
    const nameValue = normalizeOptionalString(item.name);
    const text = typeof item.text === 'string' ? item.text : '';
    if (!pathValue || !nameValue || text.length === 0) {
      return null;
    }

    return {
      type: 'file_text',
      ...(normalizeOptionalString(item.id) ? { id: normalizeOptionalString(item.id) } : {}),
      path: pathValue,
      name: nameValue,
      ...(normalizeOptionalString(item.mimeType) ? { mimeType: normalizeOptionalString(item.mimeType) } : {}),
      ...(normalizeNonNegativeNumber(item.size) !== undefined ? { size: normalizeNonNegativeNumber(item.size) } : {}),
      ...(normalizeNonNegativeNumber(item.textBytes) !== undefined
        ? { textBytes: normalizeNonNegativeNumber(item.textBytes) }
        : {}),
      text,
    };
  }

  if (type === 'file_reference') {
    const pathValue = normalizeOptionalString(item.path);
    const nameValue = normalizeOptionalString(item.name);
    if (!pathValue || !nameValue) {
      return null;
    }

    return {
      type: 'file_reference',
      ...(normalizeOptionalString(item.id) ? { id: normalizeOptionalString(item.id) } : {}),
      path: pathValue,
      name: nameValue,
      ...(normalizeOptionalString(item.mimeType) ? { mimeType: normalizeOptionalString(item.mimeType) } : {}),
      ...(normalizeNonNegativeNumber(item.size) !== undefined ? { size: normalizeNonNegativeNumber(item.size) } : {}),
      ...(normalizeInputReferenceReason(item.reason) ? { reason: normalizeInputReferenceReason(item.reason) } : {}),
    };
  }

  if (type === 'attachment_metadata') {
    const nameValue = normalizeOptionalString(item.name);
    const reasonValue = normalizeOptionalString(item.reason);
    if (!nameValue || !reasonValue) {
      return null;
    }

    return {
      type: 'attachment_metadata',
      ...(normalizeOptionalString(item.id) ? { id: normalizeOptionalString(item.id) } : {}),
      name: nameValue,
      ...(normalizeOptionalString(item.mimeType) ? { mimeType: normalizeOptionalString(item.mimeType) } : {}),
      ...(normalizeNonNegativeNumber(item.size) !== undefined ? { size: normalizeNonNegativeNumber(item.size) } : {}),
      reason: reasonValue,
    };
  }

  return null;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeInputReferenceReason(value: unknown): InputReferenceReason | undefined {
  return value === 'too_large' || value === 'binary' || value === 'unsupported' || value === 'provider_unsupported'
    ? value
    : undefined;
}

function parseImageDataUrl(dataUrl: string, requestedMimeType: string) {
  const matched = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!matched) {
    throw new Error('仅支持粘贴常见图片格式。');
  }

  const mimeType = requestedMimeType || matched[1];
  const extension = extensionFromImageMimeType(mimeType);
  const buffer = Buffer.from(matched[2], 'base64');
  if (buffer.length === 0) {
    throw new Error('图片内容为空。');
  }
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error('图片过大，请控制在 10MB 以内。');
  }

  return {
    mimeType,
    extension,
    buffer,
  };
}

function extensionFromImageMimeType(mimeType: string) {
  if (mimeType === 'image/png') {
    return 'png';
  }
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  if (mimeType === 'image/gif') {
    return 'gif';
  }

  throw new Error(`暂不支持的图片格式：${mimeType}`);
}

function buildAttachmentFileName(extension: string) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `pasted-${timestamp}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
}

async function searchWorkspaceFiles(root: string, query: string) {
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  const skipDirectories = new Set(['.git', 'node_modules', 'target', 'dist', '.next', '.venv', 'venv', '.codem-attachments']);
  const results: Array<{ path: string; rel: string; isDirectory: boolean; }> = [];
  const stack: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];

  while (stack.length > 0 && results.length < MAX_WORKSPACE_FILE_SEARCH_CANDIDATES) {
    const current = stack.pop()!;
    if (current.depth >= 4) {
      continue;
    }

    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= MAX_WORKSPACE_FILE_SEARCH_CANDIDATES) {
        break;
      }
      const absolutePath = path.join(current.directory, entry.name);
      if (entry.isDirectory()) {
        if (skipDirectories.has(entry.name)) {
          continue;
        }
      }
      const rel = path.relative(root, absolutePath).replace(/\\/g, '/');
      if (!normalizedQuery || rel.toLowerCase().includes(normalizedQuery)) {
        results.push({ path: absolutePath, rel, isDirectory: entry.isDirectory(), });
      }
      if (entry.isDirectory()) {
        stack.push({ directory: absolutePath, depth: current.depth + 1 });
        continue;
      }
    }
  }

  return results
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel))
    .slice(0, MAX_WORKSPACE_FILE_SEARCH_RESULTS);
}

function isSupportedImageFilePath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    extension === '.png' ||
    extension === '.jpg' ||
    extension === '.jpeg' ||
    extension === '.webp' ||
    extension === '.gif' ||
    extension === '.svg' ||
    extension === '.ico' ||
    extension === '.bmp' ||
    extension === '.avif'
  );
}
