import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DemoStoreProvider, useDemoStore } from "./DemoStoreContext";

function StoreProbe() {
  const { currentUser, loginAs } = useDemoStore();
  return (
    <div>
      <span>{currentUser.name}</span>
      <button onClick={() => loginAs("admin")}>switch</button>
    </div>
  );
}

function WorkflowProbe() {
  const {
    state,
    loginAs,
    inviteMember,
    addUser,
    updateUser,
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
          loginAs("leader");
          inviteMember({ name: "苏禾", phone: "13812345678" });
        }}
      >
        invite
      </button>
      <button
        onClick={() => {
          loginAs("admin");
          const created = addUser({
            name: "沈舟",
            account: "shenzhou",
            role: "collector",
            teamId: "TEAM-01",
          });
          updateUser({
            userId: created.id,
            role: "collector",
            teamId: "TEAM-02",
          });
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

describe("DemoStoreProvider", () => {
  it("re-renders consumers when the store state changes", async () => {
    const user = userEvent.setup();
    render(
      <DemoStoreProvider>
        <StoreProbe />
      </DemoStoreProvider>,
    );

    expect(screen.getByText("林晓雨")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "switch" }));
    expect(screen.getByText("陈屿")).toBeVisible();
  });

  it("requires the hook to be used within the provider", () => {
    expect(() => render(<StoreProbe />)).toThrow(
      "useDemoStore must be used inside DemoStoreProvider",
    );
  });

  it("exposes all session workflow commands and publishes their state", async () => {
    const user = userEvent.setup();
    render(
      <DemoStoreProvider>
        <WorkflowProbe />
      </DemoStoreProvider>,
    );

    expect(screen.getByText("用户 8")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "invite" }));
    expect(screen.getByText("用户 9")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "configure" }));
    expect(screen.getByText("用户 10")).toBeVisible();
    expect(screen.getByText("规则 RULE-2026-09")).toBeVisible();
    expect(screen.getByText("标签 家庭烹饪")).toBeVisible();
    expect(screen.getByText("结算 3")).toBeVisible();
    expect(screen.getByText("交付 1")).toBeVisible();
  });
});
