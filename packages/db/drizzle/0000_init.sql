CREATE TABLE "agent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"agent" text NOT NULL,
	"level" text NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anomalies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"source" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candles_m1" (
	"symbol" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" double precision DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "candles_m1_pk" PRIMARY KEY("symbol","ts","source")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"started" timestamp with time zone DEFAULT now() NOT NULL,
	"finished" timestamp with time zone,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "raw_ingest" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"range_from" timestamp with time zone NOT NULL,
	"range_to" timestamp with time zone NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setups" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"playbook" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"realized_r" double precision
);
--> statement-breakpoint
CREATE INDEX "agent_events_ts_idx" ON "agent_events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "anomalies_symbol_ts_idx" ON "anomalies" USING btree ("symbol","ts");--> statement-breakpoint
CREATE INDEX "candles_m1_symbol_source_ts_idx" ON "candles_m1" USING btree ("symbol","source","ts");--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_ts_idx" ON "chat_messages" USING btree ("conversation_id","ts");--> statement-breakpoint
CREATE INDEX "ingest_runs_source_started_idx" ON "ingest_runs" USING btree ("source","started");--> statement-breakpoint
CREATE INDEX "raw_ingest_source_fetched_idx" ON "raw_ingest" USING btree ("source","fetched_at");--> statement-breakpoint
CREATE INDEX "setups_status_idx" ON "setups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "setups_created_idx" ON "setups" USING btree ("created_at");