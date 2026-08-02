import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const headerSource = readFileSync(new URL('../components/ChatHeader.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../components/SidebarProjects.tsx', import.meta.url), 'utf8');

test('chat header exposes one capability-aware continue-in-new-chat action', () => {
  assert.match(headerSource, /MessageSquarePlus/);
  assert.match(headerSource, /onPrepareThreadFork\(activeThread\)/);
  assert.match(headerSource, />在新聊天中继续</);
  assert.match(headerSource, /disabled=\{!threadForkAvailability\.enabled\}/);
  assert.match(headerSource, /threadForkAvailability\.reason/);
});

test('sidebar prepares capability on menu open and uses the same action contract', () => {
  assert.match(sidebarSource, /onPrepareThreadFork\(thread\)/);
  assert.match(sidebarSource, /onForkThread\(thread\)/);
  assert.match(sidebarSource, />在新聊天中继续</);
  assert.match(sidebarSource, /disabled=\{!threadForkAvailability\.enabled\}/);
  assert.match(sidebarSource, /threadForkAvailability\.reason/);
});

test('App derives busy and pending states without provider fallbacks', () => {
  assert.match(appSource, /getThreadForkAvailability/);
  assert.match(appSource, /threadRuntimeStatuses\[thread\.id\]\?\.activeRun/);
  assert.match(appSource, /pendingApprovalRequests/);
  assert.match(appSource, /pendingUserInputRequests/);
  assert.doesNotMatch(
    appSource,
    /copy(?:Source)?Turns|fork(?:From)?Summary|createThread\([^)]*fork/is,
  );
});
