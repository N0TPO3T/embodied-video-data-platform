import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordIterations: integer("password_iterations").notNull(),
    role: text("role", { enum: ["collector", "leader", "admin"] }).notNull(),
    teamId: text("team_id"),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    failedAttemptCount: integer("failed_attempt_count").notNull().default(0),
    firstFailedAt: integer("first_failed_at"),
    lockedUntil: integer("locked_until"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_accounts_username_normalized").on(
      table.usernameNormalized,
    ),
    index("idx_accounts_team_id").on(table.teamId),
    index("idx_accounts_role_status").on(table.role, table.status),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("idx_auth_sessions_account_id").on(table.accountId),
  ],
);

export const accountAuditLogs = sqliteTable(
  "account_audit_logs",
  {
    id: text("id").primaryKey(),
    actorAccountId: text("actor_account_id").notNull(),
    actorName: text("actor_name").notNull(),
    action: text("action", {
      enum: ["create", "update", "reset_password", "enable", "disable"],
    }).notNull(),
    targetAccountId: text("target_account_id").notNull(),
    targetName: text("target_name").notNull(),
    summary: text("summary").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_account_audit_created_at").on(table.createdAt),
  ],
);
