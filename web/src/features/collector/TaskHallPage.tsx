"use client";

import { ClipboardList, CircleDollarSign, PauseCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { useInteractions } from "../../interactions/InteractionContext";
import { listTasksForCollector, taskErrorMessage } from "../../tasks/client/taskApi";
import type { CollectionTaskForCollector } from "../../tasks/contracts";

const SELECTED_TASK_STORAGE_KEY = "evdp:selectedTaskId";

export function TaskHallPage({ navigate }: { navigate(path: string): void }) {
  const { notify } = useInteractions();
  const [tasks, setTasks] = useState<CollectionTaskForCollector[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">(
    "loading",
  );

  useEffect(() => {
    let active = true;
    listTasksForCollector()
      .then((items) => {
        if (!active) return;
        setTasks(items);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  function goCollect(task: CollectionTaskForCollector) {
    if (task.status !== "published") {
      notify("error", "该任务当前已暂停，暂不可提交");
      return;
    }
    sessionStorage.setItem(SELECTED_TASK_STORAGE_KEY, task.id);
    navigate("/collector/upload");
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="page-kicker">众包采集入口</p>
          <h1>任务大厅</h1>
          <span>选择正在进行的采集任务，按任务要求拍摄并提交视频</span>
        </div>
      </div>

      {mode === "unavailable" ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>任务服务暂不可用</strong>
          <span>请稍后重试</span>
        </div>
      ) : mode === "loading" ? (
        <div className="empty-state">
          <span>正在读取任务…</span>
        </div>
      ) : tasks.length === 0 ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>暂无进行中的任务</strong>
          <span>管理员发布任务后即可在此查看并提交</span>
        </div>
      ) : (
        <div className="task-hall-grid">
          {tasks.map((task) => (
            <article className="content-card task-card" key={task.id}>
              <div className="task-card-head">
                <div>
                  <h2>{task.title}</h2>
                  <p className="task-scene">场景：{task.sceneName}</p>
                </div>
                <StatusBadge
                  label={task.status === "paused" ? "已暂停" : "进行中"}
                  tone={task.status === "paused" ? "warning" : "success"}
                />
              </div>
              <p className="task-desc">
                {task.normalizedRequirements?.scene_description ??
                  (task.description || "（任务未提供说明）")}
              </p>
              {task.normalizedRequirements?.requirements.length ? (
                <ul className="task-req-list">
                  {task.normalizedRequirements.requirements
                    .slice(0, 5)
                    .map((item, index) => (
                      <li key={`${item.type}-${index}`}>
                        <span className={`req-badge ${item.type}`}>
                          {item.type === "hard" ? "硬性" : "一般"}
                        </span>
                        {item.content}
                      </li>
                    ))}
                  {task.normalizedRequirements.requirements.length > 5 && (
                    <li className="req-more">
                      等共 {task.normalizedRequirements.requirements.length} 条要求
                    </li>
                  )}
                </ul>
              ) : null}
              <div className="task-card-foot">
                <span className="task-price">
                  <CircleDollarSign size={15} />
                  {task.pricePointsPerMinute !== null
                    ? `${task.pricePointsPerMinute} 分/分钟`
                    : "按全局规则计分"}
                </span>
                <button
                  type="button"
                  className="button button-primary button-small"
                  disabled={task.status !== "published"}
                  onClick={() => goCollect(task)}
                >
                  {task.status === "paused" ? (
                    <>
                      <PauseCircle size={14} />
                      已暂停
                    </>
                  ) : (
                    "去采集"
                  )}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
