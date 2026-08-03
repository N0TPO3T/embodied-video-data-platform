"use client";

import { ArrowRight, Bot, CheckCircle2, Database, Fingerprint, Layers3, PlayCircle, ScanSearch, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { BrandMark } from "../../components/BrandMark";

export function PublicHomePage({ navigate }: { navigate(path: string): void }) {
  return (
    <div className="public-site">
      <header className="public-nav">
        <BrandMark />
        <nav>
          <a href="#capabilities">数据能力</a>
          <a href="#process">生产流程</a>
          <a href="#quality">质量保障</a>
        </nav>
        <button className="button button-ghost" onClick={() => navigate("/login")}>
          登录工作台 <ArrowRight size={16} />
        </button>
      </header>
      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={15} /> AI 驱动的数据生产流水线</div>
            <h1>让每一段视频，<br /><span>成为可用的具身数据</span></h1>
            <p>从开放采集、AI 内容理解到自动质检与资产入库，用一条可追溯的数据流水线，为具身智能持续供给高质量视频数据。</p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={() => navigate("/login")}>进入演示平台 <ArrowRight size={17} /></button>
              <button className="button button-secondary"><PlayCircle size={18} /> 了解生产流程</button>
            </div>
            <div className="hero-trust">
              <span><CheckCircle2 size={16} /> 全流程可追溯</span>
              <span><CheckCircle2 size={16} /> AI 质量评估</span>
              <span><CheckCircle2 size={16} /> 数据权限隔离</span>
            </div>
          </div>
          <div className="hero-visual" aria-label="数据生产概览">
            <div className="visual-glow" />
            <div className="hero-dashboard-card">
              <div className="mini-card-head"><span>数据生产实时概览</span><em>实时</em></div>
              <div className="mini-metrics">
                <div><small>已验收视频</small><strong>86,420</strong><span>+12.6%</span></div>
                <div><small>有效时长</small><strong>2,864h</strong><span>+8.2%</span></div>
              </div>
              <div className="mini-chart">
                {[34, 52, 43, 68, 57, 76, 71, 88, 82, 96, 90, 104].map((height, index) => <i key={index} style={{ height }} />)}
              </div>
              <div className="mini-flow">
                {["上传完成", "AI 标注", "质量通过", "资产入库"].map((item, index) => <div key={item}><span>{index + 1}</span><small>{item}</small></div>)}
              </div>
            </div>
            <div className="floating-card floating-card-quality"><span>94.8%</span><small>本周质量通过率</small></div>
            <div className="floating-card floating-card-scene"><strong>紧缺场景</strong><span>工作台组装</span><span>户外园艺</span></div>
          </div>
        </section>
        <section className="public-metrics" id="capabilities">
          <div><strong>86,420</strong><span>可交付视频</span></div>
          <div><strong>2,864h</strong><span>有效数据时长</span></div>
          <div><strong>42</strong><span>高频作业场景</span></div>
          <div><strong>94.8%</strong><span>质量通过率</span></div>
        </section>
        <section className="public-content-section public-scenes">
          <div className="public-section-heading"><span>DATA CAPABILITIES</span><h2>覆盖真实世界中的高价值操作场景</h2><p>持续补充操作密度高、对象状态变化明显、可用于具身模型训练与评测的视频数据。</p></div>
          <div className="scene-showcase"><article className="scene-primary"><div><small>高频场景</small><strong>家庭精细操作</strong><span>31,280 条可交付视频</span></div></article><div className="scene-list"><div><strong>工具使用</strong><span>组装 · 维修 · 园艺</span><em>24%</em></div><div><strong>家务任务</strong><span>烹饪 · 清洁 · 收纳</span><em>38%</em></div><div><strong>物流操作</strong><span>分类 · 包装 · 搬运</span><em>19%</em></div><div><strong>办公协作</strong><span>文档 · 设备 · 物品归位</span><em>19%</em></div></div></div>
        </section>
        <section className="public-content-section public-process" id="process">
          <div className="public-section-heading"><span>PRODUCTION PIPELINE</span><h2>从原始视频到可交付资产的标准流水线</h2><p>每个环节保留状态、版本和人工操作记录，形成可解释、可复核的数据闭环。</p></div>
          <div className="process-grid">{[
            [Upload, "01", "开放采集", "多角色团队协作采集，文件与成员、团队自动绑定"],
            [ScanSearch, "02", "媒体解析", "抽取时长、分辨率与画面特征，建立处理任务"],
            [Bot, "03", "AI 内容理解", "识别场景、动作、对象、工具与质量问题区间"],
            [ShieldCheck, "04", "双层质检", "AI 初筛结合团长和平台复核，保留原始结论"],
            [Database, "05", "结算与入库", "锁定有效时长和金额，生成可交付数据资产"],
          ].map(([Icon, step, title, copy]) => { const ProcessIcon = Icon as typeof Upload; return <article key={String(step)}><span>{String(step)}</span><i><ProcessIcon size={22} /></i><h3>{String(title)}</h3><p>{String(copy)}</p></article>; })}</div>
        </section>
        <section className="public-content-section public-quality" id="quality">
          <div className="quality-copy"><span>QUALITY & SECURITY</span><h2>质量结论有依据，数据流转有边界</h2><p>评分规则、无效区间和人工调整全部可追踪；不同角色的数据范围严格隔离，公开页面只展示脱敏汇总。</p><div><span><Fingerprint size={18} /><em><strong>全流程审计</strong><small>每次调整均保留人员、时间、原因和前后结果</small></em></span><span><Layers3 size={18} /><em><strong>版本化规则</strong><small>模型、标签、价格和质检阈值均可按版本管理</small></em></span></div></div><div className="quality-panel"><header><span>质量评估样例</span><em>已通过</em></header><strong>88<small>/ 100</small></strong><div className="quality-radar">{["画面稳定", "主体完整", "动作有效", "隐私安全"].map((item, index) => <div key={item}><span>{item}</span><i><b style={{ width: `${[91, 86, 92, 100][index]}%` }} /></i><em>{[91, 86, 92, 100][index]}</em></div>)}</div></div>
        </section>
        <section className="public-cta"><div><span>为你的具身智能项目准备下一批高质量数据</span><h2>从真实任务出发，建立可持续的数据供给</h2></div><button className="button button-primary" onClick={() => navigate("/login")}>体验完整平台 <ArrowRight size={17} /></button></section>
      </main>
      <footer className="public-footer"><BrandMark /><span>可点击前端演示 · 所有数据均为模拟内容</span></footer>
    </div>
  );
}
