"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { getLabelSet } from "../../ai-quality/client/aiQualityApi";
import { Modal } from "../../components/Modal";
import type {
  CollectionTask,
  CreateTaskInput,
  UpdateTaskInput,
} from "../../tasks/contracts";

export function TaskFormModal({
  open,
  mode,
  task,
  onCreate,
  onUpdate,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  mode: "create" | "edit";
  task?: CollectionTask;
  onCreate(input: CreateTaskInput): Promise<CollectionTask>;
  onUpdate(id: string, input: UpdateTaskInput): Promise<CollectionTask>;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [sceneName, setSceneName] = useState(task?.sceneName ?? "");
  const [rawRequirements, setRawRequirements] = useState(
    task?.rawRequirements ?? "",
  );
  const [price, setPrice] = useState(
    task?.pricePointsPerMinute !== null && task?.pricePointsPerMinute !== undefined
      ? String(task.pricePointsPerMinute)
      : "",
  );
  const [sceneSuggestions, setSceneSuggestions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const activeSuggestionRef = useRef(false);

  const sceneOptions = useMemo(() => {
    const options = new Set<string>();
    for (const name of sceneSuggestions) options.add(name);
    if (sceneName.trim()) options.add(sceneName.trim());
    return [...options];
  }, [sceneName, sceneSuggestions]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    getLabelSet()
      .then((labelSet) => {
        if (!active) return;
        setSceneSuggestions(
          labelSet.labels
            .filter(
              (label) => label.type === "scene" && label.enabled,
            )
            .map((label) => label.name),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open]);

  function close() {
    if (submittingRef.current) return;
    setError("");
    onClose();
  }

  function pickScene(name: string) {
    setSceneName(name);
    activeSuggestionRef.current = false;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    const parsedPrice =
      price.trim() === "" ? null : Number(price);
    const fields = {
      title: title.trim(),
      description: description.trim(),
      sceneName: sceneName.trim(),
      rawRequirements: rawRequirements.trim(),
      ...(parsedPrice !== null && Number.isFinite(parsedPrice)
        ? { pricePointsPerMinute: parsedPrice }
        : { pricePointsPerMinute: null }),
    };

    try {
      if (mode === "create") {
        await onCreate(fields);
      } else if (task) {
        await onUpdate(task.id, fields);
      }
      submittingRef.current = false;
      setSubmitting(false);
      onClose();
    } catch (reason) {
      submittingRef.current = false;
      setSubmitting(false);
      setError(reason instanceof Error ? reason.message : "保存失败，请重试");
    }
  }

  const filteredSceneOptions = sceneOptions.filter((name) =>
    name.toLowerCase().includes(sceneName.trim().toLowerCase()),
  );

  return (
    <Modal
      open={open}
      title={mode === "create" ? "创建采集任务" : "编辑采集任务"}
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <label>
            <span>任务标题</span>
            <input
              ref={firstInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：厨房做饭场景数据采集"
              required
              maxLength={120}
            />
          </label>
          <label>
            <span>场景名称（支持从标签字典补全，全新场景发布时自动加入字典）</span>
            <input
              value={sceneName}
              onChange={(event) => {
                setSceneName(event.target.value);
                activeSuggestionRef.current = false;
              }}
              onBlur={() => {
                activeSuggestionRef.current = false;
              }}
              placeholder="例如：家庭厨房"
              required
              maxLength={120}
              list={undefined}
            />
            {sceneName.trim() && filteredSceneOptions.length > 0 && (
              <ul className="suggestion-list">
                {filteredSceneOptions.slice(0, 8).map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => pickScene(name)}
                      onMouseDown={(event) => {
                        activeSuggestionRef.current = true;
                        event.preventDefault();
                      }}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
          <label>
            <span>任务说明（展示给数采人员）</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="采集目标、拍摄方式等面向采集者的说明"
              rows={3}
              maxLength={20000}
            />
          </label>
          <label>
            <span>任务要求（自由填写，保存后可用 AI 规范化）</span>
            <textarea
              value={rawRequirements}
              onChange={(event) => setRawRequirements(event.target.value)}
              placeholder="例如：视频必须是第一人称视角，画面中必须出现双手操作，光线要充足，不能出现人脸和门牌号等隐私信息……"
              rows={6}
              required
              maxLength={20000}
            />
          </label>
          <label>
            <span>每分钟积分单价（留空回退全局默认）</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="10000"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="例如：15.5"
            />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={close}>
            取消
          </button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
