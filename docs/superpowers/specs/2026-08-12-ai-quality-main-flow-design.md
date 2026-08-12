# AI 质检主流程集成设计

## 目标

把现有独立 AI 视频质检实验页中已经验证的千问调用、抽帧、Flash 初审、Plus 复核、结构化结果校验和服务端规则复算逻辑接入正式视频主流程。正式上传的视频在媒体解析完成后自动进入 AI 队列，最多同时处理 2 个任务，结果持久化到 PostgreSQL，并由现有管理员、团长和数采页面读取。

管理员可以在“标签与规则”页面查看和修改当前 AI 系统提示词。保存生成新版本，只影响之后新开始的质检任务；已开始的任务始终使用启动时锁定的提示词快照。

## 范围

本次包含：

- 正式 AI 质检队列、Worker、重试和并发控制。
- 复用现有 `backend/src/video-quality/` 核心能力。
- AI 提示词版本和质检结果的 PostgreSQL 持久化。
- 管理员提示词查询、修改和审计。
- 正式提交列表、详情、AI 队列和质量复核页面展示真实 AI 状态与结果。
- Docker Compose、本地配置、数据库迁移和运行说明。

本次不包含结算、支付、人工复核结果持久化、向量相似度检索和自动扩缩容。冷启动库存与相似度权威系数继续使用现有规则允许的 `1.00`；精确文件重复仍按 SHA-256 判定。

## 方案选择

采用独立 AI Worker，通过 RabbitMQ 接收 `ai.quality.v1` 事件。媒体 Worker 只负责下载校验、FFprobe/FFmpeg 分析和基础片段检测；AI Worker 负责付费模型调用和结果写回。

不把 AI 调用塞进媒体 Worker，因为模型延迟、重试和费用控制不应阻塞媒体解析。不采用数据库轮询，因为项目已经使用事务 Outbox 和 RabbitMQ，继续沿用现有消息边界能保持任务投递可靠性。

## 主流程

1. 浏览器把视频分片直传 MinIO，API 完成上传后通过 Outbox 发布 `media.probe.v1`。
2. 媒体 Worker 下载原视频，校验 SHA-256，执行 FFprobe/FFmpeg，持久化媒体元数据与黑屏、冻结片段。
3. 同一个数据库事务把提交状态改为 `awaiting_ai`，并新增唯一的 `ai.quality.v1` Outbox 事件。
4. Outbox Pump 把事件发布到 `evdp.ai.quality.v1` 队列。
5. AI Worker 收到任务后锁定提交记录，若已有终态结果则直接确认消息，保证重复消息幂等。
6. Worker 读取当前启用的提示词版本，立即创建或更新该提交的运行记录，并把提示词版本、系统提示词内容哈希、模型 ID 锁定为任务快照。随后将提交状态改为 `ai_processing`。
7. Worker 从 MinIO 下载原视频到独立临时目录，调用现有预处理器、Flash 初审、条件触发的 Plus 复核和服务端规则复算。
8. Worker 在事务中写入标准化结果、原始结构化结果、模型调用元数据和实际使用的提示词快照，并把提交状态改为 `completed`。
9. 临时原视频和抽帧文件在成功、失败、重试或进程退出路径中清理。
10. API 返回持久化结果，前端不再为真实提交伪造 0 分或演示结论。

自动重试沿用分级延迟队列。网络错误、限流和可恢复的模型响应错误最多重试 3 次；无效输入、提示词配置错误和达到重试上限后写入 `system_failed`。自动重试继续使用首次启动时锁定的提示词快照，避免同一任务因重试产生不同判定规则。未来的显式“重新质检”会创建新运行并采用届时启用的提示词版本，不属于本次范围。

## 并发控制

正式 AI Worker 的默认和本地部署并发量固定为 2：

