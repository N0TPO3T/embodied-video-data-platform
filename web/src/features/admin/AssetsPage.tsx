"use client";

import { Archive, Boxes, Database, HardDrive } from "lucide-react";
import { useRef, useState } from "react";
import { MetricCard } from "../../components/MetricCard";
import { SubmissionTable } from "../../components/SubmissionTable";
import { useDemoStore } from "../../data/DemoStoreContext";
import { DeliveryPackageModal } from "./DeliveryPackageModal";

export function AssetsPage() {
  const { state } = useDemoStore();
  const [packageOpen, setPackageOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const assets = state.submissions.filter((item) => item.settlementStatus === "settled" && item.qualityStatus === "passed");
  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="page-kicker">已锁定可交付数据</p><h1>数据资产</h1><span>仅包含质检通过且完成结算锁定的视频资产</span></div><button ref={triggerRef} className="button button-primary" onClick={() => setPackageOpen(true)}>创建交付包</button></div>
      <div className="metric-grid"><MetricCard label="可交付视频" value="86,420" detail="今日新增 1,064" icon={Archive}/><MetricCard label="有效数据时长" value="2,864h" detail="覆盖 42 类场景" icon={Database} tone="green"/><MetricCard label="本月交付包" value={String(18 + state.deliveryPackages.length)} detail="7 个项目" icon={Boxes} tone="violet"/><MetricCard label="存储占用" value="184.6 TB" detail="热存储 62%" icon={HardDrive} tone="amber"/></div>
      <section className="content-card table-card"><div className="card-heading"><div><h2>最近入库资产</h2><p>模拟列表展示资产锁定条件</p></div></div><SubmissionTable submissions={assets} showOwner /></section>
      <DeliveryPackageModal open={packageOpen} onClose={() => setPackageOpen(false)} returnFocusRef={triggerRef} />
    </div>
  );
}
