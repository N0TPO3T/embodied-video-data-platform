# AI 质检主流程实施计划

**目标：** 将现有 Qwen3.7 AI 视频质检能力接入正式上传主流程，并实现并发 2、结果持久化和管理员系统提示词配置。

**架构：** 媒体 Worker 完成 FFmpeg 分析后通过事务 Outbox 发布 `ai.quality.v1`。独立 AI Worker 以 RabbitMQ `prefetch(2)` 消费任务，锁定当前提示词版本，复用 `video-quality` 核心服务并把标准化结果写回 PostgreSQL。API 和 Web 读取这些真实结果。

**模型路由：** 初审 `qwen3.7-plus`；条件复核 `qwen3.7-flash`。

## 全局约束

- 不在测试中调用真实百炼接口。
- `QWEN_API_KEY` 和 Base URL 只存在于本地环境变量。
- 管理员修改提示词只影响之后新开始的任务。
- 自动重试继续使用任务首次开始时锁定的提示词版本。
- 正式 AI Worker 和独立实验页的最大并发均为 2。
- 不删除或重建现有 PostgreSQL、MinIO、RabbitMQ 数据卷。
- 只提交本功能文件，不纳入工作区外部资料。

## Task 1：持久化模型与迁移

**文件：**

- 新建 `backend/src/database/entities/video-quality-prompt-version.entity.ts`
- 新建 `backend/src/database/entities/video-quality-result.entity.ts`
- 新建 `backend/src/database/migrations/202608120003-ai-quality.ts`
- 修改 `backend/src/database/data-source.ts`
- 修改 `backend/src/database/entities/submission.entity.ts`
- 测试 `backend/test/video-quality-schema.e2e-spec.ts`

步骤：

1. 先写迁移测试，要求新表、外键、部分唯一索引、状态约束和 `ai_processing` 提交状态存在。
2. 运行测试确认旧结构失败。
3. 实现实体和可回滚迁移。
4. 运行迁移、实体 schema 测试和类型检查。
5. 提交 `feat: persist AI quality results and prompts`。

## Task 2：提示词版本服务与管理员 API

**文件：**

- 新建 `backend/src/ai-quality/ai-quality-prompt.service.ts`
- 新建 `backend/src/ai-quality/ai-quality.controller.ts`
- 新建 `backend/src/ai-quality/ai-quality.module.ts`
- 新建 `backend/src/ai-quality/dto/update-ai-quality-prompt.dto.ts`
- 修改 `backend/src/app.module.ts`
- 修改 `backend/src/audit/audit.types.ts` 或对应审计标签映射
- 测试 `backend/test/ai-quality-prompt.e2e-spec.ts`

接口：

- `GET /api/v1/ai-quality/prompt`
- `PUT /api/v1/ai-quality/prompt`，请求 `{ systemPrompt: string }`
- `ensureDefault(): Promise<VideoQualityPromptVersionEntity>`
- `getActive(): Promise<VideoQualityPromptVersionEntity>`
- `update(actor, systemPrompt): Promise<VideoQualityPromptVersionEntity>`

步骤：

1. 写失败测试覆盖默认导入、管理员读写、普通角色拒绝、版本递增和审计脱敏。
2. 实现默认 V1 提示词导入，模型固定为 Qwen3.7 Plus/Flash。
3. 实现管理员 API、输入长度与空白校验、Origin 防护、`Cache-Control: no-store`。
4. 运行聚焦测试和身份权限回归。
5. 提交 `feat: manage versioned AI quality prompts`。

## Task 3：可靠 AI 队列与并发 2 Worker

**文件：**

- 修改 `backend/src/messaging/rabbitmq-topology.ts`
- 修改 `backend/src/messaging/rabbitmq-message-bus.service.ts`
- 修改 `backend/src/media/media-analysis.service.ts`
- 新建 `backend/src/ai-quality/ai-quality-analysis.service.ts`
- 新建 `backend/src/ai-quality/rabbit-ai-quality-worker.ts`
- 新建 `backend/src/ai-quality/ai-quality-worker.module.ts`
- 新建 `backend/src/ai-quality/ai-quality-worker.ts`
- 修改 `backend/Dockerfile`
- 修改 `compose.yaml`
- 修改 `.env.example`
- 测试 `backend/test/ai-quality-worker.spec.ts`
- 修改 `backend/test/rabbitmq-topology.spec.ts`
- 修改 `backend/test/media-analysis.e2e-spec.ts`

