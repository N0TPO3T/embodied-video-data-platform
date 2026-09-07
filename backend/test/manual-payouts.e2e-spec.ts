import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import request from "supertest";
import { createDataSource, identityEntities } from "../src/database/data-source.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { WalletBalanceEntity, WalletTransactionEntity } from "../src/database/entities/wallet.entity.js";
import { WithdrawalRequestEntity } from "../src/database/entities/withdrawal.entity.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { WalletModule } from "../src/wallet/wallet.module.js";
import { WalletService } from "../src/wallet/wallet.service.js";
import { PayoutService } from "../src/wallet/payout.service.js";
import { SessionGuard } from "../src/auth/session.guard.js";
import type { PublicUser } from "../src/auth/auth.types.js";
import { configureApplication } from "../src/http/configure-application.js";

const origin = "http://localhost:3000";
const actor = (id: string, role: PublicUser["role"], teamId?: string): PublicUser => ({ id, role, teamId, displayName: id, username: id, status: "active", updatedAt: 0 });
const admin = actor("payout-admin", "admin");
const collector = actor("payout-collector", "collector", "payout-team-a");
const other = actor("payout-other", "collector", "payout-team-b");
const leader = actor("payout-leader", "leader", "payout-team-a");
const input = (idempotencyKey: string, amount = 6) => ({ idempotencyKey, amount, method: "bank" as const, account: "00123456789012345678901234567890", name: "=malicious()", bankName: "@bank" });

