"use client";

import { ArrowRight, CheckCircle2, PlayCircle, Sparkles } from "lucide-react";
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
      </main>
    </div>
  );
}
