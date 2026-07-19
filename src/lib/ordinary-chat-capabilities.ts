import type {
  AiChatModel,
  AiChatModelPreference,
  AiChatProvider,
  AiChatReasoningEffort,
} from '../types';

export const DEFAULT_AI_CHAT_MODEL_PREFERENCE: AiChatModelPreference = {
  thinkingEnabled: false,
  reasoningEffort: 'medium',
  webSearchEnabled: false,
};

const REASONING_EFFORTS: AiChatReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const MODEL_PREFERENCES_STORAGE_KEY = 'codem.ai-chat.model-preferences.v1';

export function loadAiChatModelPreferences() {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MODEL_PREFERENCES_STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.keys(parsed as Record<string, unknown>)
        .slice(0, 100)
        .map((modelId) => [
          modelId,
          aiChatModelPreference(parsed as Record<string, AiChatModelPreference>, modelId),
        ]),
    );
  } catch {
    return {};
  }
}

export function saveAiChatModelPreferences(preferences: Record<string, AiChatModelPreference>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MODEL_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be unavailable in hardened webviews; the active chat still persists to SQLite.
  }
}

export function aiChatModelPreference(
  preferences: Record<string, AiChatModelPreference> | undefined,
  modelId: string | undefined,
): AiChatModelPreference {
  if (!modelId) return DEFAULT_AI_CHAT_MODEL_PREFERENCE;
  const stored = preferences?.[modelId];
  const reasoningEffort = REASONING_EFFORTS.includes(stored?.reasoningEffort as AiChatReasoningEffort)
    ? stored!.reasoningEffort
    : DEFAULT_AI_CHAT_MODEL_PREFERENCE.reasoningEffort;
  return {
    thinkingEnabled: stored?.thinkingEnabled === true,
    reasoningEffort,
    webSearchEnabled: stored?.webSearchEnabled === true,
  };
}

export function updateAiChatModelPreference(
  preferences: Record<string, AiChatModelPreference> | undefined,
  modelId: string,
  patch: Partial<AiChatModelPreference>,
) {
  return {
    ...(preferences ?? {}),
    [modelId]: {
      ...aiChatModelPreference(preferences, modelId),
      ...patch,
    },
  };
}

export function ordinaryChatReasoningOptions(
  provider: AiChatProvider | null | undefined,
  model: AiChatModel | null | undefined,
): AiChatReasoningEffort[] {
  if (!provider || !model) return [];
  const explicit = explicitReasoningOptions(model.capabilities);
  if (explicit) return explicit;
  if (explicitBoolean(model.capabilities, ['reasoning', 'thinking']) === false) return [];

  const modelId = model.modelId.trim().toLowerCase();
  const supportsCommonReasoning = (() => {
    switch (provider.protocol) {
      case 'openai_responses':
        return /^(o1|o3|o4)(-|$)|^gpt-5|codex|reasoning/.test(modelId);
      case 'openai_chat':
        return /grok-(3-mini|4)|reasoning-effort|deepseek/.test(modelId);
      case 'anthropic_messages':
        return /claude-(3-7|sonnet-4|opus-4|haiku-4)|claude-4|minimax-m[23]|deepseek/.test(modelId);
      case 'gemini_generate_content':
        return /gemini-(2\.5|3)/.test(modelId);
      default:
        return false;
    }
  })();
  if (!supportsCommonReasoning && explicitBoolean(model.capabilities, ['reasoning', 'thinking']) !== true) {
    return [];
  }
  return ['low', 'medium', 'high'];
}

export function ordinaryChatSupportsWebSearch(
  provider: AiChatProvider | null | undefined,
  model: AiChatModel | null | undefined,
) {
  if (!provider || !model) return false;
  const explicit = explicitBoolean(model.capabilities, ['webSearch', 'nativeWebSearch']);
  if (explicit !== undefined) return explicit;

  const host = providerHost(provider.baseUrl);
  switch (provider.protocol) {
    case 'openai_responses':
      return host === 'api.openai.com';
    case 'openai_chat':
      return host === 'api.openai.com' && model.modelId.toLowerCase().includes('search-preview');
    case 'anthropic_messages':
      return host === 'api.anthropic.com' && model.modelId.toLowerCase().includes('claude');
    case 'gemini_generate_content':
      return host === 'generativelanguage.googleapis.com';
    default:
      return false;
  }
}

function explicitReasoningOptions(capabilities: Record<string, unknown>) {
  const raw = capabilities.supportedReasoningEfforts ?? capabilities.reasoningEfforts;
  if (!Array.isArray(raw)) return null;
  return REASONING_EFFORTS.filter((effort) => raw.includes(effort));
}

function explicitBoolean(capabilities: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof capabilities[key] === 'boolean') return capabilities[key] as boolean;
  }
  return undefined;
}

function providerHost(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}
