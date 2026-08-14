# Video Preview and Failed Task Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate browser-compatible MP4 previews for uploaded videos and let administrators safely requeue failed submissions at the correct media or AI stage.

**Architecture:** The media worker transcodes a stable MP4 derivative and stores it privately in MinIO before committing media success. The API returns five-minute presigned preview URLs after applying existing submission visibility rules. A dedicated retry service locks failed submissions, infers the failed stage from the persisted failure code, reactivates the existing unique outbox event, and records an audit entry; the Web app consumes these contracts through a reusable player and the administrator AI queue.

**Tech Stack:** NestJS 11, TypeORM/PostgreSQL, AWS S3 SDK/MinIO, RabbitMQ outbox, FFmpeg/FFprobe, React 19, TypeScript 5.9, Vitest, Testing Library.

## Global Constraints

- Do not modify the login, session, password, or account-management behavior being developed in parallel.
- Preserve PostgreSQL as the business source of truth and MinIO as the private object store.
- Preserve the existing `(event_type, aggregate_id)` unique outbox constraint; retries reactivate rows instead of inserting duplicate events.
- Preview output is H.264 MP4, `yuv420p`, at most 1280×720 and 30 fps, with optional AAC audio and `faststart`.
- Preview URLs expire after exactly 300 seconds and are never persisted in the database or browser storage.
- Only administrators can retry failures; preview access reuses current collector/leader/administrator submission visibility.
- A retry automatically chooses `media` or `ai`; the UI never asks the administrator to choose a stage.
- Do not add HLS, historical preview backfill, thumbnails, artificial preview data, manual review persistence, settlement behavior, or external deployment.
- Preserve the existing pnpm lockfiles and do not add dependencies.

---

## Target File Structure

### Backend files created

- `backend/src/database/migrations/202608120004-video-preview-retry.ts` — adds preview and retry state to submissions.
- `backend/src/submissions/submission-retry.service.ts` — owns administrator authorization, stage inference, transactional outbox reactivation, and retry audit.
- `backend/test/submission-preview-retry.e2e-spec.ts` — verifies preview authorization and retry API behavior against PostgreSQL.

### Backend files modified

- `backend/src/database/entities/submission.entity.ts` — maps preview fields, media attempt count, and queued retry stage.
- `backend/src/database/data-source.ts` — registers migration 004.
- `backend/src/storage/object-storage.port.ts` — adds derivative upload and signed download contracts.
- `backend/src/storage/minio-object-storage.service.ts` — implements file upload and presigned GET.
- `backend/src/media/media-command-runner.ts` — adds deterministic MP4 preview generation.
- `backend/src/media/media-analysis.service.ts` — guards duplicate work, generates/uploads preview, persists preview status, increments media attempts, and reactivates AI outbox.
- `backend/src/submissions/submissions.policy.ts` — adds administrator-only retry policy.
- `backend/src/submissions/submissions.service.ts` — exposes preview metadata and creates signed preview responses.
- `backend/src/submissions/submissions.controller.ts` — adds preview and retry endpoints.
- `backend/src/submissions/submissions.module.ts` — registers retry/audit dependencies.
- `backend/src/ai-quality/ai-quality-analysis.service.ts` — clears retry stage when AI starts and preserves earlier model-run history on successful rerun.
- `backend/test/media-command-runner.spec.ts` — verifies exact FFmpeg preview command behavior.
- `backend/test/media-analysis.e2e-spec.ts` — verifies preview persistence, safe overwrite, preview failures, idempotency, and AI outbox reactivation.
- Existing `ObjectStoragePort` test doubles — implement the two new methods with explicit used/not-used behavior.

### Web files created

- `web/src/submissions/components/SubmissionVideoPlayer.tsx` — reusable signed-preview player.
- `web/src/submissions/components/SubmissionVideoPlayer.test.tsx` — player loading, playback error, and URL refresh behavior.
- `web/src/features/admin/AiQueuePage.test.tsx` — administrator retry interaction and error behavior.

### Web files modified

