# chesto-cli

命令行 AI Agent。终端输入 `chesto` 对话，底层调 Kimi K3，可执行本机系统任务（bash / 读写文件）。

## 用

```bash
chesto                      # 交互对话
chesto -p "帮我..."         # 一次性任务
chesto --yolo               # 不逐条确认命令
```

## 接真模型

```bash
# 1. https://platform.moonshot.ai 注册并充值（$10 够开发很久）
export CHESTO_API_KEY=sk-...
chesto
```

## 零成本本地测试（不花一分钱验证 agent 循环）

```bash
node mock-server.mjs &
CHESTO_BASE_URL=http://localhost:11435/v1 CHESTO_API_KEY=mock chesto
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `CHESTO_API_KEY` | 无 | Moonshot key |
| `CHESTO_BASE_URL` | `https://api.moonshot.ai/v1` | 换后端（mock/自部署）只改这里 |
| `CHESTO_MODEL` | `kimi-k3` | 省钱开发用 `kimi-k2.5`（约 1/5 价格） |

## 实现说明

- 单文件零依赖（`chesto.mjs`），Node ≥18
- kimi-k3 的 reasoning_content 已按官方要求在多轮 tool call 间保留
- kimi-k3 不支持 temperature 等采样参数，已省略
- 安装 = `ln -sf $(pwd)/chesto.mjs /opt/homebrew/bin/chesto`
