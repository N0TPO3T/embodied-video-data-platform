import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
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
}

export class PresignPartsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers!: number[];
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
