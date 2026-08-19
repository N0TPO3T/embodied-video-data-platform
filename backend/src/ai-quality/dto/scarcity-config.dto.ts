import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class ScarcityTierDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  minCount!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxCount!: number | null;

  @IsNumber()
  @Min(0)
  @Max(1)
  coefficient!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  label!: string;
}

export class ScarcityWeightsDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  scene!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  standardTask!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  variant!: number;
}

export class PublishScarcityConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ScarcityTierDto)
  tiers!: ScarcityTierDto[];

  @ValidateNested()
  @Type(() => ScarcityWeightsDto)
  weights!: ScarcityWeightsDto;

  @IsString()
  @MaxLength(500)
  description!: string;
}
