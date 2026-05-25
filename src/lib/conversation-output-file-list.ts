import type { ConversationOutputFile } from './conversation-output-files';

const DEFAULT_VISIBLE_COUNT = 3;

export function buildConversationOutputFileListState(
  files: ConversationOutputFile[],
  expanded: boolean,
) {
  const showToggle = files.length > DEFAULT_VISIBLE_COUNT;
  const visibleFiles = expanded || !showToggle ? files : files.slice(0, DEFAULT_VISIBLE_COUNT);
  const hiddenCount = showToggle && !expanded ? files.length - DEFAULT_VISIBLE_COUNT : 0;

  return {
    visibleFiles,
    hiddenCount,
    showToggle,
    toggleLabel: showToggle ? (expanded ? '收起' : `显示另外 ${hiddenCount} 个`) : '',
  };
}