- `web/src/submissions/contracts.ts` — preview/retry DTO types and submission preview state.
- `web/src/submissions/client/submissionApi.ts` — preview and retry requests.
- `web/src/submissions/client/submissionApi.test.ts` — client method contracts and safe errors.
- `web/src/submissions/submissionMapper.ts` — maps preview/media-attempt fields.
- `web/src/submissions/submissionMapper.test.ts` — verifies new fields.
- `web/src/domain/types.ts` — exposes preview status and media attempts to pages.
- `web/src/features/collector/SubmissionDetail.tsx` — replaces placeholder with real player.
- `web/src/components/ReviewDrawer.tsx` — replaces placeholder with the same player.
- `web/src/features/admin/AiQueuePage.tsx` — renders real attempt counts and retry action.
- `web/app/globals.css` — styles player, fallback, and retry feedback states.
- `README.md` — documents preview creation, signed playback, automatic retry stage, and no historical backfill.

---

### Task 1: Persist Preview and Retry State

**Files:**
- Create: `backend/src/database/migrations/202608120004-video-preview-retry.ts`
- Modify: `backend/src/database/entities/submission.entity.ts`
- Modify: `backend/src/database/data-source.ts`
- Test: `backend/test/video-schema.e2e-spec.ts`

**Interfaces:**
- Produces `PreviewStatus = "pending" | "ready" | "failed"`.
- Produces `RetryStage = "media" | "ai"`.
- Adds nullable preview object/size/timestamps/error, non-negative `mediaAttempts`, and nullable `retryStage` to `SubmissionEntity`.

- [ ] **Step 1: Add a failing schema assertion**

Extend `backend/test/video-schema.e2e-spec.ts` to inspect `submissions` and assert these exact columns and defaults:

```ts
expect(columns).toEqual(expect.arrayContaining([
  expect.objectContaining({ column_name: "preview_object_key", is_nullable: "YES" }),
  expect.objectContaining({ column_name: "preview_status", column_default: "'pending'::character varying" }),
  expect.objectContaining({ column_name: "preview_size_bytes", is_nullable: "YES" }),
  expect.objectContaining({ column_name: "preview_generated_at", is_nullable: "YES" }),
  expect.objectContaining({ column_name: "preview_failure_message", is_nullable: "YES" }),
  expect.objectContaining({ column_name: "media_attempts", column_default: "0" }),
  expect.objectContaining({ column_name: "retry_stage", is_nullable: "YES" }),
]));
```

Also insert invalid `preview_status`, negative `media_attempts`, and invalid `retry_stage` values and expect PostgreSQL check-constraint failures.

- [ ] **Step 2: Run the focused schema test and confirm the new columns are absent**

Run:

```bash
cd backend
./node_modules/.bin/vitest run test/video-schema.e2e-spec.ts
```

Expected: FAIL because migration 004 and the new fields do not exist.

- [ ] **Step 3: Implement migration 004**

Create migration class `VideoPreviewRetry2026081200004` whose `up()` executes:

```sql
ALTER TABLE "submissions"
  ADD COLUMN "preview_object_key" text,
  ADD COLUMN "preview_status" varchar(16) NOT NULL DEFAULT 'pending',
  ADD COLUMN "preview_size_bytes" bigint,
  ADD COLUMN "preview_generated_at" timestamptz,
  ADD COLUMN "preview_failure_message" text,
  ADD COLUMN "media_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN "retry_stage" varchar(16),
  ADD CONSTRAINT "chk_submissions_preview_status"
    CHECK ("preview_status" IN ('pending', 'ready', 'failed')),
  ADD CONSTRAINT "chk_submissions_preview_size"
    CHECK ("preview_size_bytes" IS NULL OR "preview_size_bytes" > 0),
  ADD CONSTRAINT "chk_submissions_media_attempts"
    CHECK ("media_attempts" >= 0),
  ADD CONSTRAINT "chk_submissions_retry_stage"
    CHECK ("retry_stage" IS NULL OR "retry_stage" IN ('media', 'ai'));
```

Its `down()` drops those constraints and columns in reverse dependency order. Register it after `AiQuality2026081200003` in `createDataSource()`.

- [ ] **Step 4: Map the entity fields**

Add exported types and entity columns:

