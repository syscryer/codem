import { createHash } from 'node:crypto';
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

export type ClaudeProviderSnapshot = {
  fingerprint: string;
  defaultModel?: string;
  baseUrlHost?: string;
  source: 'claude-settings' | 'process-env' | 'mixed' | 'none';
  hasAuthToken: boolean;
  hasApiKey: boolean;
  updatedAtMs: number;
};

const providerFingerprintKeys = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
] as const;

export function getConfiguredModelOptions(): ClaudeModelOption[] {
  const settings = readConfiguredClaudeSettings();
  const env = settings.env ?? {};
  const mainModel = readEnvString(env, 'ANTHROPIC_MODEL');
  const sonnetModel = readEnvString(env, 'ANTHROPIC_DEFAULT_SONNET_MODEL');
  const opusModel = readEnvString(env, 'ANTHROPIC_DEFAULT_OPUS_MODEL');
  const haikuModel = readEnvString(env, 'ANTHROPIC_DEFAULT_HAIKU_MODEL');
  const context1mDisabled = readEnvBoolean(env, 'CLAUDE_CODE_DISABLE_1M_CONTEXT');
  // Claude Code exposes [1m] model aliases at the CLI layer. Anthropic-compatible
  // gateways can support them too, so only hide the switch when explicitly disabled.
  const canUseAnthropicContext1m = !context1mDisabled;

  const defaultOption: ClaudeModelOption = {
    id: '__default',
    label: mainModel || '默认',
    description: mainModel ? `使用当前 Claude Code 默认模型：${mainModel}` : '使用当前 Claude Code 默认模型，不传 --model',
    ...(mainModel ? { model: mainModel } : {}),
    kind: 'default',
  };

  const options: ClaudeModelOption[] = [
    defaultOption,
    {
      id: 'sonnet',
      label: 'Sonnet',
      description: buildSlotDescription('默认推荐模型', sonnetModel),
      model: sonnetModel || 'sonnet',
      kind: 'slot',
      ...(canUseAnthropicContext1m && canUseContext1mAlias(sonnetModel || 'sonnet')
        ? {
            supportsContext1m: true,
            context1mModel: withContext1mSuffix(sonnetModel || 'sonnet'),
          }
        : {}),
    },
    {
      id: 'opus',
      label: 'Opus',
      description: buildSlotDescription('更强，适合复杂任务', opusModel),
      model: opusModel || 'opus',
      kind: 'slot',
      ...(canUseAnthropicContext1m && canUseContext1mAlias(opusModel || 'opus')
        ? {
            supportsContext1m: true,
            context1mModel: withContext1mSuffix(opusModel || 'opus'),
          }
        : {}),
    },
  ];

  options.push({
    id: 'haiku',
    label: 'Haiku',
    description: buildSlotDescription('更快，适合简单回复', haikuModel),
    model: haikuModel || 'haiku',
    kind: 'slot',
  });

  return options;
}

export function getClaudeProviderSnapshot(): ClaudeProviderSnapshot {
  const settings = readConfiguredClaudeSettings();
  const env = settings.env ?? {};
  const baseUrl = readEnvString(env, 'ANTHROPIC_BASE_URL');
  const mainModel = readEnvString(env, 'ANTHROPIC_MODEL');
  const authToken = readEnvString(env, 'ANTHROPIC_AUTH_TOKEN');
  const apiKey = readEnvString(env, 'ANTHROPIC_API_KEY');
  const fingerprintPayload = Object.fromEntries(
    providerFingerprintKeys.map((key) => {
      const value = readEnvString(env, key);
      if (key === 'ANTHROPIC_AUTH_TOKEN' || key === 'ANTHROPIC_API_KEY') {
        return [key, value ? hashSensitiveValue(value) : ''];
      }

      return [key, value ?? ''];
    }),
  );

  return {
    fingerprint: hashJson(fingerprintPayload),
    ...(mainModel ? { defaultModel: mainModel } : {}),
    ...(baseUrl ? { baseUrlHost: safeUrlHost(baseUrl) } : {}),
    source: resolveProviderSource(env),
    hasAuthToken: Boolean(authToken),
    hasApiKey: Boolean(apiKey),
    updatedAtMs: Date.now(),
  };
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

function resolveProviderSource(env: Record<string, unknown>): ClaudeProviderSnapshot['source'] {
  const hasSettingsValue = providerFingerprintKeys.some((key) => readOwnEnvString(env, key));
  const hasProcessValue = providerFingerprintKeys.some((key) => readProcessEnvString(key));

  if (hasSettingsValue && hasProcessValue) {
    return 'mixed';
  }

  if (hasSettingsValue) {
    return 'claude-settings';
  }

  if (hasProcessValue) {
    return 'process-env';
  }

  return 'none';
}

function readOwnEnvString(env: Record<string, unknown>, key: string) {
  const value = env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readProcessEnvString(key: string) {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeUrlHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function hashSensitiveValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function withContext1mSuffix(model: string) {
  const normalized = model.trim();
  if (/\[1m\]$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}[1m]`;
}

function isClaudeFamilyModel(model: string) {
  return /\b(claude|sonnet|opus|haiku)\b/i.test(model.trim());
}

function canUseContext1mAlias(model: string | undefined) {
  if (!model) {
    return false;
  }

  const normalized = model.trim();
  return isClaudeFamilyModel(normalized);
}

function buildSlotDescription(summary: string, configuredModel?: string) {
  return configuredModel ? `当前映射：${configuredModel} · ${summary}` : summary;
}
