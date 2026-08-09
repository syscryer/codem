import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMcpManagementResponse } from './mcp.js';

test('MCP management preserves Gemini CLI provider identity', () => {
  const result = normalizeMcpManagementResponse({ providerId: 'gemini-cli' });

  assert.equal(result.providerId, 'gemini-cli');
});

test('MCP management falls back to Claude for an unknown provider', () => {
  const result = normalizeMcpManagementResponse({ providerId: 'unknown-provider' });

  assert.equal(result.providerId, 'claude-code');
});
