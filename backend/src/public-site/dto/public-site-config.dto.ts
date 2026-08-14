import {
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class UpdatePublicSiteConfigDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  primarySceneName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  primarySceneDescription!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  ctaCopy!: string;
}
