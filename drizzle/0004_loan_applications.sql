CREATE TYPE "public"."loan_application_status" AS ENUM('submitted', 'offered', 'adjustment_requested', 'accepted', 'declined', 'rejected', 'cancelled', 'disbursed');--> statement-breakpoint
CREATE TYPE "public"."loan_offer_response" AS ENUM('accepted', 'declined', 'adjustment_requested');--> statement-breakpoint
CREATE TYPE "public"."loan_scheme_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."loan_type" AS ENUM('regular', 'commodity', 'special');--> statement-breakpoint
CREATE TABLE "loan_applications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" bigint NOT NULL,
	"scheme_id" bigint,
	"loan_type" "loan_type" NOT NULL,
	"requested_kobo" bigint NOT NULL,
	"purpose" text NOT NULL,
	"preferred_tenure_months" integer,
	"status" "loan_application_status" DEFAULT 'submitted' NOT NULL,
	"submitted_by" bigint,
	"on_behalf" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_applications_amount_chk" CHECK (requested_kobo > 0)
);
--> statement-breakpoint
CREATE TABLE "loan_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"application_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"actor_user_id" bigint,
	"on_behalf" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_offers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"application_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"rate_percent" numeric(7, 3) NOT NULL,
	"interest_kobo" bigint NOT NULL,
	"total_kobo" bigint NOT NULL,
	"tenure_months" integer NOT NULL,
	"instalment_kobo" bigint NOT NULL,
	"first_repayment_period" text NOT NULL,
	"conditions" text,
	"valid_until" date NOT NULL,
	"offered_by" bigint,
	"response" "loan_offer_response",
	"response_note" text,
	"responded_by" bigint,
	"responded_on_behalf" boolean,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_offers_first_period_chk" CHECK (first_repayment_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "loan_offers_amount_chk" CHECK (amount_kobo > 0 and tenure_months > 0 and total_kobo = amount_kobo + interest_kobo)
);
--> statement-breakpoint
CREATE TABLE "loan_schemes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "loan_type" NOT NULL,
	"description" text,
	"pool_kobo" bigint,
	"max_per_member_kobo" bigint,
	"default_rate_percent" numeric(7, 3) NOT NULL,
	"default_tenure_months" integer NOT NULL,
	"opens_on" date NOT NULL,
	"closes_on" date,
	"status" "loan_scheme_status" DEFAULT 'open' NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_scheme_id_loan_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."loan_schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_events" ADD CONSTRAINT "loan_events_application_id_loan_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."loan_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_events" ADD CONSTRAINT "loan_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_offers" ADD CONSTRAINT "loan_offers_application_id_loan_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."loan_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_offers" ADD CONSTRAINT "loan_offers_offered_by_users_id_fk" FOREIGN KEY ("offered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_offers" ADD CONSTRAINT "loan_offers_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_schemes" ADD CONSTRAINT "loan_schemes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loan_applications_member_idx" ON "loan_applications" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "loan_applications_status_idx" ON "loan_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "loan_events_app_idx" ON "loan_events" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_offers_app_version_uq" ON "loan_offers" USING btree ("application_id","version");