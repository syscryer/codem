import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPromptWithImageAttachments } from '../src/lib/composer-attachments';

test('buildPromptWithImageAttachments appends local image paths to the prompt', () => {
  const result = buildPromptWithImageAttachments('请帮我分析这张图', [
    'D:\\workspace\\.codem-attachments\\pasted-1.png',
  ]);

  assert.equal(
    result,
    '请帮我分析这张图\n\n下面这些路径是本地图片文件，不是文本文件，也不是代码文件：\n- D:\\workspace\\.codem-attachments\\pasted-1.png\n\n对于以上路径，请严格遵守以下规则：\n1. 只能使用 ViewImage 查看图片\n2. 不要使用 Read 读取图片内容\n3. 不要把图片路径当作普通文本文件处理\n4. 如果 ViewImage 失败，请直接说明失败，不要猜测图片内容',
  );
});

test('buildPromptWithImageAttachments creates a default prompt when only images are attached', () => {
  const result = buildPromptWithImageAttachments('', [
    'D:\\workspace\\.codem-attachments\\pasted-1.png',
    'D:\\workspace\\.codem-attachments\\pasted-2.png',
  ]);

  assert.equal(
    result,
    '请结合已附图片处理这次任务。\n\n下面这些路径是本地图片文件，不是文本文件，也不是代码文件：\n- D:\\workspace\\.codem-attachments\\pasted-1.png\n- D:\\workspace\\.codem-attachments\\pasted-2.png\n\n对于以上路径，请严格遵守以下规则：\n1. 只能使用 ViewImage 查看图片\n2. 不要使用 Read 读取图片内容\n3. 不要把图片路径当作普通文本文件处理\n4. 如果 ViewImage 失败，请直接说明失败，不要猜测图片内容',
  );
});
