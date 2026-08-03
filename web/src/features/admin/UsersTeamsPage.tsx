import { ShieldCheck, UserRoundPlus, Users } from "lucide-react";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";

const roleLabel={collector:"数采人员",leader:"团长",admin:"管理员"};
export function UsersTeamsPage() {
  const { state }=useDemoStore();
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">组织与权限</p><h1>用户与团队</h1><span>创建演示账号、设置角色并维护团队归属</span></div><button className="button button-primary"><UserRoundPlus size={16}/>新增用户</button></div><div className="people-summary"><article><Users size={22}/><span><strong>{state.users.length}</strong><small>演示用户</small></span></article><article><ShieldCheck size={22}/><span><strong>{state.teams.length}</strong><small>运营团队</small></span></article><div>{state.teams.map((team)=><span key={team.id}><strong>{team.name}</strong><small>{team.memberIds.length} 名成员 · ¥{team.unitPricePerMinute}/分钟</small></span>)}</div></div><section className="content-card table-card"><div className="card-heading"><div><h2>账号列表</h2><p>角色权限与团队归属</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>用户</th><th>账号</th><th>角色</th><th>所属团队</th><th>手机</th><th>状态</th><th/></tr></thead><tbody>{state.users.map((user)=><tr key={user.id}><td><div className="member-cell"><span>{user.avatar}</span><div><strong>{user.name}</strong><small>{user.id}</small></div></div></td><td>{user.account}</td><td>{roleLabel[user.role]}</td><td>{state.teams.find((team)=>team.id===user.teamId)?.name??"平台"}</td><td>{user.phone}</td><td><StatusBadge label="正常" tone="success"/></td><td><button className="table-action">配置</button></td></tr>)}</tbody></table></div></section></div>;
}
