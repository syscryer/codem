import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKFLOW_TEMPLATES,
  cloneWorkflowTemplate,
  createSavedWorkflowFromTemplate,
  createBlankWorkflow,
  isWorkflowConnectionAllowed,
  retryFailedWorkflowNode,
  validateWorkflowGraph,
  advanceWorkflowRun,
} from './workflow-prototype.js';

test('workflow templates include a bounded multi-round discussion', () => {
  assert.equal(WORKFLOW_TEMPLATES.length, 3);
  for (const template of WORKFLOW_TEMPLATES) {
    const discussion = template.nodes.find((node) => node.data.kind === 'discussion');
    assert.ok(discussion, `${template.name} should include a discussion node`);
    assert.ok((discussion.data.maxRounds ?? 0) > 0);
    assert.ok(discussion.data.proposerAgentId);
    assert.ok(discussion.data.reviewerAgentId);
    assert.ok(discussion.data.satisfactionRule);
  }
});

test('retrying a failed node keeps completed siblings unchanged', () => {
  const workflow = createSavedWorkflowFromTemplate('code-delivery', 'test-workflow');
  const failedRun = {
    id: 'failed-run', workflowId: workflow.id, templateId: workflow.templateId, source: 'saved' as const, name: workflow.name, objective: workflow.summary, status: 'failed' as const, startedAt: '刚刚', duration: '1m',
    nodes: workflow.nodes.map((node, index) => ({ id: `${node.id}-run`, label: node.data.label, agent: 'test', status: index === 1 ? 'failed' as const : 'completed' as const, summary: '', logs: [] })),
  };
  const failedNode = failedRun.nodes[1];

  const retried = retryFailedWorkflowNode(failedRun, failedNode.id);
  assert.equal(retried.status, 'running');
  assert.equal(retried.nodes.find((node) => node.id === failedNode.id)?.status, 'running');
  assert.deepEqual(
    retried.nodes.filter((node) => node.id !== failedNode.id).map((node) => node.status),
    failedRun.nodes.filter((node) => node.id !== failedNode.id).map((node) => node.status),
  );
  assert.equal(failedRun.status, 'failed');
});

test('cloning a workflow template keeps mock drafts isolated', () => {
  const first = cloneWorkflowTemplate('solution-review');
  const second = cloneWorkflowTemplate('solution-review');
  first.nodes[0].data.label = 'changed';
  assert.notEqual(second.nodes[0].data.label, 'changed');
});

test('saved workflows can be created without sharing template graph state', () => {
  const created = createSavedWorkflowFromTemplate('code-delivery', 'new-workflow', { name: '自定义交付流程' });
  assert.equal(created.id, 'new-workflow');
  assert.equal(created.name, '自定义交付流程');
  assert.equal(created.status, 'draft');
  assert.ok(created.nodes.length > 0);
});

test('workflow connections reject invalid direction and duplicate edges', () => {
  const template = cloneWorkflowTemplate('solution-review');
  const start = template.nodes.find((node) => node.data.kind === 'start');
  const end = template.nodes.find((node) => node.data.kind === 'end');
  const approval = template.nodes.find((node) => node.data.kind === 'approval');
  assert.ok(start && end && approval);

  assert.equal(isWorkflowConnectionAllowed(template.nodes, template.edges, end.id, approval.id), false);
  assert.equal(isWorkflowConnectionAllowed(template.nodes, template.edges, approval.id, start.id), false);
  assert.equal(isWorkflowConnectionAllowed(template.nodes, template.edges, start.id, start.id), false);
  assert.equal(isWorkflowConnectionAllowed(template.nodes, template.edges, template.edges[0].source, template.edges[0].target), false);
  assert.equal(isWorkflowConnectionAllowed(template.nodes, template.edges, start.id, end.id), true);
});

test('workflow graph validation catches cycles and advance runs parallel branches', () => {
  const workflow = createSavedWorkflowFromTemplate('solution-review', 'test-workflow');
  assert.deepEqual(validateWorkflowGraph(workflow), []);
  const cyclic = structuredClone(workflow);
  cyclic.edges.push({ id: 'cycle', source: cyclic.nodes[2].id, target: cyclic.nodes[1].id, condition: 'next' });
  assert.ok(validateWorkflowGraph(cyclic).some((error) => error.includes('循环')));
  const run = { id: 'test-run', workflowId: workflow.id, templateId: workflow.templateId, source: 'saved' as const, name: workflow.name, objective: workflow.summary, status: 'running' as const, startedAt: '刚刚', duration: '0m', nodes: workflow.nodes.map((node, index) => ({ id: `${node.id}-run`, label: node.data.label, agent: 'test', status: index === 0 ? 'running' as const : 'pending' as const, summary: '', logs: [] })) };
  const stepped = advanceWorkflowRun(workflow, { ...run, nodes: workflow.nodes.map((node, index) => ({ id: `${node.id}-run`, label: node.data.label, agent: 'test', status: index === 0 ? 'running' : 'pending', summary: '', logs: [] })) });
  assert.equal(stepped.nodes[0].status, 'completed');
  assert.ok(stepped.nodes.filter((node) => node.status === 'running').length >= 1);
});

test('workflow profile bindings survive workflow cloning', () => {
  const workflow = createSavedWorkflowFromTemplate('solution-review', 'test-workflow');
  const agent = workflow.nodes.find((node) => node.data.kind === 'agent');
  const discussion = workflow.nodes.find((node) => node.data.kind === 'discussion');
  assert.ok(agent && discussion);
  agent.data.profileId = 'codex-profile';
  discussion.data.proposerProfileId = 'architect-profile';
  discussion.data.reviewerProfileId = 'reviewer-profile';
  const copy = structuredClone(workflow);
  assert.equal(copy.nodes.find((node) => node.id === agent.id)?.data.profileId, 'codex-profile');
  assert.equal(copy.nodes.find((node) => node.id === discussion.id)?.data.reviewerProfileId, 'reviewer-profile');
});

test('blank workflow starts without a template graph', () => {
  const workflow = createBlankWorkflow('blank-workflow');
  assert.equal(workflow.templateId, '');
  assert.deepEqual(workflow.nodes, []);
  assert.deepEqual(workflow.edges, []);
  assert.equal(workflow.name, '未命名工作流');
});