```ts
export type PreviewStatus = "pending" | "ready" | "failed";
export type RetryStage = "media" | "ai";

previewObjectKey: string | null = null;
previewStatus: PreviewStatus = "pending";
previewSizeBytes: string | null = null;
previewGeneratedAt: Date | null = null;
previewFailureMessage: string | null = null;
mediaAttempts = 0;
retryStage: RetryStage | null = null;
```

Use the exact database names from the migration.

- [ ] **Step 5: Run focused schema verification**

Run the focused test from Step 2, then:

```bash
cd backend
./node_modules/.bin/tsc --noEmit
```

Expected: both exit 0.

- [ ] **Step 6: Commit Task 1**

```bash
git add backend/src/database backend/test/video-schema.e2e-spec.ts
git commit -m "feat: persist video preview and retry state"
```

---

### Task 2: Add Object Storage and FFmpeg Preview Primitives

**Files:**
- Modify: `backend/src/storage/object-storage.port.ts`
- Modify: `backend/src/storage/minio-object-storage.service.ts`
- Modify: `backend/src/media/media-command-runner.ts`
- Modify: `backend/test/media-command-runner.spec.ts`
- Modify: every backend test double implementing `ObjectStoragePort`

**Interfaces:**
- Produces `ObjectStoragePort.putObject(...)` and `ObjectStoragePort.presignDownload(...)` exactly as defined in the design.
- Produces `MediaCommandRunner.createPreview(inputPath, outputPath): Promise<void>`.

- [ ] **Step 1: Write failing MinIO contract tests**

Add unit-level tests with a mocked S3 client/presigner, or factor command construction into exported pure helpers if direct SDK mocking is brittle. Assert:

```ts
await storage.putObject({
  objectKey: "previews/TEAM/U/SUB/preview.mp4",
  sourcePath: "/tmp/preview.mp4",
  contentType: "video/mp4",
});
```

uses `PutObjectCommand`, and:

```ts
await storage.presignDownload({
  objectKey: "previews/TEAM/U/SUB/preview.mp4",
  expiresInSeconds: 300,
  responseContentType: "video/mp4",
  responseContentDisposition: "inline",
});
```

uses `GetObjectCommand` and returns the exact expiry timestamp.

- [ ] **Step 2: Write a failing FFmpeg preview test**

Make command execution injectable or export `previewArguments(inputPath, outputPath)`. Assert the resulting arguments contain:

```ts
expect(args).toEqual(expect.arrayContaining([
  "-map", "0:v:0",
  "-map", "0:a:0?",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-preset", "veryfast",
  "-crf", "24",
  "-c:a", "aac",
  "-b:a", "128k",
  "-movflags", "+faststart",
]));
expect(args.join(" ")).toContain("force_original_aspect_ratio=decrease");
expect(args.join(" ")).toContain("force_divisible_by=2");
expect(args.join(" ")).toContain("fps=30");
```

- [ ] **Step 3: Run focused primitive tests and confirm failure**

```bash
cd backend
./node_modules/.bin/vitest run test/media-command-runner.spec.ts test/minio-object-storage.service.spec.ts
```

Expected: FAIL because the new methods and command builder do not exist.

- [ ] **Step 4: Implement MinIO derivative upload and signed GET**

Use `createReadStream` plus `stat` and `PutObjectCommand`. Reject zero-byte source files before upload. Return `{ sizeBytes: String(stats.size), etag: result.ETag }`. Use the public-endpoint client for `getSignedUrl(new GetObjectCommand(...), { expiresIn })`, setting `ResponseContentType` and `ResponseContentDisposition` from the input.

- [ ] **Step 5: Implement deterministic preview generation**

Keep the existing `run()` output bound. Add `createPreview()` with `-y`, `-hide_banner`, `-nostdin`, optional audio mapping, and this filter:

```text
scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30
```

After FFmpeg exits successfully, stat the output and reject a missing or zero-byte file. FFmpeg's default autorotation remains enabled.

- [ ] **Step 6: Update all storage and runner fakes explicitly**

