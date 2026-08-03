# Embodied Video Data Platform Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished, responsive, clickable React demonstration of the embodied video data platform covering the public site, unified login, collector, team leader, and administrator experiences.

**Architecture:** Use a client-side React application with role-aware routes and a shared dashboard shell. Domain rules stay in pure TypeScript modules, while a single in-memory demo store exposes the same query-and-command shape that a future API adapter can implement.

**Tech Stack:** React, TypeScript, Vite, React Router, Vitest, Testing Library, Recharts, Lucide React, CSS custom properties.

## Global Constraints

- The application is a clickable front-end demonstration and does not connect to real authentication, storage, AI inference, settlement, payment, or withdrawal services.
- The three roles are `collector`, `leader`, and `admin`.
- Supported upload extensions are `.mov` and `.mp4`.
- A quality score below 60 fails; 60–69 maps to 0.7, 70–79 maps to 0.85, and 80–100 maps to 1.0.
- Estimated income equals member unit price multiplied by effective billable duration multiplied by quality coefficient.
- Team leaders may only review their own team's unsettled submissions.
- Administrators may review all unsettled submissions.
- Settled submissions are immutable in the quality review flow.
- The demo must be usable on desktop and mobile.
- User-facing product copy is Simplified Chinese.

---

### Task 0: Connect the Empty GitHub Repository

**Files:**
- Existing: `具身智能数据外包平台-一期技术总需求文档.md`
- Existing: `具身智能数据外包平台-总体方案与待确认事项.md`
- Existing: `docs/superpowers/specs/2026-07-28-embodied-data-outsourcing-platform-design.md`
- Existing: `docs/superpowers/specs/2026-08-03-clickable-platform-framework-design.md`
- Existing: `docs/superpowers/plans/2026-08-03-clickable-platform-framework.md`

**Interfaces:**
- Consumes: Empty remote repository `https://github.com/owoTomCat/embodied-video-data-platform`.
- Produces: Local `main` branch with `origin` configured and the approved documents committed.

- [ ] **Step 1: Initialize the current workspace and configure the remote**

Run:

```bash
git init
git branch -M main
git remote add origin https://github.com/owoTomCat/embodied-video-data-platform.git
```

Expected: `git remote -v` shows the provided GitHub repository for fetch and push.

- [ ] **Step 2: Commit the approved requirements, design, and implementation plan**

Run:

```bash
git add '*.md' docs
git commit -m "docs: define embodied video data platform"
```

Expected: the initial commit contains the requirement baseline, approved clickable-framework design, and this implementation plan.

- [ ] **Step 3: Push the initial documentation commit**

Run:

```bash
git push -u origin main
```

Expected: the remote `main` branch points at the local documentation commit.

### Task 1: Tooling, Domain Types, and Business Calculations

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.setup.ts`
- Create: `.gitignore`
- Create: `src/domain/types.ts`
- Create: `src/domain/calculations.ts`
- Test: `src/domain/calculations.test.ts`

**Interfaces:**
- Produces: `Role`, `Submission`, `QualityStatus`, `SettlementStatus`, `Withdrawal`, `qualityCoefficient(score)`, `qualityStatus(score)`, `effectiveDuration(duration, invalidSeconds)`, `estimateIncome(unitPricePerMinute, durationSeconds, invalidSeconds, score)`, and `validateWithdrawal(amount, availableBalance, minimumAmount)`.
- Consumes: No application code.

- [ ] **Step 1: Add the test runner configuration and failing calculation tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  effectiveDuration,
  estimateIncome,
  qualityCoefficient,
  qualityStatus,
  validateWithdrawal,
} from './calculations';

describe('quality calculations', () => {
  it.each([
    [59, 0],
    [60, 0.7],
    [70, 0.85],
    [80, 1],
    [100, 1],
  ])('maps score %s to coefficient %s', (score, coefficient) => {
    expect(qualityCoefficient(score)).toBe(coefficient);
  });

  it('uses score 60 as the passing boundary', () => {
    expect(qualityStatus(59)).toBe('failed');
    expect(qualityStatus(60)).toBe('passed');
  });

  it('never returns a negative effective duration', () => {
    expect(effectiveDuration(90, 120)).toBe(0);
  });

  it('calculates income by price, effective minutes, and coefficient', () => {
    expect(estimateIncome(12, 120, 30, 75)).toBe(15.3);
  });
});

describe('withdrawal validation', () => {
  it('rejects amounts below the minimum and above the balance', () => {
    expect(validateWithdrawal(80, 500, 100)).toEqual({
      valid: false,
      message: '最低提现金额为 ¥100',
    });
    expect(validateWithdrawal(600, 500, 100)).toEqual({
      valid: false,
      message: '提现金额不能超过可用余额',
    });
  });
});
```

