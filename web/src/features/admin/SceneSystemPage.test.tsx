import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import {
  createSceneClassification,
  createSceneLibrary,
  deleteSceneLibrary,
  listLevel1Scenes,
  listSceneClassification,
  listSceneLibrary,
  updateSceneLibrary,
} from "../../scene-system/client/sceneSystemApi";

const sceneApi = vi.hoisted(() => ({
  listLevel1Scenes: vi.fn(),
  listSceneClassification: vi.fn(),
  listSceneLibrary: vi.fn(),
  createSceneClassification: vi.fn(),
  updateSceneClassification: vi.fn(),
  deleteSceneClassification: vi.fn(),
  createSceneLibrary: vi.fn(),
  updateSceneLibrary: vi.fn(),
  deleteSceneLibrary: vi.fn(),
}));

vi.mock("../../scene-system/client/sceneSystemApi", () => ({
  listLevel1Scenes: sceneApi.listLevel1Scenes,
  listSceneClassification: sceneApi.listSceneClassification,
  listSceneLibrary: sceneApi.listSceneLibrary,
  createSceneClassification: sceneApi.createSceneClassification,
  updateSceneClassification: sceneApi.updateSceneClassification,
  deleteSceneClassification: sceneApi.deleteSceneClassification,
  createSceneLibrary: sceneApi.createSceneLibrary,
  updateSceneLibrary: sceneApi.updateSceneLibrary,
  deleteSceneLibrary: sceneApi.deleteSceneLibrary,
}));

const level1 = [
  { code: "F01", name: "家庭", categoryKey: "family" },
  { code: "O01", name: "办公室", categoryKey: "office" },
  { code: "W01", name: "工厂", categoryKey: "factory" },
  { code: "G01", name: "通用", categoryKey: "generic" },
];

const classification = [
  { id: "SC-001", level1Code: "F01", level1Name: "家庭", level2Name: "厨房", description: "备餐炒菜", enabled: true, updatedAt: 0 },
  { id: "SC-002", level1Code: "F01", level1Name: "家庭", level2Name: "客厅", description: "整理清洁", enabled: true, updatedAt: 0 },
  { id: "SC-006", level1Code: "O01", level1Name: "办公室", level2Name: "工位", description: "桌面整理", enabled: true, updatedAt: 0 },
];

function renderAdmin(path = "/admin/scenes") {
  window.history.replaceState({}, "", path);
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath={path} />
    </IdentityProvider>,
  );
}

describe("SceneSystemPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sceneApi.listLevel1Scenes.mockReset().mockResolvedValue(level1);
    sceneApi.listSceneClassification
      .mockReset()
      .mockResolvedValue(classification);
    sceneApi.listSceneLibrary.mockReset().mockResolvedValue([
      {
        id: "SL-001",
        name: "采集员A家",
        categoryKey: "family",
        categoryName: "家庭",
        subScenes: [{ id: "SC-001", level2Name: "厨房", level1Code: "F01" }],
        subSceneIds: ["SC-001"],
        description: "采集员A的家庭",
        enabled: true,
        createdByName: "管理员",
        updatedAt: 0,
      },
    ]);
  });

  it("renders the scene classification grouped by level-1 and the scene library", async () => {
    renderAdmin();
    expect(
      await screen.findByRole("heading", { level: 1, name: "场景体系" }),
    ).toBeInTheDocument();

    // 分类表：按一级分组展示二级场景
    expect(screen.getByText("F01")).toBeInTheDocument();
    expect(screen.getAllByText("家庭").length).toBeGreaterThan(0);
    expect(screen.getAllByText("厨房").length).toBeGreaterThan(0);
    expect(screen.getByText("客厅")).toBeInTheDocument();
    expect(screen.getByText("O01")).toBeInTheDocument();
    expect(screen.getByText("工位")).toBeInTheDocument();

    // 场景库表格
    expect(screen.getByText("采集员A家")).toBeInTheDocument();
  });

  it("creates a library scene with category and sub-scenes", async () => {
    const user = userEvent.setup();
    sceneApi.createSceneLibrary.mockReset().mockResolvedValue({
      id: "SL-002",
      name: "采集员B家",
      categoryKey: "family",
      categoryName: "家庭",
      subScenes: [
        { id: "SC-001", level2Name: "厨房", level1Code: "F01" },
        { id: "SC-002", level2Name: "客厅", level1Code: "F01" },
      ],
      subSceneIds: ["SC-001", "SC-002"],
      description: "",
      enabled: true,
      createdByName: "管理员",
      updatedAt: 0,
    });
    renderAdmin();
    await screen.findByText("采集员A家");

    await user.click(screen.getByRole("button", { name: "新增场景" }));
    await user.type(screen.getByLabelText(/场景名称/), "采集员B家");
    await user.click(screen.getByLabelText("厨房"));
    await user.click(screen.getByLabelText("客厅"));
    await user.click(screen.getByRole("button", { name: "新增" }));

    expect(createSceneLibrary).toHaveBeenCalledWith({
      name: "采集员B家",
      categoryKey: "family",
      subSceneIds: ["SC-001", "SC-002"],
      description: "",
    });
    expect(await screen.findByText("采集员B家")).toBeVisible();
  });

  it("creates a second-level scene under a level-1 code", async () => {
    const user = userEvent.setup();
    sceneApi.createSceneClassification.mockReset().mockResolvedValue({
      id: "SC-099",
      level1Code: "O01",
      level1Name: "办公室",
      level2Name: "库房",
      description: "出入库管理",
      enabled: true,
      updatedAt: 0,
    });
    renderAdmin();
    await screen.findByText("采集员A家");

    await user.click(screen.getByRole("button", { name: "新增二级场景" }));
    await user.selectOptions(screen.getByLabelText(/一级场景/), "O01");
    await user.type(screen.getByLabelText(/二级场景名称/), "库房");
    await user.type(screen.getByLabelText(/场景描述/), "出入库管理");
    await user.click(screen.getByRole("button", { name: "新增" }));

    expect(createSceneClassification).toHaveBeenCalledWith({
      level1Code: "O01",
      level2Name: "库房",
      description: "出入库管理",
    });
    expect(await screen.findByText("库房")).toBeVisible();
  });

  it("deletes a library scene after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    sceneApi.deleteSceneLibrary.mockReset().mockResolvedValue({ deleted: true });
    renderAdmin();
    await screen.findByText("采集员A家");

    await user.click(
      within(screen.getByText("采集员A家").closest("tr")!).getByRole("button", {
        name: "删除",
      }),
    );
    expect(confirmSpy).toHaveBeenCalledWith(
      "确认删除场景「采集员A家」？",
    );

    await waitFor(() => {
      expect(deleteSceneLibrary).toHaveBeenCalledWith("SL-001");
    });
    expect(await screen.findByText("场景已删除")).toBeVisible();
    confirmSpy.mockRestore();
  });
});
