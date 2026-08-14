import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateQualityRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  version!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  passThreshold!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  description!: string;
}
