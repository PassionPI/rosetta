CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`task_id` integer,
	`session_id` text,
	`repo_id` integer,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_read` ON `notifications` (`read`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_task` ON `notifications` (`task_id`);