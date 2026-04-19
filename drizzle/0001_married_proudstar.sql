ALTER TABLE "dens" ADD COLUMN "contract_address" varchar(80);--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "description" varchar(512);--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "visibility" varchar(16) DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "strategy" varchar(32) DEFAULT 'tonstakers' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "contract_address" varchar(80);--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "target_ton" numeric(18, 8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "current_ton" numeric(18, 8) DEFAULT '0' NOT NULL;