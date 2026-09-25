CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`production_id` text,
	`kind` text NOT NULL,
	`local_path` text,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`provider_config_id` text,
	`prompt` text,
	`reusable` integer DEFAULT false NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`input_hash` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`production_id`) REFERENCES `productions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bible_verses` (
	`id` text PRIMARY KEY NOT NULL,
	`translation` text NOT NULL,
	`book` text NOT NULL,
	`chapter` integer NOT NULL,
	`verse` integer NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bible_verses_ref_idx` ON `bible_verses` (`translation`,`book`,`chapter`,`verse`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`platform` text NOT NULL,
	`handle` text NOT NULL,
	`language` text DEFAULT 'es' NOT NULL,
	`format` text NOT NULL,
	`topic` text NOT NULL,
	`bible` text NOT NULL,
	`bible_translation` text,
	`duration_target` text NOT NULL,
	`voice_profile` text NOT NULL,
	`visual_style` text NOT NULL,
	`drive_folder_id` text,
	`ai_label` integer DEFAULT true NOT NULL,
	`monetized` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_slug_unique` ON `channels` (`slug`);--> statement-breakpoint
CREATE TABLE `cost_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`production_id` text,
	`channel_id` text NOT NULL,
	`provider_config_id` text NOT NULL,
	`operation` text NOT NULL,
	`units` integer NOT NULL,
	`unit` text NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`production_id`) REFERENCES `productions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`production_id` text,
	`type` text NOT NULL,
	`lane` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`error` text,
	`started_at` text,
	`finished_at` text,
	`duration_ms` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`production_id`) REFERENCES `productions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `productions` (
	`id` text PRIMARY KEY NOT NULL,
	`script_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`stage` text DEFAULT 'scripted' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`input_hashes` text DEFAULT '{}' NOT NULL,
	`render_path` text,
	`duration_ms` integer,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`script_id`) REFERENCES `scripts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `provider_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text,
	`capability` text NOT NULL,
	`role` text,
	`provider_config_id` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`fallback_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_config_id`) REFERENCES `provider_configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`adapter` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`base_url` text,
	`model` text,
	`params` text DEFAULT '{}' NOT NULL,
	`secret_ref` text,
	`pricing_override` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_health` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`script_id` text NOT NULL,
	`order` integer NOT NULL,
	`text` text NOT NULL,
	`visual_prompt` text NOT NULL,
	`asset_id` text,
	`start_ms` integer,
	`end_ms` integer,
	FOREIGN KEY (`script_id`) REFERENCES `scripts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`idea_id` text,
	`hook` text NOT NULL,
	`body` text NOT NULL,
	`cta` text NOT NULL,
	`full_text` text NOT NULL,
	`verse_refs` text DEFAULT '[]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`variant` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
