import type {
  AccountAuditLog,
  AccountPublic,
  AccountRecord,
  AccountRepository,
  AccountScope,
} from "../contracts";

type AccountRow = {
  id: string;
  display_name: string;
  username: string;
  username_normalized: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  role: AccountRecord["role"];
  team_id: string | null;
  status: AccountRecord["status"];
  failed_attempt_count: number;
  first_failed_at: number | null;
  locked_until: number | null;
  created_at: number;
  updated_at: number;
};

type AccountPublicRow = Pick<
  AccountRow,
  | "id"
  | "display_name"
  | "username"
  | "role"
  | "team_id"
  | "status"
  | "updated_at"
>;

type AccountAuditRow = {
  id: string;
  actor_account_id: string;
  actor_name: string;
  action: AccountAuditLog["action"];
  target_account_id: string;
  target_name: string;
  summary: string;
  created_at: number;
};

const ACCOUNT_COLUMNS = `
  id, display_name, username, username_normalized, password_hash,
  password_salt, password_iterations, role, team_id, status,
  failed_attempt_count, first_failed_at, locked_until, created_at, updated_at
`;

const PUBLIC_ACCOUNT_COLUMNS =
  "id, display_name, username, role, team_id, status, updated_at";

function toAccountRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    username: row.username,
    usernameNormalized: row.username_normalized,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    passwordIterations: row.password_iterations,
    role: row.role,
    teamId: row.team_id ?? undefined,
    status: row.status,
    failedAttemptCount: row.failed_attempt_count,
    firstFailedAt: row.first_failed_at,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAccountPublic(row: AccountPublicRow): AccountPublic {
  return {
    id: row.id,
    displayName: row.display_name,
    username: row.username,
    role: row.role,
    teamId: row.team_id ?? undefined,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function publicFromRecord(record: AccountRecord): AccountPublic {
  return {
    id: record.id,
    displayName: record.displayName,
    username: record.username,
    role: record.role,
    teamId: record.teamId,
    status: record.status,
    updatedAt: record.updatedAt,
  };
}

function toAccountAudit(row: AccountAuditRow): AccountAuditLog {
  return {
    id: row.id,
    actorAccountId: row.actor_account_id,
    actorName: row.actor_name,
    action: row.action,
    targetAccountId: row.target_account_id,
    targetName: row.target_name,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function prepareInsertAccount(db: D1Database, record: AccountRecord) {
  return db
    .prepare(
      `INSERT INTO accounts (
        id, display_name, username, username_normalized, password_hash,
        password_salt, password_iterations, role, team_id, status,
        failed_attempt_count, first_failed_at, locked_until, created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.id,
      record.displayName,
      record.username,
      record.usernameNormalized,
      record.passwordHash,
      record.passwordSalt,
      record.passwordIterations,
      record.role,
      record.teamId ?? null,
      record.status,
      record.failedAttemptCount,
      record.firstFailedAt,
      record.lockedUntil,
      record.createdAt,
      record.updatedAt,
    );
}

function prepareInsertAudit(db: D1Database, audit: AccountAuditLog) {
  return db
    .prepare(
      `INSERT INTO account_audit_logs (
        id, actor_account_id, actor_name, action, target_account_id,
        target_name, summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      audit.id,
      audit.actorAccountId,
      audit.actorName,
      audit.action,
      audit.targetAccountId,
      audit.targetName,
      audit.summary,
      audit.createdAt,
    );
}

export function createD1AccountRepository(
  db: D1Database,
): AccountRepository {
  return {
    async isAccountTableEmpty() {
      const row = await db
        .prepare("SELECT id FROM accounts LIMIT 1")
        .first<{ id: string }>();
      return row === null;
    },

    async insertSeedAccounts(records) {
      if (records.length === 0) return;
      await db.batch(
        records.map((record) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO accounts (
                id, display_name, username, username_normalized, password_hash,
                password_salt, password_iterations, role, team_id, status,
                failed_attempt_count, first_failed_at, locked_until, created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              record.id,
              record.displayName,
              record.username,
              record.usernameNormalized,
              record.passwordHash,
              record.passwordSalt,
              record.passwordIterations,
              record.role,
              record.teamId ?? null,
              record.status,
              record.failedAttemptCount,
              record.firstFailedAt,
              record.lockedUntil,
              record.createdAt,
              record.updatedAt,
            ),
        ),
      );
    },

    async findById(id) {
      const row = await db
        .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`)
        .bind(id)
        .first<AccountRow>();
      return row ? toAccountRecord(row) : null;
    },

    async findByNormalizedUsername(username) {
      const row = await db
        .prepare(
          `SELECT ${ACCOUNT_COLUMNS}
           FROM accounts
           WHERE username_normalized = ?`,
        )
        .bind(username)
        .first<AccountRow>();
      return row ? toAccountRecord(row) : null;
    },

    async listAccounts(scope: AccountScope) {
      let statement: D1PreparedStatement;
      if (scope.kind === "all") {
        statement = db.prepare(
          `SELECT ${PUBLIC_ACCOUNT_COLUMNS}
           FROM accounts
           ORDER BY created_at ASC`,
        );
      } else if (scope.kind === "team") {
        statement = db
          .prepare(
            `SELECT ${PUBLIC_ACCOUNT_COLUMNS}
             FROM accounts
             WHERE team_id = ?
             ORDER BY created_at ASC`,
          )
          .bind(scope.teamId);
      } else {
        statement = db
          .prepare(
            `SELECT ${PUBLIC_ACCOUNT_COLUMNS}
             FROM accounts
             WHERE id = ?
             ORDER BY created_at ASC`,
          )
          .bind(scope.accountId);
      }
      const result = await statement.all<AccountPublicRow>();
      return result.results.map(toAccountPublic);
    },

    async countActiveAdmins() {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM accounts
           WHERE role = 'admin' AND status = 'active'`,
        )
        .first<{ count: number }>();
      return row?.count ?? 0;
    },

    async createAccount(record, audit) {
      await db.batch([
        prepareInsertAccount(db, record),
        prepareInsertAudit(db, audit),
      ]);
      return publicFromRecord(record);
    },

    async updateAccount(record, audit) {
      await db.batch([
        db
          .prepare(
            `UPDATE accounts SET
              display_name = ?, username = ?, username_normalized = ?,
              role = ?, team_id = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            record.displayName,
            record.username,
            record.usernameNormalized,
            record.role,
            record.teamId ?? null,
            record.updatedAt,
            record.id,
          ),
        prepareInsertAudit(db, audit),
      ]);
      return publicFromRecord(record);
    },

    async updateLoginSecurity(id, values) {
      await db
        .prepare(
          `UPDATE accounts SET
            failed_attempt_count = ?, first_failed_at = ?, locked_until = ?
           WHERE id = ?`,
        )
        .bind(
          values.failedAttemptCount,
          values.firstFailedAt,
          values.lockedUntil,
          id,
        )
        .run();
    },

    async createSession(tokenHash, accountId, createdAt, expiresAt) {
      await db
        .prepare(
          `INSERT INTO auth_sessions (
            token_hash, account_id, created_at, expires_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .bind(tokenHash, accountId, createdAt, expiresAt)
        .run();
    },

    async findSessionAccount(tokenHash, now) {
      const row = await db
        .prepare(
          `SELECT ${ACCOUNT_COLUMNS.split(",")
            .map((column) => `a.${column.trim()}`)
            .join(", ")}
           FROM auth_sessions AS s
           INNER JOIN accounts AS a ON a.id = s.account_id
           WHERE s.token_hash = ?
             AND s.expires_at > ?
             AND a.status = 'active'`,
        )
        .bind(tokenHash, now)
        .first<AccountRow>();
      return row ? toAccountRecord(row) : null;
    },

    async deleteSession(tokenHash) {
      await db
        .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
        .bind(tokenHash)
        .run();
    },

    async deleteSessionsForAccount(accountId) {
      await db
        .prepare("DELETE FROM auth_sessions WHERE account_id = ?")
        .bind(accountId)
        .run();
    },

    async resetPassword(record, audit) {
      await db.batch([
        db
          .prepare(
            `UPDATE accounts SET
              password_hash = ?, password_salt = ?,
              password_iterations = ?, failed_attempt_count = 0,
              first_failed_at = NULL, locked_until = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            record.passwordHash,
            record.passwordSalt,
            record.passwordIterations,
            record.updatedAt,
            record.id,
          ),
        db
          .prepare("DELETE FROM auth_sessions WHERE account_id = ?")
          .bind(record.id),
        prepareInsertAudit(db, audit),
      ]);
    },

    async setStatus(record, audit) {
      const statements = [
        db
          .prepare(
            "UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?",
          )
          .bind(record.status, record.updatedAt, record.id),
      ];
      if (record.status === "disabled") {
        statements.push(
          db
            .prepare("DELETE FROM auth_sessions WHERE account_id = ?")
            .bind(record.id),
        );
      }
      statements.push(prepareInsertAudit(db, audit));
      await db.batch(statements);
      return publicFromRecord(record);
    },

    async listAuditLogs(limit) {
      const result = await db
        .prepare(
          `SELECT
            id, actor_account_id, actor_name, action, target_account_id,
            target_name, summary, created_at
           FROM account_audit_logs
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .bind(limit)
        .all<AccountAuditRow>();
      return result.results.map(toAccountAudit);
    },
  };
}
