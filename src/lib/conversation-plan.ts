import type {
  ConversationPlanSnapshot,
  ConversationPlanStepStatus,
  ThreadDetail,
} from '../types';

export type ConversationPlanPreview = {
  todos: ConversationPlanSnapshot['steps'];
  counts: Record<ConversationPlanStepStatus, number>;
};

export function getLatestConversationPlanPreview(
  activeThread: ThreadDetail | null,
): ConversationPlanPreview | null {
  if (!activeThread) {
    return null;
  }

  for (let index = activeThread.turns.length - 1; index >= 0; index -= 1) {
    const turn = activeThread.turns[index];
    if (turn.status !== 'pending' && turn.status !== 'running') {
      continue;
    }
    if (!turn.plan) {
      continue;
    }

    const preview = createConversationPlanPreview(turn.plan);
    return preview && hasOpenConversationPlanItems(preview) ? preview : null;
  }

  return null;
}

export function formatConversationPlanSummary(preview: ConversationPlanPreview) {
  return `共 ${preview.todos.length} 个任务，已经完成 ${preview.counts.completed} 个`;
}

function createConversationPlanPreview(
  plan: ConversationPlanSnapshot,
): ConversationPlanPreview | null {
  if (!plan.steps.length) {
    return null;
  }
  const counts: Record<ConversationPlanStepStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    unknown: 0,
  };
  for (const step of plan.steps) {
    counts[step.status] += 1;
  }
  return { todos: plan.steps, counts };
}

function hasOpenConversationPlanItems(preview: ConversationPlanPreview) {
  return preview.counts.pending > 0 || preview.counts.in_progress > 0 || preview.counts.unknown > 0;
}
