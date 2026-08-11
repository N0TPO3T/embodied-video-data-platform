import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import type { TeamStatus } from "../../database/entities/team.entity.js";

export class CreateTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1_000_000)
  unitPricePerMinute!: number;
}

export class UpdateTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1_000_000)
  unitPricePerMinute!: number;

  @IsOptional()
  @IsIn(["active", "disabled"])
  status?: TeamStatus;
}
