export type PluginErrorHint = {
  topic: string;
  message: string;
};

export type PluginErrorAnalysis = {
  summary: string;
  raw: string;
  hints: PluginErrorHint[];
};

type PluginErrorPattern = {
  keywords: RegExp;
  topic: string;
  message: string;
};

const pluginErrorPatterns: PluginErrorPattern[] = [
  {
    keywords: /could not read username|terminal prompts disabled|authentication failed/i,
    topic: 'Git 凭据',
    message: 'Git 在非交互模式下需要凭据。请配置 Git Credential Manager，或改用 SSH 地址。',
  },
  {
    keywords: /permission denied \(publickey\)|host key verification failed|ssh-agent/i,
    topic: 'SSH 公钥',
    message: 'SSH 鉴权失败。请确认私钥已加载，并用 ssh -T 检查仓库访问权限。',
  },
  {
    keywords: /403 forbidden|401 unauthorized|requires authentication/i,
    topic: 'HTTPS 鉴权',
    message: '私有仓库需要鉴权。请确认 gh auth login 或 Git 凭据配置可用。',
  },
  {
    keywords: /could not resolve host|network is unreachable|getaddrinfo|enotfound/i,
    topic: '网络',
    message: '无法解析目标地址。请检查 DNS、代理和网络连通性。',
  },
  {
    keywords: /timed out|operation timed out|etimedout|timeout/i,
    topic: '网络超时',
    message: '请求超时。请检查代理配置，或稍后重试。',
  },
  {
    keywords: /tls handshake|certificate|x509|self[- ]signed/i,
    topic: 'TLS 证书',
    message: 'TLS 证书校验失败。企业网络下可能需要配置受信任 CA。',
  },
  {
    keywords: /not found|repository not found|404/i,
    topic: '仓库不存在',
    message: '目标仓库或 Marketplace 标识不存在。请核对拼写、大小写和访问权限。',
  },
  {
    keywords: /eacces|eperm|permission denied|access is denied/i,
    topic: '文件权限',
    message: '目录写入被拒。请确认 .claude/plugins 和相关项目目录可写。',
  },
  {
    keywords: /enospc/i,
    topic: '磁盘空间',
    message: '磁盘空间不足。请清理空间后再重试。',
  },
  {
    keywords: /command not found|enoent.*claude|claude: not found|找不到/i,
    topic: 'Claude CLI',
    message: '未找到 Claude CLI。请确认 claude --version 在当前 PATH 下可用。',
  },
  {
    keywords: /git: not found|git command not found|enoent.*git/i,
    topic: 'Git',
    message: '未找到 Git。请安装 Git 并确认它在 PATH 中。',
  },
];

const fallbackHint: PluginErrorHint = {
  topic: '通用',
  message: '请检查 Marketplace 地址、网络代理、CLI 路径和目录权限后重试。',
};

export function analyzePluginError(action: string, error: unknown): PluginErrorAnalysis {
  const raw = errorMessage(error).trim();
  const hints: PluginErrorHint[] = [];
  const seenTopics = new Set<string>();

  for (const pattern of pluginErrorPatterns) {
    if (!pattern.keywords.test(raw) || seenTopics.has(pattern.topic)) {
      continue;
    }
    seenTopics.add(pattern.topic);
    hints.push({ topic: pattern.topic, message: pattern.message });
  }

  if (hints.length === 0) {
    hints.push(fallbackHint);
  }

  return {
    summary: hints.length === 1 && hints[0] === fallbackHint
      ? `${action}失败`
      : `${action}失败：${hints.map((hint) => hint.topic).join(' / ')}`,
    raw,
    hints,
  };
}

function errorMessage(error: unknown) {
  if (error == null) {
    return '';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return String(error);
  } catch {
    return '';
  }
}