Every `ObjectStoragePort` fake must implement `putObject` and `presignDownload`. Fakes not exercising those calls throw `new Error("not used")`; media analysis fakes record the uploaded preview. Every `MediaCommandRunner` fake must implement `createPreview` and write non-empty preview bytes to its requested output path.

- [ ] **Step 7: Run focused primitive tests and typecheck**

```bash
cd backend
./node_modules/.bin/vitest run test/media-command-runner.spec.ts test/minio-object-storage.service.spec.ts
./node_modules/.bin/tsc --noEmit
```

Expected: all exit 0.

- [ ] **Step 8: Commit Task 2**

```bash
git add backend/src/storage backend/src/media/media-command-runner.ts backend/test
git commit -m "feat: add browser video preview primitives"
```

---

### Task 3: Generate and Persist Preview Files in the Media Worker

**Files:**
- Modify: `backend/src/media/media-analysis.service.ts`
- Modify: `backend/src/ai-quality/ai-quality-analysis.service.ts`
- Modify: `backend/test/media-analysis.e2e-spec.ts`
- Modify: `backend/test/ai-quality-analysis.e2e-spec.ts`

**Interfaces:**
- Consumes `MediaCommandRunner.createPreview()` and `ObjectStoragePort.putObject()`.
- Produces a ready preview at `previews/{teamId}/{ownerId}/{submissionId}/preview.mp4`.
- Produces `MediaProcessOutcome = "processed" | "skipped"` so duplicate messages can be acknowledged without duplicate work.

- [ ] **Step 1: Extend the media integration test with preview assertions**

Have the fake runner write `Buffer.from("preview-mp4")`, and have storage record `putObject` calls. After processing assert:

```ts
expect(storage.puts).toEqual([
  expect.objectContaining({
    objectKey: `previews/TEAM-MEDIA/U-MEDIA/${submissionId}/preview.mp4`,
    contentType: "video/mp4",
  }),
]);
expect(submission).toMatchObject({
  processingStatus: "awaiting_ai",
  previewStatus: "ready",
  previewObjectKey: `previews/TEAM-MEDIA/U-MEDIA/${submissionId}/preview.mp4`,
  previewSizeBytes: String(Buffer.byteLength("preview-mp4")),
  mediaAttempts: 1,
  retryStage: null,
});
expect(submission.previewGeneratedAt).toBeInstanceOf(Date);
```

Add cases for:

- a second concurrent/stale delivery returns `skipped` once state is `probing` or later;
- preview transcode failure produces `MEDIA_PREVIEW_FAILED`, `previewStatus="failed"`, and no AI outbox activation;
- media retry overwrites the same object key and reactivates the existing published AI outbox row instead of inserting another row.

- [ ] **Step 2: Run the focused media integration test and confirm failure**

```bash
cd backend
./node_modules/.bin/vitest run test/media-analysis.e2e-spec.ts
```

Expected: FAIL on missing preview and attempt state.

- [ ] **Step 3: Add a transactional media begin gate**

Before downloading, lock the submission. Only `processingStatus="queued"` may transition to `probing`. Atomically increment `mediaAttempts`, clear `retryStage`, failure fields, and preview failure message, and set `previewStatus="pending"`. Return `skipped` for `probing`, `awaiting_ai`, `ai_processing`, `completed`, or unrelated failures.

- [ ] **Step 4: Generate and upload the preview**

After analysis succeeds:

```ts
const previewPath = join(directory, "preview.mp4");
await this.runner.createPreview(mediaPath, previewPath);
const previewObjectKey = `previews/${submission.teamId}/${submission.ownerId}/${submission.id}/preview.mp4`;
const preview = await this.storage.putObject({
  objectKey: previewObjectKey,
  sourcePath: previewPath,
  contentType: "video/mp4",
});
```

Wrap preview generation/upload failures in `MediaPreviewError` so they persist as `MEDIA_PREVIEW_FAILED` rather than generic media failures.

- [ ] **Step 5: Commit media state and reactivate the AI outbox**

In the existing success transaction, save preview fields and set `previewStatus="ready"`. Replace `.orIgnore()` with an explicit find-or-create operation under lock:

```ts
event.status = "pending";
event.attempts = 0;
event.availableAt = new Date();
event.publishedAt = null;
event.lastError = null;
event.payload = { submissionId };
```

