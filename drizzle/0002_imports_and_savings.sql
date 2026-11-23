CREATE TYPE "public"."import_batch_status" AS ENUM('in_review', 'committed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."import_row_resolution" AS ENUM('none', 'corrected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('ok', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."savings_txn_type" AS ENUM('contribution', 'withdrawal', 'adjustment', 'reversal', 'migrated_opening');--> statement-breakpoint
CREATE TYPE "public"."txn_source" AS ENUM('import', 'manual', 'migration', 'seed');--> statement-breakpoint
CREATE TABLE "earning_rates" (
	"effective_from" text PRIMARY KEY NOT NULL,
	"monthly_rate" numeric(9, 6) NOT NULL,
	"note" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earning_rates_period_chk" CHECK (effective_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"format" text NOT NULL,
	"file_id" bigint NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"status" "import_batch_status" DEFAULT 'in_review' NOT NULL,
	"file_period_label" text,
	"structure_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"control_count" integer,
	"control_total_kobo" bigint,
	"parsed_count" integer NOT NULL,
	"parsed_total_kobo" bigint NOT NULL,
	"posted_count" integer DEFAULT 0 NOT NULL,
	"posted_total_kobo" bigint DEFAULT 0 NOT NULL,
	"uploaded_by" bigint,
	"committed_by" bigint,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_period_chk" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"section" text,
	"employment_no_raw" text,
	"verification_no_raw" text,
	"name_raw" text,
	"amount_raw" text,
	"ytd_kobo" bigint,
	"employment_no" text,
	"amount_kobo" bigint,
	"member_id" bigint,
	"suggested_member_id" bigint,
	"status" "import_row_status" NOT NULL,
	"error_code" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message" text,
	"resolution" "import_row_resolution" DEFAULT 'none' NOT NULL,
	"resolved_by" bigint,
	"note" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savings_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" bigint NOT NULL,
	"period" text NOT NULL,
	"txn_date" date NOT NULL,
	"type" "savings_txn_type" NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"source" "txn_source" NOT NULL,
	"batch_id" bigint,
	"import_row_id" bigint,
	"import_key" text,
	"reverses_id" bigint,
	"narration" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "savings_transactions_import_row_id_unique" UNIQUE("import_row_id"),
	CONSTRAINT "savings_transactions_import_key_unique" UNIQUE("import_key"),
	CONSTRAINT "savings_transactions_reverses_id_unique" UNIQUE("reverses_id"),
	CONSTRAINT "savings_period_chk" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "savings_amount_nonzero_chk" CHECK (amount_kobo <> 0),
	CONSTRAINT "savings_sign_chk" CHECK ((type <> 'contribution' or amount_kobo > 0) and (type <> 'withdrawal' or amount_kobo < 0)),
	CONSTRAINT "savings_reversal_link_chk" CHECK ((type = 'reversal') = (reverses_id is not null)),
	CONSTRAINT "savings_import_source_chk" CHECK ((import_key is null) or (source = 'import' and batch_id is not null))
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"uploaded_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "verification_no" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "file_no" text;--> statement-breakpoint
ALTER TABLE "earning_rates" ADD CONSTRAINT "earning_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_suggested_member_id_members_id_fk" FOREIGN KEY ("suggested_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_transactions" ADD CONSTRAINT "savings_transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_transactions" ADD CONSTRAINT "savings_transactions_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_transactions" ADD CONSTRAINT "savings_transactions_import_row_id_import_rows_id_fk" FOREIGN KEY ("import_row_id") REFERENCES "public"."import_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_transactions" ADD CONSTRAINT "savings_transactions_reverses_id_savings_transactions_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."savings_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_transactions" ADD CONSTRAINT "savings_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_hash_committed_uq" ON "import_batches" USING btree ("file_hash") WHERE status = 'committed';--> statement-breakpoint
CREATE INDEX "import_batches_period_idx" ON "import_batches" USING btree ("period");--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_batch_row_uq" ON "import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "savings_member_period_idx" ON "savings_transactions" USING btree ("member_id","period");