import type { PanelState, PermissionMode } from './types';

export const DEFAULT_MODEL_VALUE = '__default';

export const permissionModes = [
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
] as const satisfies readonly PermissionMode[];

export const permissionMenuModes = [
  'default',
  'auto',
  'bypassPermissions',
] as const satisfies readonly PermissionMode[];

export const EMPTY_PANEL_STATE: PanelState = {
  organizeBy: 'project',
  sortBy: 'updated',
  visibility: 'all',
};
