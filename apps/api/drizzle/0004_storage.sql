CREATE TABLE `remote_files` (
	`id` text PRIMARY KEY NOT NULL,
	`production_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`kind` text NOT NULL,
	`local_name` text NOT NULL,
	`provider_config_id` text NOT NULL,
	`remote_id` text NOT NULL,
	`remote_path` text NOT NULL,
	`md5` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`present` integer DEFAULT true NOT NULL,
	`synced_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`production_id`) REFERENCES `productions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remote_files_production_kind_idx` ON `remote_files` (`production_id`,`kind`);--> statement-breakpoint
ALTER TABLE `channels` ADD `auto_archive` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `productions` ADD `freed_at` text;