import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../operations/client/operationsApi";
import type { TaskAssetList, TaskAssetFacets, TaskAssetSceneSummary } from "../../task-assets/contracts";
import { TaskAssetLibraryPage } from "./TaskAssetLibraryPage";
import { isKnownAuthenticatedPath, requiredRole } from "../../app/routes";
import { navigationByRole } from "../../app/navigation";

vi.mock("../../operations/client/operationsApi", () => ({
  getTaskAssets: vi.fn(), getTaskAssetFacets: vi.fn(), getTaskAssetSceneSummary: vi.fn(), getTaskSegmentPreview: vi.fn(),
  getTaskAssetAnnotation: vi.fn(), getTaskAssetAnnotationDownload: vi.fn(), getTaskAssetTechnicalDetail: vi.fn(), exportTaskAssetsCsv: vi.fn(),
}));

const summary = { assetCount: 1, totalSegmentDurationMs: 11000, totalStorageBytes: 2000, sourceGroupCount: 1,
  humanVerifiedCount: 0, inheritedCount: 1, mappedSceneCount: 0, proposedSceneCount: 1, unknownSceneCount: 0, unmappedLabelAssetCount: 1, uncertainAssetCount: 1 };
const data: TaskAssetList = {
  summary, indexHealth: { totalPublishedAssets: 3, projectedCurrentAssets: 1, missingProjectionAssets: 1, staleProjectionAssets: 1, projectionVersion: "task_asset_projection_v1" },
  pagination: { page: 1, pageSize: 50, total: 51, totalPages: 2 },
  items: [{ assetId: "TSA-TEST", currentAnnotationRevisionId: "REV-1", annotationRevision: 1, isCurrent: true,
    scene: { groupKey: "proposed:阳台", mappingStatus: "proposed", id: null, name: "阳台", coarseLabel: "室内", fineLabel: "阳台", verification: "inherited_from_published_annotation" },
    task: { description: "清洗杯子", verb: "wash_or_rinse", labelId: null, labelName: null, mappingStatus: "proposed" },
    objects: { ids: ["CUP"], names: ["杯子"], rawTexts: ["杯子"], unmappedCount: 0, proposedCount: 0 },
    tools: { ids: [], names: [], rawTexts: [], unmappedCount: 0, proposedCount: 0 },
    handMode: "both", executionPattern: "single_goal", interactionPrimitives: ["grasp"], complexitySignals: [],
    completion: "uncertain", resultStatus: "unknown", failureRecovery: "none_observed", semanticVerification: "inherited_from_published_annotation",
    sourceAnnotationAcceptance: "automatic", boundarySource: "coarse", media: { durationMs: 11000, width: 320, height: 180, frameRate: 30, hasAudio: true, materializationMode: "stream_copy", sizeBytes: 2000 },
    sourceGroupId: "SUB-1", hasUncertainty: true, hasUnmappedLabels: true, warningCount: 0, createdAt: 1700000000000, publishedAt: 1700000000000,
  }],
};
const facets: TaskAssetFacets = {
  scenes: [{ key: "proposed:阳台", name: "阳台", id: null, status: "proposed", count: 1 }], taskVerbs: [{ value: "wash_or_rinse", count: 1 }],
  taskLabels: [], objects: [{ id: "CUP", name: "杯子", count: 1 }], tools: [], handModes: [{ value: "both", count: 1 }],
  interactionPrimitives: [{ value: "grasp", count: 1 }], completions: [{ value: "uncertain", count: 1 }], results: [{ value: "unknown", count: 1 }],
  semanticVerifications: [{ value: "inherited_from_published_annotation", count: 1 }],
};
const scenes: TaskAssetSceneSummary = { totals: summary, rows: [{ ...summary, sceneKey: "proposed:阳台", sceneId: null, sceneName: "阳台", mappingStatus: "proposed",
  completeCount: 0, incompleteCount: 0, partialCount: 0, uncertainCompletionCount: 1, successCount: 0, failureCount: 0, partialResultCount: 0, unknownResultCount: 1, notApplicableResultCount: 0,
  topTaskVerbs: [{ value: "wash_or_rinse", count: 1 }], topObjects: [{ id: "CUP", name: "杯子", count: 1 }], topTools: [],
}] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getTaskAssets).mockResolvedValue(structuredClone(data));
  vi.mocked(api.getTaskAssetFacets).mockResolvedValue(facets);
  vi.mocked(api.getTaskAssetSceneSummary).mockResolvedValue(scenes);
});

