import { IsDateString, IsOptional } from "class-validator";

export class CreatePointCycleDto {
  @IsOptional()
  @IsDateString()
  businessDate?: string;
}
