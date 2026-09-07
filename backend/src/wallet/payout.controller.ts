import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, UseFilters, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import type { WithdrawalStatus } from "../database/entities/withdrawal.entity.js";
import { WalletFailureFilter } from "./wallet-failure.filter.js";
import { PayoutService } from "./payout.service.js";

export class SubmitWithdrawalDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) amount!: number;
  @IsString() @MaxLength(64) idempotencyKey!: string;
  @IsIn(["alipay", "bank"]) method!: "alipay" | "bank";
  @IsString() @MaxLength(200) account!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
}
export class WithdrawalQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsIn(["pending", "processing", "paid", "rejected", "failed"]) status?: WithdrawalStatus;
  @IsOptional() @IsString() @MaxLength(64) ownerId?: string;
  @IsOptional() @IsString() @MaxLength(64) batchId?: string;
}
export class ClaimWithdrawalsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(64, { each: true }) ids!: string[];
}
export class TransitionWithdrawalDto {
  @IsIn(["paid", "rejected", "failed"]) status!: "paid" | "rejected" | "failed";
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(120) transferReference?: string;
  @IsOptional() @IsDateString() paidAt?: string;
  @IsOptional() @IsBoolean() fundsNotTransferred?: boolean;
}
@Controller("wallet")
@UseGuards(SessionGuard)
@UseFilters(WalletFailureFilter)
export class PayoutController {
  constructor(private readonly payouts: PayoutService) {}
  @Post("withdraw") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  async submit(@CurrentUser() actor: PublicUser, @Body() input: SubmitWithdrawalDto) {
    return { request: await this.payouts.submit(actor, input) };
  }
  @Get("withdrawals") @Header("Cache-Control", "no-store")
  list(@CurrentUser() actor: PublicUser, @Query() query: WithdrawalQueryDto) { return this.payouts.list(actor, query); }
  @Post("withdrawal-batches") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  claim(@CurrentUser() actor: PublicUser, @Body() input: ClaimWithdrawalsDto) { return this.payouts.claim(actor, input.ids); }
  // Explicit POST export: authenticated, origin checked and audited every time, including re-downloads.
  @Post("withdrawal-batches/:id/export") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", 'attachment; filename="manual-payouts.csv"') @Header("Cache-Control", "no-store")
  export(@CurrentUser() actor: PublicUser, @Param("id") id: string) { return this.payouts.exportBatch(actor, id); }
  @Post("withdrawals/:id/status") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  async transition(@CurrentUser() actor: PublicUser, @Param("id") id: string, @Body() input: TransitionWithdrawalDto) {
    return { request: await this.payouts.transition(actor, id, input) };
  }
}
