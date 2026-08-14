import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { DemoStoreProvider } from "../../data/DemoStoreContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

function renderPath(path: string, admin = false) {
  window.history.replaceState({}, "", path);
  const account = admin ? accountForRole("admin") : undefined;
  const app = (
    <DemoStoreProvider
      currentAccount={account}
      accounts={account ? demoAccounts : undefined}
    >
      <PlatformApp initialPath={path} />
    </DemoStoreProvider>
  );
  return render(
    account ? <IdentityProvider currentAccount={account} accounts={demoAccounts} teams={[]}>{app}</IdentityProvider> : app,
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

  it("links submissions export to the backend CSV endpoint", async () => {
    renderPath("/admin/submissions", true);

    expect(
      await screen.findByRole("link", { name: "导出当前结果" }),
    ).toHaveAttribute(
      "href",
      "http://localhost:4000/api/v1/submissions/export.csv",
    );
  });

  it("renders session operation logs and links audit export to CSV", async () => {
    renderPath("/admin/audit", true);

    expect(await screen.findByText("调整团队积分规则")).toBeVisible();
    expect(screen.getByRole("link", { name: "导出日志" })).toHaveAttribute(
      "href",
      "http://localhost:4000/api/v1/audit-logs/export.csv",
    );
  });
});
