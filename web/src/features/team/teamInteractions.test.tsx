import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { DemoStoreProvider } from "../../data/DemoStoreContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

function renderLeader(path: string) {
  window.history.replaceState({}, "", path);
  const leader = accountForRole("leader");
  return render(
    <DemoStoreProvider currentAccount={leader} accounts={demoAccounts}>
      <PlatformApp initialPath={path} />
    </DemoStoreProvider>,
  );
}

describe("team member interactions", () => {
  it("directs leaders to an administrator without changing the team", async () => {
    const user = userEvent.setup();
    renderLeader("/team/members");

    await user.click(
      await screen.findByRole("button", { name: "邀请成员" }),
    );

    expect(
      screen.getByText("请联系管理员在“用户与团队”中创建账号"),
    ).toBeVisible();
    expect(screen.getByText("5 位成员")).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "邀请成员" }),
    ).not.toBeInTheDocument();
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
