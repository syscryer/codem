import anthropicIcon from '../assets/provider-icons/anthropic.svg?raw';
import baiduIcon from '../assets/provider-icons/baidu.svg?raw';
import bailianIcon from '../assets/provider-icons/bailian.svg?raw';
import deepseekIcon from '../assets/provider-icons/deepseek.svg?raw';
import geminiIcon from '../assets/provider-icons/gemini.svg?raw';
import kimiIcon from '../assets/provider-icons/kimi.svg?raw';
import minimaxIcon from '../assets/provider-icons/minimax.svg?raw';
import mistralIcon from '../assets/provider-icons/mistral.svg?raw';
import modelscopeIcon from '../assets/provider-icons/modelscope.svg?raw';
import nvidiaIcon from '../assets/provider-icons/nvidia.svg?raw';
import openaiIcon from '../assets/provider-icons/openai.svg?raw';
import openrouterIcon from '../assets/provider-icons/openrouter.svg?raw';
import siliconflowIcon from '../assets/provider-icons/siliconflow.svg?raw';
import stepfunIcon from '../assets/provider-icons/stepfun.svg?raw';
import volcengineIcon from '../assets/provider-icons/volcengine.svg?raw';
import xaiIcon from '../assets/provider-icons/xai.svg?raw';
import xiaomimimoIcon from '../assets/provider-icons/xiaomimimo.svg?raw';
import zhipuIcon from '../assets/provider-icons/zhipu.svg?raw';

type ProviderBrandIconProps = {
  icon?: string;
  name: string;
  size?: number;
};

const providerIconUrls: Record<string, string> = {
  anthropic: anthropicIcon,
  baidu: baiduIcon,
  bailian: bailianIcon,
  deepseek: deepseekIcon,
  gemini: geminiIcon,
  kimi: kimiIcon,
  minimax: minimaxIcon,
  mistral: mistralIcon,
  modelscope: modelscopeIcon,
  nvidia: nvidiaIcon,
  openai: openaiIcon,
  openrouter: openrouterIcon,
  qwen: bailianIcon,
  siliconflow: siliconflowIcon,
  stepfun: stepfunIcon,
  volcengine: volcengineIcon,
  xai: xaiIcon,
  xiaomimimo: xiaomimimoIcon,
  zhipu: zhipuIcon,
};

export function ProviderBrandIcon({ icon, name, size = 28 }: ProviderBrandIconProps) {
  const iconSvg = icon ? providerIconUrls[normalizeProviderIcon(icon)] : undefined;
  const initials = name.trim().slice(0, 2).toLocaleUpperCase() || 'AI';

  return (
    <span
      className={`provider-brand-icon${iconSvg ? '' : ' fallback'}`}
      style={{ width: size, height: size }}
      title={name}
      aria-hidden="true"
    >
      {iconSvg ? <span className="provider-brand-icon-svg" dangerouslySetInnerHTML={{ __html: iconSvg }} /> : <span>{initials}</span>}
    </span>
  );
}

function normalizeProviderIcon(icon: string) {
  const value = icon.toLocaleLowerCase();
  if (value.includes('minimax')) return 'minimax';
  if (value.includes('kimi')) return 'kimi';
  if (value.includes('zhipu') || value.includes('glm')) return 'zhipu';
  if (value.includes('qwen') || value.includes('bailian')) return 'qwen';
  if (value.includes('volcengine') || value.includes('doubao') || value.includes('huoshan')) return 'volcengine';
  if (value.includes('siliconflow')) return 'siliconflow';
  if (value.includes('xiaomi') || value.includes('mimo')) return 'xiaomimimo';
  if (value.includes('stepfun')) return 'stepfun';
  if (value.includes('modelscope')) return 'modelscope';
  if (value.includes('baidu') || value.includes('qianfan')) return 'baidu';
  if (value.includes('nvidia')) return 'nvidia';
  if (value.includes('mistral')) return 'mistral';
  if (value === 'xai' || value.includes('grok')) return 'xai';
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('gemini') || value.includes('google')) return 'gemini';
  if (value.includes('anthropic') || value.includes('claude')) return 'anthropic';
  if (value.includes('openrouter')) return 'openrouter';
  if (value.includes('openai')) return 'openai';
  return value;
}
