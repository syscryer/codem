export type ComposerEnterKeyState = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
};

export function shouldSubmitComposerOnEnter(state: ComposerEnterKeyState) {
  return state.key === 'Enter'
    && !state.shiftKey
    && !state.ctrlKey
    && !state.metaKey
    && !state.altKey
    && !state.isComposing;
}
