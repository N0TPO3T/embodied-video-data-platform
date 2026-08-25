import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { DemoStoreProvider } from "../../data/DemoStoreContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const taskApi = vi.hoisted(() => ({
  listManage: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  confirm: vi.fn(),
  publish: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  close: vi.fn(),
  normalize: vi.fn(),
}));

vi.mock("../../tasks/client/taskApi", () => ({
  listManageTasks: taskApi.listManage,
  createTask: taskApi.create,
  updateTask: taskApi.update,
  confirmTaskRequirements: taskApi.confirm,
  publishTask: taskApi.publish,
  pauseTask: taskApi.pause,
  resumeTask: taskApi.resume,
  closeTask: taskApi.close,
  normalizeTaskRequirements: taskApi.normalize,
  taskErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "操作失败，请重试",
}));

const aiQualityApi = vi.hoisted(() => ({
  getLabelSet: vi.fn(),
}));

vi.mock("../../ai-quality/client/aiQualityApi", () => ({
  getLabelSet: aiQualityApi.getLabelSet,
}));

const draftTask = {
  id: "TASK-draft1",
  title: "厨房数据采集",
  description: "",
  sceneName: "家庭厨房",
  sceneLabelId: null,
  rawRequirements: "第一人称，出现双手",
  normalizedRequirements: null,
  normalizationStatus: "pending",
  pricePointsPerMinute: 15.5,
  status: "draft",
  revision: 1,
  createdByName: "管理员",
  publishedAt: null,
  pausedAt: null,
  closedAt: null,
  createdAt: 1_780_000_000_000,
  updatedAt: 1_780_000_000_000,
};

const publishedTask = {
  ...draftTask,
  id: "TASK-pub1",
  title: "客厅数据采集",
  sceneName: "家庭客厅",
  sceneLabelId: "SCENE-002",
  rawRequirements: "第一人称，出现双手",
  normalizedRequirements: {
    scene_description: "客厅场景",
    requirements: [{ type: "hard", content: "必须出现双手操作" }],
    quality_notes: [],
  },
  normalizationStatus: "ready",
  status: "published",
  publishedAt: 1_780_000_100_000,
};

function renderAdmin() {
  window.history.replaceState({}, "", "/admin/tasks");
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <DemoStoreProvider currentAccount={admin} accounts={demoAccounts}>
        <PlatformApp initialPath="/admin/tasks" />
      </DemoStoreProvider>
    </IdentityProvider>,
  );
}

describe("TasksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskApi.listManage.mockResolvedValue({
      tasks: [draftTask, publishedTask],
      pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
    });
    aiQualityApi.getLabelSet.mockResolvedValue({
      id: "LSV-1",
      revision: 1,
      version: "LABELS-REV-1",
      labels: [
        { id: "SCENE-001", name: "家庭厨房", type: "scene", associationCount: 0, enabled: true },
        { id: "SCENE-002", name: "家庭客厅", type: "scene", associationCount: 0, enabled: true },
      ],
      active: true,
      createdByAccountId: "u1",
      createdByName: "管理员",
      createdAt: 0,
    });
  });

  it("renders the task list with status and price", async () => {
    renderAdmin();
    expect(await screen.findByText("厨房数据采集")).toBeInTheDocument();
    expect(screen.getByText("客厅数据采集")).toBeInTheDocument();
    expect(screen.getAllByText("草稿").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已发布").length).toBeGreaterThan(0);
    expect(screen.getAllByText("15.5 分/分钟").length).toBeGreaterThan(0);
    expect(screen.getByText("共 2 个任务")).toBeInTheDocument();
  });

  it("opens the create form and creates a task", async () => {
    const user = userEvent.setup();
    taskApi.create.mockResolvedValue({ ...draftTask, title: "新任务" });
    renderAdmin();
    await screen.findByText("厨房数据采集");

    await user.click(screen.getByRole("button", { name: "创建任务" }));
    await user.type(
      screen.getByLabelText(/任务标题/),
      "新任务",
    );
    await user.type(
      screen.getByLabelText(/场景名称/),
      "户外街道",
    );
    await user.type(
      screen.getByLabelText(/任务要求/),
      "第一人称拍摄",
    );
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(taskApi.create).toHaveBeenCalledWith({
        title: "新任务",
        description: "",
        sceneName: "户外街道",
        rawRequirements: "第一人称拍摄",
        pricePointsPerMinute: null,
      });
    });
  });

  it("opens the normalize modal and confirms AI requirements", async () => {
    const user = userEvent.setup();
    taskApi.normalize.mockResolvedValue({
      scene_description: "厨房场景描述",
      requirements: [
        { type: "hard", content: "必须出现双手操作" },
        { type: "soft", content: "光线充足" },
      ],
      quality_notes: [],
    });
    taskApi.confirm.mockResolvedValue({
      ...draftTask,
      normalizationStatus: "ready",
      normalizedRequirements: {
        scene_description: "厨房场景描述",
        requirements: [{ type: "hard", content: "必须出现双手操作" }],
        quality_notes: [],
      },
    });
    renderAdmin();
    await screen.findByText("厨房数据采集");

    await user.click(screen.getByRole("button", { name: "规范化" }));
    expect(await screen.findByText("AI 要求规范化 · 厨房数据采集")).toBeInTheDocument();

    await waitFor(() => {
      expect(taskApi.normalize).toHaveBeenCalledWith("TASK-draft1");
    });
    expect(await screen.findByDisplayValue("必须出现双手操作")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认并保存" }));
    await waitFor(() => {
      expect(taskApi.confirm).toHaveBeenCalledWith("TASK-draft1", {
        scene_description: "厨房场景描述",
        requirements: [
          { type: "hard", content: "必须出现双手操作" },
          { type: "soft", content: "光线充足" },
        ],
        quality_notes: [],
      });
    });
  });

  it("publishes a task after confirming requirements", async () => {
    const user = userEvent.setup();
    taskApi.publish.mockResolvedValue({ ...draftTask, status: "published" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAdmin();
    await screen.findByText("厨房数据采集");

    await user.click(screen.getByRole("button", { name: "发布" }));
    await waitFor(() => {
      expect(taskApi.publish).toHaveBeenCalledWith("TASK-draft1");
    });
    vi.restoreAllMocks();
  });
});
