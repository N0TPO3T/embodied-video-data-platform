import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
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

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/u, {
    message: "标签编号只能包含大写字母、数字和连字符",
  })
  nextId?: string;

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
