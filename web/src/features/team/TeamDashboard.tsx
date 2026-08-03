import { BadgeCheck, Clock3, FileVideo, Users } from "lucide-react";
import { MetricCard } from "../../components/MetricCard";
import { useDemoStore } from "../../data/DemoStoreContext";

export function TeamDashboard() {
  const { currentTeam } = useDemoStore();
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">团队运营总览</p><h1>{currentTeam?.name ?? "团队工作台"}</h1><span>成员今日活跃 16 人，还有 3 条数据待结算前复核</span></div><button className="button button-primary">邀请成员</button></div><div className="metric-grid"><MetricCard label="团队成员" value="18 人" detail="本月新增 3 人" icon={Users} /><MetricCard label="今日上传" value="86 条" detail="较昨日 +12.4%" icon={FileVideo} tone="violet" /><MetricCard label="有效时长" value="28.6h" detail="本周累计" icon={Clock3} tone="amber" /><MetricCard label="团队通过率" value="91.2%" detail="高于平台 2.8%" icon={BadgeCheck} tone="green" /></div><div className="dashboard-grid"><section className="content-card content-card-wide"><div className="card-heading"><div><h2>团队数据趋势</h2><p>近 7 日上传量与有效时长</p></div></div><div className="large-chart-placeholder">{[45,68,53,82,74,96,88].map((h,i)=><i key={i} style={{height:`${h}%`}} />)}</div></section><aside className="content-card"><div className="card-heading"><div><h2>待处理事项</h2><p>需要你关注的异常</p></div></div><div className="todo-list"><div><span className="dot dot-red"/><p><strong>3 条数据待复核</strong><small>将于今日 24:00 锁定</small></p></div><div><span className="dot dot-amber"/><p><strong>2 个 AI 任务失败</strong><small>建议联系平台管理员</small></p></div></div></aside></div></div>;
}
