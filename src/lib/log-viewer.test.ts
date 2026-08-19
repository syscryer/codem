import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatLogSize, logLevelClassName, parseLogLevel } from './log-viewer';

describe('parseLogLevel', () => {
  it('识别标准日志行级别', () => {
    assert.equal(
      parseLogLevel('[2026-08-19 10:25:00.123] [WARN] [codem::agent_cli] 未找到 OpenCode CLI'),
      'warn',
    );
    assert.equal(parseLogLevel('[2026-08-19 10:25:00.123] [ERROR] [codem::http] HTTP GET /x -> 500'), 'error');
    assert.equal(parseLogLevel('[2026-08-19 10:25:00.123] [INFO] [codem::backend] 后端已监听'), 'info');
  });

  it('时间戳与普通方括号不误判', () => {
    assert.equal(parseLogLevel('[2026-08-19 10:25:00.123] 普通文本 [备注] 内容'), null);
    assert.equal(parseLogLevel('plain line'), null);
  });
});

describe('logLevelClassName', () => {
  it('按级别返回样式类', () => {
    assert.equal(logLevelClassName('[t] [ERROR] [x] boom'), 'log-line log-error');
    assert.equal(logLevelClassName('no level here'), 'log-line');
  });
});

describe('formatLogSize', () => {
  it('格式化文件大小', () => {
    assert.equal(formatLogSize(512), '512 B');
    assert.equal(formatLogSize(2048), '2.0 KB');
    assert.equal(formatLogSize(3 * 1024 * 1024), '3.0 MB');
  });
});
