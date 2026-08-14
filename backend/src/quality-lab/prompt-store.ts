import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { LoadedVideoQualityPrompt } from "../video-quality/prompt-loader.js";

export type QualityLabPromptSnapshot = LoadedVideoQualityPrompt & {
  revision: number;
  updatedAt: string;
};

type PersistedPrompt = {
  version: 1;
  revision: number;
  systemPrompt: string;
  contentSha256: string;
  updatedAt: string;
};

type QualityLabPromptStoreOptions = {
  committedPrompt: LoadedVideoQualityPrompt;
  persistencePath?: string;
  now?: () => Date;
};

function contentSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeSystemPrompt(value: string): string {
  const prompt = value.trim();
  if (!prompt) throw new Error("系统提示词不能为空");
  if (prompt.length > 100_000) {
    throw new Error("系统提示词不能超过 100000 个字符");
  }
  if (!/video_qc_v1/u.test(prompt) || !/JSON/iu.test(prompt)) {
    throw new Error("系统提示词必须保留 video_qc_v1 和 JSON 结构化输出约束");
  }
  return prompt;
}

export class QualityLabPromptStore {
  private readonly committedPrompt: LoadedVideoQualityPrompt;
  private readonly persistencePath?: string;
  private readonly now: () => Date;
  private current: QualityLabPromptSnapshot;

  constructor(options: QualityLabPromptStoreOptions) {
    this.committedPrompt = options.committedPrompt;
    this.persistencePath = options.persistencePath;
    this.now = options.now ?? (() => new Date());
    this.current = {
      ...options.committedPrompt,
      contentSha256: contentSha256(options.committedPrompt.systemPrompt),
      revision: 1,
      updatedAt: this.now().toISOString(),
    };
    this.load();
  }

  getCurrent(): QualityLabPromptSnapshot {
    return structuredClone(this.current);
  }

  update(systemPrompt: string): QualityLabPromptSnapshot {
    const normalized = normalizeSystemPrompt(systemPrompt);
    if (normalized === this.current.systemPrompt) return this.getCurrent();
    this.current = {
      ...this.committedPrompt,
      systemPrompt: normalized,
      contentSha256: contentSha256(normalized),
      revision: this.current.revision + 1,
      updatedAt: this.now().toISOString(),
    };
    this.persist();
    return this.getCurrent();
  }

  private load(): void {
    if (!this.persistencePath || !existsSync(this.persistencePath)) return;
    const document = JSON.parse(
      readFileSync(this.persistencePath, "utf8"),
    ) as PersistedPrompt;
    if (
      document.version !== 1 ||
      !Number.isInteger(document.revision) ||
      document.revision < 1 ||
      typeof document.systemPrompt !== "string" ||
      typeof document.updatedAt !== "string"
    ) {
      throw new Error("AI 质检实验页提示词文件版本无效");
    }
    const systemPrompt = normalizeSystemPrompt(document.systemPrompt);
    this.current = {
      ...this.committedPrompt,
      systemPrompt,
      contentSha256: contentSha256(systemPrompt),
      revision: document.revision,
      updatedAt: document.updatedAt,
    };
  }

  private persist(): void {
    if (!this.persistencePath) return;
    mkdirSync(dirname(this.persistencePath), { recursive: true });
    const temporaryPath = `${this.persistencePath}.${process.pid}.${randomUUID()}.tmp`;
    const document: PersistedPrompt = {
      version: 1,
      revision: this.current.revision,
      systemPrompt: this.current.systemPrompt,
      contentSha256: this.current.contentSha256,
      updatedAt: this.current.updatedAt,
    };
    writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, this.persistencePath);
  }
}
