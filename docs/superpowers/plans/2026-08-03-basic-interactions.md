# Basic Interaction Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-only forms, business state changes, notifications, confirmations, and consistent feedback so every primary platform action produces a meaningful result.

**Architecture:** Extend the existing immutable `DemoStore` with typed commands for business mutations, then expose those commands through `DemoStoreContext`. Add a shared interaction provider for toasts and notifications plus a reusable accessible modal; page-specific forms remain focused components that call the store and interaction APIs.

**Tech Stack:** React 19, TypeScript 5.9, vinext/Next app router, Vitest, Testing Library, Lucide React, CSS.

## Global Constraints

- All new state is session-only and resets on page refresh.
- No real backend, browser persistence, invitation service, message service, export file, archive, payment, or settlement ledger is introduced.
- Business mutations must use immutable state updates in `DemoStore`.
- Leaders may invite members only into their own team.
- Settlement includes only completed, quality-passed, unsettled submissions.
- Delivery packages count only settled, quality-passed assets.
- User-facing copy remains Simplified Chinese.
- Every production behavior starts with a failing automated test.
- Desktop and mobile controls remain keyboard accessible and use at least 40px touch targets.
- Run all `pnpm` commands below from the `web/` directory.
- Every modal submit handler uses a local `submitting` state, disables its submit button while active, and resets form/error state after close.

---

## File Structure

- `web/src/domain/types.ts`: add delivery-package, rule, label, and operation-log domain contracts.
- `web/src/data/demoData.ts`: seed new state while preserving existing demo records.
- `web/src/data/demoStore.ts`: own validation and all new immutable mutations.
- `web/src/data/DemoStoreContext.tsx`: expose new store commands to pages.
- `web/src/interactions/InteractionContext.tsx`: own toasts and notification read state.
- `web/src/components/Modal.tsx`: accessible reusable form/confirmation container.
- `web/src/components/ToastViewport.tsx`: render shared feedback messages.
- `web/src/components/NotificationPanel.tsx`: render and clear unread notifications.
- `web/src/features/team/InviteMemberModal.tsx`: invite-member form used by two team pages.
- `web/src/features/team/MemberDetailModal.tsx`: read-only member details.
- `web/src/features/admin/UserFormModal.tsx`: create and configure users.
- `web/src/features/admin/RuleFormModal.tsx`: create rule versions and edit labels.
- `web/src/features/admin/SettlementConfirmModal.tsx`: preview and confirm the next batch.
- `web/src/features/admin/DeliveryPackageModal.tsx`: create a session delivery package.
- Existing team/admin/public/layout pages: connect triggers and render live state.
- `web/app/globals.css`: style modal, toast, notification, and form states.

---

### Task 1: Domain Contracts and Demo Store Commands

**Files:**
- Modify: `web/src/domain/types.ts`
- Modify: `web/src/data/demoData.ts`
- Modify: `web/src/data/demoStore.ts`
- Modify: `web/src/data/DemoStoreContext.tsx`
- Test: `web/src/data/demoStore.test.ts`

**Interfaces:**
- Produces: `DeliveryPackage`, `RuleConfig`, `LabelConfig`, `OperationLog`, `InviteMemberInput`, `AddUserInput`, `UpdateUserInput`, `RuleVersionInput`, `UpdateLabelInput`, and `DeliveryPackageInput`.
- Produces commands: `inviteMember(input): User`, `addUser(input): User`, `updateUser(input): User`, `createRuleVersion(input): RuleConfig`, `updateLabel(input): LabelConfig`, `createSettlementBatch(): SettlementBatch`, and `createDeliveryPackage(input): DeliveryPackage`.
- Consumes: existing `User`, `Team`, `Submission`, `SettlementBatch`, `estimateIncome`, and `effectiveDuration`.

- [ ] **Step 1: Add failing store tests for member and user validation**

Append tests that use the real store:

