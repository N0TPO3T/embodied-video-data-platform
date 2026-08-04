import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DemoStoreProvider } from "../../data/DemoStoreContext";
import { InteractionProvider } from "../../interactions/InteractionContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { AuditLogPage } from "./AuditLogPage";

const { listAccountAudit } = vi.hoisted(() => ({
  listAccountAudit: vi.fn(),
}));

vi.mock("../../auth/client/accountApi", () => ({
  listAccountAudit,
}));

describe("AuditLogPage", () => {
  it("shows persistent account events together with demo workflow events", async () => {
    listAccountAudit.mockResolvedValue([
      {
        id: "AUD-ACCOUNT-01",
        actorAccountId: "U-ADMIN-01",
        actorName: "管理员",
        action: "reset_password",
        targetAccountId: "U-COL-01",
        targetName: "测试人员1",
        summary: "管理员重置了测试人员1的密码",
        createdAt: Date.UTC(2026, 7, 4, 6, 30),
      },
    ]);
    const admin = accountForRole("admin");

    render(
      <DemoStoreProvider currentAccount={admin} accounts={demoAccounts}>
        <InteractionProvider>
          <AuditLogPage />
        </InteractionProvider>
      </DemoStoreProvider>,
    );

    expect(await screen.findByText("重置密码")).toBeVisible();
    expect(screen.getByText("测试人员1")).toBeVisible();
    expect(screen.getByText("调整团队单价")).toBeVisible();
  });
});
