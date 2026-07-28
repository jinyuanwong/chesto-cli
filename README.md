# chesto

Command-line AI agent powered by [Kimi K3](https://huggingface.co/moonshotai/Kimi-K3) — the strongest open-weight model. Chat in your terminal; it runs real system tasks (shell commands, file read/write) on your machine.

Like Claude Code runs on Anthropic's best model and Codex runs on OpenAI's best, **chesto runs on the best open model**.

Single file. Zero dependencies. Node ≥ 18.

## Install

```bash
git clone https://github.com/jinyuanwong/chesto-cli.git
cd chesto-cli
ln -sf "$(pwd)/chesto.mjs" /opt/homebrew/bin/chesto   # or any dir in your PATH
```

## Use

```bash
export CHESTO_API_KEY=sk-...   # get one at https://platform.moonshot.ai

chesto                      # interactive chat
chesto -p "do something"    # one-shot task
chesto --yolo               # skip per-command confirmation
```

## Test the agent loop for $0 (no API key)

A local mock Kimi API server lets you verify the full loop — streaming, tool calls, real command execution — without spending anything:

```bash
node mock-server.mjs &
CHESTO_BASE_URL=http://localhost:11435/v1 CHESTO_API_KEY=mock chesto
```

## Config

| env | default | notes |
|---|---|---|
| `CHESTO_API_KEY` | — | Moonshot API key |
| `CHESTO_BASE_URL` | `https://api.moonshot.ai/v1` | point to mock / self-hosted / any OpenAI-compatible backend |
| `CHESTO_MODEL` | `kimi-k3` | use `kimi-k2.5` for ~5× cheaper development |

## Implementation notes

- kimi-k3 requires `reasoning_content` to be preserved across tool calls — handled.
- kimi-k3 does not accept sampling params (`temperature` etc.) — omitted.
- Tool outputs are truncated at 50k chars to protect the context window.
- Commands ask for confirmation before running; `--yolo` disables that.

## Roadmap

- Human-in-the-loop tools: connect the [Chesto task marketplace](https://chesto.ai) (public discovery: [`agent-card.json`](https://chesto.ai/.well-known/agent-card.json) · [`skill.md`](https://chesto.ai/skill.md) · [`llms.txt`](https://chesto.ai/llms.txt)) so the agent can call **real human actions**, not just APIs.
- npm package (`npm install -g chesto`).

---

## 中文

命令行 AI Agent，底层是最强开源模型 Kimi K3。终端输入 `chesto` 对话，可直接执行本机系统任务。

```bash
chesto                      # 交互对话
chesto -p "帮我..."         # 一次性任务
chesto --yolo               # 不逐条确认命令
```

零成本本地测试（不花一分钱验证 agent 循环）：

```bash
node mock-server.mjs &
CHESTO_BASE_URL=http://localhost:11435/v1 CHESTO_API_KEY=mock chesto
```

省钱开发：`CHESTO_MODEL=kimi-k2.5`（约 1/5 价格）。

## License

MIT
