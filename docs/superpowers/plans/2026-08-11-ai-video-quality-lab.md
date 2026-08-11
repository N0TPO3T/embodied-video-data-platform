# AI Video Quality Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a localhost-only, database-free AI video quality lab that queues local uploads, calls the fixed Bailian Qwen video models with the existing V1 prompt, revalidates results with the existing V1 scoring rules, and exposes a reusable core for the future AI worker.

**Architecture:** A standalone Express process serves both a small browser UI and an in-memory job API. Reusable modules under `backend/src/video-quality/` handle prompt loading, input construction, Qwen calls, FFmpeg preprocessing, schema validation, and deterministic rule recomputation; the experiment-only HTTP/job layer lives under `backend/src/quality-lab/`.

**Tech Stack:** Node.js 22, TypeScript 5.9, Express 5, Multer 2, Zod 4, Vitest 4, FFmpeg/FFprobe, Docker Compose, Alibaba Cloud Model Studio OpenAI-compatible Chat Completions.

## Global Constraints

- `docs/quality/qwen-video-ai-quality-prompt-v1.md` and `docs/quality/video-ai-quality-scoring-v1.md` are the only scoring and prompt sources of truth.
- Use `qwen3-vl-flash-2026-01-22` for initial review and `qwen3-vl-plus-2025-12-19` for rule-triggered review.
- Do not implement the obsolete 60-point pass/fail behavior.
- In lab cold-start mode, pass authoritative inventory and uniqueness coefficients of `1.00`; never ask the model to invent inventory or similarity facts.
- Listen on `127.0.0.1` by default and keep the API key server-only.
- Stream uploads to per-job temporary directories, limit each video to 1 GiB, and clean temporary files on every terminal path.
- Keep browser processing concurrency at exactly one.
- Automated tests must never call Bailian; one explicit smoke command may call the smallest sample video.
- Preserve all unrelated working-tree changes and stage only files belonging to the current task.

---

### Task 1: Versioned configuration and prompt loading

**Files:**
- Create: `backend/src/video-quality/video-quality.types.ts`
- Create: `backend/src/video-quality/prompt-loader.ts`
- Create: `backend/test/video-quality-prompt-loader.spec.ts`
- Modify: `.env.example`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `VideoQualityModelConfig`, `VideoQcInputV1`, `RawVideoQcResultV1`, `NormalizedVideoQcResultV1` types.
- Produces: `loadVideoQualityPrompt(path: string): Promise<LoadedVideoQualityPrompt>`.
- `LoadedVideoQualityPrompt` contains `systemPrompt`, `promptVersion`, `ruleVersion`, `initialModel`, `reviewModel`, and `contentSha256`.

- [ ] **Step 1: Add direct runtime dependencies and the quality-lab scripts**

Add `multer@^2`, `zod@^4`, and `@types/multer@^2`. Add scripts:

```json
{
  "quality:lab": "node dist/quality-lab/main.js",
  "quality:lab:dev": "tsx src/quality-lab/main.ts",
  "quality:smoke": "tsx src/cli/smoke-video-quality.ts"
}
```

- [ ] **Step 2: Write failing prompt-loader tests**

Cover the real prompt file and malformed temporary Markdown:

```ts
expect(prompt.promptVersion).toBe("qwen_video_qc_prompt_v1");
expect(prompt.ruleVersion).toBe("video_qc_v1");
expect(prompt.initialModel).toBe("qwen3-vl-flash-2026-01-22");
expect(prompt.reviewModel).toBe("qwen3-vl-plus-2025-12-19");
expect(prompt.systemPrompt).toContain("具身视频数据质量评估器");
await expect(loadVideoQualityPrompt(malformedPath)).rejects.toThrow("系统提示词");
```

- [ ] **Step 3: Run the focused test and verify failure**

Run: `pnpm --dir backend test -- video-quality-prompt-loader.spec.ts`

Expected: FAIL because `prompt-loader.ts` does not exist.

