CREATE TABLE `account_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_account_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`target_account_id` text NOT NULL,
	`target_name` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_account_audit_created_at` ON `account_audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`role` text NOT NULL,
	`team_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`failed_attempt_count` integer DEFAULT 0 NOT NULL,
	`first_failed_at` integer,
	`locked_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_username_normalized` ON `accounts` (`username_normalized`);--> statement-breakpoint
CREATE INDEX `idx_accounts_team_id` ON `accounts` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_accounts_role_status` ON `accounts` (`role`,`status`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_account_id` ON `auth_sessions` (`account_id`);--> statement-breakpoint
PRAGMA optimize;
