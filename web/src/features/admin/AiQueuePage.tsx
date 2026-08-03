"use client";

import { CheckCircle2, CircleX, Clock3, Cpu, Play, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";

export function AiQueuePage() {
  const { state }=useDemoStore(); const [rerun,setRerun]=useState<string[]>([]); const jobs=[...state.submissions.slice(0,5).map((item,index)=>({id:`JOB-${String(index+1).padStart(3,"0")}`,file:item.fileName,status:index===3?"failed":item.processingStatus,worker:index%2?"worker-02":"worker-01",elapsed:["1m 26s","42s","排队 3m","失败 2 次","18s"][index]}))];
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">AI Worker 实时队列</p><h1>AI 任务</h1><span>查看媒体解析、标签生成、质量评估和异常重跑</span></div><span className="live-pill"><i/>4 Worker 在线</span></div><div className="metric-grid"><MetricCard label="等待处理" value="128" detail="预计 6 分钟清空" icon={Clock3} tone="amber"/><MetricCard label="分析中" value="42" detail="4 个并发 Worker" icon={Cpu}/><MetricCard label="今日完成" value="1,064" detail="平均用时 38 秒" icon={CheckCircle2} tone="green"/><MetricCard label="异常任务" value="12" detail="较昨日 -4" icon={CircleX} tone="violet"/></div><section className="content-card table-card"><div className="card-heading"><div><h2>任务队列</h2><p>最近生成和执行的 AI 分析任务</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>任务</th><th>视频文件</th><th>阶段</th><th>执行节点</th><th>耗时</th><th>状态</th><th/></tr></thead><tbody>{jobs.map((job)=><tr key={job.id}><td><strong>{job.id}</strong></td><td>{job.file}</td><td>内容理解 + 质量评估</td><td>{job.worker}</td><td>{job.elapsed}</td><td><StatusBadge label={rerun.includes(job.id)?"已重新排队":job.status==="failed"?"执行失败":job.status==="completed"?"成功":"处理中"} tone={job.status==="failed"&&!rerun.includes(job.id)?"danger":job.status==="completed"?"success":"info"}/></td><td>{job.status==="failed"&&<button className="table-action" onClick={()=>setRerun((list)=>[...list,job.id])}>{rerun.includes(job.id)?<Play size={14}/>:<RefreshCcw size={14}/>}重跑</button>}</td></tr>)}</tbody></table></div></section></div>;
}
