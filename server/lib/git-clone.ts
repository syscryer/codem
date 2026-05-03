import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';

type CloneRepositoryInput = {
  repoUrl: string;
  baseDirectory: string;
  folderName: string;
};

type CloneRepositoryResult = {
  projectPath: string;
};

const INVALID_FOLDER_NAME_PATTERN = /[<>:"/\\|?*\x00-\x1f]/;

export async function cloneRepository(input: CloneRepositoryInput): Promise<CloneRepositoryResult> {
  const repoUrl = input.repoUrl.trim();
  const baseDirectory = path.resolve(input.baseDirectory.trim());
  const folderName = normalizeFolderName(input.folderName);

  if (!repoUrl) {
    throw new Error('仓库地址不能为空');
  }

  if (!input.baseDirectory.trim()) {
    throw new Error('保存位置不能为空');
  }

  await ensureBaseDirectory(baseDirectory);

  const projectPath = path.join(baseDirectory, folderName);
  await assertPathDoesNotExist(projectPath);

  try {
    await runGitClone(repoUrl, projectPath, baseDirectory);
  } catch (error) {
    await cleanupFailedClone(projectPath);
    throw error;
  }
  return { projectPath };
}

function normalizeFolderName(value: string) {
  const folderName = value.trim();
  if (!folderName) {
    throw new Error('项目目录名不能为空');
  }
  if (folderName === '.' || folderName === '..') {
    throw new Error('项目目录名无效');
  }
  if (path.basename(folderName) !== folderName || INVALID_FOLDER_NAME_PATTERN.test(folderName)) {
    throw new Error('项目目录名包含无效字符');
  }

  return folderName;
}

async function ensureBaseDirectory(targetPath: string) {
  try {
    await mkdir(targetPath, { recursive: true });
    const stats = await stat(targetPath);
    if (!stats.isDirectory()) {
      throw new Error('保存位置不可用');
    }
  } catch {
    throw new Error(`保存位置不存在且无法创建：${targetPath}`);
  }
}

async function assertPathDoesNotExist(targetPath: string) {
  try {
    await stat(targetPath);
    throw new Error(`目标目录已存在：${targetPath}`);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return;
    }

    throw error instanceof Error ? error : new Error('目标目录状态检查失败');
  }
}

async function runGitClone(repoUrl: string, projectPath: string, baseDirectory: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['clone', repoUrl, projectPath], {
      cwd: baseDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('未检测到 Git，请先确认本机已安装并可在终端执行 git。'));
        return;
      }

      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const message = [stderr.trim(), stdout.trim()].filter(Boolean)[0] ?? 'git clone 执行失败';
      reject(new Error(message));
    });
  });
}

async function cleanupFailedClone(targetPath: string) {
  try {
    await rm(targetPath, { recursive: true, force: true });
  } catch {
    // Keep the original clone error as the primary signal.
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
