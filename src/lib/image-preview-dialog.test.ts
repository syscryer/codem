import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('../components/ImagePreviewDialog.tsx', import.meta.url), 'utf8');

test('图片预览弹层使用专用卡片类，避免继承通用对话框固定宽度', () => {
  assert.match(dialogSource, /className="image-preview-dialog"/);
  assert.doesNotMatch(dialogSource, /className="dialog-card image-preview-dialog"/);
});

test('图片预览弹层允许按图片尺寸扩展到视口上限，而不是固定 420px 宽', () => {
  assert.match(
    stylesSource,
    /\.image-preview-dialog\s*\{[^}]*width:\s*fit-content;[^}]*max-width:\s*calc\(100vw - 64px\);[^}]*max-height:\s*calc\(100vh - 64px\);[^}]*\}/s,
  );
});

test('图片预览优先按原始尺寸展示，并仅在超出窗口时缩放', () => {
  assert.match(dialogSource, /const \[imageSize, setImageSize\] = useState<\{ width: number; height: number \} \| null>\(null\);/);
  assert.match(dialogSource, /function handleImageLoad\(event: SyntheticEvent<HTMLImageElement>\)/);
  assert.match(dialogSource, /const nextWidth = Math\.min\(image\.naturalWidth,\s*maxWidth\);/);
  assert.match(dialogSource, /const nextHeight = Math\.min\(image\.naturalHeight,\s*maxHeight\);/);
  assert.match(dialogSource, /if \(image\.naturalWidth > maxWidth \|\| image\.naturalHeight > maxHeight\)/);
  assert.match(dialogSource, /style=\{imageSize \? \{ width: `\$\{imageSize\.width\}px`, height: `\$\{imageSize\.height\}px` \} : undefined\}/);
  assert.match(
    stylesSource,
    /\.image-preview-stage\s*\{[^}]*width:\s*fit-content;[^}]*max-width:\s*calc\(100vw - 100px\);[^}]*max-height:\s*calc\(100vh - 140px\);[^}]*\}/s,
  );
  assert.match(
    stylesSource,
    /\.image-preview-image\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*max-width:\s*calc\(100vw - 100px\);[^}]*max-height:\s*calc\(100vh - 140px\);[^}]*\}/s,
  );
});
