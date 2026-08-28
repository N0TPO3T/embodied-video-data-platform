import { Module } from "@nestjs/common";

import { OperationsModule } from "../operations/operations.module.js";
import { TaskSegmentModule } from "../task-segment/task-segment.module.js";
import { MediaModule } from "./media.module.js";
import { RabbitMediaWorker } from "./rabbit-media-worker.js";

@Module({
  imports: [MediaModule, OperationsModule, TaskSegmentModule],
  providers: [RabbitMediaWorker],
})
export class MediaWorkerModule {}
