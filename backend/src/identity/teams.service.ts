import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { TeamEntity } from "../database/entities/team.entity.js";
import type {
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
    return this.dataSource.transaction(async (manager) => {
      const teams = manager.getRepository(TeamEntity);
      const name = input.name.trim();
      if (await teams.findOneBy({ name })) {
        throw new IdentityFailure("CONFLICT", "团队名称已存在", 409);
      }
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
      );
      return publicTeam(saved);
    });
  }

  async update(actor: PublicUser, id: string, input: UpdateTeamDto) {
    this.policy.assertCanManageTeams(actor);
    return this.dataSource.transaction(async (manager) => {
      const teams = manager.getRepository(TeamEntity);
      const target = await teams.findOneBy({ id });
      if (!target) {
        throw new IdentityFailure("NOT_FOUND", "团队不存在", 404);
      }
      const before = publicTeam(target);
      target.name = input.name.trim();
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
  }
}
