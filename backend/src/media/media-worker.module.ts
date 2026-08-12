import { Module } from "@nestjs/common";

import { MediaModule } from "./media.module.js";
import { RabbitMediaWorker } from "./rabbit-media-worker.js";

@Module({
  imports: [MediaModule],
  providers: [RabbitMediaWorker],
})
export class MediaWorkerModule {}
