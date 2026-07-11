ALTER TABLE "event_reviews" ADD COLUMN "judge_verdict" text;--> statement-breakpoint
ALTER TABLE "event_reviews" ADD COLUMN "judge_confidence" numeric;--> statement-breakpoint
ALTER TABLE "event_reviews" ADD COLUMN "judge_rationale" text;--> statement-breakpoint
ALTER TABLE "event_reviews" ADD COLUMN "judged_at" timestamp with time zone;