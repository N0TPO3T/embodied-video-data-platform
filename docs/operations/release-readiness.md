# 发布、迁移和运维验收

本文用于本地平台进入长期运行前的发布检查。命令默认从仓库根目录执行。

## CI 检查

每个 Pull Request 和 `main`/`codex/**` 分支推送都会运行 `.github/workflows/ci.yml`：

- 后端：安装依赖、类型检查、PostgreSQL 迁移、测试、构建。
- Web：安装依赖、类型检查、测试、构建、渲染冒烟测试。

本地等价检查：

```bash
cd backend
pnpm typecheck
pnpm test
pnpm build

cd ../web
pnpm typecheck
pnpm test
pnpm build
pnpm test:render
```

数据库相关测试需要可访问的 PostgreSQL，并设置 `TEST_DATABASE_URL`。本地 Docker 默认测试库地址为：

```bash
TEST_DATABASE_URL=postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test
```

## 迁移发布顺序

1. 备份 PostgreSQL 和 MinIO 对象。
2. 在暂存或本地副本执行 `cd backend && pnpm migration:run`。
3. 执行后端类型检查、测试和构建。
4. 执行 Web 类型检查、测试、构建和渲染冒烟。
5. 部署 API，新进程启动前再次执行迁移。
6. 部署 Worker，确认媒体 Worker 和 AI Worker 心跳正常。
7. 部署 Web，确认 `/api/v1/health/ready`、登录、上传创建、预览链接和交付清单。

回滚原则：

- 代码回滚优先于数据库回滚。
- 只有确认上一版代码不能兼容新结构时，才执行 `cd backend && pnpm migration:revert`。
- 对象删除为不可逆操作，必须先确认备份或对象存储版本化可恢复。

## 容量和性能验收

首期验收基线：

- 账号与后台读接口：100 RPS 下 P95 小于 500 ms。
- 上传：30 个浏览器同时分片上传，API 只签发链接，不承载视频流量。
- 处理：500 条视频/日，媒体 Worker 和 AI Worker 队列可在业务窗口内清空。
- 对象存储：按 2 GiB 单文件上限估算，180 天保留期需要预留热存储容量。

本地轻量检查：

```bash
docker compose up -d postgres redis rabbitmq minio
cd backend
pnpm migration:run
pnpm exec vitest run test/operations.e2e-spec.ts test/submission-upload.e2e-spec.ts --reporter=dot
```

正式压测建议单独使用 k6、wrk 或云压测工具，不要对生产库执行破坏性写入压测。

## 告警起点

当前平台已在运维摘要里展示队列、失败任务和 Worker 心跳。接入外部告警时建议从以下阈值开始：

- `/api/v1/health/ready` 连续 2 分钟不可用。
- `pending` outbox 事件超过 100 条或最老事件等待超过 15 分钟。
- 任一 Worker 心跳超过 2 个任务超时时间未更新。
- AI 或媒体任务系统失败率 10 分钟内超过 5%。
- 对象预览或交付归档读取失败连续出现。
- PostgreSQL、MinIO、RabbitMQ 或 Redis 容量使用率超过 80%。

告警至少应包含环境、服务名、时间窗口、错误数量、最近错误摘要和对应后台页面链接。
