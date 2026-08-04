import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountPublic } from "../../auth/contracts";
import * as accountApi from "../../auth/client/accountApi";
import { DemoStoreProvider } from "../../data/DemoStoreContext";
import { InteractionProvider } from "../../interactions/InteractionContext";
import { UsersTeamsPage } from "./UsersTeamsPage";

vi.mock("../../auth/client/accountApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../auth/client/accountApi")
  >("../../auth/client/accountApi");
  return {
    ...actual,
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    resetAccountPassword: vi.fn(),
    setAccountStatus: vi.fn(),
  };
});

const adminAccount: AccountPublic = {
  id: "U-ADMIN-01",
  displayName: "管理员",
  username: "admin",
  role: "admin",
  status: "active",
  updatedAt: 1_722_708_000_000,
};

const collectorAccount: AccountPublic = {
  id: "U-COL-01",
  displayName: "测试人员1",
  username: "ceshirenyuan1",
  role: "collector",
  teamId: "TEAM-01",
  status: "active",
  updatedAt: 1_722_708_000_000,
};

afterEach(() => {
  vi.mocked(accountApi.createAccount).mockReset();
  vi.mocked(accountApi.updateAccount).mockReset();
  vi.mocked(accountApi.resetAccountPassword).mockReset();
  vi.mocked(accountApi.setAccountStatus).mockReset();
});

function renderAdminAccounts() {
  return render(
    <InteractionProvider>
      <DemoStoreProvider
        currentAccount={adminAccount}
        accounts={[adminAccount, collectorAccount]}
      >
        <UsersTeamsPage />
      </DemoStoreProvider>
    </InteractionProvider>,
  );
}

describe("administrator account management", () => {
  it("creates another administrator and updates the account list", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.createAccount).mockResolvedValue({
      ...adminAccount,
      id: "U-ADMIN-02",
      displayName: "管理员2",
      username: "admin2",
      updatedAt: 1_722_708_100_000,
    });
    renderAdminAccounts();

    await user.click(screen.getByRole("button", { name: "新增账号" }));
    await user.type(screen.getByLabelText("显示名称"), "管理员2");
    await user.type(screen.getByLabelText("用户名"), "admin2");
    await user.type(screen.getByLabelText("初始密码"), "admin234");
    await user.selectOptions(screen.getByLabelText("角色"), "admin");
    await user.dblClick(
      screen.getByRole("button", { name: "创建账号" }),
    );

    expect(accountApi.createAccount).toHaveBeenCalledTimes(1);
    expect(accountApi.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "admin2",
        role: "admin",
        teamId: undefined,
      }),
    );
    expect(screen.getByText("管理员2")).toBeVisible();
    expect(screen.getByText("账号已创建")).toBeVisible();
  });

  it("edits a display name and username through the persistent API", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.updateAccount).mockResolvedValue({
      ...collectorAccount,
      displayName: "测试人员一",
      username: "collector.one",
      updatedAt: 1_722_708_100_000,
    });
    renderAdminAccounts();
    const row = screen.getByText("测试人员1").closest("tr")!;

    await user.click(within(row).getByRole("button", { name: "编辑" }));
    await user.clear(screen.getByLabelText("显示名称"));
    await user.type(screen.getByLabelText("显示名称"), "测试人员一");
    await user.clear(screen.getByLabelText("用户名"));
    await user.type(screen.getByLabelText("用户名"), "collector.one");
    await user.click(screen.getByRole("button", { name: "保存账号" }));

    expect(screen.getByText("测试人员一")).toBeVisible();
    expect(screen.getByText("collector.one")).toBeVisible();
    expect(screen.getByText("账号信息已更新")).toBeVisible();
  });

  it("validates password confirmation before resetting an account", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.resetAccountPassword).mockResolvedValue({
      reauthenticate: false,
    });
    renderAdminAccounts();
    const row = screen.getByText("测试人员1").closest("tr")!;

    await user.click(
      within(row).getByRole("button", { name: "重置密码" }),
    );
    await user.type(screen.getByLabelText("新密码"), "newpassword");
    await user.type(
      screen.getByLabelText("确认新密码"),
      "different-password",
    );
    await user.click(screen.getByRole("button", { name: "确认重置" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "两次输入的密码不一致",
    );
    expect(accountApi.resetAccountPassword).not.toHaveBeenCalled();
  });

  it("disables another account after confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.setAccountStatus).mockResolvedValue({
      ...collectorAccount,
      status: "disabled",
      updatedAt: 1_722_708_100_000,
    });
    renderAdminAccounts();
    const row = screen.getByText("测试人员1").closest("tr")!;

    await user.click(within(row).getByRole("button", { name: "停用" }));
    await user.click(screen.getByRole("button", { name: "确认停用" }));

    expect(within(row).getByText("已停用")).toBeVisible();
    expect(screen.getByText("账号已停用")).toBeVisible();
  });

  it("filters accounts by search, role, and status", async () => {
    const user = userEvent.setup();
    renderAdminAccounts();

    await user.type(screen.getByLabelText("搜索账号"), "ceshi");
    expect(screen.getByText("测试人员1")).toBeVisible();
    expect(screen.queryByText("管理员", { selector: "strong" })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("搜索账号"));
    await user.selectOptions(screen.getByLabelText("角色筛选"), "admin");
    expect(screen.getByText("管理员", { selector: "strong" })).toBeVisible();
    expect(screen.queryByText("测试人员1")).not.toBeInTheDocument();
  });
});
