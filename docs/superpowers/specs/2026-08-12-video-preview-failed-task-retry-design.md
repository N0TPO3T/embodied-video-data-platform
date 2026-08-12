# 视频预览与失败任务重跑设计

- 日期：2026-08-12
- 状态：用户已确认方案，待规格复核
- 范围：为现有视频上传、媒体处理和 AI 质检主链路增加浏览器兼容预览，以及管理员按失败阶段自动重跑

## 1. 目标

本次交付解决两个已经阻塞人工查看和故障处置的问题：

1. 浏览器可以稳定播放系统生成的兼容 MP4 预览，不依赖原始 MOV、HEVC 或其他浏览器兼容性不稳定的编码。
2. 管理员可以在 AI 任务页面重跑失败任务，系统根据失败发生在媒体阶段还是 AI 阶段自动选择最小重跑范围。

本次不修改登录和账号模块，不实现人工复核写回、近似重复检测、结算、提现或交付包。

## 2. 已确认的产品行为

### 2.1 视频预览

- 媒体 Worker 下载并校验原视频后，在媒体分析流程中生成一份浏览器兼容的 MP4 派生文件。
- 预览文件使用 H.264 视频、`yuv420p` 像素格式、最大 1280×720、最大 30 fps，并启用 `faststart`。
- 原视频存在音轨时将音频转为 AAC；不存在音轨时生成无音轨预览，不把无音频视为失败。
- 保持原始宽高比，不放大低分辨率视频，不旋转或裁剪内容。
- 预览对象使用由提交 ID 派生的稳定对象键；同一视频重跑媒体阶段时覆盖该预览对象。
- 原视频仍是事实来源，预览文件只用于网页播放，不替代原始资产。
- 新上传视频和媒体阶段重跑的视频生成预览；本次不批量回填所有历史完成视频。

### 2.2 预览访问

- 前端通过 `GET /api/v1/submissions/:id/preview` 获取短时有效的 MinIO 签名地址。
- 签名有效期固定为 5 分钟；前端不持久化该地址。
- 后端在签名前复用现有视频读取权限：数采人员只能访问自己的视频，团长只能访问本团队视频，管理员可以访问全部视频。
- 只有 `preview_status=ready` 且预览对象仍存在时返回地址。
- 预览尚未生成时返回 `409 PREVIEW_NOT_READY`；预览生成失败时返回 `409 PREVIEW_FAILED`；视频或对象不存在时返回 `404`。
- `<video>` 播放失败或签名过期时，播放器提供“重新加载”操作，重新请求签名地址。

### 2.3 失败任务重跑

- 管理员通过 `POST /api/v1/submissions/:id/retry` 发起重跑。
- 只有管理员可以调用；数采人员和团长收到 `403`。
- 系统依据持久化失败码自动选择阶段，不让管理员手动选择：
  - `MEDIA_VALIDATION_FAILED`、`MEDIA_PROCESSING_FAILED`、`MEDIA_PREVIEW_FAILED`：重跑媒体分析和预览生成，成功后正常继续 AI。
  - `AI_QUALITY_FAILED`：保留媒体元数据、无效区间和预览文件，只重跑 AI 质检。
- 以下失败不能重跑：`UPLOAD_ABORTED`、`OBJECT_SIZE_MISMATCH`、原始对象不存在、上传未完成。接口返回 `409 RETRY_NOT_ALLOWED`，提示重新上传。
- 正在上传、排队、处理中或已经完成的视频不能重跑。
- 重复点击必须幂等：同一提交同一时刻最多存在一个待发布或执行中的重跑任务。

## 3. 数据模型

### 3.1 `submissions` 扩展字段

新增以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `preview_object_key` | `text null` | 兼容 MP4 在 MinIO 中的对象键 |
| `preview_status` | `varchar(16)` | `pending`、`ready` 或 `failed` |
| `preview_size_bytes` | `bigint null` | 预览对象大小 |
| `preview_generated_at` | `timestamptz null` | 最近一次成功生成时间 |
| `preview_failure_message` | `text null` | 最近一次预览失败的脱敏错误 |
| `media_attempts` | `integer not null default 0` | 媒体 Worker 实际开始处理的次数 |
| `retry_stage` | `varchar(16) null` | 管理员最近一次发起的 `media` 或 `ai` 重跑阶段；任务开始后清空 |

