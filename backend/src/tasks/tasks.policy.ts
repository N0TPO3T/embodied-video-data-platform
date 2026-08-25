import { Injectable } from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { TaskFailure } from "./tasks.failure.js";

function assertActive(actor: PublicUser): void {
  if (actor.status !== "active") {
    throw new TaskFailure("FORBIDDEN", "账号已停用", 403);
  }
}

function requireAdmin(actor: PublicUser): void {
  assertActive(actor);
  if (actor.role !== "admin") {
    throw new TaskFailure(
      "FORBIDDEN",
      "仅管理员可管理采集任务",
      403,
    );
  }
}

@Injectable()
export class TasksPolicy {
  /** 数采人员 / 团长：任务大厅只读 published + paused 任务 */
  requireListForCollectors(actor: PublicUser): void {
    assertActive(actor);
  }

  /** 管理员：管理列表与所有写操作 */
  requireManage(actor: PublicUser): void {
    requireAdmin(actor);
  }

  /** 任务详情：登录用户可见（管理员可见全部，数采/团长仅可见发布中的任务） */
  requireRead(actor: PublicUser): void {
    assertActive(actor);
  }
}