- [ ] **Step 2: Install dependencies and run the tests to verify RED**

Run:

```bash
pnpm install
pnpm test --run src/domain/calculations.test.ts
```

Expected: the suite fails because `src/domain/calculations.ts` does not exist.

- [ ] **Step 3: Implement the exact domain contracts and pure calculation functions**

```ts
export type Role = 'collector' | 'leader' | 'admin';
export type QualityStatus = 'pending' | 'passed' | 'failed';
export type SettlementStatus = 'unsettled' | 'settled';

export function qualityCoefficient(score: number): number {
  if (score < 60) return 0;
  if (score < 70) return 0.7;
  if (score < 80) return 0.85;
  return 1;
}

export function qualityStatus(score: number): QualityStatus {
  return score >= 60 ? 'passed' : 'failed';
}

export function effectiveDuration(duration: number, invalidSeconds: number): number {
  return Math.max(0, duration - invalidSeconds);
}

export function estimateIncome(
  unitPricePerMinute: number,
  durationSeconds: number,
  invalidSeconds: number,
  score: number,
): number {
  const amount =
    unitPricePerMinute *
    (effectiveDuration(durationSeconds, invalidSeconds) / 60) *
    qualityCoefficient(score);
  return Math.round(amount * 100) / 100;
}
```

- [ ] **Step 4: Run tests and type checking to verify GREEN**

Run:

```bash
pnpm test --run src/domain/calculations.test.ts
pnpm typecheck
```

Expected: all calculation tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit the domain foundation**

```bash
git add package.json pnpm-lock.yaml index.html tsconfig*.json vite.config.ts vitest.setup.ts .gitignore src/domain
git commit -m "feat: establish platform domain foundation"
```

### Task 2: In-Memory Demo Store and State Transitions

**Files:**
- Create: `src/data/demoData.ts`
- Create: `src/data/DemoStore.tsx`
- Test: `src/data/demoStore.test.tsx`

**Interfaces:**
- Consumes: `Role`, `Submission`, `Withdrawal`, `qualityStatus`, and `estimateIncome` from Task 1.
- Produces: `DemoStoreProvider`, `useDemoStore()`, `loginAs(role)`, `logout()`, `addUploads(files)`, `advanceProcessing(id)`, `adjustQuality(id, score, reason)`, `requestWithdrawal(amount)`, and `reviewWithdrawal(id, decision)`.

- [ ] **Step 1: Write failing tests for role scope and mutable demo workflows**

```tsx
it('prevents a leader from adjusting another team submission', () => {
  const store = createDemoStore(seedData);
  store.loginAs('leader');
  expect(() => store.adjustQuality('SUB-OTHER-01', 82, '复核通过')).toThrow(
    '无权调整该团队数据',
  );
});

it('preserves the AI score while saving the adjusted final score', () => {
  const store = createDemoStore(seedData);
  store.loginAs('admin');
  store.adjustQuality('SUB-001', 88, '画面稳定，调整评分');
  const updated = store.getSubmission('SUB-001');
  expect(updated.aiScore).toBe(76);
  expect(updated.finalScore).toBe(88);
  expect(updated.audit.at(-1)?.reason).toBe('画面稳定，调整评分');
});

it('rejects quality changes after settlement', () => {
  const store = createDemoStore(seedData);
  store.loginAs('admin');
  expect(() => store.adjustQuality('SUB-SETTLED-01', 90, '修改')).toThrow(
    '已结算数据不可修改',
  );
});
```

- [ ] **Step 2: Run store tests to verify RED**

Run:

```bash
pnpm test --run src/data/demoStore.test.tsx
```

Expected: tests fail because the demo store API does not exist.

- [ ] **Step 3: Implement deterministic seed data and the store commands**

The seed data must include at least:

