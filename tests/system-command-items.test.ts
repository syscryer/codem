import assert from 'node:assert/strict';
import test from 'node:test';

import { createSystemCommandItem, settleSystemCommandItem } from '../src/lib/system-command-items';

test('createSystemCommandItem starts in running state with the submitted command text', () => {
  const item = createSystemCommandItem('/status', 'Status', 'status');

  assert.equal(item.type, 'system-command');
  assert.equal(item.command, '/status');
  assert.equal(item.title, 'Status');
  assert.equal(item.cardType, 'status');
  assert.equal(item.state, 'running');
});

test('settleSystemCommandItem stores summary and details', () => {
  const item = createSystemCommandItem('/status', 'Status', 'status');
  const settled = settleSystemCommandItem(item, {
    state: 'done',
    summary: '项目: codem',
    details: { project: 'codem' },
  });

  assert.equal(settled.state, 'done');
  assert.equal(settled.summary, '项目: codem');
  assert.deepEqual(settled.details, { project: 'codem' });
});
