import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { toPublicUser } from "../auth/auth.service.js";
import { SessionEntity } from "../database/entities/session.entity.js";
import { TeamEntity } from "../database/entities/team.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import type {
  AssignTeamLeaderDto,
  CreateTeamDto,
  UpdateTeamDto,
} from "./dto/team.dto.js";
import {
  IdentityFailure,
  IdentityPolicy,
} from "./identity.policy.js";

function publicTeam(team: TeamEntity) {
  return {
    id: team.id,
    name: team.name,
    status: team.status,
    unitPricePerMinute: Number(team.unitPricePerMinute),
    createdAt: team.createdAt.getTime(),
    updatedAt: team.updatedAt.getTime(),
  };
}

function isUniqueFailure(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === "23505"
  );
}

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(TeamEntity)
    private readonly teams: Repository<TeamEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly policy: IdentityPolicy,
    private readonly audit: AuditService,
  ) {}

  async list(actor: PublicUser) {
    const scope = this.policy.visibility(actor);
    const teams =
      scope.kind === "all"
        ? await this.teams.find({ order: { createdAt: "ASC" } })
        : scope.kind === "team"
          ? await this.teams.findBy({ id: scope.teamId })
          : actor.teamId
            ? await this.teams.findBy({ id: actor.teamId })
            : [];
    return teams.map(publicTeam);
  }

  async create(actor: PublicUser, input: CreateTeamDto) {
    this.policy.assertCanManageTeams(actor);
    const name = this.normalizedName(input.name);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const teams = manager.getRepository(TeamEntity);
        await this.lockTeamNames(manager);
        await this.assertUniqueName(teams, name);
        const saved = await teams.save({
          id: `TEAM-${randomUUID()}`,
          name,
          unitPricePerMinute: input.unitPricePerMinute.toFixed(4),
          status: "active",
        });
        await this.audit.record(
          manager,
          actor,
          "team_create",
          { id: saved.id, name: saved.name },
          "创建团队",
          null,
          publicTeam(saved),
        );
        return publicTeam(saved);
      });
    } catch (error) {
      if (isUniqueFailure(error)) {
        throw new IdentityFailure("CONFLICT", "团队名称已存在", 409);
      }
      throw error;
    }
  }

  async update(actor: PublicUser, id: string, input: UpdateTeamDto) {
    this.policy.assertCanManageTeams(actor);
    const name = this.normalizedName(input.name);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const teams = manager.getRepository(TeamEntity);
        const target = await teams.findOne({
          where: { id },
          lock: { mode: "pessimistic_write" },
        });
        if (!target) {
          throw new IdentityFailure("NOT_FOUND", "团队不存在", 404);
        }
        await this.lockTeamNames(manager);
        await this.assertUniqueName(teams, name, id);
        if (target.status === "active" && input.status === "disabled") {
          const activeMembers = await manager.getRepository(UserEntity).countBy({
            teamId: id,
            status: "active",
          });
          if (activeMembers > 0) {
            throw new IdentityFailure(
              "VALIDATION",
              `请先停用或转移团队内的 ${activeMembers} 个启用账号`,
              400,
            );
          }
        }
        const before = publicTeam(target);
        target.name = name;
        target.unitPricePerMinute = input.unitPricePerMinute.toFixed(4);
        target.status = input.status ?? target.status;
        const saved = await teams.save(target);
        await this.audit.record(
          manager,
          actor,
          "team_update",
          { id: saved.id, name: saved.name },
          "更新团队",
          before,
          publicTeam(saved),
        );
        return publicTeam(saved);
      });
    } catch (error) {
      if (isUniqueFailure(error)) {
        throw new IdentityFailure("CONFLICT", "团队名称已存在", 409);
      }
      throw error;
    }
  }

  async assignLeader(
    actor: PublicUser,
    id: string,
    input: AssignTeamLeaderDto,
  ) {
    this.policy.assertCanManageTeams(actor);
    return this.dataSource.transaction(async (manager) => {
      const team = await manager.getRepository(TeamEntity).findOne({
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!team) {
        throw new IdentityFailure("NOT_FOUND", "团队不存在", 404);
      }
      if (team.status !== "active") {
        throw new IdentityFailure(
          "VALIDATION",
          "请先启用团队，再指定团长",
          400,
        );
      }

      const users = manager.getRepository(UserEntity);
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`team-leader:${team.id}`],
      );
      const candidate = await users.findOneBy({ id: input.accountId });
      if (!candidate || candidate.teamId !== team.id) {
        throw new IdentityFailure(
          "VALIDATION",
          "请选择该团队内的账号作为团长",
          400,
        );
      }
      if (candidate.status !== "active") {
        throw new IdentityFailure(
          "VALIDATION",
          "停用账号不能被指定为团长",
          400,
        );
      }

      const currentLeaders = await users.findBy({
        teamId: team.id,
        role: "leader",
      });
      if (
        currentLeaders.length === 1 &&
        currentLeaders[0]?.id === candidate.id
      ) {
        return [toPublicUser(candidate)];
      }

      const changed: UserEntity[] = [];
      for (const currentLeader of currentLeaders) {
        if (currentLeader.id === candidate.id) continue;
        currentLeader.role = "collector";
        changed.push(await users.save(currentLeader));
      }
      candidate.role = "leader";
      changed.push(await users.save(candidate));
      for (const changedAccount of changed) {
        await manager.getRepository(SessionEntity).delete({
          accountId: changedAccount.id,
        });
      }
      await this.audit.record(
        manager,
        actor,
        "team_assign_leader",
        { id: team.id, name: team.name },
        `指定团长为${candidate.displayName}`,
        { leaderAccountIds: currentLeaders.map((leader) => leader.id) },
        { leaderAccountId: candidate.id },
      );
      return changed.map(toPublicUser);
    });
  }

  private normalizedName(value: string): string {
    const name = value.trim();
    if (!name) {
      throw new IdentityFailure("VALIDATION", "团队名称不能为空", 400);
    }
    return name;
  }

  private async assertUniqueName(
    teams: Repository<TeamEntity>,
    name: string,
    excludedId?: string,
  ): Promise<void> {
    const query = teams
      .createQueryBuilder("team")
      .where("LOWER(BTRIM(team.name)) = LOWER(BTRIM(:name))", { name });
    if (excludedId) {
      query.andWhere("team.id <> :excludedId", { excludedId });
    }
    if (await query.getOne()) {
      throw new IdentityFailure("CONFLICT", "团队名称已存在", 409);
    }
  }

  private async lockTeamNames(manager: EntityManager): Promise<void> {
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["team-name"],
    );
  }
}
