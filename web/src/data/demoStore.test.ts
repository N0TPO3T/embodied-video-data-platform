import { describe, expect, it } from "vitest";
import { createDemoStore, demoSeed } from "./demoStore";

describe("demo store permissions", () => {
  it("prevents a leader from adjusting another team submission", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("leader");

    expect(() =>
      store.adjustQuality("SUB-OTHER-01", 82, "复核通过"),
    ).toThrow("无权调整该团队数据");
  });

  it("allows an administrator to adjust any unsettled submission", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");
    store.adjustQuality("SUB-OTHER-01", 82, "管理员复核");

    expect(store.getSubmission("SUB-OTHER-01").finalScore).toBe(82);
  });
});

describe("quality review workflow", () => {
  it("preserves the AI score while saving the adjusted final score", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");
    store.adjustQuality("SUB-001", 88, "画面稳定，调整评分");

    const updated = store.getSubmission("SUB-001");
    expect(updated.aiScore).toBe(76);
    expect(updated.finalScore).toBe(88);
    expect(updated.audit.at(-1)?.reason).toBe("画面稳定，调整评分");
  });

  it("rejects quality changes after settlement", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    expect(() =>
      store.adjustQuality("SUB-SETTLED-01", 90, "修改"),
    ).toThrow("已结算数据不可修改");
  });

  it("requires a non-empty adjustment reason", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    expect(() => store.adjustQuality("SUB-001", 88, "  ")).toThrow(
      "请填写调整原因",
    );
  });
});

describe("upload and withdrawal workflows", () => {
  it("creates one queued submission for each uploaded file", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("collector");
    const before = store.getState().submissions.length;

    store.addUploads([
      new File(["a"], "kitchen.mov", { type: "video/quicktime" }),
      new File(["b"], "cleaning.mp4", { type: "video/mp4" }),
    ]);

    const uploads = store.getState().submissions.slice(0, 2);
    expect(store.getState().submissions).toHaveLength(before + 2);
    expect(uploads.map((item) => item.fileName)).toEqual([
      "kitchen.mov",
      "cleaning.mp4",
    ]);
    expect(uploads.every((item) => item.processingStatus === "queued")).toBe(
      true,
    );
  });

  it("freezes the amount when a collector requests a valid withdrawal", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("collector");
    store.requestWithdrawal(200);

    expect(store.getState().wallet.available).toBe(1286.5);
    expect(store.getState().wallet.frozen).toBe(200);
    expect(store.getState().withdrawals[0].status).toBe("pending");
  });

  it("rejects a withdrawal below the configured minimum", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("collector");

    expect(() => store.requestWithdrawal(80)).toThrow(
      "最低提现金额为 ¥100",
    );
  });

  it("lets an administrator approve a pending withdrawal", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");
    store.reviewWithdrawal("WD-001", "approved");

    expect(store.getState().withdrawals[0].status).toBe("approved");
  });

  it("prevents collectors from reviewing withdrawals", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("collector");

    expect(() => store.reviewWithdrawal("WD-001", "approved")).toThrow(
      "仅管理员可审核提现",
    );
  });

  it("notifies subscribers after a state change and supports unsubscribe", () => {
    const store = createDemoStore(demoSeed);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.loginAs("leader");
    unsubscribe();
    store.loginAs("admin");

    expect(notifications).toBe(1);
  });
});