```ts
{
  users: [
    { id: 'U-COL-01', name: '林晓雨', role: 'collector', teamId: 'TEAM-01' },
    { id: 'U-LEAD-01', name: '周明远', role: 'leader', teamId: 'TEAM-01' },
    { id: 'U-ADMIN-01', name: '陈屿', role: 'admin' },
  ],
  submissions: [
    {
      id: 'SUB-001',
      ownerId: 'U-COL-01',
      teamId: 'TEAM-01',
      aiScore: 76,
      finalScore: 76,
      settlementStatus: 'unsettled',
    },
    {
      id: 'SUB-OTHER-01',
      ownerId: 'U-COL-02',
      teamId: 'TEAM-02',
      aiScore: 68,
      finalScore: 68,
      settlementStatus: 'unsettled',
    },
    {
      id: 'SUB-SETTLED-01',
      ownerId: 'U-COL-01',
      teamId: 'TEAM-01',
      aiScore: 84,
      finalScore: 84,
      settlementStatus: 'settled',
    },
  ],
}
```

All commands must return new arrays and objects so React observes state changes. Uploaded demo files advance from `uploading` to `queued`; the UI controls subsequent demo transitions.

- [ ] **Step 4: Run store tests and the complete suite to verify GREEN**

Run:

```bash
pnpm test --run src/data/demoStore.test.tsx
pnpm test --run
```

Expected: all tests pass.

- [ ] **Step 5: Commit the demo data layer**

```bash
git add src/data
git commit -m "feat: add in-memory platform workflows"
```

### Task 3: Role-Aware Routing and Shared Application Shell

**Files:**
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/routes.tsx`
- Create: `src/app/RequireRole.tsx`
- Create: `src/app/navigation.ts`
- Create: `src/layout/DashboardShell.tsx`
- Create: `src/layout/PageHeader.tsx`
- Create: `src/components/BrandMark.tsx`
- Create: `src/components/MetricCard.tsx`
- Create: `src/components/StatusBadge.tsx`
- Create: `src/components/EmptyState.tsx`
- Create: `src/components/Toast.tsx`
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: `Role`, `DemoStoreProvider`, and `useDemoStore()` from Tasks 1–2.
- Produces: `App`, role-specific navigation arrays, protected route behavior, responsive sidebar, top bar, demo role switcher, and shared page primitives.

- [ ] **Step 1: Write failing routing and permission tests**

```tsx
it('routes the collector demo account to the collector dashboard', async () => {
  renderApp('/login');
  await user.click(screen.getByRole('button', { name: '以数采人员身份进入' }));
  expect(await screen.findByRole('heading', { name: '早上好，林晓雨' })).toBeVisible();
});

it('redirects a collector away from the admin area', async () => {
  renderApp('/admin');
  expect(await screen.findByRole('heading', { name: '我的工作台' })).toBeVisible();
  expect(screen.queryByText('提现审核')).not.toBeInTheDocument();
});

it('shows team review only to leaders and administrators', async () => {
  renderApp('/login');
  await user.click(screen.getByRole('button', { name: '以团长身份进入' }));
  expect(await screen.findByRole('link', { name: '结算前复核' })).toBeVisible();
});
```

- [ ] **Step 2: Run application tests to verify RED**

Run:

```bash
pnpm test --run src/app/App.test.tsx
```

Expected: tests fail because the application shell and routes do not exist.

- [ ] **Step 3: Implement protected routes and the responsive dashboard shell**

Role base paths are fixed:

```ts
export const roleHome: Record<Role, string> = {
  collector: '/collector',
  leader: '/team',
  admin: '/admin',
};
```

The shell must render:

- Desktop sidebar at widths of 1024px and above.
- Mobile slide-over navigation below 1024px.
- Current user name, role label, notifications, and demo role switcher.
- Active route styling and keyboard-visible focus states.
- Redirect to the current role home for unauthorized paths.

- [ ] **Step 4: Run routing tests and verify GREEN**

Run:

```bash
pnpm test --run src/app/App.test.tsx
pnpm typecheck
```

Expected: route and permission tests pass.

- [ ] **Step 5: Commit the application shell**

```bash
git add src/main.tsx src/app src/layout src/components src/styles
git commit -m "feat: add role-aware application shell"
```

### Task 4: Public Website, Login, and Collector Journey

**Files:**
- Create: `src/features/public/PublicHomePage.tsx`
- Create: `src/features/auth/LoginPage.tsx`
- Create: `src/features/collector/CollectorDashboard.tsx`
- Create: `src/features/collector/UploadPage.tsx`
- Create: `src/features/collector/SubmissionsPage.tsx`
- Create: `src/features/collector/SubmissionDetail.tsx`
- Create: `src/features/collector/EarningsPage.tsx`
- Create: `src/features/collector/GuidePage.tsx`
- Create: `src/features/collector/ProfilePage.tsx`
- Create: `src/components/SubmissionTable.tsx`
- Create: `src/components/QualityScore.tsx`
- Create: `src/components/SceneDistributionChart.tsx`
- Create: `src/components/TrendChart.tsx`
- Test: `src/features/collector/collectorFlow.test.tsx`

**Interfaces:**
- Consumes: `useDemoStore()`, calculation functions, common components, and role routes.
- Produces: public marketing route `/`, login route `/login`, and collector routes under `/collector`.

- [ ] **Step 1: Write failing tests for upload validation and collector data scope**

```tsx
it('rejects unsupported upload formats without creating a submission', async () => {
  renderApp('/collector/upload', { role: 'collector' });
  const input = screen.getByLabelText('选择视频文件');
  await user.upload(input, new File(['text'], 'notes.txt', { type: 'text/plain' }));
  expect(screen.getByText('仅支持 MOV 和 MP4 视频')).toBeVisible();
  expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
});

