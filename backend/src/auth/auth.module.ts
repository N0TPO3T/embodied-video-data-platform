import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { SessionEntity } from "../database/entities/session.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { PasswordService } from "./password.service.js";
import { SessionGuard } from "./session.guard.js";

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, SessionEntity])],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionGuard],
  exports: [AuthService, PasswordService, SessionGuard],
})
export class AuthModule {}
