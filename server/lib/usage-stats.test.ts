import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { collectUsageStats } from './usage-stats.js';

test('collectUsageStats groups usage by provider and project without double-counting turns', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      custom_name INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      title TEXT NOT NULL,
      custom_title INTEGER NOT NULL DEFAULT 0,
      session_id TEXT,
      transcript_path TEXT,
      working_directory TEXT NOT NULL,
      model TEXT,
      permission_mode TEXT,
      imported INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      turn_sort INTEGER NOT NULL,
      item_sort INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT,
      activity TEXT,
      metrics TEXT,
      session_id TEXT,
      phase TEXT,
      started_at_ms INTEGER,
      duration_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_creation_input_tokens INTEGER,
      cache_read_input_tokens INTEGER,
      total_cost_usd REAL,
      pending_approval_requests_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE tool_calls (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      turn_sort INTEGER NOT NULL,
      item_sort INTEGER NOT NULL,
      tool_sort INTEGER NOT NULL,
      tool_id TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      tool_use_id TEXT,
      parent_tool_use_id TEXT,
      is_sidechain INTEGER NOT NULL DEFAULT 0,
      input_text TEXT,
      result_text TEXT,
      is_error INTEGER NOT NULL DEFAULT 0,
      subtools_json TEXT,
      sub_messages_json TEXT
    );
  `);

  db.prepare(`
    INSERT INTO projects (id, path, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('p1', 'D:\\project\\codem', 'codem', '2026-04-20T00:00:00.000Z', '2026-04-21T00:00:00.000Z');
  db.prepare(`
    INSERT INTO projects (id, path, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('p2', 'D:\\project\\other', 'other', '2026-04-20T00:00:00.000Z', '2026-04-22T00:00:00.000Z');
  db.prepare(`
    INSERT INTO threads (id, project_id, provider, title, working_directory, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('t1', 'p1', 'claude', 'A', 'D:\\project\\codem', 'sonnet', '2026-04-20T00:00:00.000Z', '2026-04-21T00:00:00.000Z');
  db.prepare(`
    INSERT INTO threads (id, project_id, provider, title, working_directory, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('t2', 'p2', 'codex', 'B', 'D:\\project\\other', 'gpt-5.1', '2026-04-20T00:00:00.000Z', '2026-04-22T00:00:00.000Z');

  const insertMessage = db.prepare(`
    INSERT INTO messages (
      id, thread_id, turn_id, turn_sort, item_sort, role, content,
      duration_ms, input_tokens, output_tokens, cache_creation_input_tokens,
      cache_read_input_tokens, total_cost_usd, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMessage.run('m1', 't1', 'turn-1', 0, 0, 'user', 'prompt', 1000, 10, 20, 2, 3, 0.01, '2026-04-21T00:00:00.000Z');
  insertMessage.run('m2', 't1', 'turn-1', 0, 1, 'assistant', 'answer', 1000, 10, 20, 2, 3, 0.01, '2026-04-21T00:00:01.000Z');
  insertMessage.run('m3', 't2', 'turn-2', 0, 0, 'user', 'prompt', 2000, 7, 8, 0, 0, 0.02, '2026-04-22T00:00:00.000Z');

  db.prepare(`
    INSERT INTO tool_calls (id, thread_id, turn_id, turn_sort, item_sort, tool_sort, tool_id, name, title, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('tool-1', 't1', 'turn-1', 0, 2, 0, 'tool-use-1', 'Read', 'Read file', 'done');

  const stats = collectUsageStats(db);

  assert.deepEqual(stats.totals, {
    projects: 2,
    threads: 2,
    messages: 3,
    toolCalls: 1,
    inputTokens: 17,
    outputTokens: 28,
    cacheCreationInputTokens: 2,
    cacheReadInputTokens: 3,
    totalTokens: 50,
    durationMs: 3000,
    totalCostUsd: 0.03,
  });
  assert.deepEqual(stats.byProvider.map((row) => [row.provider, row.model, row.totalTokens]), [
    ['claude', 'sonnet', 35],
    ['codex', 'gpt-5.1', 15],
  ]);
  assert.deepEqual(stats.byProject.map((row) => [row.projectId, row.projectName, row.totalTokens]), [
    ['p1', 'codem', 35],
    ['p2', 'other', 15],
  ]);

  db.close();
});
