import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panelSource = readFileSync(new URL('../components/GitHistoryPanel.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('Git history details view mode uses compact icon buttons instead of text chips', () => {
  assert.match(panelSource, /import \{[\s\S]*Rows3[\s\S]*TreePine[\s\S]*\} from 'lucide-react';/);
  assert.match(panelSource, /className="git-history-view-icon"/);
  assert.match(panelSource, /aria-pressed=\{detailsDisplayMode === 'tree'\}/);
  assert.match(panelSource, /aria-label=\{detailsDisplayMode === 'tree' \? '按目录显示提交文件' : '平铺显示提交文件'\}/);
  assert.match(panelSource, /title=\{detailsDisplayMode === 'tree' \? '按目录显示' : '平铺显示'\}/);
  assert.match(panelSource, /setDetailsDisplayMode\(\(current\) => \(current === 'tree' \? 'flat' : 'tree'\)\)/);
  assert.match(panelSource, /\{detailsDisplayMode === 'tree' \? <TreePine size=\{14\} \/> : <Rows3 size=\{14\} \/>\}/);
  assert.doesNotMatch(panelSource, /git-history-view-chip/);
});

test('Git history commit details message is collapsible by default', () => {
  assert.match(panelSource, /const \[commitMessageExpanded, setCommitMessageExpanded\] = useState\(false\);/);
  assert.match(panelSource, /setCommitMessageExpanded\(false\);/);
  assert.match(panelSource, /const hasDetailedCommitMessage = Boolean\(/);
  assert.match(panelSource, /className="git-history-details-message-toggle"/);
  assert.match(panelSource, /aria-expanded=\{commitMessageExpanded\}/);
  assert.match(panelSource, /onClick=\{\(\) => setCommitMessageExpanded\(\(current\) => !current\)\}/);
  assert.match(panelSource, /commitMessageExpanded \? '收起提交说明' : '展开提交说明'/);
  assert.match(panelSource, /<pre className="git-history-details-message">/);
  assert.match(panelSource, /\{commitMessageExpanded \?[\s\S]*<pre className="git-history-details-message">[\s\S]*: null\}/);
  assert.doesNotMatch(panelSource, /buildCommitMessageHint/);
  assert.doesNotMatch(panelSource, /git-history-details-message-hint/);
  assert.match(stylesSource, /\.git-history-details-message-toggle\s*\{/);
  assert.match(stylesSource, /\.git-history-details-message\s*\{[\s\S]*max-height:/);
  assert.match(stylesSource, /\.git-history-details-message\s*\{[\s\S]*overflow: auto;/);
  assert.doesNotMatch(stylesSource, /\.git-history-details-message-hint\s*\{/);
});

test('Git history commit details refs stay readable in narrow details panels', () => {
  assert.match(panelSource, /<strong title=\{commitDetails\.refs\.join\(', '\)\}>\{commitDetails\.refs\.join\(', '\)\}<\/strong>/);
  assert.match(stylesSource, /\.git-history-details-refs\s*\{[^}]*grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\);/);
  assert.match(stylesSource, /\.git-history-details-refs\s*>\s*span\s*\{[^}]*white-space:\s*nowrap;/);
  assert.match(stylesSource, /\.git-history-details-refs strong\s*\{[^}]*text-overflow:\s*ellipsis;/);
});

test('Git history branch rows show upstream tooltip for local branches', () => {
  assert.match(panelSource, /const branchTooltip =\s*branch\.kind === 'local'/);
  assert.match(panelSource, /title=\{branchTooltip\}/);
  assert.match(panelSource, /\$\{branch\.name\} -> \$\{branch\.upstream\}/);
  assert.match(panelSource, /未设置跟踪分支/);
  assert.doesNotMatch(panelSource, /branch\.kind === 'remote' \? branch\.name : branchTooltip/);
});

test('Git history branch filter only scrolls vertically and constrains long branch names', () => {
  assert.match(
    stylesSource,
    /\.git-history-filter-menu-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s,
  );
  assert.match(
    stylesSource,
    /\.git-history-filter-menu-group\s*\{[^}]*min-width:\s*0;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
  );
});