- [ ] **Step 4: Implement exact Markdown parsing and content hashing**

Parse anchored metadata lines and only the fenced block immediately following `## 系统提示词`:

```ts
export type LoadedVideoQualityPrompt = {
  systemPrompt: string;
  promptVersion: string;
  ruleVersion: string;
  initialModel: string;
  reviewModel: string;
  contentSha256: string;
};

export async function loadVideoQualityPrompt(path: string): Promise<LoadedVideoQualityPrompt>;
```

Reject missing/duplicate metadata, an empty system prompt, and unsupported `video_qc_v1`/`video_qc_result_v1` versions.

- [ ] **Step 5: Add non-secret configuration examples**

Add these names to `.env.example` with the exact safe defaults:

```dotenv
QWEN_API_KEY=
QWEN_BASE_URL=https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
VIDEO_QUALITY_PROMPT_PATH=/quality/qwen-video-ai-quality-prompt-v1.md
VIDEO_QUALITY_INITIAL_MODEL=qwen3-vl-flash-2026-01-22
VIDEO_QUALITY_REVIEW_MODEL=qwen3-vl-plus-2025-12-19
QUALITY_LAB_HOST=127.0.0.1
QUALITY_LAB_PORT=4010
QUALITY_LAB_MAX_UPLOAD_BYTES=1073741824
QUALITY_LAB_MODEL_TIMEOUT_MS=600000
```

- [ ] **Step 6: Run focused tests, typecheck, and commit**

Run:

```bash
pnpm --dir backend test -- video-quality-prompt-loader.spec.ts
pnpm --dir backend typecheck
```

Expected: both commands pass.

Commit only Task 1 files with message `feat: load versioned video quality prompt`.

### Task 2: V1 input builder, result schema, and deterministic rule engine

**Files:**
- Create: `backend/src/video-quality/video-qc-schema.ts`
- Create: `backend/src/video-quality/video-qc-input.ts`
- Create: `backend/src/video-quality/video-qc-rule-engine.ts`
- Create: `backend/test/video-qc-input.spec.ts`
- Create: `backend/test/video-qc-rule-engine.spec.ts`

**Interfaces:**
- Consumes: types from `video-quality.types.ts`.
- Produces: `buildVideoQcInput(input: BuildVideoQcInput): VideoQcInputV1`.
- Produces: `parseRawVideoQcResult(value: unknown): RawVideoQcResultV1`.
- Produces: `normalizeVideoQcResult(input: NormalizeVideoQcInput): NormalizedVideoQcResultV1`.

- [ ] **Step 1: Write failing input-builder tests**

Assert explicit cold-start authority and no invented task metadata:

```ts
expect(input.inventory_context).toMatchObject({
  mode: "cold_start",
  authoritative_coefficient: 1,
  current_video_excluded: true,
});
expect(input.similarity_context.authoritative_coefficient).toBe(1);
expect(input.similarity_context.file_hash_exact).toBe(true);
expect(input.task_context.submitted_task_name).toBe("");
```

- [ ] **Step 2: Write failing rule-engine boundary tests**

Cover exact score bands and hard-reject precedence:

```ts
expect(normalize(scoredAt(80)).settlementRatio).toBe(1);
expect(normalize(scoredAt(60)).settlementRatio).toBe(0.8);
expect(normalize(scoredAt(40)).settlementRatio).toBe(0.6);
expect(normalize(scoredAt(39.9)).settlementRatio).toBe(0.4);
expect(normalize(hardRejectAt(88)).settlementRatio).toBe(0);
expect(normalize(reviewPendingAt(88)).settlementRatio).toBeNull();
```

Also cover coefficient clamping rejection, score recomputation, one-decimal rounding after the unrounded sum, evidence timestamps, interval clipping/union, billable duration, and duplicate `reason_code` across dimensions.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --dir backend test -- video-qc-input.spec.ts video-qc-rule-engine.spec.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the Zod result schema**

