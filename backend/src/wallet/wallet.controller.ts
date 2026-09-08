import {
  Controller,
  Get,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  IsDateString,
  IsIn,
  IsOptional,
} from "class-validator";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { WalletFailureFilter } from "./wallet-failure.filter.js";
import { WalletService } from "./wallet.service.js";


export class WalletFlowStatsQueryDto {
  @IsIn(["day", "week", "month"])
  bucket!: "day" | "week" | "month";

  @IsOptional()
  @IsDateString({}, { message: "from 必须是 ISO 日期" })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: "to 必须是 ISO 日期" })
  to?: string;
}

export class WalletTeamStatsQueryDto {
  @IsOptional()
  @IsDateString({}, { message: "from 必须是 ISO 日期" })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: "to 必须是 ISO 日期" })
  to?: string;
}

@Controller("wallet")
@UseGuards(SessionGuard)
@UseFilters(WalletFailureFilter)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /** 当前登录人自己的钱包 */
  @Get("me")
  async me(@CurrentUser() actor: PublicUser) {
    const balance = await this.wallet.getWallet(actor.id);
    const transactions = await this.wallet.listTransactions(actor, actor.id);
    return { balance, transactions };
  }

  /** 钱包列表：管理员全平台 / 团长本队 / 数采本人 */
  @Get()
  async list(@CurrentUser() actor: PublicUser) {
    return { wallets: await this.wallet.listWallets(actor) };
  }

  /** 指定用户的钱包流水（仅管理员 / 团长查看本队成员） */
  @Get("transactions")
  async transactions(
    @CurrentUser() actor: PublicUser,
    @Query("ownerId") ownerId?: string,
  ) {
    return { transactions: await this.wallet.listTransactions(actor, ownerId || actor.id) };
  }

  /** 流水统计（日/周/月聚合，仅管理员）——折线图数据 */
  @Get("stats/flow")
  async statsFlow(
    @CurrentUser() actor: PublicUser,
    @Query() query: WalletFlowStatsQueryDto,
  ) {
    if (actor.role !== "admin") {
      return { flow: [] };
    }
    return { flow: await this.wallet.statsFlow(query) };
  }

  /** 团队流水分布（仅管理员）——饼图数据 */
  @Get("stats/teams")
  async statsTeams(
    @CurrentUser() actor: PublicUser,
    @Query() query: WalletTeamStatsQueryDto,
  ) {
    if (actor.role !== "admin") {
      return { teams: [] };
    }
    return { teams: await this.wallet.statsByTeam(query) };
  }

}