Create the row only when absent. This is necessary for media reruns after the original AI outbox event was already published.

- [ ] **Step 6: Preserve AI history when a retried AI result completes**

In `AiQualityAnalysisService.begin()`, clear `submission.retryStage` when changing to `ai_processing`. In `complete()`, append new normalized runs to existing `result.modelRuns` rather than discarding older persisted runs:

```ts
result.modelRuns = [
  ...result.modelRuns,
  ...(normalized.modelRuns as Array<Record<string, unknown>>),
];
```

Add a focused assertion that an existing prior model run remains after a successful AI rerun.

- [ ] **Step 7: Run focused worker tests and typecheck**

```bash
cd backend
./node_modules/.bin/vitest run test/media-analysis.e2e-spec.ts test/ai-quality-analysis.e2e-spec.ts
./node_modules/.bin/tsc --noEmit
```

Expected: all exit 0.

- [ ] **Step 8: Commit Task 3**

```bash
git add backend/src/media backend/src/ai-quality backend/test/media-analysis.e2e-spec.ts backend/test/ai-quality-analysis.e2e-spec.ts
git commit -m "feat: generate persistent video previews"
```

---

### Task 4: Expose Secure Preview and Administrator Retry APIs

**Files:**
- Create: `backend/src/submissions/submission-retry.service.ts`
- Create: `backend/test/submission-preview-retry.e2e-spec.ts`
- Modify: `backend/src/submissions/submissions.policy.ts`
- Modify: `backend/src/submissions/submissions.service.ts`
- Modify: `backend/src/submissions/submissions.controller.ts`
- Modify: `backend/src/submissions/submissions.module.ts`

**Interfaces:**
- Produces `GET /api/v1/submissions/:id/preview` returning `{ preview: { url, expiresAt, contentType } }`.
- Produces `POST /api/v1/submissions/:id/retry` returning `{ retry: { submissionId, stage, status: "queued" } }`.
- Adds public submission fields `previewStatus`, `mediaAttempts`, and `retryStage`, but never returns `previewObjectKey`.

- [ ] **Step 1: Write preview API authorization tests**

In the new e2e suite, seed an administrator, same-team leader, owner collector, different-team collector, and a ready preview submission. Assert:

- owner, same-team leader, and administrator receive 200;
- unrelated collector receives 403;
- response has `contentType: "video/mp4"` and expiry exactly five minutes after the fake clock;
- response JSON does not contain the preview object key;
- pending preview returns `409 PREVIEW_NOT_READY`;
- failed preview returns `409 PREVIEW_FAILED`;
- ready database state with missing MinIO object returns 404.

- [ ] **Step 2: Write retry API behavior tests**

Seed published media and AI outbox rows and assert:

```ts
expect(mediaRetry.body.retry).toEqual({
  submissionId: mediaFailedId,
  stage: "media",
  status: "queued",
});
expect(aiRetry.body.retry).toEqual({
  submissionId: aiFailedId,
  stage: "ai",
  status: "queued",
});
```

Verify media retry sets `processingStatus="queued"`, `previewStatus="pending"`, `retryStage="media"`; AI retry sets `processingStatus="awaiting_ai"`, preserves preview fields, sets quality status to `queued`, clears terminal error fields, and sets `retryStage="ai"`. Both must reactivate the correct existing outbox row and create one audit row with action `submission_retry`.

Also assert 403 for leader/collector, 409 for upload/size failures, 409 for active/completed work, and that two sequential requests yield one success plus one 409 without creating duplicate rows.

- [ ] **Step 3: Run the new e2e suite and confirm failure**

```bash
cd backend
./node_modules/.bin/vitest run test/submission-preview-retry.e2e-spec.ts
```

Expected: FAIL with missing routes/services.

- [ ] **Step 4: Implement preview signing**

Add `getPreview(actor, id)` to `SubmissionsService`. Load and authorize the submission, validate preview state, use `headObject()` to ensure it still exists and is non-empty, then call:

```ts
this.storage.presignDownload({
  objectKey: submission.previewObjectKey,
  expiresInSeconds: 300,
  responseContentType: "video/mp4",
  responseContentDisposition: "inline",
});
```

