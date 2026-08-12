# AI 视频质检 Qwen3.7 模型路由实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI 视频质检默认初审切换为 `qwen3.7-plus`、条件复核切换为 `qwen3.7-flash`，并把运行阶段改成与模型档位无关的名称。

**Architecture:** 保留现有媒体预处理、百炼 OpenAI 兼容 Provider、结构化 JSON、中文门禁和规则引擎，只替换模型配置与业务阶段类型。新任务写入 `initial_review` / `secondary_review` 与 `initial` / `review`，读取和页面展示继续兼容旧 `flash_review` / `plus_review` 与 `flash` / `plus` 历史值。

**Tech Stack:** TypeScript、Vitest、NestJS 独立质检服务、百炼 OpenAI 兼容 Chat Completions、Docker Compose。

## Global Constraints

- 初审默认模型必须为 `qwen3.7-plus`。
- 条件复核默认模型必须为 `qwen3.7-flash`。
- 不修改 `video_qc_v1` 评分、硬性否决、计费和结算规则。
- 不修改多帧输入、中文结果门禁、重试次数或复核阈值。
- 新任务不得写入 `flash_review`、`plus_review`、`flash` 或 `plus` 阶段值。
- 已持久化的旧阶段与诊断必须继续可读、可展示。
- 不通过真实视频付费调用验证。

---

### Task 1: 默认模型配置与文档

**Files:**
- Modify: `.env.example`
- Modify: `.env`（本地忽略文件，不提交）
- Modify: `backend/src/quality-lab/environment.ts`
- Modify: `docs/quality/qwen-video-ai-quality-prompt-v1.md`
- Modify: `docs/quality/video-ai-quality-scoring-v1.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-12-ai-quality-main-flow-design.md`
- Test: `backend/test/video-quality-prompt-loader.spec.ts`
- Test: `backend/test/quality-lab-server.spec.ts`

**Interfaces:**
- Consumes: `VIDEO_QUALITY_INITIAL_MODEL`、`VIDEO_QUALITY_REVIEW_MODEL` 和提示词模型元数据。
- Produces: 默认 `initialModel="qwen3.7-plus"`、`reviewModel="qwen3.7-flash"`，运行配置与文档一致。

- [ ] **Step 1: 更新测试期望并确认失败**

将提示词加载测试和质量实验环境测试中的默认模型断言改为：

```ts
expect(prompt.initialModel).toBe("qwen3.7-plus");
expect(prompt.reviewModel).toBe("qwen3.7-flash");
```

Run: `pnpm --dir backend exec vitest run test/video-quality-prompt-loader.spec.ts test/quality-lab-server.spec.ts`

Expected: 旧默认模型导致断言失败。

- [ ] **Step 2: 更新配置和正式文档**

把所有当前运行说明和默认配置更新为 `qwen3.7-plus` 初审、`qwen3.7-flash` 复核；历史实施计划中的旧模型记录保持不改，避免改写历史决策文档。

- [ ] **Step 3: 运行定向测试**

Run: `pnpm --dir backend exec vitest run test/video-quality-prompt-loader.spec.ts test/quality-lab-server.spec.ts`

Expected: 两个测试文件全部通过。

### Task 2: 模型无关的业务阶段

**Files:**
- Modify: `backend/src/video-quality/video-quality.types.ts`
- Modify: `backend/src/video-quality/video-quality.service.ts`
- Modify: `backend/src/video-quality/qwen-video-quality.provider.ts`
- Test: `backend/test/video-quality-service.spec.ts`
- Test: `backend/test/qwen-video-quality-provider.spec.ts`

**Interfaces:**
- Consumes: `QualityStage`、`ModelRunMetadata.stage`、`BailianCallDiagnostic.modelStage`。
- Produces: 新任务阶段 `initial_review` / `secondary_review`，新模型元数据阶段 `initial` / `review`；类型继续接受旧历史值。

- [ ] **Step 1: 更新测试期望并确认失败**

质量服务进度应为：

```ts
["media_analysis", "initial_review", "secondary_review", "completed"]
```

Provider 初审请求断言 `qwen3.7-plus` 和 `metadata.stage === "initial"`；复核请求断言 `qwen3.7-flash` 和 `metadata.stage === "review"`。

Run: `pnpm --dir backend exec vitest run test/video-quality-service.spec.ts test/qwen-video-quality-provider.spec.ts`

Expected: 旧阶段或旧模型断言失败。

- [ ] **Step 2: 实现新阶段并保留旧类型兼容**

`QualityStage` 同时包含新旧业务阶段；Provider 的内部 `stage` 只写入 `initial` / `review`，诊断类型允许读取旧 `flash` / `plus`。将复核原因中的“Flash”改为“初审模型”，复核失败中的“Plus”改为“复核模型”。

- [ ] **Step 3: 运行定向测试**

Run: `pnpm --dir backend exec vitest run test/video-quality-service.spec.ts test/qwen-video-quality-provider.spec.ts`

Expected: 两个测试文件全部通过，Provider 请求体模型 ID 与新配置一致。

### Task 3: 页面与持久化历史兼容

**Files:**
- Modify: `backend/src/quality-lab/page.ts`
- Test: `backend/test/quality-lab-page.spec.ts`
- Test: `backend/test/quality-lab-job-store.spec.ts`

**Interfaces:**
- Consumes: 新旧 `QualityStage` 和新旧 `BailianCallDiagnostic.modelStage`。
- Produces: 新阶段显示“初审”“复核”，旧阶段显示“初审（历史）”“复核（历史）”，所有状态仍可恢复。

- [ ] **Step 1: 更新页面测试并确认失败**

断言页面包含：

```ts
expect(html).toContain('initial_review:"初审"');
expect(html).toContain('secondary_review:"复核"');
expect(html).toContain('flash_review:"初审（历史）"');
expect(html).toContain('plus_review:"复核（历史）"');
```

Run: `pnpm --dir backend exec vitest run test/quality-lab-page.spec.ts test/quality-lab-job-store.spec.ts`

Expected: 页面新阶段断言失败。

- [ ] **Step 2: 更新页面活动阶段与标签**

把 `initial_review`、`secondary_review` 纳入活动状态；保留旧阶段标签，避免 30 天历史显示英文代码。

- [ ] **Step 3: 运行定向测试**

Run: `pnpm --dir backend exec vitest run test/quality-lab-page.spec.ts test/quality-lab-job-store.spec.ts`

Expected: 页面与持久化测试全部通过。

### Task 4: 完整验证与本地服务更新

**Files:**
- Verify: all modified source, tests, configuration, and documentation

**Interfaces:**
- Consumes: 完整 Qwen3.7 模型路由改动。
- Produces: 可构建、可启动、模型健康状态显示准确的质检服务。

- [ ] **Step 1: 运行完整自动验证**

Run: `pnpm --dir backend test && pnpm --dir backend typecheck && pnpm --dir backend build`

Expected: 全部后端测试、类型检查和构建通过。

- [ ] **Step 2: 验证工作空间模型可用性**

读取百炼工作空间 `/models`，确认精确包含 `qwen3.7-plus` 和 `qwen3.7-flash`，且不打印 API Key。

- [ ] **Step 3: 重建并检查本地服务**

Run: `docker compose --profile ai-test build ai-quality-lab && docker compose --profile ai-test up -d --force-recreate ai-quality-lab`

Expected: `/api/health` 返回 `initialModel=qwen3.7-plus`、`reviewModel=qwen3.7-flash`，容器健康。

- [ ] **Step 4: 安全与差异检查**

Run: `git diff --check`

Expected: 无代码空白错误；`.env` 与 API Key 不在待提交差异中。
