import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class PointRuleCoefficientBandDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  minScore!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  maxScore!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  ratio!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label!: string;
}

export class CreatePointRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  version!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1_000_000)
  defaultPointsPerMinute!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PointRuleCoefficientBandDto)
  coefficientBands!: PointRuleCoefficientBandDto[];

  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  description!: string;
}