步骤：

1. 写失败测试证明媒体成功后新增唯一 AI Outbox、AI queue topology 和 `prefetch(2)`。
2. 实现 `ai.quality.v1` 队列、死信和三级延迟重试。
3. 实现任务开始事务：校验提交和媒体元数据、锁定提示词快照、递增尝试次数、状态改为 `ai_processing`。
4. 下载 MinIO 原视频，复用预处理器、Qwen provider、规则引擎；成功后原子写回结果。
5. 实现终态幂等、可重试/不可重试错误分类和临时目录清理。
6. 把正式 Worker 加入 Docker Compose，设置 `AI_QUALITY_CONCURRENCY=2`。
7. 把独立实验页队列并发与文案改为 2。
8. 运行 Worker、媒体、队列和现有 video-quality 测试。
9. 提交 `feat: run AI quality jobs in the main pipeline`。

## Task 4：正式结果 API 与前端映射

**文件：**

- 修改 `backend/src/submissions/submissions.service.ts`
- 修改 `web/src/submissions/contracts.ts`
- 修改 `web/src/submissions/submissionMapper.ts`
- 修改 `web/src/domain/types.ts`
- 修改 `web/src/features/admin/AiQueuePage.tsx`
- 修改 `web/src/components/ReviewDrawer.tsx`
- 修改 `web/src/features/collector/SubmissionDetail.tsx`
- 测试 `backend/test/submission-upload.e2e-spec.ts`
- 修改 `web/src/submissions/submissionMapper.test.ts`
- 新建或修改 AI 队列与详情组件测试

步骤：

1. 写失败测试，要求 API 返回真实 quality 字段并遵守角色数据范围。
2. 扩展公开提交 DTO，返回状态、分数、比例、摘要、问题、建议、模型和提示词版本。
3. 前端将 `scored`、`hard_reject`、`review_pending`、运行中和系统失败映射到现有领域模型。
4. AI 队列改为真实任务统计，显示并发 2；详情和复核显示真实结果。
5. 移除正式数据的 0 分占位和 60 分判断。
6. 运行后端提交测试与完整 Web 测试。
7. 提交 `feat: show persisted AI quality results`。

## Task 5：管理员提示词编辑页面

**文件：**

- 新建 `web/src/ai-quality/contracts.ts`
- 新建 `web/src/ai-quality/client/aiQualityApi.ts`
- 修改 `web/src/features/admin/RulesPage.tsx`
- 修改 `web/src/features/admin/adminConfiguration.test.tsx`
- 修改相关样式文件

步骤：

1. 写失败测试覆盖加载版本、编辑、保存提示、错误保留和普通角色不可达。
2. 实现客户端 API 和管理员编辑卡片。
3. 展示版本、哈希、Qwen3.7 Plus/Flash、修改人和修改时间。
4. 保存后显示“仅影响之后新开始的任务”并刷新版本。
5. 运行前端完整测试、类型检查、构建、SSR 与 lint。
6. 提交 `feat: edit AI quality system prompt`。

## Task 6：运行验证与交付

1. 运行后端完整测试、类型检查和构建。
2. 运行前端完整测试、类型检查、构建、SSR 与 lint。
3. 验证 Docker Compose 配置并无损执行数据库迁移。
4. 重建 API、媒体 Worker 和 AI Worker，确认数据库及 MinIO 数据保留。
5. 检查 AI Worker 启动日志、RabbitMQ consumer prefetch 和 API 健康状态。
6. 若本地已有可用最小样例且百炼配置有效，只执行一次付费真实冒烟；否则报告缺少样例或密钥，不伪造成功。
7. 更新 README，说明正式主流程、并发 2、提示词配置与故障处理。
8. 推送 `codex/integrate-ai-quality-flow` 并创建草稿 PR。
