# Embodied Video Data Platform

一个面向具身智能视频数据生产的可点击平台框架，覆盖公开官网、账号密码登录、数采人员、团长和平台管理员四类界面。

当前版本保留了原有 Web 界面，账号、登录会话、团队权限、账户审计和视频上传均已迁移到本地 NestJS + PostgreSQL 后端。视频文件由浏览器分片直传 MinIO，经 RabbitMQ 进入独立媒体进程，再由 FFprobe/FFmpeg 提取元数据并检测黑屏、冻结片段。AI 质检、结算和提现仍是后续阶段。

## 已实现范围

- 公开官网：平台定位、公开指标、场景能力、生产流程、质量保障和体验入口。
- 数采人员：视频上传、我的数据、质检详情、收入提现、采集指南和个人资料。
- 团长：成员管理、团队数据、结算前复核、团队分析和团队收入。
- 平台管理员：全平台提交、AI 队列、质量复核、数据资产、用户团队、规则、结算、提现审核、公开配置和审计日志。
- 核心规则：角色数据隔离、质量系数、有效时长、预计收入、结算后不可修改和提现金额校验。
- 真实视频链路：MP4/MOV 分片上传、对象大小与 SHA-256 校验、可靠消息、媒体元数据、黑屏与冻结片段。

## 本地运行

推荐使用 Docker Desktop 启动后端基础设施，再在本机启动 Web 界面。

```bash
cp .env.example .env
docker compose up -d --build

cd web
pnpm install
pnpm dev
```

默认地址：

- Web：`http://localhost:3000`
- 后端存活检查：`http://localhost:4000/api/v1/health/live`
- 后端就绪检查：`http://localhost:4000/api/v1/health/ready`（包含 PostgreSQL 可用性）
- RabbitMQ 管理页：`http://localhost:15672`
- MinIO 管理页：`http://localhost:9001`

后端容器每次启动都会自动检查并升级数据库结构；媒体进程会等待 API 健康后再启动。Web 通过 `web/.env.local` 中的 `NEXT_PUBLIC_API_BASE_URL` 和 `BACKEND_INTERNAL_URL` 连接本地后端。

### 本地预设账号

首次启动且 `users` 表为空时，系统会创建以下账号并写入 PostgreSQL：

| 角色 | 用户名 | 本地初始密码 | 团队 |
| --- | --- | --- | --- |
| 平台管理员 | `admin` | `admin123` | 无 |
| 团长 | `tuanzhang1` | `team1234` | TEAM-01 |
| 团长 | `tuanzhang2` | `team1234` | TEAM-02 |
| 数采人员 | `ceshirenyuan1` | `user1234` | TEAM-01 |
| 数采人员 | `ceshirenyuan2` | `user1234` | TEAM-01 |
| 数采人员 | `ceshirenyuan3` | `user1234` | TEAM-01 |
| 数采人员 | `ceshirenyuan4` | `user1234` | TEAM-02 |
| 数采人员 | `ceshirenyuan5` | `user1234` | TEAM-02 |

这些是明确可知的本地默认密码，只适合本机联调。把服务开放到局域网或公网之前，必须登录“个人资料”修改各账号密码，并更换 `.env` 中的数据库、会话、队列和对象存储密钥。

正常重启只会在账号表完全为空时创建预设账号；只要已有任意账号，就不会重置密码或覆盖现有身份。对于已经运行过旧版本、但需要一次性校准上述八个账号的本地数据库，可明确执行：

```bash
docker compose exec api node dist/cli/bootstrap-local-identity.js --reconcile
```

该命令只应在需要校准的现有本地安装中手动运行，不属于日常启动流程。它会保留无关账号和业务数据，只校准上述预设账号并撤销被校准账号的旧会话。每个登录用户都可以在“个人资料”中验证当前密码后修改自己的密码；管理员和对应团长也可以在账号管理页重置其权限范围内账号的密码。两种改密操作都会撤销目标账号的现有会话。

