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
    '图片已经作为消息附件提供。通常直接根据附件内容回答即可。',
    '如果必须访问本地图片文件，只能使用 ViewImage 查看这些路径：',
    attachmentLines,
    '',
    '不要使用 Read、Grep 或文本读取类工具处理图片文件。',
  ].join('\n');
}
