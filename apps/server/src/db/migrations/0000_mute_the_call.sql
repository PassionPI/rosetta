CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`run_id` integer,
	`type` text NOT NULL,
	`payload` text,
	`ts` integer
);
--> statement-breakpoint
CREATE INDEX `idx_events_session_ts` ON `events` (`session_id`,`ts`);--> statement-breakpoint
CREATE TABLE `projects` (
	`path` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`repo_root` text,
	`repo_name` text,
	`is_worktree` integer,
	`worktree_name` text,
	`branch` text,
	`session_count` integer DEFAULT 0,
	`last_active_at` integer,
	`meta_checked_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_projects_repo` ON `projects` (`repo_root`);--> statement-breakpoint
CREATE TABLE `repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_root` text NOT NULL,
	`display_name` text,
	`settings` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repos_repo_root_unique` ON `repos` (`repo_root`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`prompt` text,
	`trigger` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`model_id` text,
	`input_tokens` integer DEFAULT 0,
	`output_tokens` integer DEFAULT 0,
	`cache_read_tokens` integer DEFAULT 0,
	`cost_usd_micros` integer DEFAULT 0,
	`turn_count` integer DEFAULT 0,
	`error` text,
	`started_at` integer,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_runs_session` ON `runs` (`session_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_status` ON `runs` (`status`);--> statement-breakpoint
CREATE TABLE `session_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`parent_id` text,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`role` text,
	`stop_reason` text,
	`tool_name` text,
	`is_error` integer,
	`payload` text,
	`timestamp` integer
);
--> statement-breakpoint
CREATE INDEX `idx_entries_session_seq` ON `session_entries` (`session_id`,`seq`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`name` text,
	`cwd` text NOT NULL,
	`provider` text,
	`model_id` text,
	`thinking_level` text,
	`status` text DEFAULT 'active' NOT NULL,
	`parent_session` text,
	`task_id` integer,
	`entry_count` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_cwd` ON `sessions` (`cwd`);--> statement-breakpoint
CREATE INDEX `idx_sessions_updated` ON `sessions` (`updated_at`);--> statement-breakpoint
CREATE TABLE `steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`call_id` text,
	`tool_name` text NOT NULL,
	`arguments` text,
	`result` text,
	`patch` text,
	`is_error` integer,
	`duration_ms` integer,
	`started_at` integer,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_steps_run` ON `steps` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_steps_tool` ON `steps` (`tool_name`);--> statement-breakpoint
CREATE INDEX `idx_steps_session_time` ON `steps` (`session_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `task_deps` (
	`task_id` integer NOT NULL,
	`depends_on` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_deps_task` ON `task_deps` (`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`description` text NOT NULL,
	`summary` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`worktree_path` text,
	`session_id` text,
	`branch` text,
	`base_commit` text,
	`end_commit` text,
	`reject_count` integer DEFAULT 0,
	`error` text,
	`created_at` integer,
	`dispatched_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_repo_seq` ON `tasks` (`repo_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE TABLE `worktrees` (
	`path` text PRIMARY KEY NOT NULL,
	`repo_id` integer NOT NULL,
	`name` text NOT NULL,
	`is_main` integer NOT NULL,
	`branch` text,
	`slot_order` integer NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_worktrees_repo` ON `worktrees` (`repo_id`,`slot_order`);