Return the timestamp with `expiresAt.getTime()`.

- [ ] **Step 5: Implement retry stage inference and outbox reactivation**

Use these exact sets:

```ts
const MEDIA_RETRY_CODES = new Set([
  "MEDIA_VALIDATION_FAILED",
  "MEDIA_PROCESSING_FAILED",
  "MEDIA_PREVIEW_FAILED",
]);
const AI_RETRY_CODES = new Set(["AI_QUALITY_FAILED"]);
```

`SubmissionRetryService.retry()` performs the locked transaction described in the specification. Call `AuditService.record()` inside the same transaction with:

```ts
action: "submission_retry"
target: { id: submission.id, name: submission.originalFileName }
summary: stage === "media" ? "重新排队媒体处理" : "重新排队 AI 质检"
beforeValue: { processingStatus: "system_failed", failureCode }
afterValue: { processingStatus: nextStatus, retryStage: stage }
```

- [ ] **Step 6: Wire controllers and module dependencies**

Add `AuditModule` to `SubmissionsModule`, register `SubmissionRetryService`, and add:

```ts
@Get(":id/preview")
getPreview(...)

@Post(":id/retry")
@UseGuards(AllowedOriginGuard)
retry(...)
```

Place these routes before `@Get(":id")` for clarity. Extend `publicSubmission()` with safe preview/retry metadata only.

- [ ] **Step 7: Run focused API tests and typecheck**

```bash
cd backend
./node_modules/.bin/vitest run test/submission-preview-retry.e2e-spec.ts test/submission-upload.e2e-spec.ts
./node_modules/.bin/tsc --noEmit
```

Expected: all exit 0.

- [ ] **Step 8: Commit Task 4**

```bash
git add backend/src/submissions backend/test/submission-preview-retry.e2e-spec.ts
git commit -m "feat: expose preview and failed task retry APIs"
```

---

### Task 5: Add the Shared Signed-Preview Player

**Files:**
- Create: `web/src/submissions/components/SubmissionVideoPlayer.tsx`
- Create: `web/src/submissions/components/SubmissionVideoPlayer.test.tsx`
- Modify: `web/src/submissions/contracts.ts`
- Modify: `web/src/submissions/client/submissionApi.ts`
- Create or modify: `web/src/submissions/client/submissionApi.test.ts`
- Modify: `web/src/domain/types.ts`
- Modify: `web/src/submissions/submissionMapper.ts`
- Modify: `web/src/submissions/submissionMapper.test.ts`
- Modify: `web/src/features/collector/SubmissionDetail.tsx`
- Modify: `web/src/components/ReviewDrawer.tsx`
- Modify: `web/app/globals.css`

**Interfaces:**
- Produces `getSubmissionPreview(id): Promise<SubmissionPreview>`.
- Produces `SubmissionVideoPlayer({ submissionId, previewStatus, durationSeconds, compact? })`.

- [ ] **Step 1: Write failing API-client tests**

Mock fetch and assert `getSubmissionPreview("SUB/01")` calls:

```ts
expect(fetch).toHaveBeenCalledWith(
  "http://localhost:4000/api/v1/submissions/SUB%2F01/preview",
  expect.objectContaining({ credentials: "include" }),
);
```

Assert numeric `expiresAt` and `contentType="video/mp4"` are returned, and `PREVIEW_NOT_READY` remains available through `SubmissionApiError.code`.

- [ ] **Step 2: Write failing player component tests**

Mock `getSubmissionPreview`. Assert:

- ready state renders `<video controls preload="metadata" playsinline>` with the signed URL;
- pending state shows “预览正在生成” without calling the API;
- failed state shows “预览生成失败” and no video;
- API failure shows a retry button;
- dispatching a video `error` event shows “播放地址可能已过期”; clicking “重新加载” calls the API again and renders the replacement URL.

- [ ] **Step 3: Run the focused Web tests and confirm failure**

```bash
cd web
./node_modules/.bin/vitest run src/submissions/client/submissionApi.test.ts src/submissions/components/SubmissionVideoPlayer.test.tsx src/submissions/submissionMapper.test.ts
```

