import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { DemoStoreProvider } from "../../data/DemoStoreContext";

function renderCollector(path: string) {
  window.history.replaceState({}, "", path);
  return render(
    <DemoStoreProvider>
      <PlatformApp initialPath={path} />
    </DemoStoreProvider>,
  );
}

describe("collector journey", () => {
  it("rejects unsupported upload formats without creating a submission", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderCollector("/collector/upload");

    await user.upload(
      screen.getByLabelText("选择视频文件"),
      new File(["text"], "notes.txt", { type: "text/plain" }),
    );

    expect(screen.getByText("仅支持 MOV 和 MP4 视频")).toBeVisible();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("creates one visible upload item for each supported file", async () => {
    const user = userEvent.setup();
    renderCollector("/collector/upload");

    await user.upload(screen.getByLabelText("选择视频文件"), [
      new File(["a"], "kitchen.mov", { type: "video/quicktime" }),
      new File(["b"], "cleaning.mp4", { type: "video/mp4" }),
    ]);

    expect(screen.getByText("kitchen.mov")).toBeVisible();
    expect(screen.getByText("cleaning.mp4")).toBeVisible();
  });

  it("only lists the current collector's submissions", () => {
    renderCollector("/collector/submissions");

    expect(screen.getByText("kitchen_breakfast_0803.mov")).toBeVisible();
    expect(screen.queryByText("warehouse_packing_0803.mp4")).not.toBeInTheDocument();
  });
});