Define all fixed keys from `video_qc_result_v1`. Make issue intervals, evidence timestamps, coefficients, scores, confidence, billing candidates, review flags, and missing inputs explicit. Use `.passthrough()` only for segment-level model observations so future prompt additions do not discard evidence.

```ts
export const rawVideoQcResultSchema = z.object({
  schema_version: z.literal("video_qc_result_v1"),
  rule_version: z.literal("video_qc_v1"),
  prompt_version: z.literal("qwen_video_qc_prompt_v1"),
  evaluation_status: z.enum(["scored", "hard_reject", "incomplete_input", "review_pending"]),
  dimensions: dimensionsSchema,
  raw_total_score: z.number().finite(),
  final_score: z.number().finite(),
  review_required: z.boolean(),
}).strict();
```

- [ ] **Step 5: Implement cold-start input construction**

Build all template fields, use media/detector values from preprocessing, set both authoritative cold-start coefficients to `1`, set exact duplicate only from SHA-256 batch state, and include unavailable deterministic fields in `missing_inputs` instead of fabricating healthy values.

- [ ] **Step 6: Implement server-side normalization**

For dimension coefficients `c1..c5`, compute unrounded scores as `20 * c`, expose one-decimal dimension scores, sum unrounded values, then round the final score once. Clip and union invalid intervals before computing:

```ts
invalidDurationMs = unionDuration([...detectorWindows, ...semanticWindows]);
billableDurationMs = Math.max(0, analysisDurationMs - invalidDurationMs);
settlementRatio = status === "hard_reject"
  ? 0
  : status === "scored"
    ? scoreBand(finalScore)
    : null;
```

Return model values separately from normalized values, plus `validationWarnings` and `validationErrors`. A critical validation error makes the result non-settleable.

- [ ] **Step 7: Run tests, typecheck, and commit**

Run:

```bash
pnpm --dir backend test -- video-qc-input.spec.ts video-qc-rule-engine.spec.ts
pnpm --dir backend typecheck
```

Expected: pass.

Commit Task 2 files with message `feat: validate video quality scoring rules`.

### Task 3: Bailian Qwen provider with retries and review calls

**Files:**
- Create: `backend/src/video-quality/qwen-video-quality.provider.ts`
- Create: `backend/test/qwen-video-quality-provider.spec.ts`

**Interfaces:**
- Consumes: `LoadedVideoQualityPrompt`, `VideoQcInputV1`, and timestamped JPEG frames.
- Produces: `QwenVideoQualityProvider.analyze(request, signal): Promise<ModelRunResult>`.
- Produces: `QwenVideoQualityProvider.review(request, signal): Promise<ModelRunResult>`.

- [ ] **Step 1: Write failing provider tests with mocked `fetch`**

Assert the exact endpoint and server-only authentication:

