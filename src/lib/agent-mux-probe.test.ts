import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentSettingsDiagnostics } from '../types.js';
import { resolveClaudeAgentMuxProbe } from './agent-mux-api.js';

const diagnostics = (
  success: boolean | null,
  overrides: Partial<AgentSettingsDiagnostics> = {},
): AgentSettingsDiagnostics => ({
  providerId: 'claude-code',
  installed: true,
  command: 'C:/Users/test/AppData/Roaming/npm/claude.cmd',
  version: '2.1.220',
  latestVersion: null,
  updateAvailable: false,
  versionCheckError: null,
  configDirectory: 'C:/Users/test/.claude',
  skillsDirectory: 'C:/Users/test/.claude/skills',
  updateCommand: 'npm install -g @anthropic-ai/claude-code@latest',
  installCommand: 'npm install -g @anthropic-ai/claude-code@latest',
  diagnosticCommand: 'claude doctor',
  diagnostic: { available: true, success },
  capabilities: { plugins: true, mcp: true, skills: true },
  ...overrides,
});

test('Claude Agent Mux probe accepts a successful doctor result', () => {
  assert.deepEqual(resolveClaudeAgentMuxProbe(diagnostics(true)), {
    available: true,
    message: 'Claude Code 2.1.220 已连接',
  });
});

test('Claude Agent Mux probe keeps explicit doctor failures offline', () => {
  assert.deepEqual(resolveClaudeAgentMuxProbe(diagnostics(false)), {
    available: false,
    message: 'Claude Code 诊断命令执行失败',
  });
});

test('Claude Agent Mux probe does not misclassify a legacy null result as failure', () => {
  assert.deepEqual(resolveClaudeAgentMuxProbe(diagnostics(null)), {
    available: true,
    message: 'Claude Code 2.1.220 已检测 · 当前 Runtime 未返回诊断结果',
  });
});

test('Claude Agent Mux probe rejects missing CLI diagnostics', () => {
  assert.deepEqual(resolveClaudeAgentMuxProbe(diagnostics(null, {
    installed: false,
    command: null,
    version: null,
    diagnostic: { available: false, success: null },
  })), {
    available: false,
    message: 'Claude Code 未安装或诊断命令不可用',
  });
});