Expected: FAIL because contracts, client method, fields, and player are absent.

- [ ] **Step 4: Add Web contracts and mapping**

Add:

```ts
export type BackendPreviewStatus = "pending" | "ready" | "failed";
export type SubmissionPreview = {
  url: string;
  expiresAt: number;
  contentType: "video/mp4";
};
export type RetryStage = "media" | "ai";
```

Extend `BackendSubmission` and domain `Submission` with `previewStatus`, `mediaAttempts`, and optional `retryStage`. Default legacy/demo records to `previewStatus="pending"` and `mediaAttempts=0` in the mapper.

- [ ] **Step 5: Implement the client and player**

Use the existing `requestJson` helper for the preview call. In the player, request only when `previewStatus="ready"`; store URL in component state only; reset state before reload. Render:

```tsx
<video
  controls
  playsInline
  preload="metadata"
  src={preview.url}
  onError={() => setPlaybackFailed(true)}
/>
```

Do not add `autoPlay`. Include accessible loading/status text and a button named “重新加载”.

- [ ] **Step 6: Replace both preview placeholders**

Use the component in `SubmissionDetail` with full layout and in `ReviewDrawer` with `compact`. Preserve file metadata and duration text outside the video controls. Do not change the review form behavior.

- [ ] **Step 7: Add responsive player styling**

Give the video `width:100%`, `height:100%`, `object-fit:contain`, a black background, and at least the current detail/drawer minimum heights. Keep fallback buttons keyboard-focusable and ensure the compact drawer player does not overflow horizontally.

- [ ] **Step 8: Run focused Web tests and typecheck**

```bash
cd web
./node_modules/.bin/vitest run src/submissions/client/submissionApi.test.ts src/submissions/components/SubmissionVideoPlayer.test.tsx src/submissions/submissionMapper.test.ts src/features/review/reviewFlow.test.tsx
./node_modules/.bin/tsc --noEmit
```

Expected: all exit 0.

- [ ] **Step 9: Commit Task 5**

```bash
git add web/src/submissions web/src/domain/types.ts web/src/features/collector/SubmissionDetail.tsx web/src/components/ReviewDrawer.tsx web/app/globals.css
git commit -m "feat: play signed video previews"
```

---

### Task 6: Add Administrator Retry Interaction

**Files:**
- Modify: `web/src/submissions/contracts.ts`
- Modify: `web/src/submissions/client/submissionApi.ts`
- Modify: `web/src/submissions/client/submissionApi.test.ts`
- Modify: `web/src/features/admin/AiQueuePage.tsx`
- Create: `web/src/features/admin/AiQueuePage.test.tsx`
- Modify: `web/app/globals.css`

**Interfaces:**
- Produces `retryFailedSubmission(id): Promise<RetryResult>`.
- Consumes backend `failureCode`, `mediaAttempts`, AI attempts, and retry response stage.

- [ ] **Step 1: Write failing retry client tests**

Assert:

```ts
await retryFailedSubmission("SUB-FAILED");
expect(fetch).toHaveBeenCalledWith(
  "http://localhost:4000/api/v1/submissions/SUB-FAILED/retry",
  expect.objectContaining({ method: "POST", credentials: "include" }),
);
```

Verify the returned `stage` and `status`, plus safe propagation of `RETRY_NOT_ALLOWED`.

- [ ] **Step 2: Write failing AI queue interaction tests**

Render the administrator queue with one media failure, one AI failure, one completed submission, and one active submission. Assert only the two failed rows have “重跑” buttons. Click the media failure and assert:

