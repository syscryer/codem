import { getWorkbenchPreviewKind } from './workbench-files';
import type {
  GitFileStatus,
  ProjectFileEntry,
  WorkbenchPreviewRequest,
  WorkbenchPreviewTab,
} from '../types';

export function buildProjectFilePreviewRequest(
  file: Pick<ProjectFileEntry, 'path' | 'name' | 'type'>,
): WorkbenchPreviewRequest {
  if (file.type !== 'file') {
    throw new Error('Only files can be previewed.');
  }

  return {
    key: buildWorkbenchPreviewKey(file.path, 'project-file'),
    path: file.path,
    name: file.name,
    kind: getWorkbenchPreviewKind(file.path),
    source: 'project-file',
  };
}

export function buildChangedFilePreviewRequest(
  file: Pick<GitFileStatus, 'path' | 'status'>,
): WorkbenchPreviewRequest {
  return {
    key: buildWorkbenchPreviewKey(file.path, 'changed-file'),
    path: file.path,
    name: getFileName(file.path),
    kind: getWorkbenchPreviewKind(file.path),
    source: 'changed-file',
    status: file.status,
  };
}

export function openWorkbenchPreviewTab(
  currentTabs: WorkbenchPreviewTab[],
  request: WorkbenchPreviewRequest,
) {
  const existing = currentTabs.find((tab) => tab.key === request.key);
  return {
    tabs: existing ? currentTabs : [...currentTabs, request],
    activeKey: request.key,
  };
}

export function normalizeWorkbenchPreviewRequest(
  request: WorkbenchPreviewRequest,
  projectPath: string,
): WorkbenchPreviewRequest {
  const normalizedProjectPath = normalizeWindowsPath(projectPath);
  const normalizedRequestPath = normalizeWindowsPath(request.path);

  if (
    normalizedProjectPath &&
    normalizedRequestPath &&
    normalizedRequestPath.toLowerCase().startsWith(`${normalizedProjectPath.toLowerCase()}/`)
  ) {
    const relativePath = normalizedRequestPath.slice(normalizedProjectPath.length + 1);
    return {
      ...request,
      key: buildWorkbenchPreviewKey(relativePath, request.source),
      path: relativePath,
      kind: getWorkbenchPreviewKind(relativePath),
    };
  }

  return request;
}

export function resolveWorkbenchPreviewFilePath(projectPath: string, previewPath: string) {
  if (isAbsoluteWorkbenchPath(previewPath)) {
    return previewPath;
  }

  const normalizedProjectPath = projectPath.replace(/[\\/]+$/, '');
  const normalizedRelativePath = previewPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalizedRelativePath) {
    return normalizedProjectPath;
  }

  return `${normalizedProjectPath}\\${normalizedRelativePath.replace(/\//g, '\\')}`;
}

export function closeWorkbenchPreviewTab(
  currentTabs: WorkbenchPreviewTab[],
  activeKey: string,
  closingKey: string,
) {
  const closingIndex = currentTabs.findIndex((tab) => tab.key === closingKey);
  const tabs = currentTabs.filter((tab) => tab.key !== closingKey);
  const nextActiveKey =
    activeKey === closingKey
      ? tabs[Math.max(0, closingIndex - 1)]?.key ?? tabs[0]?.key ?? ''
      : activeKey;

  return {
    tabs,
    activeKey: nextActiveKey,
  };
}

export function closeWorkbenchPreviewTabs(
  currentTabs: WorkbenchPreviewTab[],
  activeKey: string,
  closingKeys: string[],
) {
  if (closingKeys.length === 0) {
    return {
      tabs: currentTabs,
      activeKey,
    };
  }

  const closingSet = new Set(closingKeys);
  const tabs = currentTabs.filter((tab) => !closingSet.has(tab.key));

  if (!closingSet.has(activeKey)) {
    return {
      tabs,
      activeKey,
    };
  }

  const activeIndex = currentTabs.findIndex((tab) => tab.key === activeKey);

  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const candidate = currentTabs[index];
    if (!closingSet.has(candidate.key)) {
      return {
        tabs,
        activeKey: candidate.key,
      };
    }
  }

  for (let index = activeIndex + 1; index < currentTabs.length; index += 1) {
    const candidate = currentTabs[index];
    if (!closingSet.has(candidate.key)) {
      return {
        tabs,
        activeKey: candidate.key,
      };
    }
  }

  return {
    tabs,
    activeKey: '',
  };
}

function getFileName(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || normalizedPath;
}

function buildWorkbenchPreviewKey(path: string, source: WorkbenchPreviewRequest['source']) {
  return `${source === 'conversation-card' ? 'conversation' : 'file'}:${path}`;
}

function normalizeWindowsPath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isAbsoluteWorkbenchPath(filePath: string) {
  return /^[a-zA-Z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath) || filePath.startsWith('/');
}
