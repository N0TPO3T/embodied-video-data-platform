"use client";

import { Archive, Clock, Database, HardDrive, ShieldCheck, Tags } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "../../components/Modal";
import { MetricCard } from "../../components/MetricCard";
import { exportTaskAssetsCsv, getTaskAssets, getTaskAssetFacets, getTaskAssetSceneSummary, getTaskSegmentPreview,
  getTaskAssetAnnotation, getTaskAssetAnnotationDownload, getTaskAssetTechnicalDetail } from "../../operations/client/operationsApi";
import type { TaskAsset, TaskAssetFilters, TaskAssetList, TaskAssetFacets, TaskAssetSceneSummary } from "../../task-assets/contracts";
import styles from "./TaskAssetLibraryPage.module.css";

const labels: Record<string, string> = {
  matched: "已映射", proposed: "待映射", unknown: "未知", complete: "完整", incomplete: "未完成", partial: "部分", uncertain: "不确定",
  success: "成功", failure: "失败", not_applicable: "不适用", human_verified: "人工确认", inherited_from_published_annotation: "继承已发布标注",
  left: "左手", right: "右手", both: "双手", unclear: "不清楚", no_hand_visible: "未见手部",
  coarse: "粗边界", refined: "精修边界", coarse_fallback: "粗边界回退",
};
const label = (value: string) => labels[value] ?? value;
const duration = (ms: number) => `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} 秒`;
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${value.toLocaleString()} B`;
const listedLabels = (values: TaskAsset["tools"]) => [...new Set([...values.names, ...values.rawTexts])].join("、");

function MultiFilter({ title, values, options, onChange }: {
  title: string; values: string[]; options: Array<{ value: string; label: string }>; onChange(values: string[]): void;
}) {
  const combined = [...options, ...values.filter(v => !options.some(o => o.value === v)).map(value => ({ value, label: value }))];
  return <details className={styles.multi}>
    <summary>{title}<span>{values.length ? `已选 ${values.length}` : "全部"}</span></summary>
    <fieldset><legend>{title}（可多选）</legend>
      {combined.length === 0 && <small>当前结果无可用选项</small>}
      {combined.map(option => <label key={option.value}><input type="checkbox" checked={values.includes(option.value)}
        disabled={!values.includes(option.value) && values.length >= 20}
        onChange={event => onChange(event.target.checked ? [...values, option.value] : values.filter(v => v !== option.value))} />{option.label}</label>)}
      <button type="button" onClick={() => onChange([])}>清除此项</button>
    </fieldset>
  </details>;
}

export function TaskAssetLibraryPage() {
  const [query, setQuery] = useState<TaskAssetFilters>({ page: 1, pageSize: 50 });
  const [draft, setDraft] = useState<TaskAssetFilters>({});
  const [tab, setTab] = useState<"assets" | "scenes">("assets");
  const [data, setData] = useState<TaskAssetList | null>(null);
  const [facets, setFacets] = useState<TaskAssetFacets | null>(null);
  const [scenes, setScenes] = useState<TaskAssetSceneSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [action, setAction] = useState<{ title: string; loading?: boolean; video?: string; json?: unknown; download?: string; error?: string } | null>(null);
  const actionId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getTaskAssets(query, controller.signal), getTaskAssetFacets(query, controller.signal), getTaskAssetSceneSummary(query, controller.signal)])
      .then(([next, nextFacets, nextScenes]) => {
        if (controller.signal.aborted) return;
        setData(next); setFacets(nextFacets); setScenes(nextScenes); setError(""); setLoading(false);
      }).catch(reason => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "资产库加载失败"); setLoading(false);
      });
    return () => { controller.abort(); actionId.current += 1; };
  }, [query]);

  function search(next: TaskAssetFilters) { setLoading(true); setError(""); setQuery(next); }
  function submit(event: FormEvent) { event.preventDefault(); search({ ...draft, page: 1, pageSize: query.pageSize, sortBy: query.sortBy, sortOrder: query.sortOrder }); }
  function pickScene(sceneKey: string) {
    const next = { ...query, sceneKeys: [sceneKey], page: 1 };
    setDraft(next); setTab("assets"); search(next);
  }
  async function openAsset(asset: TaskAsset, kind: "play" | "json" | "download" | "technical") {
    const id = ++actionId.current;
    const title = `${{ play: "播放片段", json: "查看 JSON", download: "下载 JSON", technical: "技术详情" }[kind]} · ${asset.assetId}`;
    setAction({ title, loading: true });
    try {
      let result: NonNullable<typeof action> = { title };
      if (kind === "play") result.video = (await getTaskSegmentPreview(asset.assetId)).url;
      if (kind === "json") {
        const current = await getTaskAssetAnnotation(asset.assetId);
        if (!current.currentRevision) throw new Error("当前无已发布 JSON");
        result = { title: `${title} · r${current.currentRevision.revision}`, json: current.currentRevision.contentJson };
      }
      if (kind === "download") result.download = (await getTaskAssetAnnotationDownload(asset.assetId, asset.annotationRevision)).url;
      if (kind === "technical") result.json = await getTaskAssetTechnicalDetail(asset.assetId);
      if (actionId.current === id) setAction(result);
    } catch (reason) { if (actionId.current === id) setAction({ title, error: reason instanceof Error ? reason.message : "操作失败" }); }
  }
  async function exportCsv() {
    setExporting(true);
    try {
      const blob = await exportTaskAssetsCsv(query);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "task-assets.csv"; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setAction({ title: "CSV 导出失败", error: reason instanceof Error ? reason.message : "导出失败" }); }
    finally { setExporting(false); }
  }

  const multi = (key: keyof TaskAssetFilters, title: string, options: Array<{ value: string; label: string }>) =>
    <MultiFilter key={key} title={title} values={(draft[key] as string[] | undefined) ?? []} options={options} onChange={values => setDraft({ ...draft, [key]: values })} />;
  const counted = (values: Array<{ value: string; count: number }> = []) => values.map(v => ({ value: v.value, label: `${label(v.value)} (${v.count})` }));
  const summary = data?.summary;
  const health = data?.indexHealth;

  return <div className={styles.page}>
    <header className="page-header"><div><h1>任务片段资产库</h1><p>按当前正式发布的任务片段检索；原视频删除后，片段和 JSON 仍可独立使用。</p></div></header>
    {summary && <section className={styles.metrics} aria-label="库存概览">
      <MetricCard icon={Archive} label="任务片段" value={summary.assetCount.toLocaleString()} detail="当前筛选结果" />
      <MetricCard icon={Clock} label="片段累计时长" value={duration(summary.totalSegmentDurationMs)} detail="包含重叠任务" />
      <MetricCard icon={HardDrive} label="片段存储大小" value={bytes(summary.totalStorageBytes)} detail="片段 MP4 合计" />
      <MetricCard icon={Database} label="原始上传数" value={String(summary.sourceGroupCount)} detail="按 sourceGroupId 去重" />
      <MetricCard icon={ShieldCheck} label="人工确认" value={String(summary.humanVerifiedCount)} detail={`继承标注 ${summary.inheritedCount}`} />
      <MetricCard icon={Tags} label="待映射资产" value={String(summary.unmappedLabelAssetCount)} detail={`含不确定信息 ${summary.uncertainAssetCount}`} tone="amber" />
    </section>}
    <p className={styles.notice}>任务可能重叠，累计时长可能重复计算原视频区间，不代表去重后视频时长。</p>
    {health && <div className={styles.notice} role={health.missingProjectionAssets || health.staleProjectionAssets ? "alert" : "status"}>
      索引覆盖 {health.projectedCurrentAssets} / {health.totalPublishedAssets}（当前正式发布范围，不随筛选变化）
      {(health.missingProjectionAssets > 0 || health.staleProjectionAssets > 0) && <p>缺失 {health.missingProjectionAssets}，过期 {health.staleProjectionAssets}。请由运维运行 <code>pnpm task-asset:projection-backfill -- --dry-run --limit=100</code> 核对后补建索引；不需要原视频或对象存储。</p>}
    </div>}

    <form onSubmit={submit} className={styles.filters} aria-label="资产筛选">
      <label className={styles.keyword}>关键词<input aria-label="关键词" maxLength={200} placeholder="任务描述、场景、对象或工具" value={draft.q ?? ""} onChange={e => setDraft({ ...draft, q: e.target.value })} /></label>
      {multi("sceneKeys", "场景", facets?.scenes.map(v => ({ value: v.key, label: `${v.name ?? "未知场景"}${v.status === "proposed" ? " · 待映射" : ""} (${v.count})` })) ?? [])}
      {multi("taskVerbs", "任务动词", counted(facets?.taskVerbs))}
      {multi("objectLabelIds", "对象", facets?.objects.filter(v => v.id !== null).map(v => ({ value: v.id!, label: `${v.name} (${v.count})` })) ?? [])}
      {multi("toolLabelIds", "工具", facets?.tools.filter(v => v.id !== null).map(v => ({ value: v.id!, label: `${v.name} (${v.count})` })) ?? [])}
      {multi("handModes", "手部模式", counted(facets?.handModes))}
      {multi("interactionPrimitives", "交互原语", counted(facets?.interactionPrimitives))}
      {multi("completions", "完成状态", counted(facets?.completions))}
      {multi("resultStatuses", "结果状态", counted(facets?.results))}
      {multi("semanticVerifications", "语义确认", counted(facets?.semanticVerifications))}
      <label>最短时长（秒）<input aria-label="最短时长（秒）" type="number" min="0" step="0.001" value={draft.minDurationMs === undefined ? "" : Number(draft.minDurationMs) / 1000} onChange={e => setDraft({ ...draft, minDurationMs: e.target.value === "" ? undefined : String(Number(e.target.value) * 1000) })} /></label>
      <label>最长时长（秒）<input aria-label="最长时长（秒）" type="number" min="0" step="0.001" value={draft.maxDurationMs === undefined ? "" : Number(draft.maxDurationMs) / 1000} onChange={e => setDraft({ ...draft, maxDurationMs: e.target.value === "" ? undefined : String(Number(e.target.value) * 1000) })} /></label>
      <label>音轨<select aria-label="音轨" value={draft.hasAudio ?? ""} onChange={e => setDraft({ ...draft, hasAudio: e.target.value })}><option value="">全部</option><option value="true">含音轨</option><option value="false">无音轨</option></select></label>
      <label>映射情况<select aria-label="映射情况" value={draft.hasUnmappedLabels ?? ""} onChange={e => setDraft({ ...draft, hasUnmappedLabels: e.target.value })}><option value="">全部</option><option value="true">含待映射标签</option><option value="false">全部已映射</option></select></label>
      <div className={styles.filterActions}><small>同维度多选为 OR，不同维度为 AND。分面数量随全部筛选条件变化。</small><div className="button-row">
        <button className="primary-button" type="submit">应用筛选</button>
        <button className="secondary-button" type="button" onClick={() => { setDraft({}); search({ page: 1, pageSize: 50 }); }}>重置</button>
        <button className="secondary-button" type="button" disabled={exporting || loading || !!error} onClick={() => void exportCsv()}>{exporting ? "导出中…" : "导出 CSV"}</button>
      </div></div>
    </form>

    <div className={styles.tabs} role="tablist" aria-label="资产视图">
      <button type="button" role="tab" aria-selected={tab === "assets"} onClick={() => setTab("assets")}>资产明细</button>
      <button type="button" role="tab" aria-selected={tab === "scenes"} onClick={() => setTab("scenes")}>场景库存</button>
    </div>
    {loading && <p role="status">正在加载任务片段…</p>}
    {error && <div role="alert">{error} <button type="button" onClick={() => search({ ...query })}>重试</button></div>}
    {!loading && !error && data && tab === "assets" && <section role="tabpanel" aria-label="资产明细">
      <div className={styles.toolbar}><span>共 {data.pagination.total} 个任务片段</span><label>排序 <select aria-label="排序" value={`${query.sortBy ?? "createdAt"}:${query.sortOrder ?? "desc"}`} onChange={e => { const [sortBy, sortOrder] = e.target.value.split(":"); search({ ...query, sortBy, sortOrder, page: 1 }); }}>
        <option value="createdAt:desc">创建时间 · 新到旧</option><option value="createdAt:asc">创建时间 · 旧到新</option><option value="duration:desc">时长 · 长到短</option><option value="scene:asc">场景</option><option value="task:asc">任务描述</option><option value="result:asc">结果状态</option>
      </select></label></div>
      {data.items.length === 0 ? <p>没有符合条件的任务片段。</p> : <div className={styles.tableWrap}><table className={`data-table ${styles.assetTable}`}><thead><tr>
        {["片段 / 操作", "任务描述", "场景", "动词", "对象", "工具", "交互原语", "完成 / 结果", "时长", "语义确认", "边界来源", "Revision", "创建时间"].map(v => <th key={v}>{v}</th>)}
      </tr></thead><tbody>{data.items.map(asset => <tr key={asset.assetId}>
        <td><strong>{asset.assetId}</strong><div className={styles.actions}><button onClick={() => void openAsset(asset, "play")}>播放</button><button onClick={() => void openAsset(asset, "json")}>查看 JSON</button><button onClick={() => void openAsset(asset, "download")}>下载 JSON</button><button onClick={() => void openAsset(asset, "technical")}>技术详情</button></div></td>
        <td>{asset.task.description}{asset.hasUncertainty && <small className={styles.flag}>含不确定信息</small>}</td>
        <td>{asset.scene.name ?? "未知场景"}{asset.scene.mappingStatus === "proposed" && <small className={styles.flag}>待映射</small>}</td>
        <td>{asset.task.verb}</td><td>{listedLabels(asset.objects) || "未列出对象"}{asset.objects.unmappedCount > 0 && <small className={styles.flag}>含待映射项</small>}</td>
        <td>{listedLabels(asset.tools) || "未列出工具"}{asset.tools.unmappedCount > 0 && <small className={styles.flag}>含待映射项</small>}</td>
        <td>{asset.interactionPrimitives.join("、") || "未列出"}</td><td>{label(asset.completion)} / {label(asset.resultStatus)}</td><td>{duration(asset.media.durationMs)}</td>
        <td>{label(asset.semanticVerification)}</td><td>{label(asset.boundarySource)}</td><td>r{String(asset.annotationRevision).padStart(4, "0")}</td><td>{new Date(asset.createdAt).toLocaleString()}</td>
      </tr>)}</tbody></table></div>}
      <div className={styles.toolbar}><label>每页 <select aria-label="每页" value={query.pageSize ?? 50} onChange={e => search({ ...query, page: 1, pageSize: Number(e.target.value) })}>{[20, 50, 100].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
        <div className="button-row"><button disabled={data.pagination.page <= 1} onClick={() => search({ ...query, page: data.pagination.page - 1 })}>上一页</button><span>{data.pagination.page} / {Math.max(1, data.pagination.totalPages)}</span><button disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => search({ ...query, page: data.pagination.page + 1 })}>下一页</button></div>
      </div>
    </section>}
    {!loading && !error && scenes && tab === "scenes" && <section role="tabpanel" aria-label="场景库存">
      <p>共 {scenes.rows.length} 个场景，{scenes.totals.assetCount} 个片段，累计 {duration(scenes.totals.totalSegmentDurationMs)}。点击场景查看片段。</p>
      {scenes.rows.length === 0 ? <p>当前筛选下暂无场景库存。</p> : <div className={styles.tableWrap}><table className="data-table"><thead><tr>{["场景", "片段数", "累计时长", "大小 / 原始上传数", "完成状态分布", "结果状态分布", "语义确认", "待映射 / 不确定", "Top 动词", "Top 对象", "Top 工具"].map(v => <th key={v}>{v}</th>)}</tr></thead><tbody>
        {scenes.rows.map(scene => <tr key={scene.sceneKey}><td><button className={styles.sceneLink} onClick={() => pickScene(scene.sceneKey)}>{scene.sceneName ?? "未知场景"}</button><small className={styles.flag}>{label(scene.mappingStatus)}</small></td>
          <td>{scene.assetCount}</td><td>{duration(scene.totalSegmentDurationMs)}</td><td>{bytes(scene.totalStorageBytes)} / {scene.sourceGroupCount}</td>
          <td>完整 {scene.completeCount} · 未完成 {scene.incompleteCount} · 部分 {scene.partialCount} · 不确定 {scene.uncertainCompletionCount}</td>
          <td>成功 {scene.successCount} · 失败 {scene.failureCount} · 部分 {scene.partialResultCount} · 未知 {scene.unknownResultCount} · 不适用 {scene.notApplicableResultCount}</td>
          <td>人工 {scene.humanVerifiedCount} / 继承 {scene.inheritedCount}</td><td>{scene.unmappedLabelAssetCount} / {scene.uncertainAssetCount}</td>
          <td>{scene.topTaskVerbs.map(v => `${v.value} (${v.count})`).join("、") || "未列出"}</td><td>{scene.topObjects.map(v => `${v.name}${v.id ? "" : " [待映射]"} (${v.count})`).join("、") || "未列出对象"}</td><td>{scene.topTools.map(v => `${v.name}${v.id ? "" : " [待映射]"} (${v.count})`).join("、") || "未列出工具"}</td>
        </tr>)}
      </tbody></table></div>}
    </section>}
    <Modal open={action !== null} title={action?.title ?? "片段"} onClose={() => { actionId.current += 1; setAction(null); }} className={styles.modal}>
      {action?.loading && <p role="status">加载中…</p>}{action?.error && <p role="alert">{action.error}</p>}
      {action?.video && <video className={styles.video} src={action.video} controls autoPlay playsInline />}
      {action?.json !== undefined && <pre className={styles.json}>{JSON.stringify(action.json, null, 2)}</pre>}
      {action?.download && <p><a href={action.download} target="_blank" rel="noopener noreferrer" download>打开 / 下载已发布 JSON</a>（链接短期有效）</p>}
    </Modal>
  </div>;
}
