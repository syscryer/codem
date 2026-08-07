export type ComposerEnterKeyState = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  sendShortcut?: 'enter' | 'modEnter';
};

export function shouldSubmitComposerOnEnter(state: ComposerEnterKeyState) {
  const sendShortcut = state.sendShortcut ?? 'enter';
  return state.key === 'Enter'
    && !state.shiftKey
    && !state.altKey
    && !state.isComposing
    && (sendShortcut === 'modEnter' ? state.ctrlKey || state.metaKey : !state.ctrlKey && !state.metaKey);
}
