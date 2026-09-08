import type { MigrationInterface, QueryRunner } from "typeorm";

export class ManualPayouts2026092000001 implements MigrationInterface {
  name = "ManualPayouts2026092000001";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE wallet_balances ADD COLUMN reserved_balance numeric(14,2) NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0)`);
    await queryRunner.query(`CREATE TABLE withdrawal_batches (
      id varchar(64) PRIMARY KEY, created_by varchar(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE withdrawal_requests (
      id varchar(64) PRIMARY KEY, owner_id varchar(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      idempotency_key varchar(64) NOT NULL, payload_hash varchar(64) NOT NULL,
      amount numeric(14,2) NOT NULL CHECK (amount > 0),
      status varchar(16) NOT NULL CHECK (status IN ('pending','processing','paid','rejected','failed')),
      method varchar(16) NOT NULL CHECK (method IN ('alipay','bank')),
      recipient_encrypted text NOT NULL, account_masked varchar(16) NOT NULL, name_masked varchar(16) NOT NULL,
      batch_id varchar(64) REFERENCES withdrawal_batches(id) ON DELETE RESTRICT,
      reason varchar(500), transfer_reference varchar(120), paid_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_withdrawal_owner_key UNIQUE(owner_id,idempotency_key),
      CHECK ((status IN ('pending','rejected') AND batch_id IS NULL) OR (status IN ('processing','paid','failed') AND batch_id IS NOT NULL)),
      CHECK (status <> 'paid' OR (transfer_reference IS NOT NULL AND paid_at IS NOT NULL)),
      CHECK (status NOT IN ('rejected','failed') OR reason IS NOT NULL)
    )`);
    await queryRunner.query(`CREATE INDEX idx_withdrawal_status_created ON withdrawal_requests(status,created_at)`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION protect_withdrawal_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash OR NEW.amount IS DISTINCT FROM OLD.amount
        OR NEW.method IS DISTINCT FROM OLD.method OR NEW.recipient_encrypted IS DISTINCT FROM OLD.recipient_encrypted
        OR NEW.account_masked IS DISTINCT FROM OLD.account_masked OR NEW.name_masked IS DISTINCT FROM OLD.name_masked
        OR (OLD.batch_id IS NOT NULL AND NEW.batch_id IS DISTINCT FROM OLD.batch_id) THEN
        RAISE EXCEPTION 'Withdrawal snapshot and assigned batch are immutable';
      END IF; RETURN NEW; END $$`);
    await queryRunner.query(`CREATE TRIGGER withdrawal_snapshot_immutable BEFORE UPDATE ON withdrawal_requests FOR EACH ROW EXECUTE FUNCTION protect_withdrawal_snapshot()`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE withdrawal_requests`);
    await queryRunner.query(`DROP FUNCTION protect_withdrawal_snapshot()`);
    await queryRunner.query(`DROP TABLE withdrawal_batches`);
    await queryRunner.query(`ALTER TABLE wallet_balances DROP COLUMN reserved_balance`);
  }
}
