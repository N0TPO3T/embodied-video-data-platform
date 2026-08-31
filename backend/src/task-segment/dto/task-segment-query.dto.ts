import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

import type { TaskSegmentGenerationStatus } from "../../database/entities/task-segment-asset.entity.js";

const STATUSES = ["queued", "processing", "ready", "failed", "skipped"] as const;

export class TaskSegmentQueryDto {
  @IsOptional()
  @IsString()
  annotationRunId?: string;

  @IsOptional()
  @IsString()
  submissionId?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: TaskSegmentGenerationStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