```ts
expect(url).toBe(`${baseUrl}/chat/completions`);
expect(init.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` });
expect(body.model).toBe("qwen3-vl-flash-2026-01-22");
expect(body.enable_thinking).toBe(false);
expect(body.response_format).toEqual({ type: "json_object" });
expect(body.messages[1].content[0].type).toBe("video");
expect(JSON.stringify(result)).not.toContain(apiKey);
```

Cover 429/5xx retry twice, no retry for 401/404, timeout/abort, fenced JSON extraction, one same-model schema repair, request ID extraction, and Plus using only controversy frames plus the initial structured result.

- [ ] **Step 2: Run the provider test and verify failure**

Run: `pnpm --dir backend test -- qwen-video-quality-provider.spec.ts`

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: Implement OpenAI-compatible requests**

Use this content shape:

```ts
messages: [
  { role: "system", content: prompt.systemPrompt },
  {
    role: "user",
    content: [
      { type: "video", video: frames.map((frame) => frame.dataUrl) },
      { type: "text", text: JSON.stringify(videoQcInput) },
    ],
  },
]
```

Normalize the base URL once, attach an `AbortSignal.timeout(modelTimeoutMs)`, combine it with the caller signal, and redact response bodies in thrown authentication errors.

- [ ] **Step 4: Implement retry classification and JSON repair**

Retry only network failures, 429, and 5xx with delays `500 ms` and `1500 ms`. For a 2xx response whose message content is not valid `video_qc_result_v1`, send one correction request to the same model containing the invalid output and the compact validation error list.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run:

```bash
pnpm --dir backend test -- qwen-video-quality-provider.spec.ts
pnpm --dir backend typecheck
```

Expected: pass.

Commit Task 3 files with message `feat: call Bailian video quality models`.

### Task 4: FFmpeg preprocessing and timestamped frame extraction

**Files:**
- Create: `backend/src/video-quality/media-preprocessor.ts`
- Create: `backend/test/video-quality-media-preprocessor.spec.ts`
- Reuse: `backend/src/media/media-command-runner.ts`

**Interfaces:**
- Produces: `VideoQualityMediaPreprocessor.prepare(filePath, workDir, signal): Promise<PreparedVideoEvidence>`.
- Produces: `VideoQualityMediaPreprocessor.extractReviewFrames(filePath, windows, workDir, signal): Promise<TimestampedFrame[]>`.
- `PreparedVideoEvidence` contains metadata, detector windows, technical ratios, SHA-256, full-video frames, actual sampling FPS, and missing metrics.

- [ ] **Step 1: Write failing parser and command-runner tests**

Use fixture stdout/stderr to cover rotation-aware display size, nominal FPS, black/freeze windows, signalstats exposure ratios, blurdetect ratio, command abort, and timestamps for `fps=0.2` frames. Assert a short clip still produces at least four frames.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --dir backend test -- video-quality-media-preprocessor.spec.ts`

Expected: FAIL because `media-preprocessor.ts` does not exist.

- [ ] **Step 3: Implement safe process execution**

Spawn only fixed `ffprobe`/`ffmpeg` executables with argument arrays. Never interpolate file names into a shell command. Cap captured output, kill the child on abort, and include only the final 2,000 stderr characters in non-sensitive errors.

- [ ] **Step 4: Implement metadata and deterministic detectors**

Use FFprobe JSON for stream/container data, existing black/freeze parsing where applicable, `signalstats` for under/overexposure sampling, and `blurdetect` for sampled blur. Report unsupported or unavailable metrics in `missingMetrics`.

- [ ] **Step 5: Implement frame extraction**

Extract full-video JPEGs at `fps=0.2`, scaled to at most 960 pixels on the long side. If duration would yield fewer than four frames, raise sampling just enough to create four frames. For review windows, clip each range to 10–60 seconds and use `fps=1` by default, increasing to `fps=2` only for sub-20-second windows.

- [ ] **Step 6: Run tests, typecheck, and commit**

Run:

```bash
pnpm --dir backend test -- video-quality-media-preprocessor.spec.ts
pnpm --dir backend typecheck
```

Expected: pass.

Commit Task 4 files with message `feat: prepare local video evidence for Qwen`.

### Task 5: Reusable orchestration and in-memory quality-lab API

**Files:**
- Create: `backend/src/video-quality/video-quality.service.ts`
- Create: `backend/src/quality-lab/environment.ts`
- Create: `backend/src/quality-lab/job-store.ts`
- Create: `backend/src/quality-lab/server.ts`
- Create: `backend/src/quality-lab/main.ts`
- Create: `backend/test/video-quality-service.spec.ts`
- Create: `backend/test/quality-lab-server.spec.ts`

**Interfaces:**
- Consumes: preprocessor, prompt loader, provider, input builder, and rule engine.
- Produces: `VideoQualityService.evaluate(request, observer, signal): Promise<NormalizedVideoQcResultV1>`.
- Produces HTTP endpoints `POST /api/jobs`, `GET /api/jobs/:id`, `DELETE /api/jobs/:id`, and `GET /api/health`.

