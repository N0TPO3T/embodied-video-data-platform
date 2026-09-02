import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { OperationsModule } from "../operations/operations.module.js";
import { TaskSegmentModule } from "../task-segment/task-segment.module.js";
import { RabbitAnnotationWorker } from "./rabbit-annotation-worker.js";
import { VideoAnnotationModule } from "./video-annotation.module.js";

@Module({
  imports: [DatabaseModule, OperationsModule, VideoAnnotationModule, TaskSegmentModule],
  providers: [RabbitAnnotationWorker],
})
export class AnnotationWorkerModule {}
