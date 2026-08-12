# AI Quality Lab Persistent History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist 30 days of AI quality-lab tasks and expose task-scoped, redacted Bailian request diagnostics with stable task IDs across refreshes and restarts.

**Architecture:** Extend the in-memory job store with an atomic JSON snapshot and a Docker named volume. Route provider attempt diagnostics to the owning task, expose history through the existing local API, and hydrate the existing page from that API.

**Tech Stack:** Node.js 22, TypeScript, Express, Vitest, Docker Compose, atomic JSON file replacement.

## Global Constraints

- Do not persist video files, extracted frames, API keys, request bodies, Authorization headers, Data URLs, or full model responses.
- Retain terminal task metadata for 30 days.
- Preserve the existing single-concurrency queue and V1 quality rules.
- Automated tests must not call Bailian.

---

### Task 1: Persistent job store

**Files:**
- Modify: `backend/src/quality-lab/environment.ts`
- Modify: `backend/src/quality-lab/job-store.ts`
- Create: `backend/test/quality-lab-job-store.spec.ts`

- [ ] Write failing tests for save/reload, startup interruption recovery, 30-day expiry, diagnostics and deletion.
- [ ] Add the configurable persistence path and 30-day retention.
- [ ] Atomically persist safe public task records and restore them at startup.
- [ ] Run the focused store tests and typecheck.

### Task 2: Request diagnostics

**Files:**
- Modify: `backend/src/video-quality/qwen-video-quality.provider.ts`
- Modify: `backend/test/qwen-video-quality-provider.spec.ts`
- Modify: `backend/src/quality-lab/main.ts`

- [ ] Write failing tests for success, HTTP error and network error attempt diagnostics.
- [ ] Emit redacted attempt records for Flash, Plus and repair calls.
- [ ] Connect the provider sink to persistent task history and structured stdout logs.
- [ ] Run provider tests and typecheck.

### Task 3: History API and page restoration

**Files:**
- Modify: `backend/src/quality-lab/server.ts`
- Modify: `backend/src/quality-lab/page.ts`
- Modify: `backend/test/quality-lab-server.spec.ts`
- Modify: `backend/test/quality-lab-page.spec.ts`

- [ ] Write failing API and HTML tests for history, stable IDs and terminal deletion.
- [ ] Add history listing, deletion and lifecycle logging.
- [ ] Hydrate page state from history and show task IDs in queue/results/downloads.
- [ ] Run all quality-lab tests and typecheck.

### Task 4: Packaging and verification

**Files:**
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `README.md`

- [ ] Add safe persistence configuration and a named Docker volume.
- [ ] Document 30-day history and diagnostic privacy boundaries.
- [ ] Run the full backend tests, typecheck, build, Docker config, rebuild and health check.
