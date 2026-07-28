#!/usr/bin/env node
// mock-server — 本地假 Kimi API（OpenAI 兼容 SSE），$0 验证 chesto 的 agent 循环
//
// 行为：第一次回复返回一个 bash tool call（执行用户消息里 cmd: 后面的命令，
// 没有 cmd: 就执行默认命令）；chesto 执行完把结果传回来后，返回最终文字回答。
//
// 启动: node mock-server.mjs   (监听 http://localhost:11435/v1)

import http from 'node:http';

const PORT = 11435;

// 按 SSE 格式把一段回复切成小块流式发出去，模拟真实打字感
function sse(res, deltas, finish) {
  for (const delta of deltas) {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const chunks = (s, n = 8) => s.match(new RegExp(`.{1,${n}}`, 'gs')) || [];

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { messages = [] } = JSON.parse(body || '{}');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });

    const hasToolResult = messages.some((m) => m.role === 'tool');
    if (!hasToolResult) {
      // 第一轮：装作思考了一下，然后发起 bash tool call
      const user = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
      const cmd = user.includes('cmd:') ? user.split('cmd:')[1].trim() : 'sw_vers && echo "hello from chesto"';
      sse(res, [
        ...chunks('用户给了我一个系统任务，我需要执行命令来完成它。').map((c) => ({ reasoning_content: c })),
        { tool_calls: [{ index: 0, id: 'call_mock_1', type: 'function', function: { name: 'bash', arguments: '' } }] },
        ...chunks(JSON.stringify({ command: cmd })).map((c) => ({ tool_calls: [{ index: 0, function: { arguments: c } }] })),
      ], 'tool_calls');
    } else {
      // 第二轮：拿到工具结果，给最终回答
      const result = messages[messages.length - 1].content.slice(0, 200);
      sse(res, chunks(`命令已执行完成 ✅ 输出摘要：${result}\n（我是本地 mock，换成真 Kimi K3 只需设置 CHESTO_API_KEY 并去掉 CHESTO_BASE_URL）`).map((c) => ({ content: c })), 'stop');
    }
  });
}).listen(PORT, () => console.log(`mock Kimi API 运行中: http://localhost:${PORT}/v1`));
