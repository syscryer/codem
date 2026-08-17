import type { ConversationTurn } from '../../types';

export type PrototypeTaskStatus = 'running' | 'waiting' | 'done' | 'error';

export type PrototypeTask = {
  id: string;
  title: string;
  project: string;
  provider: string;
  status: PrototypeTaskStatus;
  statusLabel: string;
  summary: string;
  updatedAt: string;
};

export const prototypeTasks: PrototypeTask[] = [
  {
    id: 'mobile-shell',
    title: '重做移动端任务与会话外壳',
    project: 'CodeM',
    provider: 'Claude Code',
    status: 'running',
    statusLabel: '正在运行',
    summary: '正在整理移动端导航和会话详情布局',
    updatedAt: '刚刚',
  },
  {
    id: 'release-review',
    title: '检查 v0.1.17 发布改动',
    project: 'CodeM',
    provider: 'Codex',
    status: 'waiting',
    statusLabel: '等待审批',
    summary: '需要确认是否允许执行构建命令',
    updatedAt: '8 分钟前',
  },
  {
    id: 'provider-import',
    title: '完善 Provider 配置导入',
    project: 'CodeM',
    provider: 'Claude Code',
    status: 'done',
    statusLabel: '已完成',
    summary: '配置导入和模型同步已经完成',
    updatedAt: '今天 16:42',
  },
  {
    id: 'mobile-access',
    title: '验证手机局域网访问',
    project: 'CodeM',
    provider: 'Claude Code',
    status: 'error',
    statusLabel: '运行失败',
    summary: '设备连接中断，需要重新检查电脑端状态',
    updatedAt: '昨天',
  },
];

export const prototypeConversationTurns: ConversationTurn[] = [
  {
    id: 'prototype-turn-1',
    userText: '当前这个 mobile 版本整体不太行，聊天样式尽量和 CodeM 电脑版一致，只改移动端外壳。',
    workspace: 'D:\\ai_proj\\codem',
    assistantText: '',
    tools: [],
    items: [
      {
        id: 'prototype-turn-1-thinking',
        type: 'thinking',
        text: '需要把移动端的聊天内容层和导航外壳分开。聊天层继续使用桌面端的消息、Thinking 和工具摘要，移动端只负责安全区、顶部导航和底部 Composer。',
      },
      {
        id: 'prototype-turn-1-text',
        type: 'text',
        text: '可以。这版原型会保留 CodeM 现有的对话排版：用户消息仍是克制的浅色气泡，Agent 回复保持无气泡的正文布局，Thinking 和工具调用继续使用桌面端组件。\n\n移动端只调整以下内容：\n\n- 顶部返回和任务状态\n- 单栏内容宽度与安全区\n- 底部输入区和触控尺寸\n- 任务首页与底部导航',
      },
    ],
    status: 'done',
    providerId: 'claude-code',
    providerName: 'Claude Code',
    modelName: 'Claude Sonnet',
    startedAtMs: Date.now() - 210_000,
    durationMs: 42_000,
  },
  {
    id: 'prototype-turn-2',
    userText: '不要再搞大量玻璃化，正常苹果应用的风格就行。',
    workspace: 'D:\\ai_proj\\codem',
    assistantText: '',
    tools: [
      {
        id: 'prototype-read-tool',
        name: 'Read',
        title: '读取桌面聊天组件',
        status: 'done',
        inputText: 'src/components/ConversationTurn.tsx',
        resultText: '已确认桌面消息、Thinking、工具摘要与审批卡片的现有渲染结构。',
      },
    ],
    items: [
      {
        id: 'prototype-read-tool-item',
        type: 'tool',
        tool: {
          id: 'prototype-read-tool',
          name: 'Read',
          title: '读取桌面聊天组件',
          status: 'done',
          inputText: 'src/components/ConversationTurn.tsx',
          resultText: '已确认桌面消息、Thinking、工具摘要与审批卡片的现有渲染结构。',
        },
      },
      {
        id: 'prototype-turn-2-text',
        type: 'text',
        text: '视觉改为常规 iOS 信息架构：系统灰背景、白色分组列表、细分隔线、轻阴影和清晰的蓝色操作色。不会再使用环境光、彩色渐变卡片或大面积毛玻璃。',
      },
    ],
    status: 'done',
    providerId: 'claude-code',
    providerName: 'Claude Code',
    modelName: 'Claude Sonnet',
    startedAtMs: Date.now() - 122_000,
    durationMs: 31_000,
  },
  {
    id: 'prototype-turn-3',
    userText: '可以使用 uiuxpromax 来参考设计。',
    workspace: 'D:\\ai_proj\\codem',
    assistantText: '',
    tools: [],
    items: [
      {
        id: 'prototype-turn-3-text',
        type: 'text',
        text: '正在按移动优先、44px 触控区域、清晰层级和深浅主题要求整理原型。确认这套方向后，再把真实任务流、SSE、审批和用户输入接回同一个外壳。',
      },
    ],
    status: 'running',
    phase: 'thinking',
    activity: '正在整理移动端原型',
    providerId: 'claude-code',
    providerName: 'Claude Code',
    modelName: 'Claude Sonnet',
    startedAtMs: Date.now() - 36_000,
  },
];