- [ ] **Step 1: Write failing service orchestration tests**

With fake preprocessor/provider, assert stages run in order, Flash always runs, Plus runs only when the V1 review predicates match, a Plus failure returns `review_pending`, exact batch duplicate state reaches the input builder, and cleanup runs after success/failure/abort.

- [ ] **Step 2: Write failing HTTP tests**

Post a small fixture using multipart form data and assert:

```ts
expect(create.status).toBe(202);
expect(create.body.jobId).toMatch(/^LAB-/);
expect((await request(app).get(`/api/jobs/${jobId}`)).body.stage).toBeDefined();
expect((await request(app).delete(`/api/jobs/${jobId}`)).status).toBe(202);
```

Cover MIME/extension rejection, 1 GiB Multer limit configuration, localhost defaults, missing key health state, server-side file paths never returned, and job-result TTL cleanup.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --dir backend test -- video-quality-service.spec.ts quality-lab-server.spec.ts`

Expected: FAIL because the service and server do not exist.

- [ ] **Step 4: Implement orchestration with explicit progress callbacks**

Use these stages:

```ts
type QualityStage =
  | "queued"
  | "uploading"
  | "media_analysis"
  | "flash_review"
  | "plus_review"
  | "completed"
  | "review_pending"
  | "system_failed"
  | "cancelled";
```

Pass detector output as authority, construct cold-start snapshots, validate/normalize after each model call, and select controversy windows only from low-confidence dimensions, hard-veto candidates, detector conflicts, and deduction evidence.

- [ ] **Step 5: Implement the in-memory job store and HTTP API**

Use `crypto.randomUUID()` identifiers, one AbortController per running job, a one-hour terminal-result TTL, and a batch map of SHA-256 values. Multer writes directly into a `mkdtemp()` directory. Start evaluation after returning `202`, poll through `GET`, and redact all internal paths/errors before responses.

- [ ] **Step 6: Run tests, typecheck, and commit**

Run:

```bash
pnpm --dir backend test -- video-quality-service.spec.ts quality-lab-server.spec.ts
pnpm --dir backend typecheck
```

Expected: pass.

Commit Task 5 files with message `feat: add standalone video quality lab API`.

### Task 6: Local upload and result page

**Files:**
- Create: `backend/src/quality-lab/page.ts`
- Create: `backend/test/quality-lab-page.spec.ts`
- Modify: `backend/src/quality-lab/server.ts`

**Interfaces:**
- Produces: `renderQualityLabPage(): string` served by `GET /`.
- Consumes the job API from Task 5.

- [ ] **Step 1: Write failing static-page tests**

Assert the page has a multiple video input, drag/drop target, queue/result regions, no API-key input, no pass/fail copy, JSON download controls, and client code that waits for one terminal job before starting the next.

- [ ] **Step 2: Run the page test and verify failure**

Run: `pnpm --dir backend test -- quality-lab-page.spec.ts`

Expected: FAIL because `page.ts` does not exist.

- [ ] **Step 3: Implement the self-contained page**

Return semantic HTML with embedded CSS and browser JavaScript. Maintain this client state:

```js
const state = {
  batchId: crypto.randomUUID(),
  queue: [],
  running: false,
  results: [],
};
```

Upload with `FormData`, poll once per second, continue after one file fails, cancel queued items locally, call `DELETE` for the active item, format milliseconds as `hh:mm:ss`, and create JSON downloads with `Blob` URLs that are revoked after click.

- [ ] **Step 4: Render V1-specific results**

Show final score, settlement ratio, evaluation status, five dimension scores/confidence, hard-veto reasons, detected task summary, analysis/invalid/billable duration, deductions with time ranges/evidence, recommendations, versions, request IDs, sampling metadata, validation messages, and a collapsible raw response. Never render user-provided strings with `innerHTML`; build text nodes or escape before interpolation.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run:

```bash
pnpm --dir backend test -- quality-lab-page.spec.ts quality-lab-server.spec.ts
pnpm --dir backend typecheck
```

Expected: pass.

Commit Task 6 files with message `feat: add local AI video quality test page`.

### Task 7: Docker packaging, documentation, and verification

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `compose.yaml`
- Create: `backend/src/cli/smoke-video-quality.ts`
- Modify: `README.md`
- Modify: `.env` locally only; do not stage it
- Test: all backend tests and Docker health checks

**Interfaces:**
- Produces Docker target and Compose service `ai-quality-lab` under profile `ai-test`.
- Produces explicit smoke command that evaluates one supplied path and never scans a directory.

- [ ] **Step 1: Add the Docker target and isolated Compose service**

Add this target:

```dockerfile
FROM runtime-base AS ai-quality-lab
RUN apk add --no-cache ffmpeg
CMD ["node", "dist/quality-lab/main.js"]
```

Add a profile-gated service with no dependencies:

```yaml
ai-quality-lab:
  profiles: ["ai-test"]
  build:
    context: ./backend
    target: ai-quality-lab
  env_file: [.env]
  environment:
    QUALITY_LAB_HOST: 0.0.0.0
    VIDEO_QUALITY_PROMPT_PATH: /quality/qwen-video-ai-quality-prompt-v1.md
  ports: ["127.0.0.1:4010:4010"]
  volumes: ["./docs/quality:/quality:ro"]
