# Phase 2 Video Ingestion and Media Processing Plan

> **Execution requirement:** Follow test-driven development and verify each focused test before moving to the next task.

**Goal:** Replace the browser-only upload simulation with PostgreSQL submissions, direct multipart upload to MinIO, durable RabbitMQ media jobs, and real FFprobe/FFmpeg metadata and invalid-segment analysis while preserving the current Web interface.

**Architecture:** NestJS owns upload sessions, visibility rules, submission state, and an outbox. Browsers upload file parts directly to MinIO using short-lived presigned URLs. A RabbitMQ publisher drains committed outbox rows. A separate media worker downloads one object to an isolated temporary directory, runs FFprobe and FFmpeg, persists metadata and invalid intervals, then moves the submission to `awaiting_ai`. PostgreSQL remains authoritative; queue delivery is at-least-once and every worker operation is idempotent.

**Tech Stack:** NestJS 11, TypeORM 1.1, PostgreSQL 17, MinIO/S3 multipart API, RabbitMQ 4, FFprobe/FFmpeg, React 19, Vitest 4.

## Global Constraints

- Do not call or simulate an AI model in phase 2.
- Do not create fake AI scores or label test fixtures as AI output.
- Keep all media, API, and queue endpoints local-only.
- Accept MP4 and MOV only, up to 2 GiB per file.
- Validate owner/team permissions in the API; browser visibility is not a security boundary.
- Use multipart upload with 16 MiB parts and presigned URLs that expire in 15 minutes.
- Require an expected byte size and SHA-256 checksum when creating an upload.
- Never trust client-reported media metadata.
- Normal task waiting remains potentially valid; phase 2 only detects technical invalid intervals such as black frames and frozen video.
- Jobs are at-least-once and idempotent. A duplicate delivery must not duplicate metadata or intervals.
- Temporary media files must use a per-job temporary directory and be removed after success or failure.
- Preserve D1 as a read-only migration artifact.

## Task 1: Add the Submission and Job Schema

**Files:**
- Create `backend/src/database/entities/submission.entity.ts`
- Create `backend/src/database/entities/media-metadata.entity.ts`
- Create `backend/src/database/entities/media-segment.entity.ts`
- Create `backend/src/database/entities/job-outbox.entity.ts`
- Create `backend/src/database/migrations/202608070002-video-ingestion.ts`
- Modify `backend/src/database/data-source.ts`
- Create `backend/test/video-schema.e2e-spec.ts`

**Contract:**
- `submissions.upload_status`: `created | uploading | uploaded | aborted`
- `submissions.processing_status`: `uploading | queued | probing | awaiting_ai | completed | system_failed`
- `submissions.is_test_data` explicitly marks fabricated records.
- Metadata and detected intervals are replaced transactionally per media-processing attempt.
- One submission has at most one active MinIO multipart upload.
- One committed upload creates one unique `media.probe.v1` outbox event.

## Task 2: Implement MinIO Multipart Upload

**Files:**
- Create `backend/src/storage/object-storage.port.ts`
- Create `backend/src/storage/minio-object-storage.service.ts`
- Create `backend/src/storage/storage.module.ts`
- Create `backend/src/submissions/dto/upload.dto.ts`
- Create `backend/src/submissions/submissions.policy.ts`
- Create `backend/src/submissions/submissions.service.ts`
- Create `backend/src/submissions/submissions.controller.ts`
- Create `backend/src/submissions/submissions.module.ts`
- Create `backend/test/submission-upload.e2e-spec.ts`

**Contract:**
- `POST /api/v1/submissions/uploads`
- `POST /api/v1/submissions/:id/uploads/parts`
- `POST /api/v1/submissions/:id/uploads/complete`
- `DELETE /api/v1/submissions/:id/uploads`
- `GET /api/v1/submissions`
- `GET /api/v1/submissions/:id`
- Collector sees self, leader sees own team, administrator sees all.
- Completing the multipart upload verifies object size before committing the outbox event.

## Task 3: Publish Durable RabbitMQ Jobs

**Files:**
- Create `backend/src/messaging/message-bus.port.ts`
- Create `backend/src/messaging/rabbitmq-message-bus.service.ts`
- Create `backend/src/messaging/outbox-publisher.service.ts`
- Create `backend/src/messaging/messaging.module.ts`
- Create `backend/src/cli/publish-outbox.ts`
- Create `backend/test/outbox-publisher.spec.ts`

**Contract:**
- Durable topic exchange `evdp.events`.
- Durable queue `evdp.media.probe.v1`.
- Routing key `media.probe.v1`.
- Publisher confirms are required before marking an outbox row published.
- Failed publishes retain the row and increment attempts with exponential backoff.

## Task 4: Implement the Real Media Worker

**Files:**
- Create `backend/src/media/media-command-runner.ts`
- Create `backend/src/media/media-analysis.service.ts`
- Create `backend/src/media/media-worker.ts`
- Create `backend/test/media-command-runner.spec.ts`
- Create `backend/test/media-analysis.e2e-spec.ts`

**Contract:**
- FFprobe extracts duration, dimensions, average frame rate, codec, bitrate, and byte size.
- FFmpeg detects black intervals and frozen intervals.
- Intervals are normalized, clipped to video duration, and merged when overlapping.
- Successful processing writes metadata and intervals, sets `awaiting_ai`, and acknowledges the message.
- Retryable failures reject for bounded retry; terminal failures set `system_failed`.
- Duplicate processing replaces the previous media result rather than appending duplicates.

## Task 5: Switch the Web Upload and Submission Lists

**Files:**
- Create `web/src/submissions/client/submissionApi.ts`
- Create `web/src/submissions/server/submissionBackendClient.ts`
- Create `web/src/submissions/upload/multipartUploader.ts`
- Modify `web/src/features/collector/UploadPage.tsx`
- Modify `web/src/features/collector/SubmissionsPage.tsx`
- Modify `web/src/features/team/TeamSubmissionsPage.tsx`
- Modify `web/src/features/admin/SubmissionsAdminPage.tsx`
- Modify `web/src/features/collector/SubmissionDetail.tsx`
- Modify `web/src/data/DemoStoreContext.tsx`
- Modify `web/app/[[...slug]]/page.tsx`
- Add focused browser-client and component tests.

**Contract:**
- Hash the selected file locally before upload.
- Upload at most three parts concurrently.
- Display real per-file progress and explicit failure/retry state.
- Refresh submission data from the NestJS API after completion.
- Remove `DemoStore.addUploads` from the live upload path.
- Keep quality/settlement demo state only until phases 3 and 4 replace it.

## Task 6: Seed and Verify Clearly Marked Test Video Records

**Files:**
- Create `backend/src/cli/seed-video-test-data.ts`
- Create `backend/test/seed-video-test-data.spec.ts`
- Modify `README.md`
- Modify `compose.yaml`

**Contract:**
- Create six `is_test_data=true` records across two teams only when those IDs are absent.
- Include uploaded, queued, probing, awaiting-AI, and system-failed examples.
- Populate real-shaped metadata fixtures, but leave AI score fields absent.
- Document local upload limits, media-worker start, test-data seed, and safe shutdown.
- Verify PostgreSQL counts, MinIO object existence, RabbitMQ delivery, Web upload, and role-filtered lists.