```ts
it("invites a collector into the leader's own team", () => {
  const store = createDemoStore(demoSeed);
  store.loginAs("leader");
  const created = store.inviteMember({ name: "苏禾", phone: "13812345678" });
  expect(created.role).toBe("collector");
  expect(created.teamId).toBe("TEAM-01");
  expect(store.getState().teams[0].memberIds).toContain(created.id);
});

it("rejects duplicate invitation phones and duplicate login accounts", () => {
  const store = createDemoStore(demoSeed);
  store.loginAs("leader");
  store.inviteMember({ name: "苏禾", phone: "13812345678" });
  expect(() => store.inviteMember({ name: "苏禾二", phone: "13812345678" }))
    .toThrow("该手机号已存在");
  store.loginAs("admin");
  expect(() => store.addUser({ name: "重复账号", account: "linxiaoyu", role: "collector", teamId: "TEAM-01" }))
    .toThrow("登录账号已存在");
});

it("replaces a team leader without leaving two leaders", () => {
  const store = createDemoStore(demoSeed);
  store.loginAs("admin");
  const replacement = store.updateUser({ userId: "U-COL-01", role: "leader", teamId: "TEAM-01" });
  expect(replacement.role).toBe("leader");
  expect(store.getState().teams[0].leaderId).toBe("U-COL-01");
  expect(store.getState().users.find((user) => user.id === "U-LEAD-01")?.role).toBe("collector");
  expect(store.getState().teams[0].memberIds).toContain("U-LEAD-01");
  expect(store.getState().teams[0].memberIds).not.toContain("U-COL-01");
});
```

- [ ] **Step 2: Run the store test and verify RED**

Run: `pnpm test -- src/data/demoStore.test.ts`

Expected: FAIL because `inviteMember` and `addUser` do not exist.

- [ ] **Step 3: Define the new domain and state contracts**

Add exact contracts:

```ts
export interface DeliveryPackage {
  id: string;
  name: string;
  assetCount: number;
  status: "ready";
  createdAt: string;
}

export interface RuleConfig {
  version: string;
  passThreshold: number;
  description: string;
}

export interface LabelConfig {
  id: string;
  name: string;
  type: "scene" | "action" | "object" | "issue";
  associationCount: number;
  enabled: boolean;
}

export interface OperationLog {
  id: string;
  actor: string;
  action: string;
  target: string;
  reason: string;
  createdAt: string;
}
```

Extend `DemoState` with:

```ts
deliveryPackages: DeliveryPackage[];
rule: RuleConfig;
labels: LabelConfig[];
operationLogs: OperationLog[];
```

Seed `deliveryPackages: []`, rule version `RULE-2026-08` with threshold `60`, and these labels: `SCENE-001` 家庭厨房, `ACTION-014` 组装, `OBJECT-032` 手持工具, and `ISSUE-006` 镜头遮挡. Seed the existing price-update and withdrawal-approval rows as `operationLogs` so `AuditLogPage` no longer owns hard-coded log records.

- [ ] **Step 4: Implement member, user, and team-relation commands**

Export these input types from `demoStore.ts`:

```ts
export type InviteMemberInput = { name: string; phone: string };
export type AddUserInput = { name: string; account: string; role: Role; teamId?: string };
export type UpdateUserInput = { userId: string; role: Role; teamId?: string };
```

Implement validation with exact messages:

```ts
if (!input.name.trim()) throw new Error("请填写成员姓名");
if (!/^1\d{10}$/.test(input.phone)) throw new Error("请输入正确的手机号");
if (this.state.users.some((user) => user.phone === input.phone)) throw new Error("该手机号已存在");
```

`inviteMember` first requires the current user to be a leader and always uses that leader's `teamId`; otherwise throw `仅团长可邀请成员` or `当前团长未加入团队`. `addUser` and `updateUser` require an administrator and throw `仅管理员可配置用户` otherwise. `addUser` requires name/account with `请填写用户姓名` and `请填写登录账号`, rejects duplicate accounts with `登录账号已存在`, and requires an existing team for `collector` and `leader` with `请选择有效团队`. `updateUser` removes the user from previous `memberIds`, adds collectors to the new team, and when assigning a leader updates `team.leaderId` while changing the previous leader to a collector member. Reject changing the current leader to a non-leader with `请先为团队指定新的团长`.

Invited members receive `id: U-INV-${Date.now()}`, `account: invited_${Date.now()}`, the first character of the name as avatar, and the submitted phone. Newly added users receive `phone: "未设置"`. A newly added leader follows the same leader-replacement rule as `updateUser`.

- [ ] **Step 5: Run member/user tests and verify GREEN**

Run: `pnpm test -- src/data/demoStore.test.ts`

