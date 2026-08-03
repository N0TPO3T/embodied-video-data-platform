import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { DemoStoreProvider, useDemoStore } from "../../data/DemoStoreContext";

function LeaderBootstrap({ path }: { path: string }) {
  const { loginAs } = useDemoStore();
  useEffect(() => loginAs("leader"), []);
  return <PlatformApp initialPath={path} />;
}

function renderLeader(path: string) {
  window.history.replaceState({}, "", path);
  return render(
    <DemoStoreProvider>
      <LeaderBootstrap path={path} />
    </DemoStoreProvider>,
  );
}

async function fillInviteForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("成员姓名"), "苏禾");
  await user.type(screen.getByLabelText("手机号"), "13812345678");
}

describe("team member interactions", () => {
  it("invites a member and updates the team list", async () => {
    const user = userEvent.setup();
    renderLeader("/team/members");

    await user.click(
      await screen.findByRole("button", { name: "邀请成员" }),
    );
    await fillInviteForm(user);
    await user.click(screen.getByRole("button", { name: "确认邀请" }));

    expect(screen.getByText("苏禾")).toBeVisible();
    expect(screen.getByText("成员已加入团队")).toBeVisible();
    expect(screen.getByText("6 位成员")).toBeVisible();
  });

  it("shows duplicate phone errors without closing the form", async () => {
    const user = userEvent.setup();
    renderLeader("/team/members");

    await user.click(
      await screen.findByRole("button", { name: "邀请成员" }),
    );
    await fillInviteForm(user);
    await user.click(screen.getByRole("button", { name: "确认邀请" }));
    await user.click(screen.getByRole("button", { name: "邀请成员" }));
    await fillInviteForm(user);
    await user.click(screen.getByRole("button", { name: "确认邀请" }));

    expect(screen.getByRole("alert")).toHaveTextContent("该手机号已存在");
    expect(screen.getByRole("dialog", { name: "邀请成员" })).toBeVisible();
  });

  it("prevents a double submit from creating duplicate members", async () => {
    const user = userEvent.setup();
    renderLeader("/team/members");

    await user.click(
      await screen.findByRole("button", { name: "邀请成员" }),
    );
    await fillInviteForm(user);
    await user.dblClick(screen.getByRole("button", { name: "确认邀请" }));

    expect(screen.getAllByText("苏禾")).toHaveLength(1);
    expect(screen.getByText("6 位成员")).toBeVisible();
  });

  it("opens read-only member details with contribution metrics", async () => {
    const user = userEvent.setup();
    renderLeader("/team/members");

    const viewButtons = await screen.findAllByRole("button", { name: "查看" });
    await user.click(viewButtons[0]);

    const dialog = screen.getByRole("dialog", { name: "成员详情" });
    expect(within(dialog).getByText("zhoumingyuan")).toBeVisible();
    expect(within(dialog).getByText("139****1176")).toBeVisible();
    expect(within(dialog).getByText("今日上传")).toBeVisible();
    expect(within(dialog).getByText("有效时长")).toBeVisible();
    expect(within(dialog).getByText("通过率")).toBeVisible();
  });

  it("opens the same invite flow from the team dashboard", async () => {
    const user = userEvent.setup();
    renderLeader("/team");

    await user.click(
      await screen.findByRole("button", { name: "邀请成员" }),
    );
    expect(screen.getByRole("dialog", { name: "邀请成员" })).toBeVisible();
  });
});
