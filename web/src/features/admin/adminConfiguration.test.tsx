import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { DemoStoreProvider, useDemoStore } from "../../data/DemoStoreContext";

function AdminBootstrap({ path }: { path: string }) {
  const { loginAs } = useDemoStore();
  useEffect(() => loginAs("admin"), [loginAs]);
  return <PlatformApp initialPath={path} />;
}

function renderAdmin(path: string) {
  window.history.replaceState({}, "", path);
  return render(
    <DemoStoreProvider>
      <AdminBootstrap path={path} />
    </DemoStoreProvider>,
  );
}

describe("administrator user configuration", () => {
  it("creates a user and updates the live account list", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/people");

    await user.click(await screen.findByRole("button", { name: "新增用户" }));
    await user.type(screen.getByLabelText("姓名"), "沈舟");
    await user.type(screen.getByLabelText("登录账号"), "shenzhou");
    await user.selectOptions(screen.getByLabelText("角色"), "collector");
    await user.selectOptions(screen.getByLabelText("所属团队"), "TEAM-01");
    await user.click(screen.getByRole("button", { name: "创建用户" }));

    expect(screen.getByText("沈舟")).toBeVisible();
    expect(screen.getByText("用户已创建")).toBeVisible();
    expect(screen.getByText("9")).toBeVisible();
  });

  it("shows duplicate-account errors inline", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/people");

    await user.click(await screen.findByRole("button", { name: "新增用户" }));
    await user.type(screen.getByLabelText("姓名"), "重复账号");
    await user.type(screen.getByLabelText("登录账号"), "linxiaoyu");
    await user.selectOptions(screen.getByLabelText("角色"), "collector");
    await user.selectOptions(screen.getByLabelText("所属团队"), "TEAM-01");
    await user.click(screen.getByRole("button", { name: "创建用户" }));

    expect(screen.getByRole("alert")).toHaveTextContent("登录账号已存在");
    expect(screen.getByRole("dialog", { name: "新增用户" })).toBeVisible();
  });

  it("moves a collector to another team", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/people");

    const row = (await screen.findByText("林晓雨")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "配置" }));
    await user.selectOptions(screen.getByLabelText("所属团队"), "TEAM-02");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(within(row).getByText("远山二队")).toBeVisible();
    expect(screen.getByText("用户配置已更新")).toBeVisible();
  });
});

describe("administrator rule configuration", () => {
  it("publishes a new active rule version", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/rules");

    await user.click(
      await screen.findByRole("button", { name: "新建规则版本" }),
    );
    await user.type(screen.getByLabelText("版本名称"), "RULE-2026-09");
    await user.clear(screen.getByLabelText("通过阈值"));
    await user.type(screen.getByLabelText("通过阈值"), "65");
    await user.type(screen.getByLabelText("规则说明"), "九月质量规则");
    await user.click(screen.getByRole("button", { name: "发布规则" }));

    expect(screen.getByText("RULE-2026-09")).toBeVisible();
    expect(screen.getByText("65 分")).toBeVisible();
    expect(screen.getByText("规则版本已发布")).toBeVisible();
  });

  it("edits a label name and enabled state", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/rules");

    const row = (await screen.findByText("家庭厨房")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "编辑" }));
    await user.clear(screen.getByLabelText("标签名称"));
    await user.type(screen.getByLabelText("标签名称"), "家庭烹饪");
    await user.click(screen.getByLabelText("启用标签"));
    await user.click(screen.getByRole("button", { name: "保存标签" }));

    expect(within(row).getByText("家庭烹饪")).toBeVisible();
    expect(within(row).getByText("停用")).toBeVisible();
    expect(screen.getByText("标签已更新")).toBeVisible();
  });
});
