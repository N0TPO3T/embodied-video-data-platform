import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { SessionEntity } from "../database/entities/session.entity.js";
import { TeamEntity } from "../database/entities/team.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { AccountsController } from "./accounts.controller.js";
import { AccountsService } from "./accounts.service.js";
import { IdentityPolicy } from "./identity.policy.js";
import { TeamsController } from "./teams.controller.js";
import { TeamsService } from "./teams.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, TeamEntity, SessionEntity]),
    AuthModule,
    AuditModule,
  ],
  controllers: [AccountsController, TeamsController],
  providers: [
    AccountsService,
    TeamsService,
    IdentityPolicy,
    AllowedOriginGuard,
  ],
  exports: [AccountsService, TeamsService, IdentityPolicy],
})
export class IdentityModule {}
