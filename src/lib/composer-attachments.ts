export function buildPromptWithImageAttachments(prompt: string, imagePaths: string[]) {
  const trimmedPrompt = prompt.trim();
  const normalizedPaths = imagePaths.map((item) => item.trim()).filter(Boolean);

  if (normalizedPaths.length === 0) {
    return trimmedPrompt;
  }

  const attachmentLines = normalizedPaths.map((item) => `- ${item}`).join('\n');
  const prefix = trimmedPrompt || '请结合已附图片处理这次任务。';

  return [
    prefix,
    '',
    '下面这些路径是本地图片文件，不是文本文件，也不是代码文件：',
    attachmentLines,
    '',
    '对于以上路径，请严格遵守以下规则：',
    '1. 只能使用 ViewImage 查看图片',
    '2. 不要使用 Read 读取图片内容',
    '3. 不要把图片路径当作普通文本文件处理',
    '4. 如果 ViewImage 失败，请直接说明失败，不要猜测图片内容',
  ].join('\n');
}