视频上传限制：仅支持 MP4 和 MOV，单文件最大 2 GiB；分片大小为 16 MiB，浏览器最多同时上传 3 个分片。上传地址有效期 15 分钟。等待类任务仍可作为有效内容，当前自动无效片段只包括技术性黑屏和画面冻结。

如果只调试账号等 API，可以用 Docker 启动五个基础服务，再使用本机 Node 启动后端：

```bash
docker compose up -d postgres redis rabbitmq minio qdrant

cd backend
pnpm install
pnpm build
pnpm start:local
```

完整视频处理应使用 `docker compose up -d --build`，因为 `media-worker` 容器已经包含 FFprobe/FFmpeg。

旧 D1 账号只在首次迁移时读取，运行期不再提供 D1 接口。迁移命令会保留账号 ID、角色和团队归属，把旧原型密码立即转换为 Argon2id，并跳过旧会话：

```bash
cd backend
D1_SQLITE_PATH=/绝对路径/旧数据库.sqlite pnpm import:d1
```

需要页面联调数据时，可以写入 6 条明确带 `is_test_data=true` 标记的视频记录。脚本幂等，不覆盖同 ID 的已有数据，也不会伪造 AI 分数：

```bash
docker compose exec api node dist/cli/seed-video-test-data.js
```

停止服务时使用 `docker compose stop`，PostgreSQL、MinIO、Redis、RabbitMQ 和 Qdrant 的命名数据卷都会保留。删除数据卷属于破坏性操作，不是正常重启或日常清理步骤；只有在明确不再需要本地数据库、对象和队列数据时才可执行。

## 验证

```bash
cd backend
pnpm test
pnpm typecheck
pnpm build

cd web
pnpm test
pnpm typecheck
pnpm build
pnpm test:render
```

## 初始账号

- 管理员用户名：`admin`
- 团长用户名：`tuanzhang1`、`tuanzhang2`
- 测试人员用户名：`ceshirenyuan1` 至 `ceshirenyuan5`

初始密码由管理员通过私密渠道提供，不保存在公开源码或 README 中。

登录页使用用户名和密码。管理员可在“用户与团队”页面新增管理员、团长或数采人员账号，并可编辑账号、重置密码、停用和重新启用账号。重置密码或停用账号会使该账号已有登录会话失效。

> 对外长期使用时，管理员可在后台定期重置账号密码。

## 交互演示

账号、团队、审计、视频上传、视频列表和媒体解析使用真实本地后端。AI 质检、质量复核、结算、提现、文件导出和交付包仍保留演示状态。可优先体验：

- 团长查看成员详情与指标，并新增、改名、重置密码、停用或启用本团队数采账号。
- 管理员新增或配置账号，新建价格规则版本并维护标签。
- 管理员预览并生成结算批次，将已结算数据组成交付包。
- 通过顶部通知面板、成功提示和操作日志观察操作结果。

短信、文件导出、真实支付和交付包下载仍为演示占位，会给出明确的界面反馈，不会触发外部服务。上传后的视频在媒体解析成功时停留于 `awaiting_ai`，等待后续真实模型质检阶段接管。

## 工程结构

```text
backend/                  # NestJS API、PostgreSQL、MinIO、RabbitMQ 与媒体处理
web/
├── app/                  # vinext / Next 应用入口、全局样式和元数据
├── src/app/              # 客户端路由与角色边界
├── src/auth/             # 对接 NestJS 的登录与账号 API
├── src/domain/           # 领域类型和纯业务计算
├── src/data/             # 尚未迁移的质检、结算等演示状态
├── src/submissions/      # 真实视频上传、列表与后端数据映射
├── src/components/       # 表格、状态、复核抽屉等公共组件
└── src/features/         # 官网、登录、数采、团长和管理员页面
```

账号、登录会话、团队、审计和视频提交通过 NestJS API 与 PostgreSQL 管理，视频对象保存在 MinIO。质检、相似度、结算和交付将在后续阶段逐步替换演示状态，同时保留现有页面结构。