it('creates one visible upload item for each supported file', async () => {
  renderApp('/collector/upload', { role: 'collector' });
  const input = screen.getByLabelText('选择视频文件');
  await user.upload(input, [
    new File(['a'], 'kitchen.mov', { type: 'video/quicktime' }),
    new File(['b'], 'cleaning.mp4', { type: 'video/mp4' }),
  ]);
  expect(screen.getByText('kitchen.mov')).toBeVisible();
  expect(screen.getByText('cleaning.mp4')).toBeVisible();
});
```

- [ ] **Step 2: Run collector flow tests to verify RED**

Run:

```bash
pnpm test --run src/features/collector/collectorFlow.test.tsx
```

Expected: tests fail because the collector pages do not exist.

- [ ] **Step 3: Implement the public, login, and collector experiences**

The public page must contain a hero, four public metrics, scene distribution, production flow, quality assurance, and contact call-to-action. The collector area must contain real demo cards, tables, filters, detail panels, quality evidence, income summaries, withdrawal validation, collection guidance, and profile form state.

The upload control accepts:

```tsx
<input
  aria-label="选择视频文件"
  accept=".mov,.mp4,video/quicktime,video/mp4"
  multiple
  type="file"
/>
```

Extension validation must be case-insensitive and must occur before calling `addUploads`.

- [ ] **Step 4: Run collector tests and the complete suite to verify GREEN**

Run:

```bash
pnpm test --run src/features/collector/collectorFlow.test.tsx
pnpm test --run
```

Expected: all tests pass.

- [ ] **Step 5: Commit the public and collector experience**

```bash
git add src/features/public src/features/auth src/features/collector src/components
git commit -m "feat: build public and collector experiences"
```

### Task 5: Team Leader and Administrator Workspaces

**Files:**
- Create: `src/features/team/TeamDashboard.tsx`
- Create: `src/features/team/MembersPage.tsx`
- Create: `src/features/team/TeamSubmissionsPage.tsx`
- Create: `src/features/team/ReviewPage.tsx`
- Create: `src/features/team/TeamAnalyticsPage.tsx`
- Create: `src/features/team/TeamIncomePage.tsx`
- Create: `src/features/admin/AdminDashboard.tsx`
- Create: `src/features/admin/SubmissionsAdminPage.tsx`
- Create: `src/features/admin/AiQueuePage.tsx`
- Create: `src/features/admin/QualityReviewPage.tsx`
- Create: `src/features/admin/AssetsPage.tsx`
- Create: `src/features/admin/UsersTeamsPage.tsx`
- Create: `src/features/admin/RulesPage.tsx`
- Create: `src/features/admin/SettlementPage.tsx`
- Create: `src/features/admin/WithdrawalsPage.tsx`
- Create: `src/features/admin/PublicConfigPage.tsx`
- Create: `src/features/admin/AuditLogPage.tsx`
- Create: `src/components/ReviewDrawer.tsx`
- Create: `src/components/FilterBar.tsx`
- Test: `src/features/review/reviewFlow.test.tsx`

**Interfaces:**
- Consumes: store commands, scoped submissions, common table/chart components, and role routes.
- Produces: team routes under `/team`, administrator routes under `/admin`, and the reusable `ReviewDrawer`.

- [ ] **Step 1: Write failing tests for review and withdrawal approval flows**

```tsx
it('requires a reason before saving a quality adjustment', async () => {
  renderApp('/team/review', { role: 'leader' });
  await user.click(screen.getAllByRole('button', { name: '复核' })[0]);
  await user.clear(screen.getByLabelText('最终评分'));
  await user.type(screen.getByLabelText('最终评分'), '88');
  await user.click(screen.getByRole('button', { name: '保存调整' }));
  expect(screen.getByText('请填写调整原因')).toBeVisible();
});

