import { IsIn, IsString, MaxLength } from "class-validator";

export class CreateDeliveryPackageDto {
  @IsString()
  @MaxLength(160)
  name!: string;
}

export class CreateDeliveryArchiveTaskDto {
  @IsIn(["zip", "tar"])
  format!: "zip" | "tar";
}
