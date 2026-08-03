import { qualityStatus, validateWithdrawal } from "../domain/calculations";
import type { Role, Submission, WithdrawalStatus } from "../domain/types";
import { demoSeed, type DemoState } from "./demoData";

type Listener = () => void;

export class DemoStore {
  private state: DemoState;
  private listeners = new Set<Listener>();

  constructor(seed: DemoState) {
    this.state = structuredClone(seed);
  }

  getState(): DemoState {
    return this.state;
  }

  getSubmission(id: string): Submission {
    const submission = this.state.submissions.find((item) => item.id === id);
    if (!submission) throw new Error("数据提交不存在");
    return submission;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  loginAs(role: Role): void {
    const user = this.state.users.find((item) => item.role === role);
    if (!user) throw new Error("演示账号不存在");
    this.state = { ...this.state, currentUserId: user.id };
    this.notify();
  }

  addUploads(files: File[]): void {
    const user = this.currentUser();
    const team = this.state.teams.find((item) => item.id === user.teamId);
    if (!team) throw new Error("当前账号未加入团队");

    const created = files.map<Submission>((file, index) => ({
      id: `SUB-UP-${Date.now()}-${index}`,
      fileName: file.name,
      ownerId: user.id,
      ownerName: user.name,
      teamId: team.id,
      teamName: team.name,
      scene: "待识别",
      action: "AI 分析中",
      object: "待识别",
      durationSeconds: 0,
      invalidSeconds: 0,
      sizeMb: Math.max(0.1, Math.round((file.size / 1024 / 1024) * 10) / 10),
      resolution: "解析中",
      processingStatus: "queued",
      qualityStatus: "pending",
      aiScore: 0,
      finalScore: 0,
      settlementStatus: "unsettled",
      createdAt: "2026-08-03 17:00",
      tags: [],
      issues: [],
      audit: [],
    }));

    this.state = {
      ...this.state,
      submissions: [...created, ...this.state.submissions],
    };
    this.notify();
  }

  adjustQuality(id: string, score: number, reason: string): void {
    const current = this.currentUser();
    const submission = this.getSubmission(id);

    if (submission.settlementStatus === "settled") {
      throw new Error("已结算数据不可修改");
    }
    if (current.role === "collector") {
      throw new Error("无权调整该数据");
    }
    if (current.role === "leader" && current.teamId !== submission.teamId) {
      throw new Error("无权调整该团队数据");
    }
    if (!reason.trim()) {
      throw new Error("请填写调整原因");
    }

    this.state = {
      ...this.state,
      submissions: this.state.submissions.map((item) =>
        item.id === id
          ? {
              ...item,
              finalScore: score,
              qualityStatus: qualityStatus(score),
              audit: [
                ...item.audit,
                {
                  id: `AUD-${Date.now()}`,
                  actor: current.name,
                  action: "人工调整质量评分",
                  reason: reason.trim(),
                  createdAt: "2026-08-03 17:02",
                  previousScore: item.finalScore,
                  nextScore: score,
                },
              ],
            }
          : item,
      ),
    };
    this.notify();
  }

  requestWithdrawal(amount: number): void {
    const user = this.currentUser();
    const validation = validateWithdrawal(
      amount,
      this.state.wallet.available,
      this.state.wallet.minimumWithdrawal,
    );
    if (!validation.valid) throw new Error(validation.message);

    this.state = {
      ...this.state,
      wallet: {
        ...this.state.wallet,
        available: this.state.wallet.available - amount,
        frozen: this.state.wallet.frozen + amount,
      },
      withdrawals: [
        {
          id: `WD-${Date.now()}`,
          userId: user.id,
          userName: user.name,
          amount,
          status: "pending",
          account: user.alipayAccount ?? "未设置",
          createdAt: "2026-08-03 17:03",
        },
        ...this.state.withdrawals,
      ],
    };
    this.notify();
  }

  reviewWithdrawal(id: string, status: WithdrawalStatus): void {
    if (this.currentUser().role !== "admin") {
      throw new Error("仅管理员可审核提现");
    }

    this.state = {
      ...this.state,
      withdrawals: this.state.withdrawals.map((item) =>
        item.id === id ? { ...item, status } : item,
      ),
    };
    this.notify();
  }

  private currentUser() {
    const user = this.state.users.find(
      (item) => item.id === this.state.currentUserId,
    );
    if (!user) throw new Error("当前演示账号不存在");
    return user;
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export function createDemoStore(seed: DemoState): DemoStore {
  return new DemoStore(seed);
}

export { demoSeed };
