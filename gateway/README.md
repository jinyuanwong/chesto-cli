# gateway

这是 chesto.ai LLM 网关**实际运行的源码镜像**（`POST https://chesto.ai/api/v1/chat/completions`）。

用户信任三件事，代码可查证：

1. 上游 API key 只存在服务器环境变量，永不回传客户端
2. 对话内容不写入任何日志或数据库（只记录 key 别名、模型、状态码、耗时）
3. 只转发白名单字段，上游错误不透传账号细节

CLI 走网关：`CHESTO_BASE_URL=https://chesto.ai/api/v1 CHESTO_API_KEY=<你的 chesto key> chesto`
