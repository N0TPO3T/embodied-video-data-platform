"use client";

import { Search, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";

export function MembersPage() {
  const { state, currentTeam, currentUser } = useDemoStore();
  const [query, setQuery] = useState("");
  const members = state.users.filter((user) => (currentTeam?.memberIds.includes(user.id) || user.id === currentUser.id) && `${user.name}${user.account}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">{currentTeam?.name}</p><h1>成员管理</h1><span>查看成员活跃状态、数据贡献与质量表现</span></div><button className="button button-primary"><UserPlus size={16} />邀请成员</button></div><section className="content-card table-card"><div className="filter-bar"><label className="search-field"><Search size={16} /><input aria-label="搜索成员" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或账号" /></label><span className="filter-count"><Users size={15} />{members.length} 位成员</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>成员</th><th>角色</th><th>今日上传</th><th>有效时长</th><th>通过率</th><th>状态</th><th /></tr></thead><tbody>{members.map((member, index) => <tr key={member.id}><td><div className="member-cell"><span>{member.avatar}</span><div><strong>{member.name}</strong><small>{member.account} · {member.phone}</small></div></div></td><td>{member.role === "leader" ? "团长" : "数采人员"}</td><td>{[0,18,23,16,11][index] ?? 12} 条</td><td>{[0,4.8,5.2,3.7,2.9][index] ?? 3.1}h</td><td><strong>{["—","94.2%","91.8%","89.6%","87.4%"][index] ?? "90.1%"}</strong></td><td><StatusBadge label="在线" tone="success" /></td><td><button className="table-action">查看</button></td></tr>)}</tbody></table></div></section></div>;
}
