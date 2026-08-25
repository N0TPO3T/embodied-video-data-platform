import { Search } from "lucide-react";

export function FilterBar({
  value,
  onChange,
  status,
  onStatusChange,
  taskId,
  onTaskChange,
  taskSources = [],
  placeholder = "搜索文件名、编号或场景",
}: {
  value: string;
  onChange(value: string): void;
  status: string;
  onStatusChange(value: string): void;
  taskId?: string;
  onTaskChange?(value: string): void;
  taskSources?: Array<{ taskId: string; title: string; sceneName: string }>;
  placeholder?: string;
}) {
  return (
    <div className="filter-bar">
      <label className="search-field"><Search size={16} /><input aria-label="搜索" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>
      {taskId !== undefined && onTaskChange && (
        <select
          className="task-source-filter"
          aria-label="任务来源筛选"
          value={taskId}
          onChange={(event) => onTaskChange(event.target.value)}
        >
          <option value="all">全部任务来源</option>
          {taskSources.map((source) => (
            <option key={source.taskId} value={source.taskId}>
              {source.title} · {source.sceneName}
            </option>
          ))}
          <option value="__none__">未关联任务</option>
        </select>
      )}
      <select aria-label="状态筛选" value={status} onChange={(event) => onStatusChange(event.target.value)}>
        <option value="all">全部状态</option>
        <option value="completed">处理完成</option>
        <option value="processing">处理中</option>
        <option value="passed">质量通过</option>
        <option value="failed">质量未通过</option>
        <option value="unsettled">待结算</option>
      </select>
    </div>
  );
}