- RabbitMQ channel 使用 `prefetch(2)`。
- Worker 同时最多执行两个 `handle` 调用，每条消息只在结果成功持久化或进入明确失败/重试状态后确认。
- Docker Compose 默认只启动一个 AI Worker 实例，因此本地总并发为 2。
- 配置项 `AI_QUALITY_CONCURRENCY=2` 会在启动时校验为正整数；本次 Compose 明确设置为 2。

独立实验页也把浏览器与服务端队列从单并发改为 2，保持验证环境与正式环境一致。页面文案同步显示“双并发”。

## 数据模型

### `video_quality_prompt_versions`

- `id`：不可变版本 ID。
- `revision`：单调递增版本号，唯一。
- `system_prompt`：管理员可编辑的完整系统提示词。
- `content_sha256`：仅对规范化后的系统提示词计算的 SHA-256。
- `prompt_version`、`rule_version`、`output_schema`：固定协议版本。
- `initial_model`、`review_model`：该版本使用的模型 ID。
- `active`：只有一条记录可启用，使用部分唯一索引保证。
- `created_by_account_id`、`created_by_name`、`created_at`：修改人和时间。

首次启动时，若表为空，API 或 AI Worker 从仓库内已提交的 V1 提示词文档导入默认版本。输出结构、规则版本和模型 ID 仍由已提交文档约束，管理员只能编辑系统提示词正文，不能在网页改变输出协议或 API Key。

### `video_quality_results`

- `submission_id`：主键并关联提交，一条提交保留当前正式 AI 结果。
- `status`：`queued`、`running`、`scored`、`hard_reject`、`review_pending` 或 `system_failed`。
- `attempts`、`started_at`、`completed_at`、`last_error`：运行状态与重试信息。
- `prompt_version_id`、`prompt_revision`、`prompt_content_sha256`：任务启动时锁定的提示词快照标识。
- `initial_model`、`review_model`、`model_runs`：实际模型和调用元数据。
- `final_score`、`raw_total_score`、`settlement_ratio`、`invalid_duration_ms`、`billable_duration_ms`。
- `summary`、`recommendations`、`deductions`、`review_required`、`review_reasons`。
- `normalized_result`、`raw_model_result`：完整 JSONB 结果，用于详情、审计和后续迁移。
- `created_at`、`updated_at`。

媒体检测片段继续保存在 `media_segments`。模型语义问题、扣分项和无效区间保存在质检结果 JSON 中，API 统一输出，避免破坏现有只允许 `black`/`freeze` 的媒体片段约束。

## 提示词配置 API 与权限

新增管理员专用接口：

- `GET /api/v1/ai-quality/prompt`：返回当前启用版本的正文、版本号、哈希、模型 ID、修改人和修改时间。
- `PUT /api/v1/ai-quality/prompt`：接受新的 `systemPrompt`，校验去除首尾空白后非空、长度上限和必需的结构化输出约束说明；在一个事务中停用旧版本并创建新版本。

两个接口都要求有效会话和管理员角色；写接口同时要求允许的 Web Origin。任何普通用户、团长或未登录请求都返回 403/401。API Key、Base URL 和其他密钥永不通过接口返回。

提示词修改写入现有审计日志，动作名为 `ai_quality_prompt_update`。审计只保存旧/新版本、哈希和摘要，不在通用日志中复制整段提示词正文。

## 前端行为

“标签与规则”页面新增“AI 系统提示词”配置卡和编辑区域：

- 显示当前版本、内容哈希缩写、Flash/Plus 模型和最近修改信息。
- 通过多行文本框编辑完整系统提示词。
- 保存前提示“仅影响保存后新开始的任务”。
- 保存成功后刷新版本信息；失败时保留未保存内容并显示后端错误。

正式提交 API 增加 `quality` 字段。前端映射规则为：

- `scored`：可结算结果，兼容现有 `qualityStatus=passed`，显示真实评分和结算比例，不再使用 60 分阈值。
- `hard_reject`：`qualityStatus=failed`。
- `review_pending`：`qualityStatus=pending`，进入人工复核视图。
- 尚未运行或系统失败：保持待处理/异常状态，并展示明确原因。

