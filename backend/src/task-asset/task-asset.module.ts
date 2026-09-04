import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OperationsFailureFilter } from "../operations/operations-failure.filter.js";
import { TaskAssetController } from "./task-asset.controller.js";
import { TaskAssetService } from "./task-asset.service.js";

@Module({ imports: [AuthModule], controllers: [TaskAssetController], providers: [TaskAssetService, OperationsFailureFilter] })
export class TaskAssetModule {}