Expected: the new member and user tests pass.

- [ ] **Step 6: Add failing tests for rule, settlement, and delivery commands**

```ts
it("locks eligible submissions into a new settlement batch", () => {
  const store = createDemoStore(demoSeed);
  store.loginAs("admin");
  const before = store.getState().settlements.length;
  const batch = store.createSettlementBatch();
  expect(store.getState().settlements).toHaveLength(before + 1);
  expect(batch.status).toBe("locked");
  expect(store.getSubmission("SUB-001").settlementStatus).toBe("settled");
  expect(store.getSubmission("SUB-003").settlementStatus).toBe("unsettled");
});

it("creates delivery packages only from settled passed assets", () => {
  const store = createDemoStore(demoSeed);
  store.loginAs("admin");
  const created = store.createDeliveryPackage({ name: "八月家庭任务包" });
  expect(created.assetCount).toBe(
    store.getState().submissions.filter((item) => item.settlementStatus === "settled" && item.qualityStatus === "passed").length,
  );
});

it("updates the active rule and a label", () => {
  const store = createDemoStore(demoSeed);
  store.loginAs("admin");
  expect(store.createRuleVersion({ version: "RULE-2026-09", passThreshold: 65, description: "九月规则" }).version)
    .toBe("RULE-2026-09");
  expect(store.updateLabel({ id: "SCENE-001", name: "家庭烹饪", enabled: true }).name)
    .toBe("家庭烹饪");
  expect(store.getState().operationLogs[0].action).toBe("发布质量规则");
});
```

- [ ] **Step 7: Run the store test and verify RED**

Run: `pnpm test -- src/data/demoStore.test.ts`

Expected: FAIL because the rule, settlement, and delivery commands do not exist.

- [ ] **Step 8: Implement remaining store commands and expose all commands through context**

Define the remaining inputs exactly:

```ts
export type RuleVersionInput = { version: string; passThreshold: number; description: string };
export type UpdateLabelInput = { id: string; name: string; enabled: boolean };
export type DeliveryPackageInput = { name: string };
```

Use `effectiveDuration` for batch minutes and `estimateIncome` with each submission's team price for batch amount. Eligible submissions satisfy all three conditions:

```ts
item.processingStatus === "completed" &&
item.qualityStatus === "passed" &&
item.settlementStatus === "unsettled"
```

Prepend the created batch and delivery package, update eligible submissions to `settled`, and expose all seven new methods on `DemoStoreValue`. `createRuleVersion` prepends a `发布质量规则` operation log and `createSettlementBatch` prepends a `生成结算批次` operation log, both attributed to the current administrator.

All four commands require the current role to be `admin`; otherwise throw `仅管理员可执行该操作`. `createRuleVersion` validates a non-empty version and description plus an integer threshold from 0 through 100. `updateLabel` requires an existing label and a non-empty trimmed name. `createSettlementBatch` throws `当前没有可结算数据` when the eligible set is empty. `createDeliveryPackage` requires a non-empty trimmed name and throws `当前没有可交付资产` when no settled, quality-passed assets exist. Add store tests for each empty-data and invalid-input branch so the page layer is not the only enforcement point.

- [ ] **Step 9: Run store tests, context tests, and type checking**

Run: `pnpm test -- src/data/demoStore.test.ts src/data/DemoStoreContext.test.tsx && pnpm typecheck`

Expected: all selected tests pass and TypeScript reports no errors.

- [ ] **Step 10: Commit the data workflow foundation**

```bash
git add web/src/domain web/src/data
git commit -m "feat: add interactive demo workflows"
```

---

### Task 2: Shared Modal, Toast, and Notification Layer

**Files:**
- Create: `web/src/interactions/InteractionContext.tsx`
- Create: `web/src/components/Modal.tsx`
- Create: `web/src/components/ToastViewport.tsx`
- Create: `web/src/components/NotificationPanel.tsx`
- Modify: `web/src/app/PlatformApp.tsx`
- Modify: `web/src/layout/DashboardShell.tsx`
- Modify: `web/app/globals.css`
- Test: `web/src/interactions/InteractionContext.test.tsx`
- Test: `web/src/components/Modal.test.tsx`