`preview_status` 使用数据库约束限制取值。`media_attempts` 每次媒体 Worker 获得任务并开始处理时原子递增；AI 尝试次数继续使用 `video_quality_results.attempts`。

### 3.2 可靠消息复用

当前 `job_outbox` 对 `(event_type, aggregate_id)` 有唯一约束，因此管理员重跑不插入第二条相同事件。重跑事务锁定提交和对应 outbox 行，并将原有事件重新激活：

- `status = pending`
- `attempts = 0`
- `available_at = now()`
- `published_at = null`
- `last_error = null`
- `payload` 更新为当前提交 ID

`job_outbox.attempts` 只代表消息发布尝试，不代表 Worker 业务尝试；业务尝试分别读取 `submissions.media_attempts` 和 `video_quality_results.attempts`。

## 4. 媒体处理设计

### 4.1 媒体命令边界

扩展媒体命令接口，使分析和预览生成保持两个明确方法：

```ts
interface MediaCommandRunner {
  analyze(filePath: string): Promise<MediaCommandResult>;
  createPreview(inputPath: string, outputPath: string): Promise<void>;
}
```

预览转码使用等价于以下约束的 FFmpeg 参数：

```text
-map 0:v:0
-map 0:a:0?
-vf scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease,
    fps=fps='min(30,source_fps)'
-c:v libx264
-pix_fmt yuv420p
-preset veryfast
-crf 24
-c:a aac
-b:a 128k
-movflags +faststart
```

实现可以采用与上述等价、且能正确处理奇数宽高与旋转元数据的滤镜表达式，但不得放大或裁剪视频。

### 4.2 对象存储边界

扩展 `ObjectStoragePort`：

```ts
putObject(input: {
  objectKey: string;
  sourcePath: string;
  contentType: string;
}): Promise<{ sizeBytes: string; etag?: string }>;

presignDownload(input: {
  objectKey: string;
  expiresInSeconds: number;
  responseContentType?: string;
  responseContentDisposition?: string;
}): Promise<{ url: string; expiresAt: Date }>;
```

预览对象键固定为：

```text
previews/{teamId}/{ownerId}/{submissionId}/preview.mp4
```

### 4.3 一致性和失败处理

媒体 Worker 的顺序为：

```text
下载原视频
→ 校验 SHA-256
→ FFprobe/FFmpeg 分析
→ 生成本地 preview.mp4
→ 上传/覆盖 MinIO 预览对象
→ 校验预览对象大小
→ 同一数据库事务写入媒体结果、预览状态并创建/激活 AI outbox
```

- 只有预览对象上传成功且对象大小大于 0，媒体阶段才完成。
- 转码或预览上传失败统一记录 `MEDIA_PREVIEW_FAILED`，`preview_status=failed`，提交进入 `system_failed`。
- 媒体重跑开始时将 `preview_status` 设为 `pending`，清除预览失败信息，但暂不删除已有预览对象；只有新对象成功覆盖后才更新数据库。
- 如果数据库事务在预览上传后失败，固定对象键允许下次重跑安全覆盖孤立派生对象。
- 媒体重跑成功后复用并重新激活 `ai.quality.v1` outbox；已有非终态 AI 结果重新排队，已有失败结果保留模型运行历史并增加下一次尝试。

## 5. 重跑服务设计

新增独立的 `SubmissionRetryService`，避免继续扩大上传服务职责。其输入与输出为：

```ts
retry(actor: PublicUser, submissionId: string): Promise<{
  submissionId: string;
  stage: "media" | "ai";
  status: "queued";
}>;
```

事务内处理步骤：

1. 验证管理员角色。
2. 对提交行加写锁。
3. 验证 `upload_status=uploaded`、`processing_status=system_failed`。
4. 使用失败码决定阶段。
5. 锁定并重新激活对应 outbox 行。
6. 媒体重跑将提交改为 `queued`、预览改为 `pending`；AI 重跑将提交改为 `awaiting_ai`，并把质量结果状态改为 `queued`、清除当前终态错误，但保留模型运行历史和累计尝试次数。
7. 写入 `retry_stage`，提交任务开始后由 Worker 清空。
8. 在同一事务写入审计日志，记录失败码、所选阶段和发起人。

