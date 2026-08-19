import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class UpdateLabelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsBoolean()
  enabled!: boolean;
}

export class CreateLabelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(["scene", "action", "object", "issue"])
  type!: "scene" | "action" | "object" | "issue";

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class LabelSetItemDto extends UpdateLabelDto {
  @IsIn(["scene", "action", "object", "issue"])
  type!: "scene" | "action" | "object" | "issue";

  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  associationCount!: number;
}