**Interfaces:**
- Produces: `useInteractions()` returning `notify(type, message)`, `dismissToast(id)`, `notifications`, `unreadCount`, and `markAllRead()`.
- Produces: `Modal({ open, title, onClose, children, returnFocusRef, initialFocusRef })`.
- Consumes: `PlatformApp` and `DashboardShell` as provider/rendering entry points.

- [ ] **Step 1: Write failing tests for toasts and notification read state**

Render an `InteractionProvider` harness and assert:

```tsx
await user.click(screen.getByRole("button", { name: "发送成功提示" }));
expect(screen.getByText("操作已完成")).toBeVisible();
expect(screen.getByText("3 条未读")).toBeVisible();
await user.click(screen.getByRole("button", { name: "全部标为已读" }));
expect(screen.getByText("0 条未读")).toBeVisible();
```

- [ ] **Step 2: Run interaction tests and verify RED**

Run: `pnpm test -- src/interactions/InteractionContext.test.tsx`

Expected: FAIL because the provider and hook do not exist.

- [ ] **Step 3: Implement the interaction provider and toast viewport**

Use exact public types:

```ts
type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; message: string };
type DemoNotification = { id: string; title: string; detail: string; read: boolean };
```

Seed exactly these three notifications: `3 条数据等待结算前复核`, `AI 任务 SUB-019 处理异常`, and `提现申请 WD-20260803 已通过`. Cap toasts with `next.slice(-3)`, and remove successful/info toasts after 2800ms. Render `ToastViewport` inside the provider so every route receives feedback without page plumbing.

Error toasts remain visible until the user closes them with an accessible close button that calls `dismissToast(id)`. Form validation still renders inline with `role="alert"` and does not depend on toasts.

- [ ] **Step 4: Run interaction tests and verify GREEN**

Run: `pnpm test -- src/interactions/InteractionContext.test.tsx`

Expected: toast and notification state tests pass.

- [ ] **Step 5: Write failing modal accessibility tests**

```tsx
expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "打开表单" }));
expect(screen.getByRole("dialog", { name: "邀请成员" })).toBeVisible();
expect(screen.getByLabelText("姓名")).toHaveFocus();
await user.keyboard("{Escape}");
expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "打开表单" })).toHaveFocus();
```

Add assertions that clicking inside the dialog leaves it open, clicking the backdrop closes it, and the close button has the accessible name `关闭邀请成员`.

- [ ] **Step 6: Run modal tests and verify RED**

Run: `pnpm test -- src/components/Modal.test.tsx`

Expected: FAIL because `Modal` does not exist.

- [ ] **Step 7: Implement accessible modal and notification panel**

