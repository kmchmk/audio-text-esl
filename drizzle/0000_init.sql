CREATE TABLE "character_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"gender" text NOT NULL,
	"age_group" text NOT NULL,
	"accent" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"voice" text NOT NULL,
	"default_speed" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"current_version_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"voice" text NOT NULL,
	"text" text NOT NULL,
	"emotion" text NOT NULL,
	"speed" double precision NOT NULL,
	"audio_key" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"provider_generation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clips_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "conversation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"pause_ms" integer NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"pause_ms" integer DEFAULT 500 NOT NULL,
	"updated_ms" double precision NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" double precision NOT NULL,
	"character_id" uuid,
	"text" text DEFAULT '' NOT NULL,
	"emotion" text DEFAULT 'neutral' NOT NULL,
	"speed" double precision,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_ms" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"line_id" uuid NOT NULL,
	"cache_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"clip_id" uuid,
	"cached" boolean DEFAULT false NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"total_items" integer NOT NULL,
	"done_items" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"audio_key" text,
	"duration_ms" integer,
	"timings" jsonb,
	"error" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"hide_transcript" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone,
	"tutorial_done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "character_versions_char_ver_idx" ON "character_versions" USING btree ("character_id","version");--> statement-breakpoint
CREATE INDEX "characters_user_idx" ON "characters" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_versions_conv_ver_idx" ON "conversation_versions" USING btree ("conversation_id","version");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "draft_lines_conv_idx" ON "draft_lines" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "generation_items_gen_idx" ON "generation_items" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX "generations_conv_idx" ON "generations" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "shares_generation_idx" ON "shares" USING btree ("generation_id");