import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { DemoStoreProvider } from "../../data/DemoStoreContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

function renderAdmin(path: string) {
  window.history.replaceState({}, "", path);
  const admin = accountForRole("admin");
  return render(
    <DemoStoreProvider currentAccount={admin} accounts={demoAccounts}>
      <PlatformApp initialPath={path} />
    </DemoStoreProvider>,
  );
}

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