- the client is called exactly once;
- the button is disabled while pending;
- success text reads “媒体处理已重新排队”;
- a second click is unavailable;
- a rejected request displays the safe API message.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
cd web
./node_modules/.bin/vitest run src/submissions/client/submissionApi.test.ts src/features/admin/AiQueuePage.test.tsx
```

Expected: FAIL because retry client/UI do not exist.

- [ ] **Step 4: Implement retry client and eligibility helper**

Add exact recoverable codes to a shared constant in `submissionApi.ts` or the page module:

```ts
export const RETRYABLE_FAILURE_CODES = new Set([
  "MEDIA_VALIDATION_FAILED",
  "MEDIA_PROCESSING_FAILED",
  "MEDIA_PREVIEW_FAILED",
  "AI_QUALITY_FAILED",
]);
```

Only show the button when processing status is failed/system-failed and the persisted failure code belongs to this set.

- [ ] **Step 5: Implement row-scoped retry state**

Keep maps/sets keyed by submission ID for pending, queued stage, and error. The success label uses the returned stage. Render attempts as `媒体 {mediaAttempts} / AI {qualityResult?.attempts ?? 0}`. Do not mutate `DemoStore`, because the result is persisted and the next page refresh is authoritative.

- [ ] **Step 6: Run focused tests, typecheck, and lint the changed surface**

```bash
cd web
./node_modules/.bin/vitest run src/submissions/client/submissionApi.test.ts src/features/admin/AiQueuePage.test.tsx
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/submissions src/features/admin/AiQueuePage.tsx
```

Expected: all exit 0 with no new warnings.

- [ ] **Step 7: Commit Task 6**

```bash
git add web/src/submissions web/src/features/admin/AiQueuePage.tsx web/src/features/admin/AiQueuePage.test.tsx web/app/globals.css
git commit -m "feat: retry failed video tasks from admin queue"
```

---

### Task 7: Document and Verify the End-to-End Feature

**Files:**
- Modify: `README.md`
- Modify only if required by implementation: `compose.yaml`

**Interfaces:**
- Documents the exact preview and retry behavior delivered by Tasks 1–6.

- [ ] **Step 1: Update local operation documentation**

Document:

- media worker creates private 720p H.264/AAC MP4 previews;
- preview signing lasts five minutes;
- historical completed submissions need a media retry or future backfill before preview becomes available;
- administrator retry automatically selects media or AI based on failure code;
- upload-aborted, size-mismatch, and missing-original failures require a new upload;
- retry audit and separate media/AI attempt counts are retained.

- [ ] **Step 2: Run backend focused and regression verification**

```bash
cd backend
./node_modules/.bin/vitest run \
  test/video-schema.e2e-spec.ts \
  test/media-command-runner.spec.ts \
  test/minio-object-storage.service.spec.ts \
  test/media-analysis.e2e-spec.ts \
  test/ai-quality-analysis.e2e-spec.ts \
  test/submission-preview-retry.e2e-spec.ts \
  test/submission-upload.e2e-spec.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/nest build
```

Expected: all exit 0. If PostgreSQL/MinIO infrastructure is unavailable, start only the documented local dependencies and rerun; do not report success from partial output.

- [ ] **Step 3: Run Web focused and regression verification**

```bash
cd web
./node_modules/.bin/vitest run \
  src/submissions/client/submissionApi.test.ts \
  src/submissions/components/SubmissionVideoPlayer.test.tsx \
  src/submissions/submissionMapper.test.ts \
  src/features/admin/AiQueuePage.test.tsx \
  src/features/review/reviewFlow.test.tsx
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/submissions src/features/admin/AiQueuePage.tsx src/features/collector/SubmissionDetail.tsx src/components/ReviewDrawer.tsx
pnpm build
```

Expected: all exit 0 with no new warnings.

- [ ] **Step 4: Perform a local MP4 and MOV smoke flow**

With the local stack running, upload one MP4 with audio and one MOV without audio. Verify each reaches a terminal AI state, each detail page plays its MP4 preview, and each signed preview request has a five-minute expiry. Force or seed one media failure and one AI failure, use the administrator queue to retry them, and verify the media retry regenerates preview while the AI retry leaves preview metadata unchanged.

- [ ] **Step 5: Inspect final scope and repository state**

```bash
git status --short
git diff --check
git log --oneline -10
```

Confirm only preview/retry files and approved documentation changed, and no login/account files were modified.

- [ ] **Step 6: Commit documentation or final integration adjustments**

```bash
git add README.md compose.yaml
git commit -m "docs: explain video preview and retry operations"
```

Skip `compose.yaml` in `git add` when no implementation change was required.
