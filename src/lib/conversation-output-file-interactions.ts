export type ConversationOutputFileMenuEvent = {
  stopPropagation?: () => void;
};

export function runConversationOutputFileMenuAction(
  event: ConversationOutputFileMenuEvent,
  action: () => void,
) {
  event.stopPropagation?.();
  action();
}
