# Appearance Preview Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the appearance settings preview card so its message/code samples reflect the selected font settings and use a cleaner neutral preview style.

**Architecture:** Keep the change local to the appearance settings preview. Simplify the preview JSX from a two-pane diff into a single code card, then update the CSS to consume existing app font variables and lighter neutral surfaces.

**Tech Stack:** React 19, TypeScript, CSS

---

### Task 1: Simplify the preview card markup

**Files:**
- Modify: `src/components/settings/AppearanceSettings.tsx`
- Modify: `src/styles.css`

- [ ] Replace the two diff panes with one neutral code snippet card.
- [ ] Keep the existing preview shell, sidebar, heading, message pills, and footer.
- [ ] Use a short static snippet that reads well at multiple code font sizes.

### Task 2: Bind preview typography to appearance settings

**Files:**
- Modify: `src/styles.css`

- [ ] Make the message preview use `--app-chat-font-family` and `--app-chat-font-size`.
- [ ] Make the code preview use `--app-code-font-family` and `--app-code-font-size`.
- [ ] Keep line-height and spacing stable after size changes.

### Task 3: Refresh the neutral preview styling

**Files:**
- Modify: `src/styles.css`

- [ ] Lighten the message pill background.
- [ ] Convert code preview colors to gray-only surfaces, borders, and line numbers.
- [ ] Remove red/green diff semantics from the preview card.

### Task 4: Verify visually in desktop dev mode

**Files:**
- Verify: `src/components/settings/AppearanceSettings.tsx`
- Verify: `src/styles.css`

- [ ] Restart desktop dev mode after the CSS/preview changes.
- [ ] Open the appearance settings page.
- [ ] Confirm chat font/size changes affect only the preview messages.
- [ ] Confirm code font/size changes affect only the preview snippet.