详情与复核抽屉显示真实摘要、扣分项、无效时长、建议、模型版本和提示词版本。管理员 AI 队列从真实提交及质检状态生成，不再显示固定演示数量或“4 个并发 Worker”。

## 错误处理与安全

- 未配置 `QWEN_API_KEY` 时 AI Worker 启动失败并给出明确配置错误；API、数据库和媒体 Worker仍可运行，提交停留在 `awaiting_ai`。
- 模型调用诊断只记录请求 ID、模型、阶段、耗时、状态和脱敏错误，不记录 API Key、完整视频帧或 Authorization header。
- 提示词内容只对管理员可见；数据库保存版本，HTTP 响应禁止缓存。
- 消息投递采用 at-least-once，终态检查和 `submission_id` 唯一结果保证重复消费不会重复覆盖结果。模型返回后、数据库提交前进程崩溃仍可能产生一次重复付费调用；日志通过稳定提交 ID 和尝试次数支持核对。
- Worker 仅处理 `uploaded` 且媒体元数据完整的提交，其他消息进入不可重试失败。
- 所有数据库迁移可回滚，但正常启动、重建容器和停止服务均不删除现有 PostgreSQL 或 MinIO 数据卷。

## 测试与验收

自动测试不得发起真实百炼付费调用，使用现有可注入 provider/fetcher：

- 数据库迁移、默认提示词导入、单一 active 版本约束。
- 管理员读写提示词、非管理员拒绝、修改审计和正文不进入通用审计。
- 提示词保存后，新任务使用新版本；已经 running 的任务及其自动重试继续使用旧快照。
- 媒体完成事务创建唯一 `ai.quality.v1` Outbox 事件。
- RabbitMQ topology 和 AI Worker `prefetch(2)`。
- 两个任务可并行执行，第三个任务在前两个之一结束前不开始。
- 成功结果、Plus 复核、review pending、hard reject、可重试失败和终态失败写回。
- 重复消息不会对终态提交再次调用 provider。
- API 根据管理员、团长和数采角色继续执行数据范围隔离。
- 前端提示词编辑、真实质量结果映射、AI 队列和旧的 60 分判断移除。

完成自动测试后执行一次明确授权的本地真实冒烟：使用最小样例上传或已有 MinIO 视频，确认状态依次经过 `awaiting_ai`、`ai_processing`、终态，数据库保存模型请求 ID、提示词版本和结果，页面刷新后仍显示相同结果。真实调用会产生百炼费用，因此只执行一个最小样例。

## 部署与配置

Dockerfile 新增正式 `ai-worker` target，安装 FFmpeg。Compose 新增常驻 `ai-worker` 服务，依赖 PostgreSQL、RabbitMQ、MinIO，并挂载 `docs/quality` 为只读默认提示词来源。

新增或明确以下非密钥配置：

```dotenv
AI_QUALITY_CONCURRENCY=2
AI_QUALITY_MODEL_TIMEOUT_MS=600000
VIDEO_QUALITY_PROMPT_PATH=/quality/qwen-video-ai-quality-prompt-v1.md
VIDEO_QUALITY_INITIAL_MODEL=qwen3-vl-flash-2026-01-22
VIDEO_QUALITY_REVIEW_MODEL=qwen3-vl-plus-2025-12-19
```

`QWEN_API_KEY` 与工作空间专属 `QWEN_BASE_URL` 继续只存在于本地 `.env`，不提交 Git、不写数据库、不显示在管理页面。

## 成功标准

- 正式上传视频媒体解析成功后能自动完成真实 AI 质检，不再永久停在 `awaiting_ai`。
- AI 调用并发量在默认本地部署中稳定为 2。
- 质检结果、失败信息和提示词版本在重启后仍存在。
- 管理员可以修改系统提示词，普通用户不能读取或修改。
- 提示词更新不影响已开始任务，只影响之后新开始的任务。
- 现有账号权限、上传、媒体解析和独立实验页继续工作。
