import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AccountPublic } from "../auth/contracts";
import type { BackendSubmission } from "../submissions/contracts";
import {
  accountToUser,
  DemoStoreProvider,
  useDemoStore,
} from "./DemoStoreContext";

function StoreProbe() {
  const { currentUser, syncAccount } = useDemoStore();
  return (
    <div>
      <span>{currentUser.name}</span>
      <button
        onClick={() =>
          syncAccount({ ...currentUser, name: "测试人员1更新" })
        }
      >
        sync current
      </button>
    </div>
  );
}

function WorkflowProbe() {
  const {
    state,
    createRuleVersion,
    updateLabel,
    createSettlementBatch,
    createDeliveryPackage,
  } = useDemoStore();

  return (
    <div>
      <span>用户 {state.users.length}</span>
      <span>规则 {state.rule.version}</span>
      <span>标签 {state.labels[0].name}</span>
      <span>结算 {state.settlements.length}</span>
      <span>交付 {state.deliveryPackages.length}</span>
      <button
        onClick={() => {
          createRuleVersion({
            version: "RULE-2026-09",
            passThreshold: 65,
            description: "九月规则",
          });
          updateLabel({ id: "SCENE-001", name: "家庭烹饪", enabled: true });
          createSettlementBatch();
          createDeliveryPackage({ name: "八月交付包" });
        }}
      >
        configure
      </button>
    </div>
  );
}

function AuthenticatedProbe({
  account,
}: {
  account: AccountPublic;
}) {
  const { currentUser, state, syncAccount } = useDemoStore();
  return (
    <div>
      <span>当前 {currentUser.name}</span>
      <span>用户 {state.users.length}</span>
      <button onClick={() => syncAccount(accountToUser(account))}>
        sync
      </button>
    </div>
  );
}

function SubmissionProbe({ next }: { next: BackendSubmission }) {
  const { state, upsertSubmission } = useDemoStore();
  return (
    <div>
      <span>视频 {state.submissions.length}</span>
      <span>{state.submissions[0]?.fileName}</span>
      <button onClick={() => upsertSubmission(next)}>upsert video</button>
    </div>
  );
}

describe("DemoStoreProvider", () => {
  it("re-renders consumers when the store state changes", async () => {
    const user = userEvent.setup();
    render(
      <DemoStoreProvider>
        <StoreProbe />
      </DemoStoreProvider>,
    );

    expect(screen.getByText("测试人员1")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "sync current" }),
    );
    expect(screen.getByText("测试人员1更新")).toBeVisible();
  });

  it("requires the hook to be used within the provider", () => {
    expect(() => render(<StoreProbe />)).toThrow(
      "useDemoStore must be used inside DemoStoreProvider",
    );
  });

  it("hydrates only the server-scoped account snapshot", async () => {
    const user = userEvent.setup();
    const admin: AccountPublic = {
      id: "U-ADMIN-01",
      displayName: "管理员",
      username: "admin",
      role: "admin",
      status: "active",
      updatedAt: 1_722_708_000_000,
    };
    const secondAdmin: AccountPublic = {
      ...admin,
      id: "U-ADMIN-02",
      displayName: "管理员2",
      username: "admin2",
    };

    render(
      <DemoStoreProvider currentAccount={admin} accounts={[admin]}>
        <AuthenticatedProbe account={secondAdmin} />
      </DemoStoreProvider>,
    );

    expect(screen.getByText("当前 管理员")).toBeVisible();
    expect(screen.getByText("用户 1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "sync" }));
    expect(screen.getByText("用户 2")).toBeVisible();
  });

  it("hydrates real backend submissions and upserts upload results", async () => {
    const user = userEvent.setup();
    const collector: AccountPublic = {
      id: "U-COL-01",
      displayName: "测试人员1",
      username: "ceshirenyuan1",
      role: "collector",
      teamId: "TEAM-01",
      status: "active",
      updatedAt: 1_722_708_000_000,
    };
    const first: BackendSubmission = {
      id: "SUB-REAL-01",
      fileName: "real-one.mp4",
      ownerId: collector.id,
      ownerName: collector.displayName,
      teamId: "TEAM-01",
      teamName: "星火一队",
      sizeBytes: "1024",
      uploadStatus: "uploaded",
      processingStatus: "queued",
      isTestData: true,
      createdAt: 1_786_118_400_000,
      segments: [],
    };
    const next = { ...first, id: "SUB-REAL-02", fileName: "real-two.mov" };

    render(
      <DemoStoreProvider
        currentAccount={collector}
        accounts={[collector]}
        backendSubmissions={[first]}
      >
        <SubmissionProbe next={next} />
      </DemoStoreProvider>,
    );

    expect(screen.getByText("视频 1")).toBeVisible();
    expect(screen.getByText("real-one.mp4")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "upsert video" }));
    expect(screen.getByText("视频 2")).toBeVisible();
    expect(screen.getByText("real-two.mov")).toBeVisible();
  });

  it("exposes all session workflow commands and publishes their state", async () => {
    const user = userEvent.setup();
    const admin: AccountPublic = {
      id: "U-ADMIN-01",
      displayName: "管理员",
      username: "admin",
      role: "admin",
      status: "active",
      updatedAt: 1_722_708_000_000,
    };
    render(
      <DemoStoreProvider currentAccount={admin} accounts={[admin]}>
        <WorkflowProbe />
      </DemoStoreProvider>,
    );

    expect(screen.getByText("用户 1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "configure" }));
    expect(screen.getByText("用户 1")).toBeVisible();
    expect(screen.getByText("规则 RULE-2026-09")).toBeVisible();
    expect(screen.getByText("标签 家庭烹饪")).toBeVisible();
    expect(screen.getByText("结算 3")).toBeVisible();
    expect(screen.getByText("交付 1")).toBeVisible();
  });
});
