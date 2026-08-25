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
      className="task-form-modal"
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <p className="task-form-intro">
          先清楚说明采集目标与原始要求，保存后再使用 AI 规范化并确认，最后发布给数采人员。
        </p>
        <section className="task-form-section">
          <div className="task-form-section-title">
            <span>1</span>
            <div><strong>基础信息</strong><small>用于任务大厅识别和归类</small></div>
          </div>
          <div className="task-form-two-column">
            <label className="form-label">
              <span>任务标题 <em>必填</em></span>
              <input
                ref={firstInputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：厨房做饭场景数据采集"
                required
                maxLength={120}
              />
              <small className="field-counter">{title.length}/120</small>
            </label>
            <label className="form-label task-scene-field">
              <span>场景名称 <em>必填</em></span>
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
              <small className="field-help">可选择已有标签；新场景发布时自动加入字典</small>
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
          </div>
        </section>
        <section className="task-form-section">
          <div className="task-form-section-title">
            <span>2</span>
            <div><strong>采集说明与要求</strong><small>这些内容会直接影响数采理解与 AI 质检</small></div>
          </div>
          <div className="task-form-grid">
            <label className="form-label">
              <span>面向数采人员的任务说明</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="说明采集目标、拍摄方式、完成标准和常见误区"
                rows={4}
                maxLength={20000}
              />
            </label>
            <label className="form-label">
              <span>原始任务要求 <em>必填</em></span>
              <textarea
                value={rawRequirements}
                onChange={(event) => setRawRequirements(event.target.value)}
                placeholder="建议分条填写，例如：\n1. 必须使用第一人称视角；\n2. 双手与主要操作对象全程可见；\n3. 不得出现人脸、门牌号等隐私信息。"
                rows={7}
                required
                maxLength={20000}
              />
              <small className="field-help">保存后可通过“规范化”整理成硬性要求与一般要求</small>
            </label>
          </div>
        </section>
        <section className="task-form-section task-form-price-section">
          <div className="task-form-section-title">
            <span>3</span>
            <div><strong>计分方式</strong><small>不填写时沿用平台全局规则</small></div>
          </div>
          <label className="form-label task-price-field">
            <span>每分钟积分单价</span>
            <div className="input-with-suffix">
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
              <span>分 / 分钟</span>
            </div>
          </label>
        </section>
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
