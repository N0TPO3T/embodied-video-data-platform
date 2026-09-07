import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import type { PublicUser } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { csvDocument } from "../csv/csv.js";
import { WalletBalanceEntity, WalletTransactionEntity } from "../database/entities/wallet.entity.js";
import { WithdrawalBatchEntity, WithdrawalRequestEntity, type WithdrawalStatus } from "../database/entities/withdrawal.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { WalletFailure } from "./wallet.failure.js";
import { centsMoney, decryptRecipient, encryptRecipient, moneyCents, normalizeWithdrawal, payoutHash, payoutKey, requiredText, type WithdrawalInput } from "./payout-recipient.js";

export function withdrawalView(row: WithdrawalRequestEntity) {
  return { id: row.id, ownerId: row.ownerId, amount: Number(row.amount), status: row.status, method: row.method,
    accountMasked: row.accountMasked, nameMasked: row.nameMasked, batchId: row.batchId, reason: row.reason,
    transferReference: row.transferReference, paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
@Injectable()
export class PayoutService {
  constructor(private readonly dataSource: DataSource, private readonly audit: AuditService) {}

  private admin(actor: PublicUser) {
    if (actor.role !== "admin") throw new WalletFailure("FORBIDDEN", "仅管理员可操作财务提现", 403);
  }
  private async lockedBalance(manager: EntityManager, ownerId: string) {
    await manager.getRepository(WalletBalanceEntity).createQueryBuilder().insert().values({ ownerId }).orIgnore().execute();
    return manager.getRepository(WalletBalanceEntity).findOneOrFail({ where: { ownerId }, lock: { mode: "pessimistic_write" } });
  }
  private async auditState(manager: EntityManager, actor: PublicUser, action: string, row: WithdrawalRequestEntity) {
    await this.audit.record(manager, actor, action, { id: row.ownerId, name: row.ownerId }, `提现 ${row.id}：${row.status}`, null,
      { requestId: row.id, batchId: row.batchId, status: row.status, amount: row.amount, accountMasked: row.accountMasked });
  }
  async submit(actor: PublicUser, input: WithdrawalInput) {
    if (actor.role !== "collector") throw new WalletFailure("FORBIDDEN", "仅数采人员可申请提现", 403);
    const { cents, recipient, idempotencyKey } = normalizeWithdrawal(input);
    const key = payoutKey();
    const hash = payoutHash(cents, recipient, key);
    return this.dataSource.transaction(async (manager) => {
      const balance = await this.lockedBalance(manager, actor.id);
      const repo = manager.getRepository(WithdrawalRequestEntity);
      const previous = await repo.findOneBy({ ownerId: actor.id, idempotencyKey });
      if (previous) {
        if (previous.payloadHash !== hash) throw new WalletFailure("IDEMPOTENCY_CONFLICT", "此提交标识已用于不同申请，请恢复原申请信息或发起新申请", 409);
        return withdrawalView(previous);
      }
      if (moneyCents(balance.availableBalance) < cents) throw new WalletFailure("INSUFFICIENT_BALANCE", "可提现余额不足", 409);
      const id = `WR-${randomUUID()}`;
      const row = repo.create({ id, ownerId: actor.id, idempotencyKey, payloadHash: hash, amount: centsMoney(cents), status: "pending",
        method: recipient.method, recipientEncrypted: encryptRecipient(recipient, id, key),
        accountMasked: recipient.account.length > 4 ? `***${recipient.account.slice(-4)}` : "***", nameMasked: recipient.name.length > 1 ? `${recipient.name.slice(0, 1)}***` : "***" });
      balance.availableBalance = centsMoney(moneyCents(balance.availableBalance) - cents);
      balance.reservedBalance = centsMoney(moneyCents(balance.reservedBalance) + cents);
      await manager.getRepository(WalletBalanceEntity).save(balance);
      await repo.save(row);
      await this.auditState(manager, actor, "withdrawal.submitted", row);
      return withdrawalView(row);
    });
  }
  async list(actor: PublicUser, input: { page?: number; pageSize?: number; status?: WithdrawalStatus; ownerId?: string; batchId?: string } = {}) {
    if (actor.role !== "collector") this.admin(actor);
    const page = input.page ?? 1, pageSize = input.pageSize ?? 25;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new WalletFailure("VALIDATION", "分页参数无效", 400);
    if (input.status && !["pending", "processing", "paid", "rejected", "failed"].includes(input.status)) throw new WalletFailure("VALIDATION", "状态无效", 400);
    if (actor.role === "collector" && input.ownerId && input.ownerId !== actor.id) throw new WalletFailure("FORBIDDEN", "不可读取他人申请", 403);
    const query = this.dataSource.getRepository(WithdrawalRequestEntity).createQueryBuilder("request");
    const ownerId = actor.role === "collector" ? actor.id : input.ownerId;
    if (ownerId) query.andWhere("request.ownerId = :ownerId", { ownerId });
    if (input.status) query.andWhere("request.status = :status", { status: input.status });
    if (input.batchId) query.andWhere("request.batchId = :batchId", { batchId: input.batchId });
    const [rows, total] = await query.orderBy("request.createdAt", "DESC").addOrderBy("request.id", "DESC").skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { requests: rows.map(withdrawalView), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }
  async claim(actor: PublicUser, ids: string[]) {
    this.admin(actor);
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || id.length > 64)) throw new WalletFailure("VALIDATION", "请选择 1 至 100 条不同申请", 400);
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(WithdrawalRequestEntity);
      const rows = await repo.createQueryBuilder("request").where("request.id IN (:...ids)", { ids }).orderBy("request.id", "ASC").setLock("pessimistic_write").getMany();
      if (rows.length !== ids.length || rows.some(row => row.status !== "pending" || row.batchId)) throw new WalletFailure("STATE_CONFLICT", "部分申请已被领取或不再待处理，请刷新；未创建批次", 409);
      const batch = await manager.getRepository(WithdrawalBatchEntity).save({ id: `WB-${randomUUID()}`, createdBy: actor.id });
      for (const row of rows) {
        row.status = "processing"; row.batchId = batch.id;
        await repo.save(row);
        await this.auditState(manager, actor, "withdrawal.claimed", row);
      }
      return { batchId: batch.id, requests: rows.map(withdrawalView) };
    });
  }
  async exportBatch(actor: PublicUser, batchId: string) {
    this.admin(actor);
    const key = payoutKey();
    return this.dataSource.transaction(async manager => {
      const batch = await manager.getRepository(WithdrawalBatchEntity).findOneBy({ id: batchId });
      if (!batch) throw new WalletFailure("NOT_FOUND", "批次不存在", 404);
      const rows = await manager.getRepository(WithdrawalRequestEntity).createQueryBuilder("request").addSelect("request.recipientEncrypted").where("request.batchId = :batchId", { batchId }).orderBy("request.id", "ASC").getMany();
      const csvRows = [["request_id", "batch_id", "owner_id", "owner_name", "method", "recipient_name", "account_text", "bank_name", "amount_CNY", "submitted_at", "current_status", "notice"]];
      for (const row of rows) {
        const recipient = decryptRecipient(row.recipientEncrypted, row.id, key);
        const owner = await manager.getRepository(UserEntity).findOneBy({ id: row.ownerId });
        // Apostrophe is an intentional text marker, not an Excel formula. Import account_text as text and remove the marker before transfer.
        csvRows.push([row.id, batchId, row.ownerId, owner?.displayName ?? row.ownerId, recipient.method, recipient.name, `'${recipient.account}`, recipient.bankName, row.amount, row.createdAt.toISOString(), row.status, "EXPORT IS NOT PAYMENT; reconcile request_id before transfer"]);
      }
      const csv = csvDocument(csvRows);
      await this.audit.record(manager, actor, "withdrawal.exported", { id: batchId, name: batchId }, `导出提现批次 ${batchId}（${rows.length} 条），导出不是付款`, null, { batchId, count: rows.length });
      return csv;
    });
  }
  async transition(actor: PublicUser, id: string, input: { status: "paid" | "rejected" | "failed"; reason?: string; transferReference?: string; paidAt?: string; fundsNotTransferred?: boolean }) {
    this.admin(actor);
    if (!["paid", "rejected", "failed"].includes(input.status)) throw new WalletFailure("VALIDATION", "不支持的状态", 400);
    const reason = input.status === "paid" ? null : requiredText(input.reason, 500);
    const reference = input.status === "paid" ? requiredText(input.transferReference, 120) : null;
    const paidAt = input.status === "paid" && input.paidAt ? new Date(input.paidAt) : null;
    if (input.status === "paid" && (!paidAt || !Number.isFinite(paidAt.getTime()) || paidAt.getTime() > Date.now())) throw new WalletFailure("VALIDATION", "请提供实际付款时间（不可为未来）", 400);
    if (input.status === "failed" && input.fundsNotTransferred !== true) throw new WalletFailure("VALIDATION", "必须经财务确认未实际转账或款项已退回后才能释放余额", 400);
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(WithdrawalRequestEntity);
      const row = await repo.findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
      if (!row) throw new WalletFailure("NOT_FOUND", "申请不存在", 404);
      if (row.status === input.status && row.reason === reason && row.transferReference === reference && (row.paidAt?.getTime() ?? null) === (paidAt?.getTime() ?? null)) return withdrawalView(row);
      const expected = input.status === "rejected" ? "pending" : "processing";
      if (row.status !== expected) throw new WalletFailure("STATE_CONFLICT", "申请状态已变化，不能重复付款或退款", 409);
      if (paidAt && paidAt < row.createdAt) throw new WalletFailure("VALIDATION", "付款时间不能早于申请时间", 400);
      const balance = await this.lockedBalance(manager, row.ownerId);
      const cents = moneyCents(row.amount);
      if (moneyCents(balance.reservedBalance) < cents) throw new WalletFailure("BALANCE_CONFLICT", "预留余额异常，请财务核对", 409);
      balance.reservedBalance = centsMoney(moneyCents(balance.reservedBalance) - cents);
      if (input.status === "paid") {
        balance.withdrawnBalance = centsMoney(moneyCents(balance.withdrawnBalance) + cents);
        balance.cumulativeWithdrawn = centsMoney(moneyCents(balance.cumulativeWithdrawn) + cents);
        await manager.getRepository(WalletTransactionEntity).save({ id: `WT-${randomUUID()}`, ownerId: row.ownerId, type: "withdraw", amount: `-${row.amount}`, balanceAfter: balance.totalBalance, remark: `人工付款已确认：${row.id}`, createdByAccountId: actor.id });
      } else balance.availableBalance = centsMoney(moneyCents(balance.availableBalance) + cents);
      row.status = input.status; row.reason = reason; row.transferReference = reference; row.paidAt = paidAt;
      await manager.getRepository(WalletBalanceEntity).save(balance);
      await repo.save(row);
      await this.auditState(manager, actor, `withdrawal.${input.status}`, row);
      return withdrawalView(row);
    });
  }
}
