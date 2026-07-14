import readline from 'node:readline';

const lines = readline.createInterface({ input: process.stdin });

lines.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id == null) {
    return;
  }
  let result;
  if (request.method === 'initialize') {
    result = {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-stdio', version: '1.0.0' },
    };
  } else if (request.method === 'tools/list') {
    result = {
      tools: [{ name: 'read_value', description: '读取测试值', inputSchema: { type: 'object' } }],
    };
  } else if (request.method === 'tools/call') {
    result = {
      content: [{ type: 'text', text: `value:${request.params?.arguments?.value ?? ''}` }],
      isError: false,
    };
  } else {
    result = {};
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
});
