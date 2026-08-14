"use client";

import { BadgeCheck, Bot, CircleGauge, Tags } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  getLabelSet,
  getQualityRule,
} from "../../ai-quality/client/aiQualityApi";
import type { LabelSet, QualityRule } from "../../ai-quality/contracts";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";
import type { LabelConfig } from "../../domain/types";
import { RuleFormModal } from "./RuleFormModal";
import { AiSystemPromptCard } from "./AiSystemPromptCard";

const typeLabel = { scene: "场景", action: "动作", object: "对象", issue: "质量问题" };

export function RulesPage() {
  const { state } = useDemoStore();
  const [qualityRule, setQualityRule] = useState<QualityRule>();
  const [labelSet, setLabelSet] = useState<LabelSet>();
  const [ruleMode, setRuleMode] = useState<"loading" | "live" | "demo">(
    "loading",
  );
  const [ruleOpen, setRuleOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<LabelConfig>();
  const ruleTriggerRef = useRef<HTMLButtonElement>(null);
  const labelTriggerRef = useRef<HTMLButtonElement>(null);
  const visibleRule = qualityRule ?? {
    version: state.rule.version,
    passThreshold: state.rule.passThreshold,
    description: state.rule.description,
    revision: 0,
    createdByName: "演示数据",
  };
  const visibleLabels = labelSet?.labels ?? state.labels;

  useEffect(() => {
    let active = true;
    getQualityRule()
      .then((rule) => {
        if (!active) return;
        setQualityRule(rule);
        setRuleMode("live");
      })
      .catch(() => {
        if (!active) return;
        setQualityRule(undefined);
        setRuleMode("demo");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getLabelSet()
      .then((nextLabelSet) => {
        if (!active) return;
        setLabelSet(nextLabelSet);
      })
      .catch(() => {
        if (!active) return;
        setLabelSet(undefined);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><p className="page-kicker">版本化配置中心</p><h1>标签与规则</h1><span>统一管理内容标签、模型版本和质量判定阈值</span></div>
        <button ref={ruleTriggerRef} className="button button-primary" onClick={() => setRuleOpen(true)}>新建规则版本</button>
      </div>
      <div className="rule-cards">
        <article className="content-card"><span><Tags size={19}/></span><div><small>标签体系</small><strong>{labelSet ? `V${labelSet.revision}` : "v3.2"}</strong><em>{visibleLabels.filter((label) => label.enabled).length} 个核心标签启用</em></div></article>
        <article className="content-card"><span><Bot size={19}/></span><div><small>AI 模型</small><strong>Qwen3.7</strong><em>Plus 初检 · Flash 条件复核</em></div></article>
        <article className="content-card"><span><CircleGauge size={19}/></span><div><small>通过阈值</small><strong>{visibleRule.passThreshold} 分</strong><em>质量系数分 3 档</em></div></article>
        <article className="content-card"><span><BadgeCheck size={19}/></span><div><small>当前规则</small><strong>{visibleRule.version}</strong><em>{ruleMode === "live" ? `V${visibleRule.revision} · 后端生效` : ruleMode === "loading" ? "正在读取后端规则" : "演示配置"}</em></div></article>
      </div>
      <AiSystemPromptCard />
      <section className="content-card table-card">
        <div className="card-heading"><div><h2>核心标签</h2><p>场景、动作、对象和质量问题标签</p></div></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>编号</th><th>标签名称</th><th>类型</th><th>关联视频</th><th>状态</th><th/></tr></thead><tbody>
          {visibleLabels.map((label) => (
            <tr key={label.id}><td>{label.id}</td><td><strong>{label.name}</strong></td><td>{typeLabel[label.type]}</td><td>{label.associationCount}</td><td><StatusBadge label={label.enabled ? "启用" : "停用"} tone={label.enabled ? "success" : "neutral"}/></td><td><button className="table-action" onClick={(event) => { labelTriggerRef.current = event.currentTarget; setSelectedLabel(label); }}>编辑</button></td></tr>
          ))}
        </tbody></table></div>
      </section>
      {ruleOpen && <RuleFormModal open mode="rule" currentRule={qualityRule} onRulePublished={(rule) => { setQualityRule(rule); setRuleMode("live"); }} onClose={() => setRuleOpen(false)} returnFocusRef={ruleTriggerRef} />}
      {selectedLabel && <RuleFormModal open mode="label" label={selectedLabel} onLabelSetPublished={setLabelSet} onClose={() => setSelectedLabel(undefined)} returnFocusRef={labelTriggerRef} />}
    </div>
  );
}