describe("task asset library", () => {
  it("registers only an admin page and navigation entry", () => {
    expect(requiredRole("/admin/task-assets")).toBe("admin");
    expect(isKnownAuthenticatedPath("/admin/task-assets", "admin")).toBe(true);
    expect(isKnownAuthenticatedPath("/admin/task-assets", "collector")).toBe(false);
    expect(navigationByRole.admin.flatMap(v => v.items).some(v => v.path === "/admin/task-assets")).toBe(true);
  });

  it("shows loading, coverage, overlap warning, proposed/unknown semantics and no speculative tool absence", async () => {
    render(<TaskAssetLibraryPage />);
    expect(screen.getByText("正在加载任务片段…")).toBeInTheDocument();
    await screen.findByText("TSA-TEST");
    expect(screen.getByText(/任务可能重叠/)).toBeInTheDocument();
    expect(screen.getByText(/索引覆盖 1 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText(/projection-backfill/)).toBeInTheDocument();
    expect(screen.getByText("未列出工具")).toBeInTheDocument();
    expect(screen.getByText("待映射")).toBeInTheDocument();
    expect(screen.getByText("不确定 / 未知")).toBeInTheDocument();
    expect(api.getTaskSegmentPreview).not.toHaveBeenCalled(); expect(api.getTaskAssetAnnotationDownload).not.toHaveBeenCalled();
    expect(screen.queryByText("无工具")).not.toBeInTheDocument();
  });

  it("applies combined filters, resets pagination, and resets all filters", async () => {
    render(<TaskAssetLibraryPage />); await screen.findByText("TSA-TEST");
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "杯子" } });
    fireEvent.click(screen.getByLabelText("杯子 (1)"));
    fireEvent.change(screen.getByLabelText("音轨"), { target: { value: "false" } });
    fireEvent.change(screen.getByLabelText("最短时长（秒）"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("应用筛选"));
    await waitFor(() => expect(api.getTaskAssets).toHaveBeenLastCalledWith(expect.objectContaining({ q: "杯子", objectLabelIds: ["CUP"], hasAudio: "false", minDurationMs: "2000", page: 1 }), expect.any(AbortSignal)));
    await screen.findByText("TSA-TEST"); fireEvent.click(screen.getByText("重置"));
    await waitFor(() => expect(api.getTaskAssets).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 }, expect.any(AbortSignal)));
    expect(screen.getByLabelText("关键词")).toHaveValue("");
  });

  it("paginates on the server and changes sorting", async () => {
    render(<TaskAssetLibraryPage />); await screen.findByText("TSA-TEST"); fireEvent.click(screen.getByText("下一页"));
    await waitFor(() => expect(api.getTaskAssets).toHaveBeenLastCalledWith({ page: 2, pageSize: 50 }, expect.any(AbortSignal)));
    await screen.findByText("TSA-TEST"); fireEvent.change(screen.getByLabelText("排序"), { target: { value: "duration:desc" } });
    await waitFor(() => expect(api.getTaskAssets).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, sortBy: "duration", sortOrder: "desc" }), expect.any(AbortSignal)));
  });

  it("switches to scene inventory and drills into scene-filtered assets", async () => {
    render(<TaskAssetLibraryPage />); await screen.findByText("TSA-TEST"); fireEvent.click(screen.getByRole("tab", { name: "场景库存" }));
    expect(screen.getByText(/未知 1/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("tabpanel", { name: "场景库存" })).getByRole("button", { name: "阳台" }));
    await waitFor(() => expect(api.getTaskAssets).toHaveBeenLastCalledWith(expect.objectContaining({ sceneKeys: ["proposed:阳台"], page: 1 }), expect.any(AbortSignal)));
    expect(screen.getByRole("tab", { name: "资产明细" })).toHaveAttribute("aria-selected", "true");
  });

  it("fetches video, current JSON, revision download and technical details only on demand", async () => {
    vi.mocked(api.getTaskSegmentPreview).mockResolvedValue({ assetId: "TSA-TEST", url: "https://example.test/video", contentType: "video/mp4", expiresAt: 1 });
    vi.mocked(api.getTaskAssetAnnotation).mockResolvedValue({ currentRevision: { revision: 2, contentJson: { schema_version: "task_segment.v1" } } });
    vi.mocked(api.getTaskAssetAnnotationDownload).mockResolvedValue({ url: "https://example.test/json", expiresAt: 1 });
    vi.mocked(api.getTaskAssetTechnicalDetail).mockResolvedValue({ asset: { id: "TSA-TEST" } } as Awaited<ReturnType<typeof api.getTaskAssetTechnicalDetail>>);
    render(<TaskAssetLibraryPage />); await screen.findByText("TSA-TEST");
    fireEvent.click(screen.getByText("播放")); await waitFor(() => expect(document.querySelector("video")).toHaveAttribute("src", "https://example.test/video"));
    fireEvent.click(screen.getByRole("button", { name: /关闭播放片段/ }));
    fireEvent.click(screen.getByText("查看 JSON")); await screen.findByText(/task_segment.v1/);
    expect(screen.getByRole("dialog")).toHaveAccessibleName(/r2/); fireEvent.click(screen.getByRole("button", { name: /关闭查看 JSON/ }));
    fireEvent.click(screen.getByText("下载 JSON")); expect(await screen.findByRole("link", { name: "打开 / 下载已发布 JSON" })).toHaveAttribute("href", "https://example.test/json");
    expect(api.getTaskAssetAnnotationDownload).toHaveBeenCalledWith("TSA-TEST", 1); fireEvent.click(screen.getByRole("button", { name: /关闭下载 JSON/ }));
    fireEvent.click(screen.getByText("技术详情")); await waitFor(() => expect(api.getTaskAssetTechnicalDetail).toHaveBeenCalledWith("TSA-TEST"));
  });

  it("renders empty/error states and allows retry", async () => {
    vi.mocked(api.getTaskAssets).mockRejectedValueOnce(new Error("服务不可用"));
    render(<TaskAssetLibraryPage />); expect(await screen.findByRole("alert")).toHaveTextContent("服务不可用");
    vi.mocked(api.getTaskAssets).mockResolvedValue({ ...data, items: [], summary: { ...summary, assetCount: 0 } });
    fireEvent.click(screen.getByText("重试")); expect(await screen.findByText("没有符合条件的任务片段。")).toBeInTheDocument();
  });

  it("shows explicit export-limit failure instead of a successful download", async () => {
    vi.mocked(api.exportTaskAssetsCsv).mockRejectedValue(new Error("导出超过 50,000 行，请缩小筛选范围"));
    render(<TaskAssetLibraryPage />); await screen.findByText("TSA-TEST"); fireEvent.click(screen.getByText("导出 CSV"));
    expect(await screen.findByText(/导出超过 50,000 行/)).toBeInTheDocument();
    expect(api.exportTaskAssetsCsv).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
  });
});
