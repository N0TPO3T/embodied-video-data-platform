import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { DemoStoreProvider, useDemoStore } from "../../data/DemoStoreContext";

function AdminBootstrap({ path }: { path: string }) {
  const { loginAs } = useDemoStore();
  useEffect(() => loginAs("admin"), [loginAs]);
  return <PlatformApp initialPath={path} />;
}

function renderPath(path: string, admin = false) {
  window.history.replaceState({}, "", path);
  return render(
    <DemoStoreProvider>
      {admin ? <AdminBootstrap path={path} /> : <PlatformApp initialPath={path} />}
    </DemoStoreProvider>,
  );
}

describe("lightweight feedback interactions", () => {
  it("smoothly scrolls the public process call to action", async () => {
    const user = userEvent.setup();
    renderPath("/");
    const scrollIntoView = vi.fn();
    document.getElementById("process")!.scrollIntoView = scrollIntoView;

    await user.click(screen.getByRole("button", { name: "了解生产流程" }));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("shows feedback instead of creating a fake submissions export", async () => {
    const user = userEvent.setup();
    renderPath("/admin/submissions", true);

    await user.click(
      await screen.findByRole("button", { name: "导出当前结果" }),
    );

    expect(screen.getByText("导出任务已创建")).toBeVisible();
  });

  it("renders session operation logs and gives audit export feedback", async () => {
    const user = userEvent.setup();
    renderPath("/admin/audit", true);

    expect(await screen.findByText("调整团队单价")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "导出日志" }));

    expect(screen.getByText("导出任务已创建")).toBeVisible();
  });
});
