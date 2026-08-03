"use client";

import { Globe2, Save } from "lucide-react";
import { FormEvent, useState } from "react";

export function PublicConfigPage() {
  const [saved,setSaved]=useState(false); function save(event:FormEvent){event.preventDefault();setSaved(true)}
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">公开脱敏汇总</p><h1>公开数据配置</h1><span>控制官网展示的指标、场景和商务联系入口</span></div></div><div className="public-config-grid"><form className="content-card profile-form" onSubmit={save}><div className="card-heading"><div><h2>首页指标</h2><p>只展示脱敏后的平台汇总</p></div><Globe2 size={18}/></div><div className="form-grid"><label><span>可交付视频</span><input defaultValue="86,420"/></label><label><span>有效数据时长</span><input defaultValue="2,864h"/></label><label><span>高频作业场景</span><input defaultValue="42"/></label><label><span>质量通过率</span><input defaultValue="94.8%"/></label></div><label><span>商务联系文案</span><textarea defaultValue="为你的具身智能项目准备下一批高质量数据" rows={3}/></label><button className="button button-primary" type="submit"><Save size={16}/>保存公开配置</button>{saved&&<p className="form-message success">公开配置已保存</p>}</form><aside className="content-card config-preview"><span>官网预览</span><h2>让每一段视频，<br/>成为可用的具身数据</h2><div><strong>86,420</strong><small>可交付视频</small></div><p>公开页面不显示原始视频、成员、团队和任何资金信息。</p></aside></div></div>;
}