describe("manual payouts", () => {
  let db: DataSource;
  let app: INestApplication;
  let payouts: PayoutService;
  let wallet: WalletService;
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("Explicit disposable TEST_DATABASE_URL required for manual payout regressions");
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", randomBytes(32).toString("hex"));
    db = createDataSource(url);
    await db.initialize();
    await db.dropDatabase();
    await db.runMigrations();
    await db.getRepository(TeamEntity).save([{ id: "payout-team-a", name: "A" }, { id: "payout-team-b", name: "B" }]);
    await db.getRepository(UserEntity).save([admin, collector, other, leader].map(user => ({ id: user.id, displayName: user.displayName, username: user.username, usernameNormalized: user.username, role: user.role, teamId: user.teamId ?? null, status: "active" as const, passwordHash: "not-used-by-this-guard-test" })));
    const module = await Test.createTestingModule({ imports: [TypeOrmModule.forRoot({ type: "postgres", url, entities: identityEntities, synchronize: false }), WalletModule] })
      .overrideGuard(SessionGuard).useValue({ canActivate(context: { switchToHttp(): { getRequest(): { user?: PublicUser; headers: Record<string, string> } } }) {
        const req = context.switchToHttp().getRequest();
        const users: Record<string, PublicUser> = { admin, collector, other, leader };
        req.user = users[req.headers["x-test-actor"] ?? "collector"];
        return true;
      } }).compile();
    app = module.createNestApplication(); configureApplication(app); await app.init();
    payouts = module.get(PayoutService); wallet = module.get(WalletService);
  });
  beforeEach(async () => {
    await db.query("TRUNCATE withdrawal_requests, withdrawal_batches, wallet_transactions, wallet_balances, audit_logs");
    await db.getRepository(WalletBalanceEntity).save({ ownerId: collector.id, totalBalance: "10.00", availableBalance: "10.00" });
  });
  afterAll(async () => { await app?.close(); if (db?.isInitialized) await db.destroy(); vi.unstubAllEnvs(); });

  it("serializes competing requests and retries without double spending or changing snapshots", async () => {
    const results = await Promise.allSettled([payouts.submit(collector, input("first")), payouts.submit(collector, input("second"))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected").map(result => result.reason.code)).toEqual(["INSUFFICIENT_BALANCE"]);
    const stored = await db.getRepository(WithdrawalRequestEntity).findOneByOrFail({ ownerId: collector.id });
    const retries = await Promise.all([payouts.submit(collector, input(stored.idempotencyKey)), payouts.submit(collector, input(stored.idempotencyKey))]);
    expect(retries.map(row => row.id)).toEqual([stored.id, stored.id]);
    await expect(payouts.submit(collector, { ...input(stored.idempotencyKey), account: "different" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await wallet.getWallet(collector.id)).toMatchObject({ totalBalance: 10, availableBalance: 4, reservedBalance: 6, withdrawnBalance: 0 });
    expect(await wallet.listTransactions(collector, collector.id)).toEqual([]);
    await expect(db.getRepository(WithdrawalRequestEntity).update(stored.id, { amount: "1.00" })).rejects.toThrow("immutable");
  });

  it("keeps reservations through concurrent credit/settlement and pays exactly once after manual confirmation", async () => {
    const row = await payouts.submit(collector, input("paid"));
    await Promise.all([
      db.transaction(manager => wallet.creditSettling(manager, { ownerId: collector.id, amount: 3, cycleId: "cycle-manual" })),
      payouts.submit(collector, input("more", 2)),
    ]);
    await db.transaction(manager => wallet.settleToAvailable(manager, { ownerId: collector.id, amount: 3, cycleId: "cycle-manual" }));
    expect(await wallet.getWallet(collector.id)).toMatchObject({ totalBalance: 13, availableBalance: 5, reservedBalance: 8 });
    await expect(payouts.transition(admin, row.id, { status: "paid", transferReference: "ref", paidAt: new Date().toISOString() })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    const batch = await payouts.claim(admin, [row.id]);
    await expect(payouts.claim(admin, [row.id])).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    await expect(db.getRepository(WithdrawalRequestEntity).update(row.id, { batchId: null })).rejects.toThrow("immutable");
    await payouts.exportBatch(admin, batch.batchId);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ reservedBalance: 8, withdrawnBalance: 0 });
    const confirmation = { status: "paid" as const, transferReference: "bank-ref-001", paidAt: new Date().toISOString() };
    await Promise.all([payouts.transition(admin, row.id, confirmation), payouts.transition(admin, row.id, confirmation)]);
    await expect(payouts.transition(admin, row.id, { ...confirmation, transferReference: "conflicting-ref" })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    await expect(payouts.transition(admin, row.id, { status: "failed", reason: "ambiguous", fundsNotTransferred: true })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(await wallet.getWallet(collector.id)).toMatchObject({ totalBalance: 13, availableBalance: 5, reservedBalance: 2, withdrawnBalance: 6, cumulativeWithdrawn: 6 });
    expect((await wallet.listTransactions(collector, collector.id)).filter(tx => tx.type === "withdraw").map(tx => tx.amount)).toEqual([-6]);
  });

  it("rejects pending or definitively fails processing and releases only once", async () => {
    const pending = await payouts.submit(collector, input("rejected"));
    const rejection = { status: "rejected" as const, reason: "recipient could not be verified" };
    await Promise.all([payouts.transition(admin, pending.id, rejection), payouts.transition(admin, pending.id, rejection)]);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ availableBalance: 10, reservedBalance: 0 });
    const processing = await payouts.submit(collector, input("failed"));
    await payouts.claim(admin, [processing.id]);
    await expect(payouts.transition(admin, processing.id, rejection)).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    await expect(payouts.transition(admin, processing.id, { status: "failed", reason: "bank result unknown" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await wallet.getWallet(collector.id)).toMatchObject({ availableBalance: 4, reservedBalance: 6 });
    const failure = { status: "failed" as const, reason: "finance verified bank returned the transfer", fundsNotTransferred: true };
    await Promise.all([payouts.transition(admin, processing.id, failure), payouts.transition(admin, processing.id, failure)]);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ availableBalance: 10, reservedBalance: 0, withdrawnBalance: 0 });
    expect(await db.getRepository(WalletTransactionEntity).count()).toBe(0);
  });

  it("encrypts snapshots, masks ordinary responses, protects cross-user/team reads and explicit exports", async () => {
    const row = await payouts.submit(collector, input("privacy"));
    expect(JSON.stringify(row)).not.toContain(input("privacy").account);
    expect(JSON.stringify(await payouts.list(admin))).not.toContain(input("privacy").name);
    expect((await payouts.list(other)).requests).toEqual([]);
    await expect(payouts.list(other, { ownerId: collector.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(payouts.list(leader)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(wallet.listTransactions(leader, other.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(wallet.listTransactions(other, collector.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await wallet.listTransactions(leader, collector.id)).toEqual([]);
    expect(await wallet.listWallets({ ...leader, teamId: undefined })).toEqual([]);
    const batch = await payouts.claim(admin, [row.id]);
    await expect(payouts.exportBatch(collector, batch.batchId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(payouts.claim(collector, [row.id])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(payouts.transition(collector, row.id, { status: "failed", reason: "cancel", fundsNotTransferred: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ciphertext = (await db.query("SELECT recipient_encrypted FROM withdrawal_requests WHERE id = $1", [row.id]))[0].recipient_encrypted as string;
    expect(ciphertext).not.toContain(input("privacy").account);
    expect(JSON.stringify(await db.getRepository(AuditLogEntity).find())).not.toContain(input("privacy").account);
    await request(app.getHttpServer()).post(`/api/v1/wallet/withdrawal-batches/${batch.batchId}/export`).set("Origin", origin).set("x-test-actor", "collector").expect(403);
    await request(app.getHttpServer()).get(`/api/v1/wallet/transactions?ownerId=${other.id}`).set("x-test-actor", "leader").expect(403);
  });

  it("exports immutable membership, preserves all long account digits as text and neutralizes formulas", async () => {
    const first = await payouts.submit(collector, input("csv", 3));
    const batch = await payouts.claim(admin, [first.id]);
    await payouts.submit(collector, { ...input("later", 2), account: "+formula()", name: "Other recipient" });
    const csv = await payouts.exportBatch(admin, batch.batchId);
    expect(csv).toContain(",'00123456789012345678901234567890,");
    expect(csv).toContain(",'=malicious(),");
    expect(csv).toContain(",'@bank,");
    expect(csv).not.toContain("+formula()");
    expect(await payouts.exportBatch(admin, batch.batchId)).toBe(csv);
    expect((await payouts.list(admin, { batchId: batch.batchId })).requests.map(row => row.id)).toEqual([first.id]);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ reservedBalance: 5, withdrawnBalance: 0 });
    const key = process.env.PAYOUT_RECIPIENT_KEY!;
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", "");
    await expect(payouts.submit(collector, input("missing", 1))).rejects.toMatchObject({ code: "PAYOUT_UNAVAILABLE" });
    await expect(payouts.exportBatch(admin, batch.batchId)).rejects.toMatchObject({ code: "PAYOUT_UNAVAILABLE" });
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", randomBytes(32).toString("hex"));
    await expect(payouts.exportBatch(admin, batch.batchId)).rejects.toMatchObject({ code: "PAYOUT_UNAVAILABLE" });
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", key);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ availableBalance: 5, reservedBalance: 5 });
  });
});
