import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPromptWithImageAttachments } from '../src/lib/composer-attachments';

test('buildPromptWithImageAttachments adds a hidden ViewImage fallback for attached images', () => {
  const result = buildPromptWithImageAttachments('请帮我分析这张图', [
    'D:\\workspace\\.codem-attachments\\pasted-1.png',
  ]);

  assert.equal(
    result,
    '请帮我分析这张图\n\n图片已经作为消息附件提供。通常直接根据附件内容回答即可。\n如果必须访问本地图片文件，只能使用 ViewImage 查看这些路径：\n- D:\\workspace\\.codem-attachments\\pasted-1.png\n\n不要使用 Read、Grep 或文本读取类工具处理图片文件。',
  );
});

test('buildPromptWithImageAttachments creates a default prompt with ViewImage fallback when only images are attached', () => {
  const result = buildPromptWithImageAttachments('', [
    'D:\\workspace\\.codem-attachments\\pasted-1.png',
    'D:\\workspace\\.codem-attachments\\pasted-2.png',
  ]);

  assert.equal(
    result,
    '请结合已附图片处理这次任务。\n\n图片已经作为消息附件提供。通常直接根据附件内容回答即可。\n如果必须访问本地图片文件，只能使用 ViewImage 查看这些路径：\n- D:\\workspace\\.codem-attachments\\pasted-1.png\n- D:\\workspace\\.codem-attachments\\pasted-2.png\n\n不要使用 Read、Grep 或文本读取类工具处理图片文件。',
  );
});
