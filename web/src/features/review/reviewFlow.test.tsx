import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { DemoStoreProvider, useDemoStore } from "../../data/DemoStoreContext";
import type { Role } from "../../domain/types";

function RoleBootstrap({ role, path }: { role: Role; path: string }) {
  const { loginAs } = useDemoStore();
  useEffect(() => loginAs(role), [role]);
  return <PlatformApp initialPath={path} />;
}

function renderRole(path: string, role: Role) {
  window.history.replaceState({}, "", path);
  return render(<DemoStoreProvider><RoleBootstrap path={path} role={role} /></DemoStoreProvider>);
}

describe("review workflows", () => {
  it("requires a reason before saving a quality adjustment", async () => {
    const user = userEvent.setup();
    renderRole("/team/review", "leader");

    await user.click((await screen.findAllByRole("button", { name: "复核" }))[0]);
    await user.clear(screen.getByLabelText("最终评分"));
    await user.type(screen.getByLabelText("最终评分"), "88");
    await user.click(screen.getByRole("button", { name: "保存调整" }));

    expect(screen.getByText("请填写调整原因")).toBeVisible();
  });

  it("lets an administrator approve a pending withdrawal", async () => {
    const user = userEvent.setup();
    renderRole("/admin/withdrawals", "admin");

    await user.click((await screen.findAllByRole("button", { name: "审核" }))[0]);
    await user.click(screen.getByRole("button", { name: "批准申请" }));

    expect(screen.getByText("待打款")).toBeVisible();
  });
});
