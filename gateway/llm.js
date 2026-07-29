import express from 'express';
import { authenticateAgentRequest, getBearerToken, isAgentApiKeyRequest } from '../middleware/agentAuth.js';

// LLM gateway: chesto CLI 等客户端 → 本服务器 → Moonshot (Kimi)。
// 上游 key 只存在服务器 .env，客户端永远拿不到。
//
// 隐私红线：本文件禁止把 messages/对话内容写入任何日志或数据库；
// 只允许记录 key 别名、模型名、状态码、耗时。
//
// 鉴权两条路：
//   1. LLM_GATEWAY_KEYS（.env 逗号分隔）——手工发放的内测 key
//   2. 平台 agent key（chesto_sk_*，走 DB 验证 + 每日限额）——
//      默认关闭，设 LLM_GATEWAY_AGENT_ACCESS=1 打开（涉及成本，开关留给运营决策）

const router = express.Router();

const DEFAULT_MODELS = 'kimi-k3,kimi-k2.5';
// 转发字段白名单：防止客户端塞任意字段到上游（K3 本身也不接受采样参数）
const FORWARD_FIELDS = ['model', 'messages', 'tools', 'tool_choice', 'stream', 'max_tokens', 'reasoning_effort'];

// 每个 key 的滑动窗限流（内存实现，同 publicReadLimit 的模式；PM2 fork 单进程够用）
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
const buckets = new Map();
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, hits] of buckets) {
    const fresh = hits.filter((t) => t > cutoff);
    if (fresh.length === 0) buckets.delete(k);
    else buckets.set(k, fresh);
  }
}, WINDOW_MS).unref();

function overLimit(key) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => t > now - WINDOW_MS);
  hits.push(now);
  buckets.set(key, hits);
  return hits.length > MAX_PER_WINDOW;
}

async function authorize(req) {
  const key = getBearerToken(req);
  if (!key) return { ok: false, status: 401, error: 'Missing API key. Use: Authorization: Bearer <chesto key>' };

  const manualKeys = (process.env.LLM_GATEWAY_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (manualKeys.includes(key)) return { ok: true, alias: key.slice(0, 12) };

  if (isAgentApiKeyRequest(req)) {
    if (process.env.LLM_GATEWAY_AGENT_ACCESS !== '1') {
      return { ok: false, status: 403, error: 'LLM access for agent keys is not enabled yet' };
    }
    const auth = await authenticateAgentRequest(req);
    if (!auth.ok) return auth;
    return { ok: true, alias: key.slice(0, 14) };
  }

  return { ok: false, status: 401, error: 'Invalid API key' };
}

router.post('/chat/completions', async (req, res) => {
  const started = Date.now();
  const upstreamKey = process.env.MOONSHOT_API_KEY;
  if (!upstreamKey) return res.status(503).json({ error: 'LLM gateway not configured' });

  const auth = await authorize(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (overLimit(auth.alias)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests — slow down.' });
  }

  const allowed = (process.env.LLM_ALLOWED_MODELS || DEFAULT_MODELS).split(',').map((s) => s.trim());
  const model = req.body?.model;
  if (!allowed.includes(model)) {
    return res.status(400).json({ error: `Model not allowed. Use one of: ${allowed.join(', ')}` });
  }

  const body = {};
  for (const f of FORWARD_FIELDS) {
    if (req.body[f] !== undefined) body[f] = req.body[f];
  }

  let upstream;
  try {
    upstream = await fetch(`${process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1'}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${upstreamKey}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.log(`[llm] ${auth.alias} ${model} upstream_unreachable ${Date.now() - started}ms`);
    return res.status(502).json({ error: 'Upstream LLM unreachable' });
  }

  // 只记录元数据，绝不记录对话内容（隐私红线）
  console.log(`[llm] ${auth.alias} ${model} ${upstream.status} stream=${!!body.stream} ${Date.now() - started}ms`);

  if (!upstream.ok) {
    // 上游错误原样转发状态码，但正文重新包装，避免泄露上游账号信息
    const detail = upstream.status === 429 ? 'Upstream rate limited' : 'Upstream LLM error';
    return res.status(upstream.status).json({ error: detail });
  }

  if (body.stream) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    try {
      for await (const chunk of upstream.body) res.write(chunk);
    } catch {
      // 客户端断开或上游中断：直接结束，不重试
    }
    return res.end();
  }

  const json = await upstream.json();
  return res.json(json);
});

export default router;
