import { resolveWorkbenchPreviewFilePath } from './workbench-preview';

export type ConversationOutputFileMenuEvent = {
  stopPropagation?: () => void;
};

export function resolveConversationOutputFileActionPath(workspace: string, filePath: string) {
  return workspace ? resolveWorkbenchPreviewFilePath(workspace, filePath) : filePath;
}

export function runConversationOutputFileMenuAction(
  event: ConversationOutputFileMenuEvent,
  action: () => void,
) {
  event.stopPropagation?.();
  action();
}
