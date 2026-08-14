import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DeliveryArchiveTaskEntity } from "../database/entities/delivery-archive-task.entity.js";
import { DeliveryPackageEntity } from "../database/entities/delivery-package.entity.js";
import { DeliveryPackageItemEntity } from "../database/entities/delivery-package-item.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SecurityModule } from "../security/security.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { DeliveryArchiveWorker } from "./delivery-archive.worker.js";
import { DeliveryFailureFilter } from "./delivery-failure.filter.js";
import { DeliveryPackagesController } from "./delivery-packages.controller.js";
import { DeliveryPackagesService } from "./delivery-packages.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeliveryPackageEntity,
      DeliveryPackageItemEntity,
      DeliveryArchiveTaskEntity,
    ]),
    AuthModule,
    AuditModule,
    SecurityModule,
    StorageModule,
  ],
  controllers: [DeliveryPackagesController],
  providers: [
    DeliveryPackagesService,
    DeliveryArchiveWorker,
    DeliveryFailureFilter,
    AllowedOriginGuard,
  ],
})
export class DeliveryModule {}
