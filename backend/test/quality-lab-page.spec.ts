import { describe, expect, it } from "vitest";

import { renderQualityLabPage } from "../src/quality-lab/page.js";

describe("quality lab page", () => {
  it("contains only the local upload queue and result workflow", () => {
    const html = renderQualityLabPage();

    expect(html).toContain('type="file"');
    expect(html).toContain("multiple");
    expect(html).toContain('accept="video/mp4,video/quicktime,.mp4,.mov"');
    expect(html).toContain('id="drop-zone"');
    expect(html).toContain('id="queue-list"');
    expect(html).toContain('id="results-list"');
    expect(html).toContain("下载整批 JSON");
    expect(html).toContain('fetch("/api/jobs")');
    expect(html).toContain("任务 ID");
    expect(html).toContain("调用诊断");
    expect(html).toContain("删除记录");
  });

  it("keeps the API key server-side and omits the obsolete pass/fail copy", () => {
    const html = renderQualityLabPage();

    expect(html).not.toContain("QWEN_API_KEY");
    expect(html).not.toMatch(/API\s*Key\s*<input/iu);
    expect(html).not.toContain("60 分通过");
    expect(html).not.toContain("质量不通过");
  });

  it("runs one browser job at a time and renders user values with textContent", () => {
    const html = renderQualityLabPage();

    expect(html).toMatch(/if\s*\(state\.running\)\s*return/u);
    expect(html).toMatch(/state\.running\s*=\s*true/u);
    expect(html).toContain("await processEntry(entry)");
    expect(html).toMatch(/state\.running\s*=\s*false/u);
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
  });

  it("rehydrates 30-day server history and keeps task IDs in exports", () => {
    const html = renderQualityLabPage();

    expect(html).toContain("async function loadHistory");
    expect(html).toContain("jobId:job.id");
    expect(html).toContain("taskId:entry.jobId");
    expect(html).toContain("diagnostics:entry.diagnostics");
    expect(html).toContain("async function watchHistory");
    expect(html).toMatch(/void\s+watchHistory\(\)/u);
  });

  it("renders technical result enums with Chinese labels", () => {
    const html = renderQualityLabPage();

    expect(html).toContain('scored:"已评分"');
    expect(html).toContain('hard_reject:"硬性否决"');
    expect(html).toContain('BROKEN_UNPLAYABLE:"视频损坏或无法播放"');
    expect(html).toContain('critical:"严重"');
    expect(html).toContain("evaluationStatusLabel(result.evaluationStatus)");
    expect(html).toContain("reasonLabel(issue.reason_code)");
    expect(html).toContain("severityLabel(issue.severity)");
  });

  it("uses model-independent stage labels and keeps old history readable", () => {
    const html = renderQualityLabPage();

    expect(html).toContain('initial_review:"初审"');
    expect(html).toContain('secondary_review:"复核"');
    expect(html).toContain('flash_review:"初审（历史）"');
    expect(html).toContain('plus_review:"复核（历史）"');
    expect(html).toContain('"initial_review","secondary_review"');
  });
});
