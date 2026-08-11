import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  EntityManager,
  Not,
  QueryFailedError,
  Repository,
} from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import { PasswordService } from "../auth/password.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { normalizeUsername, toPublicUser } from "../auth/auth.service.js";
import { SessionEntity } from "../database/entities/session.entity.js";
import { TeamEntity } from "../database/entities/team.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import type {
  ChangeOwnPasswordDto,
  CreateAccountDto,
  SetAccountStatusDto,
  UpdateAccountDto,
} from "./dto/account.dto.js";
import {
  IdentityFailure,
  IdentityPolicy,
} from "./identity.policy.js";

const ACTIVE_ADMIN_INVARIANT_LOCK_ID = "4996251375702723913";

function isUniqueFailure(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === "23505"
  );
}

function auditAccount(user: UserEntity): Record<string, unknown> {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    role: user.role,
    teamId: user.teamId,
    status: user.status,
  };
}

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly policy: IdentityPolicy,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: PublicUser): Promise<PublicUser[]> {
    const scope = this.policy.visibility(actor);
    const users =
      scope.kind === "all"
        ? await this.users.find({ order: { createdAt: "ASC" } })
        : scope.kind === "team"
          ? await this.users.find({
              where: { teamId: scope.teamId },
              order: { createdAt: "ASC" },
            })
          : await this.users.find({
              where: { id: scope.accountId },
            });
    return users.map(toPublicUser);
  }

  async create(
    actor: PublicUser,
    input: CreateAccountDto,
  ): Promise<PublicUser> {
    const mutation = {
      displayName: input.displayName.trim(),
      username: input.username.trim(),
      role: input.role,
      teamId: input.teamId,
    };
    this.policy.assertCanCreate(actor, mutation);
    const passwordHash = await this.passwords.hash(input.password);

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.assertRoleTeam(manager.getRepository(TeamEntity), mutation);
        const users = manager.getRepository(UserEntity);
        const normalized = normalizeUsername(mutation.username);
        if (await users.findOneBy({ usernameNormalized: normalized })) {
          throw new IdentityFailure(
            "CONFLICT",
            "用户名已存在",
            409,
          );
        }
        const saved = await users.save(
          users.create({
            id: `U-${randomUUID()}`,
            ...mutation,
            teamId: mutation.teamId ?? null,
            usernameNormalized: normalized,
            passwordHash,
            status: "active",
          }),
        );
        await this.audit.record(
          manager,
          actor,
          "create",
          { id: saved.id, name: saved.displayName },
          "创建账号",
          null,
          auditAccount(saved),
        );
        return toPublicUser(saved);
      });
    } catch (error) {
      if (isUniqueFailure(error)) {
        throw new IdentityFailure("CONFLICT", "用户名已存在", 409);
      }
      throw error;
    }
  }

  async update(
    actor: PublicUser,
    id: string,
    input: UpdateAccountDto,
  ): Promise<PublicUser> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockActiveAdminInvariant(manager);
      const users = manager.getRepository(UserEntity);
      const target = await users.findOneBy({ id });
      if (!target) {
        throw new IdentityFailure("NOT_FOUND", "账号不存在", 404);
      }
      const mutation = {
        displayName: input.displayName.trim(),
        username: input.username.trim(),
        role: input.role,
        teamId: input.teamId,
      };
      this.policy.assertCanUpdate(actor, target, mutation);
      await this.protectLastAdmin(users, target, {
        role: mutation.role,
        status: target.status,
      });
      await this.assertRoleTeam(
        manager.getRepository(TeamEntity),
        mutation,
      );
      const normalized = normalizeUsername(mutation.username);
      if (
        await users.findOne({
          where: {
            usernameNormalized: normalized,
            id: Not(target.id),
          },
        })
      ) {
        throw new IdentityFailure("CONFLICT", "用户名已存在", 409);
      }
      const before = auditAccount(target);
      const identityChanged =
        target.role !== mutation.role ||
        target.teamId !== (mutation.teamId ?? null);
      Object.assign(target, mutation, {
        teamId: mutation.teamId ?? null,
        usernameNormalized: normalized,
      });
      const saved = await users.save(target);
      if (identityChanged) {
        await manager
          .getRepository(SessionEntity)
          .delete({ accountId: saved.id });
      }
      await this.audit.record(
        manager,
        actor,
        "update",
        { id: saved.id, name: saved.displayName },
        "更新账号信息",
        before,
        auditAccount(saved),
      );
      return toPublicUser(saved);
    });
  }

  async resetPassword(
    actor: PublicUser,
    id: string,
    password: string,
  ): Promise<{ reauthenticate: boolean }> {
    const passwordHash = await this.passwords.hash(password);
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      const target = await users.findOneBy({ id });
      if (!target) {
        throw new IdentityFailure("NOT_FOUND", "账号不存在", 404);
      }
      this.policy.assertCanManage(actor, target);
      target.passwordHash = passwordHash;
      target.failedAttemptCount = 0;
      target.firstFailedAt = null;
      target.lockedUntil = null;
      await users.save(target);
      await manager
        .getRepository(SessionEntity)
        .delete({ accountId: target.id });
      await this.audit.record(
        manager,
        actor,
        "reset_password",
        { id: target.id, name: target.displayName },
        "重置账号密码",
      );
      return { reauthenticate: actor.id === target.id };
    });
  }

  async changeOwnPassword(
    actor: PublicUser,
    input: ChangeOwnPasswordDto,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      const target = await users.findOneBy({ id: actor.id });
      if (
        !target ||
        !(await this.passwords.verify(target.passwordHash, input.currentPassword))
      ) {
        throw new IdentityFailure("VALIDATION", "当前密码错误", 400);
      }

      target.passwordHash = await this.passwords.hash(input.newPassword);
      target.failedAttemptCount = 0;
      target.firstFailedAt = null;
      target.lockedUntil = null;
      await users.save(target);
      await manager
        .getRepository(SessionEntity)
        .delete({ accountId: target.id });
      await this.audit.record(
        manager,
        actor,
        "change_password",
        { id: target.id, name: target.displayName },
        "修改本人密码",
      );
    });
  }

  async setStatus(
    actor: PublicUser,
    id: string,
    input: SetAccountStatusDto,
  ): Promise<PublicUser> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockActiveAdminInvariant(manager);
      const users = manager.getRepository(UserEntity);
      const target = await users.findOneBy({ id });
      if (!target) {
        throw new IdentityFailure("NOT_FOUND", "账号不存在", 404);
      }
      this.policy.assertCanManage(actor, target);
      if (actor.id === target.id && input.status === "disabled") {
        throw new IdentityFailure(
          "VALIDATION",
          "不能停用当前登录账号",
          400,
        );
      }
      await this.protectLastAdmin(users, target, {
        role: target.role,
        status: input.status,
      });
      const before = auditAccount(target);
      target.status = input.status;
      const saved = await users.save(target);
      if (saved.status === "disabled") {
        await manager
          .getRepository(SessionEntity)
          .delete({ accountId: saved.id });
      }
      await this.audit.record(
        manager,
        actor,
        saved.status === "active" ? "enable" : "disable",
        { id: saved.id, name: saved.displayName },
        saved.status === "active" ? "启用账号" : "停用账号",
        before,
        auditAccount(saved),
      );
      return toPublicUser(saved);
    });
  }

  private async assertRoleTeam(
    teams: Repository<TeamEntity>,
    input: {
      role: UserEntity["role"];
      teamId?: string;
    },
  ): Promise<void> {
    if (input.role === "admin") {
      if (input.teamId) {
        throw new IdentityFailure(
          "VALIDATION",
          "管理员不能归属采集团队",
          400,
        );
      }
      return;
    }
    if (!input.teamId) {
      throw new IdentityFailure(
        "VALIDATION",
        "团长和数采人员必须归属团队",
        400,
      );
    }
    const team = await teams.findOneBy({ id: input.teamId });
    if (!team || team.status !== "active") {
      throw new IdentityFailure(
        "VALIDATION",
        "所属团队不存在或已停用",
        400,
      );
    }
  }

  private async protectLastAdmin(
    users: Repository<UserEntity>,
    target: UserEntity,
    next: Pick<UserEntity, "role" | "status">,
  ): Promise<void> {
    if (
      target.role === "admin" &&
      target.status === "active" &&
      (next.role !== "admin" || next.status !== "active") &&
      (await users.countBy({ role: "admin", status: "active" })) <= 1
    ) {
      throw new IdentityFailure(
        "VALIDATION",
        "系统必须保留至少一个启用的管理员",
        400,
      );
    }
  }

  private async lockActiveAdminInvariant(
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      "SELECT pg_advisory_xact_lock($1::bigint)",
      [ACTIVE_ADMIN_INVARIANT_LOCK_ID],
    );
  }
}
