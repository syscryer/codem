import http from 'node:http';

const port = Number(process.env.MOCK_AI_PORT || 3199);

http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'mock-chat-model' }] }));
    return;
  }
  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const latestUser = [...messages].reverse().find((message) => message.role === 'user');
    const content = typeof latestUser?.content === 'string'
      ? latestUser.content
      : JSON.stringify(latestUser?.content ?? '');
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `模拟回复：${content}` } }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 8, completion_tokens: 6 } })}\n\n`);
    response.end('data: [DONE]\n\n');
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
}).listen(port, '127.0.0.1');
