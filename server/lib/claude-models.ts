import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type ClaudeModelOption = {
  id: string;
  label: string;
  description?: string;
  model?: string;
  kind?: 'default' | 'slot' | 'custom';
  supportsContext1m?: boolean;
  context1mModel?: string;
  contextWindowTokens?: number;
};

export function getConfiguredModelOptions(): ClaudeModelOption[] {
  const settings = readConfiguredClaudeSettings();
  const env = settings.env ?? {};
  const mainModel = readEnvString(env, 'ANTHROPIC_MODEL');
  const sonnetModel = readEnvString(env, 'ANTHROPIC_DEFAULT_SONNET_MODEL');
  const opusModel = readEnvString(env, 'ANTHROPIC_DEFAULT_OPUS_MODEL');
  const haikuModel = readEnvString(env, 'ANTHROPIC_DEFAULT_HAIKU_MODEL');
  const baseUrl = readEnvString(env, 'ANTHROPIC_BASE_URL');
  const isThirdParty = Boolean(baseUrl && !/anthropic\.com/i.test(baseUrl));
  const context1mDisabled = readEnvBoolean(env, 'CLAUDE_CODE_DISABLE_1M_CONTEXT');
  const canUseAnthropicContext1m = !isThirdParty && !context1mDisabled;

  const options: ClaudeModelOption[] = [
    {
      id: '__default',
      label: '默认',
      description: mainModel ? `使用当前 Claude Code 默认模型：${mainModel}` : '使用当前 Claude Code 默认模型，不传 --model',
      kind: 'default',
    },
    {
      id: 'sonnet',
      label: sonnetModel || 'Sonnet',
      description: 'Sonnet · 默认推荐模型',
      model: sonnetModel || 'sonnet',
      kind: 'slot',
      ...(canUseAnthropicContext1m
        ? {
            supportsContext1m: true,
            context1mModel: withContext1mSuffix(sonnetModel || 'sonnet'),
          }
        : {}),
    },
    {
      id: 'opus',
      label: opusModel || 'Opus',
      description: 'Opus · 更强，适合复杂任务',
      model: opusModel || 'opus',
      kind: 'slot',
      ...(canUseAnthropicContext1m
        ? {
            supportsContext1m: true,
            context1mModel: withContext1mSuffix(opusModel || 'opus'),
          }
        : {}),
    },
    {
      id: 'opusplan',
      label: 'Opus Plan',
      description: 'Opus 规划，Sonnet 执行',
      model: 'opusplan',
      kind: 'slot',
    },
  ];

  options.push({
    id: 'haiku',
    label: haikuModel || 'Haiku',
    description: 'Haiku · 更快，适合简单回复',
    model: haikuModel || 'haiku',
    kind: 'slot',
  });

  return options;
}

function readConfiguredClaudeSettings(): { env?: Record<string, unknown> } {
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  if (!home) {
    return {};
  }

  try {
    const settingsPath = path.join(home, '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      env?: Record<string, unknown>;
    };
    return settings && typeof settings === 'object' ? settings : {};
  } catch {
    return {};
  }
}

function readEnvString(env: Record<string, unknown>, key: string) {
  const value = env[key] ?? process.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readEnvBoolean(env: Record<string, unknown>, key: string) {
  const value = readEnvString(env, key);
  if (!value) {
    return false;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function withContext1mSuffix(model: string) {
  const normalized = model.trim();
  if (/\[1m\]$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}[1m]`;
}
