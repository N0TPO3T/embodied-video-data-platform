import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { DemoStoreProvider } from "../../data/DemoStoreContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

function renderLeader(path: string) {
  window.history.replaceState({}, "", path);
  const leader = accountForRole("leader");
  return render(
    <IdentityProvider
      currentAccount={leader}
      accounts={demoAccounts}
      teams={[{ id: "TEAM-01", name: "星火一队", status: "active", unitPricePerMinute: 12, createdAt: 1_722_708_000_000, updatedAt: 1_722_708_000_000 }]}
    >
      <DemoStoreProvider currentAccount={leader} accounts={demoAccounts}>
        <PlatformApp initialPath={path} />
      </DemoStoreProvider>
    </IdentityProvider>,
  );
}

describe("team member interactions", () => {
  it("labels synthetic member contribution values as demo business metrics", () => {
    renderLeader("/team/members");

    expect(screen.getByRole("note")).toHaveTextContent(
      "示例数据：今日上传、有效时长和通过率为演示业务指标",
    );
    expect(screen.getByRole("table")).toHaveAccessibleDescription(
      "示例数据：今日上传、有效时长和通过率为演示业务指标",
    );
  });

  it("opens the own-team collector account form", async () => {
    const user = userEvent.setup();
    renderLeader("/team/members");

    await user.click(
      await screen.findByRole("button", { name: "新增数采账号" }),
    );

    expect(
      screen.getByRole("dialog", { name: "新增数采账号" }),
    ).toBeVisible();
    expect(screen.getByText("账号将自动归属星火一队")).toBeVisible();
    expect(screen.getByText("5 位成员")).toBeVisible();
  });

  it("opens read-only member details with contribution metrics", async () => {
    const user = userEvent.setup();
    renderLeader("/team/members");

    const viewButtons = await screen.findAllByRole("button", { name: "查看" });
    await user.click(viewButtons[0]);

    const dialog = screen.getByRole("dialog", { name: "成员详情" });
    expect(within(dialog).getByText("tuanzhang1")).toBeVisible();
    expect(within(dialog).getByText("139****1176")).toBeVisible();
    expect(within(dialog).getByText("今日上传")).toBeVisible();
    expect(within(dialog).getByText("有效时长")).toBeVisible();
    expect(within(dialog).getByText("通过率")).toBeVisible();
  });

  it("shows the same administrator guidance from the team dashboard", async () => {
    const user = userEvent.setup();
    renderLeader("/team");

    await user.click(
      await screen.findByRole("button", { name: "邀请成员" }),
    );
    expect(
      screen.getByText("请联系管理员在“用户与团队”中创建账号"),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "邀请成员" }),
    ).not.toBeInTheDocument();
  });
});
