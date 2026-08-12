import { IsString, MaxLength, MinLength } from "class-validator";

export class UpdateAiQualityPromptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  systemPrompt!: string;
}
