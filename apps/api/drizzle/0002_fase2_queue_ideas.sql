CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`title` text NOT NULL,
	`angle` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`source` text DEFAULT 'ai' NOT NULL,
	`embedding` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `channel_id` text REFERENCES channels(id);--> statement-breakpoint
ALTER TABLE `jobs` ADD `progress` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `productions` ADD `current_step` text;--> statement-breakpoint
ALTER TABLE `productions` ADD `progress` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `productions` ADD `error` text;--> statement-breakpoint
ALTER TABLE `scripts` ADD `title` text;