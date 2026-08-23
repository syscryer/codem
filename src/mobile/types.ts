import type { AgentModelOption, ConversationTurn } from '../types';

export type MobilePermission = 'view' | 'send' | 'stop' | 'approve';
export type MobileTaskPhase = 'idle' | 'starting' | 'running' | 'waiting' | 'stopped' | 'done' | 'error';

export interface MobilePendingAction {
  id: string;
  type: 'approval' | 'user-input';
  title: string;
  description?: string;
}

export interface MobileTask {
  threadId: string;
  projectId: string;
  projectName: string;
  title: string;
  providerId: string;
  providerLabel: string;
  phase: MobileTaskPhase;
  activeRunId?: string;
  latestActivity?: string;
  updatedAt: string;
  durationMs?: number;
  model?: string;
  reasoningEffort?: string;
  permissionMode?: string;
  channelId?: string;
  pendingActions: MobilePendingAction[];
}

export interface MobileProject {
  id: string;
  name: string;
  pathLabel: string;
  branch?: string;
  dirty?: boolean;
  runningTaskCount: number;
  recentTasks: MobileTask[];
}

export interface MobileProvider {
  id: string;
  displayName: string;
  available: boolean | null;
  selectable: boolean;
  capabilities?: Record<string, unknown>;
}

export interface MobileChannelModel {
  id: string;
  modelId: string;
  displayName: string;
  isDefault: boolean;
  capabilities?: Record<string, unknown>;
}

export interface MobileChannel {
  id: string;
  providerId: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  apiKeySaved: boolean;
  models: MobileChannelModel[];
}

export interface MobileSystemChannel {
  id: 'system';
  providerId: string;
  name: string;
  configured: boolean;
  model?: string;
  detail?: string;
}

export interface MobileChannelBootstrap {
  channels: MobileChannel[];
  systemChannels: MobileSystemChannel[];
  defaultChannelIds: Record<string, string>;
}

export interface MobileModelCatalog {
  providerId: string;
  defaultModelId?: string;
  models: AgentModelOption[];
}

export interface MobileThreadPage {
  task: MobileTask;
  turns: ConversationTurn[];
  hasMore: boolean;
  nextCursor?: string;
  liveRunId?: string;
  liveEventCursor: number;
}

export interface MobileTaskDefaults {
  permissionMode?: string;
  modelId?: string;
  providerId?: string;
}

export interface MobileBootstrap {
  computerName: string;
  connected: boolean;
  permissions: MobilePermission[];
  tasks: MobileTask[];
  projects: MobileProject[];
  providers: MobileProvider[];
  channels: MobileChannelBootstrap;
  defaults?: MobileTaskDefaults;
  unreadNotifications: number;
  eventCursor?: string;
}

export interface MobileAuthStatus {
  enabled: boolean;
  authenticated: boolean;
  computerName?: string;
  address?: string;
  passwordConfigured?: boolean;
  username?: string;
}
