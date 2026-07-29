#!/usr/bin/env node
// chesto — 命令行 AI Agent（底层 Kimi K3，OpenAI 兼容接口，零依赖单文件）
//
// 用法:
//   chesto                    交互模式（对话）
//   chesto -p "帮我..."       一次性任务模式
//   chesto --yolo             执行命令不再逐条确认
//
// 配置（环境变量）:
//   CHESTO_API_KEY   Moonshot API key（必填，本地 mock 测试可随便填）
//   CHESTO_BASE_URL  默认 https://api.moonshot.ai/v1（测试时指向本地 mock）
//   CHESTO_MODEL     默认 kimi-k3（省钱开发可用 kimi-k2.5）

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import readline from 'node:readline/promises';

const API_KEY = process.env.CHESTO_API_KEY || process.env.MOONSHOT_API_KEY || '';
// key 前缀决定走哪条路：chesto 发的 key → chesto 网关；Moonshot 的 sk- → 直连。
// 显式设置 CHESTO_BASE_URL 时以它为准（逃生通道 / 本地 mock / 自建后端）。
const BASE_URL = process.env.CHESTO_BASE_URL ||
  (API_KEY.startsWith('chesto_') ? 'https://chesto.ai/api/v1' : 'https://api.moonshot.ai/v1');
const MODEL = process.env.CHESTO_MODEL || 'kimi-k3';

const argv = process.argv.slice(2);
const YOLO = argv.includes('--yolo') || process.env.CHESTO_YOLO === '1';
const pIdx = argv.indexOf('-p');
const ONE_SHOT = pIdx !== -1 ? argv[pIdx + 1] : null;

// ---------- 工具定义（给模型看的说明书） ----------
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: '在用户的 macOS 上执行 shell 命令，返回 stdout/stderr。用它完成系统任务。',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: '要执行的 shell 命令' } },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取本地文件内容',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '文件绝对路径' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '写入本地文件（自动创建目录，覆盖写）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

// ---------- 工具执行（真正动手的部分） ----------
const TRUNC = 50_000; // 工具输出超长会截断，防止撑爆上下文
const truncate = (s) => (s.length > TRUNC ? s.slice(0, TRUNC) + `\n...[截断,共${s.length}字符]` : s);

async function runTool(name, args, ask) {
  try {
    if (name === 'bash') {
      if (!(await ask(`$ ${args.command}`))) return '[用户拒绝执行该命令]';
      try {
        const out = execSync(args.command, {
          encoding: 'utf8', shell: '/bin/zsh', timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
        });
        return truncate(out) || '[命令执行成功，无输出]';
      } catch (e) {
        return truncate(`[退出码 ${e.status ?? '?'}]\n${e.stdout || ''}${e.stderr || ''}`);
      }
    }
    if (name === 'read_file') return truncate(readFileSync(args.path, 'utf8'));
    if (name === 'write_file') {
      if (!(await ask(`写入文件 ${args.path} (${args.content.length} 字符)`))) return '[用户拒绝写入]';
      mkdirSync(dirname(args.path), { recursive: true });
      writeFileSync(args.path, args.content);
      return `已写入 ${args.path}`;
    }
    return `[未知工具 ${name}]`;
  } catch (e) {
    return `[工具出错] ${e.message}`;
  }
}

// ---------- 调模型（流式 SSE，边生成边打印） ----------
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

async function chat(messages) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, stream: true }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

  // 从 SSE 流里拼装出完整的 assistant 消息（K3 要求保留 reasoning 内容传回去）
  let content = '', reasoning = '', toolCalls = [], finish = null, buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop(); // 最后一行可能不完整，留到下个 chunk
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      const choice = JSON.parse(data).choices?.[0];
      if (!choice) continue;
      const d = choice.delta || {};
      if (d.reasoning_content) { reasoning += d.reasoning_content; process.stdout.write(dim(d.reasoning_content)); }
      if (d.content) { content += d.content; process.stdout.write(d.content); }
      for (const tc of d.tool_calls || []) {
        toolCalls[tc.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) toolCalls[tc.index].id = tc.id;
        if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  process.stdout.write('\n');
  const msg = { role: 'assistant', content };
  if (reasoning) msg.reasoning_content = reasoning;
  if (toolCalls.length) msg.tool_calls = toolCalls;
  return { msg, finish };
}

// ---------- Agent 循环：模型要用工具就执行，直到它给出最终回答 ----------
async function agentTurn(messages, ask) {
  for (let i = 0; i < 25; i++) { // 单轮最多 25 次工具调用，防死循环
    const { msg } = await chat(messages);
    messages.push(msg);
    if (!msg.tool_calls?.length) return;
    for (const tc of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      console.log(cyan(`⚙ ${tc.function.name}`));
      const result = await runTool(tc.function.name, args, ask);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }
  console.log('[达到单轮工具调用上限]');
}

// ---------- 入口 ----------
const SYSTEM = `你是 chesto，Chesto 出品的命令行 AI Agent，底层是最强开源模型 Kimi K3。
你运行在用户的 macOS 终端里，可以用工具直接执行 shell 命令、读写文件，帮用户完成真实的系统任务。
风格：直接、简洁、说中文（用户用英文则用英文）。动手前简短说明要做什么。`;

async function main() {
  if (!API_KEY) {
    console.log(`缺少 API key。两种任选其一:
  export CHESTO_API_KEY=chesto_...   # chesto key，走 chesto.ai 网关（推荐）
  export CHESTO_API_KEY=sk-...       # 自己的 Moonshot key，直连 https://platform.moonshot.ai`);
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (desc) => {
    if (YOLO) { console.log(dim(`  ${desc}`)); return true; }
    const a = await rl.question(`  ${desc}\n  执行? [y/N] `);
    return a.trim().toLowerCase() === 'y';
  };
  const messages = [{ role: 'system', content: SYSTEM }];

  if (ONE_SHOT) { // 一次性任务模式：chesto -p "..."
    messages.push({ role: 'user', content: ONE_SHOT });
    await agentTurn(messages, ask);
    rl.close();
    return;
  }

  console.log(cyan(`chesto`) + dim(` · ${MODEL} · ${BASE_URL}\n输入任务，/exit 退出，/clear 清空对话\n`));
  while (true) {
    const input = (await rl.question(cyan('you › '))).trim();
    if (!input) continue;
    if (input === '/exit') break;
    if (input === '/clear') { messages.length = 1; console.log(dim('已清空\n')); continue; }
    messages.push({ role: 'user', content: input });
    await agentTurn(messages, ask);
    console.log();
  }
  rl.close();
}

main().catch((e) => { console.error(`出错: ${e.message}`); process.exit(1); });