it('lets an administrator approve a pending withdrawal', async () => {
  renderApp('/admin/withdrawals', { role: 'admin' });
  await user.click(screen.getAllByRole('button', { name: '审核' })[0]);
  await user.click(screen.getByRole('button', { name: '批准申请' }));
  expect(screen.getByText('待打款')).toBeVisible();
});
```

- [ ] **Step 2: Run review flow tests to verify RED**

Run:

```bash
pnpm test --run src/features/review/reviewFlow.test.tsx
```

Expected: tests fail because the team and administrator workspaces do not exist.

- [ ] **Step 3: Implement leader and administrator workspaces with dense demo data**

Every navigation item must lead to a composed page containing at least one of the following: operational metrics, a populated table, a chart, an actionable form, or an explanatory policy panel. No route may render only a title and placeholder sentence.

The review drawer must show:

- Video metadata and current processing status.
- AI original score and immutable AI conclusion.
- Final score input and derived coefficient.
- Invalid duration and estimated income.
- Adjustment reason.
- Audit timeline.

- [ ] **Step 4: Run review tests and the complete suite to verify GREEN**

Run:

```bash
pnpm test --run src/features/review/reviewFlow.test.tsx
pnpm test --run
pnpm typecheck
```

Expected: all tests pass and all role routes type check.

- [ ] **Step 5: Commit the team and administrator workspaces**

```bash
git add src/features/team src/features/admin src/features/review src/components
git commit -m "feat: add team and administrator workspaces"
```

### Task 6: Responsive Visual QA, Production Build, and Repository Delivery

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`
- Modify: affected component files discovered through visual QA
- Create: `README.md`
- Create: `.openai/hosting.json` only through the Sites workflow when a Sites project is created

**Interfaces:**
- Consumes: the complete application from Tasks 1–5.
- Produces: responsive visual fixes, usage documentation, a passing production build, a pushed GitHub branch, and a production deployment.

- [ ] **Step 1: Run all automated verification before visual inspection**

Run:

```bash
pnpm test --run
pnpm typecheck
pnpm build
```

Expected: all tests pass, TypeScript reports no errors, and Vite creates `dist/`.

- [ ] **Step 2: Start the application and inspect key routes**

Run:

```bash
pnpm dev --host 127.0.0.1
```

Inspect at desktop `1440×1000` and mobile `390×844`:

- `/`
- `/login`
- `/collector`
- `/collector/upload`
- `/team`
- `/team/review`
- `/admin`
- `/admin/submissions`
- `/admin/withdrawals`

Expected: no clipped content, overlapping navigation, unreadable chart labels, horizontal page overflow, or browser console errors.

- [ ] **Step 3: Fix each visual defect and re-run the affected route**

For every issue, record the route and viewport, make one focused CSS or component correction, then capture the same viewport again. Repeat until the listed routes meet the visual criteria from the design specification.

- [ ] **Step 4: Add run, test, build, demo account, and architecture instructions**

`README.md` must document:

```md
## 本地运行
pnpm install
pnpm dev

## 验证
pnpm test --run
pnpm typecheck
pnpm build

## 演示角色
- 数采人员：林晓雨
- 团长：周明远
- 平台管理员：陈屿
```

- [ ] **Step 5: Run final verification**

Run:

```bash
pnpm test --run
pnpm typecheck
pnpm build
git status --short
```

Expected: tests, type checking, and build pass; Git reports only intentional project files.

- [ ] **Step 6: Commit and push the verified source**

```bash
git add .
git commit -m "feat: deliver clickable platform framework"
git push -u origin main
```

- [ ] **Step 7: Save and deploy the exact pushed version through Sites**

Read `.openai/hosting.json` if present, push the exact source state, save a Sites version using that commit SHA, deploy the saved version, and inspect deployment status until it reaches a terminal state.
