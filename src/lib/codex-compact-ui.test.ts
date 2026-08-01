import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const composerSource = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8');
const indicatorSource = readFileSync(
  new URL('../components/ComposerContextIndicator.tsx', import.meta.url),
  'utf8',
);
const paneSource = readFileSync(new URL('../components/ConversationPane.tsx', import.meta.url), 'utf8');
const turnSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('Codex compact slash command uses the native coordinator while Claude keeps its submission', () => {
  assert.match(
    appSource,
    /activeProviderId === OPENAI_CODEX_PROVIDER_ID[\s\S]*requestThreadCompaction\(thread, 'slash'\)/,
  );
  assert.match(appSource, /buildCompactSlashCommandSubmission\(submittedText\)/);
});

test('context indicator exposes one capability-aware compact action for Codex', () => {
  assert.match(indicatorSource, /onCompactContext/);
  assert.match(indicatorSource, /compactAvailability\.reason/);
  assert.match(indicatorSource, /Minimize2/);
  assert.match(indicatorSource, /压缩上下文/);
  assert.match(composerSource, /agent === 'codex'[\s\S]*compactAvailability/);
});

test('system turns do not render fake user or assistant labels', () => {
  assert.match(turnSource, /turn\.kind === 'system'/);
  assert.match(turnSource, /system-turn-content/);
  assert.match(paneSource, /onRetryCompact/);
  assert.match(paneSource, /onSkipCompact/);
});

test('manual failed compact card exposes retry and skip while automatic card does not', () => {
  assert.match(turnSource, /onRetryCompact/);
  assert.match(turnSource, /onSkipCompact/);
  assert.match(turnSource, /item\.compact\?\.source === 'manual'/);
  assert.match(turnSource, /RotateCcw/);
  assert.match(turnSource, /跳过并继续/);
});

test('compact controls use stable themed action styles', () => {
  assert.match(stylesSource, /\.composer-context-compact-action\s*\{[\s\S]*var\(--app-/);
  assert.match(stylesSource, /\.system-turn-content\s*\{/);
  assert.match(stylesSource, /\.system-command-card-actions\s*\{/);
});
