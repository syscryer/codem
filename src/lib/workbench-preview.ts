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
    key: `file:${file.path}`,
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
    key: `file:${file.path}`,
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

function getFileName(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || normalizedPath;
}
