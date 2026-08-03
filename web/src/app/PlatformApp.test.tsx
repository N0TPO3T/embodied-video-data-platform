import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DemoStoreProvider } from "../data/DemoStoreContext";
import { PlatformApp } from "./PlatformApp";

function renderPlatform(path: string) {
  window.history.replaceState({}, "", path);
  return render(
    <DemoStoreProvider>
      <PlatformApp initialPath={path} />
    </DemoStoreProvider>,
  );
}

describe("platform routing", () => {
  it("renders the public site at the root route", () => {
    renderPlatform("/");
    expect(
      screen.getByRole("heading", {
        name: "让每一段视频，成为可用的具身数据",
      }),
    ).toBeVisible();
  });

  it("routes the collector demo account to the collector dashboard", async () => {
    const user = userEvent.setup();
    renderPlatform("/login");

    await user.click(
      screen.getByRole("button", { name: "以数采人员身份进入" }),
    );

    expect(
      await screen.findByRole("heading", { name: "早上好，林晓雨" }),
    ).toBeVisible();
  });

  it("redirects a collector away from the admin area", () => {
    renderPlatform("/admin");
    expect(screen.getByRole("heading", { name: "我的工作台" })).toBeVisible();
    expect(screen.queryByText("提现审核")).not.toBeInTheDocument();
  });

  it("shows team review navigation to a leader", async () => {
    const user = userEvent.setup();
    renderPlatform("/login");
    await user.click(
      screen.getByRole("button", { name: "以团长身份进入" }),
    );

    expect(
      await screen.findByRole("link", { name: /^结算前复核/ }),
    ).toBeVisible();
  });

  it("shows full operations navigation to an administrator", async () => {
    const user = userEvent.setup();
    renderPlatform("/login");
    await user.click(
      screen.getByRole("button", { name: "以管理员身份进入" }),
    );

    expect(await screen.findByRole("link", { name: /^AI 任务/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /^提现审核/ })).toBeVisible();
  });
});