```

- [ ] **Step 2: Add the explicit one-file smoke CLI**

Require an exact file argument and a `--confirm-paid-call` flag:

```bash
pnpm --dir backend quality:smoke -- ../Data/file/27622_60.mp4 --confirm-paid-call
```

Reject directories, missing confirmation, and missing credentials. Print only normalized score/status/model/request IDs and never raw headers or API keys.

- [ ] **Step 3: Configure the provided credential locally**

Set the provided key only in ignored `.env`. Set:

```dotenv
QWEN_BASE_URL=https://ws-mockz25ij4gwi2tn.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
```

Do not put the real API key in this plan, examples, tests, commits, logs, or final response.

- [ ] **Step 4: Document start and safety behavior**

Add the exact local workflow to `README.md`:

```bash
docker compose --profile ai-test up --build ai-quality-lab
```

Document `http://localhost:4010`, single concurrency, ephemeral results, cold-start D5 behavior, model billing, JSON export, and post-test key rotation.

- [ ] **Step 5: Run the full automated verification**

Run:

```bash
pnpm --dir backend test
pnpm --dir backend typecheck
pnpm --dir backend build
docker compose config --quiet
docker compose --profile ai-test build ai-quality-lab
```

Expected: all commands exit 0 and no real model call occurs.

- [ ] **Step 6: Start the lab and verify locally**

Run the profile service, poll `http://127.0.0.1:4010/api/health`, open the page, and verify upload controls render. Do not enqueue all sample videos.

- [ ] **Step 7: Execute one paid smoke call**

Run only `Data/file/27622_60.mp4`. Verify the fixed Flash snapshot accepts frame-array video input, the response validates, server recomputation completes, the result is visible/downloadable, and the temporary directory disappears.

If the model rejects frame-array input or the fixed snapshot is unavailable, stop and report the exact non-secret API error. Do not substitute a different model, public tunnel, OSS upload, or third-party file host.

- [ ] **Step 8: Run final security and scope checks**

Run:

```bash
git diff --check
git status --short
rg -n "sk-ws-|Authorization: Bearer sk-|60.*通过|低于 60" backend compose.yaml README.md .env.example
```

Expected: no secret match, no obsolete pass/fail implementation, and only intended files changed.

- [ ] **Step 9: Commit packaging and documentation**

Stage only Task 7 source/config/docs files, excluding `.env`, and commit with message `chore: package the AI video quality lab`.
