import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AccountPublic } from "../auth/contracts";
import { DemoStoreProvider } from "../data/DemoStoreContext";
import { InteractionProvider } from "../interactions/InteractionContext";
import { DashboardShell } from "./DashboardShell";

const admin: AccountPublic = {
  id: "U-ADMIN-01",
  displayName: "管理员",
  username: "admin",
  role: "admin",
  status: "active",
  updatedAt: 1_722_708_000_000,
};

describe("DashboardShell", () => {
  it("shows the authenticated account and signs out once", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn().mockResolvedValue(undefined);
    render(
      <DemoStoreProvider currentAccount={admin} accounts={[admin]}>
        <InteractionProvider>
          <DashboardShell
            currentPath="/admin"
            navigate={vi.fn()}
            onLogout={onLogout}
          >
            <p>content</p>
          </DashboardShell>
        </InteractionProvider>
      </DemoStoreProvider>,
    );

    expect(screen.getByText("管理员")).toBeVisible();
    expect(screen.queryByLabelText("演示角色")).not.toBeInTheDocument();
    await user.dblClick(
      screen.getByRole("button", { name: "退出登录" }),
    );
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