`Modal` uses `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, an Escape listener, initial focus on open, and focus restoration on close. `NotificationPanel` lists the three notifications and calls `markAllRead` from its button.

The backdrop handles pointer clicks only when `event.target === event.currentTarget`, so clicks inside the card never close the modal. Split the current component into exported `PlatformApp`, which only renders `InteractionProvider`, and private `PlatformContent`, which contains the existing path and store logic. This ensures every dashboard and public route can call `useInteractions`. Connect the top-bar notification button to the panel, show the unread dot only when `unreadCount > 0`, and notify `通知已全部标为已读` after clearing.

- [ ] **Step 8: Add responsive interaction styles**

Add focused class groups for `.modal-backdrop`, `.modal-card`, `.modal-form`, `.toast-viewport`, `.toast-item`, `.notification-panel`, `.notification-item`, error copy, and mobile full-width behavior. Add `:focus-visible` outlines to `.button`, `.icon-button`, `.table-action`, `.nav-link`, and form controls.

- [ ] **Step 9: Run modal, interaction, routing tests and type checking**

Run: `pnpm test -- src/components/Modal.test.tsx src/interactions/InteractionContext.test.tsx src/app/PlatformApp.test.tsx && pnpm typecheck`

Expected: all selected tests pass with no type errors.

- [ ] **Step 10: Commit the shared interaction layer**

```bash
git add web/src/interactions web/src/components web/src/app/PlatformApp.tsx web/src/layout/DashboardShell.tsx web/app/globals.css
git commit -m "feat: add shared interaction feedback"
```

---

### Task 3: Team Invitation and Member Details

**Files:**
- Create: `web/src/features/team/InviteMemberModal.tsx`
- Create: `web/src/features/team/MemberDetailModal.tsx`
- Modify: `web/src/features/team/TeamDashboard.tsx`
- Modify: `web/src/features/team/MembersPage.tsx`
- Test: `web/src/features/team/teamInteractions.test.tsx`

**Interfaces:**
- Consumes: `inviteMember(input)`, `Modal`, and `notify`.
- Produces: reusable invite form and read-only member details.

- [ ] **Step 1: Write failing team interaction tests**

Use the existing role bootstrap pattern to render `/team/members` as leader:

```tsx
await user.click(screen.getByRole("button", { name: "邀请成员" }));
await user.type(screen.getByLabelText("成员姓名"), "苏禾");
await user.type(screen.getByLabelText("手机号"), "13812345678");
await user.click(screen.getByRole("button", { name: "确认邀请" }));
expect(screen.getByText("苏禾")).toBeVisible();
expect(screen.getByText("成员已加入团队")).toBeVisible();
```

Add a second test opening the first `查看` button and asserting a dialog containing `成员详情`, account, phone, daily uploads, effective duration, and pass rate.

Add a duplicate-submit test that double-clicks `确认邀请`, then assert only one `苏禾` row exists and only one matching user was added to state. The submit button uses both a synchronous guard ref and the visible `submitting` state so a second event cannot enter before React rerenders.

- [ ] **Step 2: Run team interaction tests and verify RED**

Run: `pnpm test -- src/features/team/teamInteractions.test.tsx`

Expected: FAIL because invite and detail buttons do not open dialogs.

- [ ] **Step 3: Implement the invite modal**

Use controlled `name`, `phone`, and `error` state. On submit call `inviteMember`; on success clear/close and call `notify("success", "成员已加入团队")`; on error display the exact store message with `role="alert"`. Prevent duplicate submit with a local `submitting` flag.

- [ ] **Step 4: Implement member detail modal and connect both team pages**

Move the current member metrics arrays into a `memberMetrics` helper keyed by user id so list and detail show the same values. Connect both `邀请成员` entry points to `InviteMemberModal` and each list `查看` button to `MemberDetailModal`.

- [ ] **Step 5: Run team tests and full role-routing tests**

Run: `pnpm test -- src/features/team/teamInteractions.test.tsx src/app/PlatformApp.test.tsx`

Expected: invite, detail, and navigation tests pass.

- [ ] **Step 6: Commit team interactions**

```bash
git add web/src/features/team
git commit -m "feat: add team member interactions"
```

---

### Task 4: Administrator User and Rule Forms

**Files:**
- Create: `web/src/features/admin/UserFormModal.tsx`
- Create: `web/src/features/admin/RuleFormModal.tsx`
- Modify: `web/src/features/admin/UsersTeamsPage.tsx`
- Modify: `web/src/features/admin/RulesPage.tsx`
- Test: `web/src/features/admin/adminConfiguration.test.tsx`

**Interfaces:**
- Consumes: `addUser`, `updateUser`, `createRuleVersion`, `updateLabel`, `Modal`, and `notify`.
- Produces: create/configure user flows and create/edit rule flows.

- [ ] **Step 1: Write failing user-management tests**

```tsx
await user.click(screen.getByRole("button", { name: "新增用户" }));
await user.type(screen.getByLabelText("姓名"), "沈舟");
await user.type(screen.getByLabelText("登录账号"), "shenzhou");
await user.selectOptions(screen.getByLabelText("角色"), "collector");
await user.selectOptions(screen.getByLabelText("所属团队"), "TEAM-01");
await user.click(screen.getByRole("button", { name: "创建用户" }));
expect(screen.getByText("沈舟")).toBeVisible();
expect(screen.getByText("用户已创建")).toBeVisible();
```

Add a duplicate-account UI test and a configuration test that changes a collector from `TEAM-01` to `TEAM-02` and observes the updated team name in the table.

- [ ] **Step 2: Run admin configuration tests and verify RED**

Run: `pnpm test -- src/features/admin/adminConfiguration.test.tsx`

Expected: FAIL because user buttons are static.

- [ ] **Step 3: Implement and connect `UserFormModal`**

Support `mode: "create" | "edit"`. Create mode collects all four fields; edit mode shows name/account disabled and edits role/team. Hide team for admin role. Call store commands and show `用户已创建` or `用户配置已更新`.

Both modes catch store errors into a `role="alert"` message, disable the submit button and change its label while `submitting`, and clear local state after a successful save or close.

- [ ] **Step 4: Run user-management tests and verify GREEN**

Run: `pnpm test -- src/features/admin/adminConfiguration.test.tsx`

Expected: all user tests pass while rule tests still fail.

- [ ] **Step 5: Add failing rule form tests**

```tsx
await user.click(screen.getByRole("button", { name: "新建规则版本" }));
await user.type(screen.getByLabelText("版本名称"), "RULE-2026-09");
await user.clear(screen.getByLabelText("通过阈值"));
await user.type(screen.getByLabelText("通过阈值"), "65");
await user.type(screen.getByLabelText("规则说明"), "九月质量规则");
await user.click(screen.getByRole("button", { name: "发布规则" }));
expect(screen.getByText("RULE-2026-09")).toBeVisible();
```

Add a label-edit test changing `家庭厨房` to `家庭烹饪`.

- [ ] **Step 6: Run rule tests and verify RED**

Run: `pnpm test -- src/features/admin/adminConfiguration.test.tsx`

Expected: user tests pass; rule tests fail because rule buttons are static.

- [ ] **Step 7: Implement and connect rule forms**

Render rule cards and label rows from `state.rule` and `state.labels`, not local constants. Validate version and description as non-empty and threshold as an integer from 0 through 100. Connect new/edit buttons and notify on success.

Both rule forms catch store errors inline, use the shared duplicate-submit behavior, and reset their draft state whenever the modal closes.

- [ ] **Step 8: Run administrator configuration tests and type checking**

Run: `pnpm test -- src/features/admin/adminConfiguration.test.tsx && pnpm typecheck`

Expected: all user and rule tests pass with no type errors.

- [ ] **Step 9: Commit administrator configuration interactions**

```bash
git add web/src/features/admin/UserFormModal.tsx web/src/features/admin/RuleFormModal.tsx web/src/features/admin/UsersTeamsPage.tsx web/src/features/admin/RulesPage.tsx web/src/features/admin/adminConfiguration.test.tsx
git commit -m "feat: add administrator configuration forms"
```

---

### Task 5: Settlement and Delivery Package Actions

**Files:**
- Create: `web/src/features/admin/SettlementConfirmModal.tsx`
- Create: `web/src/features/admin/DeliveryPackageModal.tsx`
- Modify: `web/src/features/admin/SettlementPage.tsx`
- Modify: `web/src/features/admin/AssetsPage.tsx`
- Test: `web/src/features/admin/settlementDelivery.test.tsx`

**Interfaces:**
- Consumes: `createSettlementBatch`, `createDeliveryPackage`, calculation functions, `Modal`, and `notify`.
- Produces: confirmation summary and delivery-package form.

- [ ] **Step 1: Write failing settlement UI test**

```tsx
await user.click(screen.getByRole("button", { name: "生成演示批次" }));
expect(screen.getByRole("dialog", { name: "确认生成结算批次" })).toBeVisible();
expect(screen.getByText(/符合条件的视频/)).toBeVisible();
await user.click(screen.getByRole("button", { name: "确认生成" }));
expect(screen.getByText("结算批次已生成并锁定")).toBeVisible();
expect(screen.getAllByText("已锁定").length).toBeGreaterThan(2);
```

- [ ] **Step 2: Run settlement/delivery tests and verify RED**

Run: `pnpm test -- src/features/admin/settlementDelivery.test.tsx`

Expected: FAIL because the settlement trigger is static.

- [ ] **Step 3: Implement settlement confirmation**

Calculate the preview from current state using the exact eligibility predicate from Task 1. Display count, rounded effective minutes, and amount. Disable `确认生成` when count is zero. On success close and notify `结算批次已生成并锁定`.

Use the shared submitting state while confirming. If state changes between preview and confirmation and the store reports no eligible records, keep the dialog open and render `当前没有可结算数据` with `role="alert"`.

- [ ] **Step 4: Write failing delivery package UI test**

```tsx
await user.click(screen.getByRole("button", { name: "创建交付包" }));
await user.type(screen.getByLabelText("交付包名称"), "八月家庭任务包");
await user.click(screen.getByRole("button", { name: "确认创建" }));
expect(screen.getByText("交付包已创建")).toBeVisible();
expect(screen.getByText("19")).toBeVisible();
```

The assets metric starts at 18 and must derive its displayed count as `18 + state.deliveryPackages.length`.

- [ ] **Step 5: Run delivery test and verify RED**

Run: `pnpm test -- src/features/admin/settlementDelivery.test.tsx`

Expected: settlement test passes; delivery test fails because package creation is static.

- [ ] **Step 6: Implement delivery package form and live metric**

Show the eligible asset count, require a non-empty package name, call the store, update the metric, close, and notify `交付包已创建`.

Disable duplicate submission, render store errors inline, and disable confirmation with the explanation `当前没有可交付资产` when the eligible asset count is zero.

- [ ] **Step 7: Run settlement/delivery and review regression tests**

Run: `pnpm test -- src/features/admin/settlementDelivery.test.tsx src/features/review/reviewFlow.test.tsx src/data/demoStore.test.ts`

Expected: all tests pass, including the existing settled-submission immutability test.

- [ ] **Step 8: Commit settlement and delivery interactions**

```bash
git add web/src/features/admin/SettlementConfirmModal.tsx web/src/features/admin/DeliveryPackageModal.tsx web/src/features/admin/SettlementPage.tsx web/src/features/admin/AssetsPage.tsx web/src/features/admin/settlementDelivery.test.tsx
git commit -m "feat: add settlement and delivery actions"
```

---

### Task 6: Lightweight Feedback, Public Scroll, and Final Verification

**Files:**
- Modify: `web/src/features/public/PublicHomePage.tsx`
- Modify: `web/src/features/admin/SubmissionsAdminPage.tsx`
- Modify: `web/src/features/admin/AuditLogPage.tsx`
- Modify: `web/app/globals.css`
- Test: `web/src/features/interactions/lightweightFeedback.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `useInteractions().notify` and the existing `#process` section.
- Produces: smooth scroll and explicit feedback for non-mutating actions.

