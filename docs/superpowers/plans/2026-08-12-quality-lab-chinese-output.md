# AI 视频质检中文输出实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保证 AI 视频质检面向用户的自然语言结果均为简体中文，并保持原有 JSON 接口兼容。

**Architecture:** 模型请求与系统提示词共同声明中文约束；Provider 在结构校验后执行中文字段门禁并复用一次修复调用；页面仅翻译技术枚举的展示值。原始字段名、枚举和原因代码不变。

**Tech Stack:** TypeScript、NestJS 独立质检服务、Vitest、百炼 OpenAI 兼容接口、原生 HTML/JavaScript。

## Global Constraints

- 所有面向用户的自然语言字段使用简体中文。
- `video_qc_result_v1` 的字段名、枚举值、原因代码和版本号保持不变。
- 英文结果最多触发一次模型修复调用。
- 不修改评分、否决和结算规则。

---

### Task 1: 模型中文输出约束与门禁

**Files:**
- Modify: `docs/quality/qwen-video-ai-quality-prompt-v1.md`
- Modify: `backend/src/video-quality/qwen-video-quality.provider.ts`
- Test: `backend/test/video-quality-prompt-loader.spec.ts`
- Test: `backend/test/qwen-video-quality-provider.spec.ts`

**Interfaces:**
- Consumes: `RawVideoQcResultV1` 和现有一次修复调用链路。
- Produces: 仅包含简体中文自然语言字段的模型结果，技术枚举保持原值。

- [ ] **Step 1: 编写失败测试**

断言系统提示词与请求要求包含简体中文约束，并构造英文摘要使首次响应进入修复调用。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `pnpm --dir backend exec vitest run test/video-quality-prompt-loader.spec.ts test/qwen-video-quality-provider.spec.ts`

Expected: 中文约束或英文修复断言失败。

- [ ] **Step 3: 实现中文提示词与字段检查**

新增中文字段路径收集器；在 `parseRawVideoQcResult` 后检查非空自然语言值是否包含 `\u3400-\u9fff` 中文字符，不符合时抛出 `VideoQcSchemaError` 进入现有修复分支。

- [ ] **Step 4: 运行定向测试确认通过**

Run: `pnpm --dir backend exec vitest run test/video-quality-prompt-loader.spec.ts test/qwen-video-quality-provider.spec.ts`

Expected: 两个测试文件全部通过。

### Task 2: 页面技术枚举中文化

**Files:**
- Modify: `backend/src/quality-lab/page.ts`
- Test: `backend/test/quality-lab-page.spec.ts`

**Interfaces:**
- Consumes: 原始 `evaluationStatus`、`reason_code` 和 `severity`。
- Produces: 中文状态、中文原因与中文严重程度展示；导出 JSON 保持原值。

- [ ] **Step 1: 编写失败测试**

断言生成页面包含 `evaluationStatusLabels`、`reasonLabels`、`severityLabels`，且评估状态和扣分列表通过映射函数展示。

- [ ] **Step 2: 运行页面测试确认失败**

Run: `pnpm --dir backend exec vitest run test/quality-lab-page.spec.ts`

Expected: 中文映射断言失败。

- [ ] **Step 3: 实现展示映射**

添加固定映射并以“中文原因 · 时间范围 · 中文严重程度 · 中文描述”渲染；未知原因统一显示“其他质量问题”，原始代码仍保留在详情 JSON。

- [ ] **Step 4: 运行页面测试确认通过**

Run: `pnpm --dir backend exec vitest run test/quality-lab-page.spec.ts`

Expected: 页面测试全部通过。

### Task 3: 完整验证并发布到 main

**Files:**
- Verify: repository working tree and Docker Compose configuration

**Interfaces:**
- Consumes: 当前功能分支的完整项目改动。
- Produces: GitHub `main` 上经过验证的完整项目代码。

- [ ] **Step 1: 运行完整验证**

Run: `pnpm --dir backend test && pnpm --dir backend typecheck && pnpm --dir backend build`

Expected: 所有测试、类型检查与构建通过。

- [ ] **Step 2: 检查安全与提交范围**

确认 `.env`、`Data/`、`outputs/`、`.superpowers/`、临时缓存和 API Key 未进入 Git；源码、测试、配置、正式文档与维护脚本进入提交。

- [ ] **Step 3: 提交并合并**

提交当前分支，更新本地 `main`，把功能分支合并到 `main`，在合并后的 `main` 再运行完整测试。

- [ ] **Step 4: 推送**

Run: `git push origin main`

Expected: GitHub `main` 指向本地验证通过的合并提交。