Worker 开始处理时再次检查当前状态。重复 RabbitMQ 消息依靠现有数据库状态和锁防止并行执行；AI Worker继续使用 PostgreSQL advisory lock。

## 6. API 契约

### 6.1 获取预览地址

```http
GET /api/v1/submissions/:id/preview
```

成功响应：

```json
{
  "preview": {
    "url": "http://localhost:9000/...",
    "expiresAt": 1786489200000,
    "contentType": "video/mp4"
  }
}
```

该接口是读取操作，不使用来源校验 Guard；仍要求有效会话和视频读取权限。

### 6.2 重跑失败任务

```http
POST /api/v1/submissions/:id/retry
```

成功响应：

```json
{
  "retry": {
    "submissionId": "SUB-...",
    "stage": "ai",
    "status": "queued"
  }
}
```

该接口要求有效会话、管理员角色和来源校验 Guard。

## 7. Web 设计

### 7.1 共用播放器

新增 `SubmissionVideoPlayer`：

- 首次进入可见区域时请求预览地址；不在服务端 HTML 中嵌入签名 URL。
- 使用原生 `<video controls preload="metadata" playsInline>`。
- 不自动播放。
- 加载中显示明确占位；未生成、生成失败和地址过期分别显示对应提示。
- “重新加载”会丢弃旧地址并请求新地址。
- 组件卸载时移除当前 URL 引用，不写入浏览器持久存储。

播放器接入数采视频详情和团长/管理员共用复核抽屉。

### 7.2 AI 任务重跑

AI 任务页为 `processing_status=system_failed` 且失败码可重跑的行显示“重跑”按钮。

- 点击期间禁用按钮并显示“正在排队”。
- 成功后在本地更新该提交的处理阶段和失败信息，按钮变为“已重新排队”。
- 后续刷新从后端读取真实状态。
- `RETRY_NOT_ALLOWED` 显示后端安全提示；其他错误显示通用失败提示。
- 非管理员页面不提供重跑入口。

## 8. 权限与安全

- 预览桶继续保持私有，不提供永久公共 URL。
- 签名 URL 只指向预览对象，不暴露原始视频对象键。
- API 返回的提交 DTO 不包含任何 MinIO 对象键。
- 重跑仅管理员可执行，并记录审计。
- 所有返回给前端的 FFmpeg、MinIO 和 RabbitMQ 错误均使用既有安全错误消息，不暴露凭据、内部地址或本地临时路径。
- 不把签名 URL、原始对象键或凭据写入审计日志。

## 9. 验收标准

### 9.1 视频预览

- MP4 和 MOV 上传完成后均生成可由 Chrome/Safari 播放的 MP4 预览。
- 有音轨和无音轨视频均可完成处理。
- 竖屏、横屏、低于 720p 和高于 720p 的视频保持正确比例；低分辨率不放大。
- 数采、团长、管理员只能按既有范围获取预览地址。
- 签名过期后重新加载可获得新地址。
- 预览失败不会产生假的 ready 状态，并可由管理员媒体重跑恢复。

### 9.2 失败任务重跑

- 媒体失败自动排入媒体队列，成功后继续 AI。
- AI 失败只排入 AI 队列，不重复媒体分析或预览转码。
- 连续点击不会创建重复任务。
- 上传类不可恢复失败返回明确的不可重跑响应。
- 已完成、排队中和执行中任务不能被重跑。
- 每次管理员重跑均有审计记录，媒体和 AI 尝试次数可分别查看。

## 10. 非目标与后续工作

- 不生成 HLS、多码率或自适应码流。
- 不为历史完成视频执行自动批量补预览。
- 不在本次增加缩略图、证据片段下载或视频编辑。
- 不在本次实现管理员指定模型或提示词版本重跑。
- 不在本次实现人工质量结果写回。
- 不部署或发布到外部环境；当前项目继续按本地 Docker Compose 方式运行。
