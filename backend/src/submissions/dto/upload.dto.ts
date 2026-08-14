import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateUploadDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsIn(["video/mp4", "video/quicktime"])
  contentType!: "video/mp4" | "video/quicktime";

  @IsInt()
  @Min(1)
  @Max(2_147_483_648)
  sizeBytes!: number;

  @IsString()
  @Matches(/^[0-9a-f]{64}$/u)
  checksumSha256!: string;

  @IsBoolean()
  dataUsageAuthorized!: boolean;

  @IsBoolean()
  privacyConfirmed!: boolean;

  @IsBoolean()
  sensitiveContentConfirmed!: boolean;
}

export class PresignPartsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers!: number[];
}

export class VerifyResumeUploadDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_648)
  sizeBytes!: number;

  @IsString()
  @Matches(/^[0-9a-f]{64}$/u)
  checksumSha256!: string;
}

export class CompletedPartDto {
  @IsInt()
  @Min(1)
  partNumber!: number;

  @IsString()
  @MaxLength(512)
  etag!: string;
}

export class CompleteUploadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts!: CompletedPartDto[];
}

export class ReviewIssueDto {
  @IsString()
  @MaxLength(120)
  label!: string;

  @IsNumber()
  @Min(0)
  start!: number;

  @IsNumber()
  @Min(0)
  end!: number;
}

export class ReviewSubmissionQualityDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  finalScore!: number;

  @IsString()
  @MaxLength(2_000)
  reason!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReviewIssueDto)
  issues!: ReviewIssueDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedReviewRevision?: number;

  @IsOptional()
  @IsBoolean()
  quarantine?: boolean;
}

export class RerunAiQualityDto {
  @IsString()
  @MaxLength(2_000)
  reason!: string;
}

export class RenameSubmissionDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  reason?: string;
}

export class DeleteSubmissionDto {
  @IsString()
  @MaxLength(2_000)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class DeleteSubmissionObjectsDto {
  @IsString()
  @MaxLength(2_000)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class ClearDuplicateCandidateDto {
  @IsString()
  @MaxLength(2_000)
  reason!: string;
}

export class ListSubmissionsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn([
    "all",
    "uploading",
    "queued",
    "processing",
    "completed",
    "failed",
    "passed",
    "reviewed",
    "review_queue",
    "unsettled",
  ])
  status?: string;

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