- [ ] **Step 1: Write failing public scroll and export-feedback tests**

Mock only the browser method and assert the real button wiring:

```tsx
const scrollIntoView = vi.fn();
document.getElementById("process")!.scrollIntoView = scrollIntoView;
await user.click(screen.getByRole("button", { name: "了解生产流程" }));
expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
```

Render admin submissions and audit routes, click their export buttons, and assert `导出任务已创建`.

- [ ] **Step 2: Run lightweight interaction tests and verify RED**

Run: `pnpm test -- src/features/interactions/lightweightFeedback.test.tsx`

Expected: FAIL because the process and export buttons have no handlers.

- [ ] **Step 3: Wire smooth scrolling and export feedback**

Use:

```ts
document.getElementById("process")?.scrollIntoView({ behavior: "smooth", block: "start" });
```

Both export buttons call `notify("info", "导出任务已创建")`. Do not create blobs or downloads. Change `AuditLogPage` to render `state.operationLogs` together with submission audit records, removing its two hard-coded log objects.

- [ ] **Step 4: Audit remaining production buttons**

Run:

```bash
rg -n '<button' web/src/features web/src/layout web/src/components
```

Verify this explicit checklist: public login and process buttons navigate/scroll; collector upload, details, withdrawal, and profile buttons already mutate/navigate; team invitation and member-detail buttons open modals; administrator rerun, review, user, rule, settlement, delivery, withdrawal, public-config, and both export buttons mutate or provide feedback; top-bar notification toggles its panel. If the audit finds a button outside this checklist, connect it to navigation, an existing form, or `notify("info", "该功能将在后续版本接入")` without creating fake records.

- [ ] **Step 5: Run the lightweight test and complete suite**

Run: `pnpm test -- src/features/interactions/lightweightFeedback.test.tsx && pnpm test`

Expected: all tests pass with zero failures.

- [ ] **Step 6: Update project documentation**

Add an “交互演示” section to `README.md` documenting session-only behavior and the available invitation, user, rule, settlement, delivery, notification, and feedback flows.

- [ ] **Step 7: Run final verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:render
git diff --check
git status --short
```

Expected: 0 failing tests, 0 type errors, successful production build and rendered HTML tests, no whitespace errors, and only intentional source changes.

- [ ] **Step 8: Commit the verified interaction enhancement**

```bash
git add README.md web
git commit -m "feat: complete basic platform interactions"
```
