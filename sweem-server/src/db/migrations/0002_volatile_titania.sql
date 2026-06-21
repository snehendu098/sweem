CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_wallet" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"token" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"due_date" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "inv_org_fk" FOREIGN KEY ("org_wallet") REFERENCES "public"."organizations"("wallet_address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "inv_emp_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invoices_org" ON "invoices" USING btree ("org_wallet");--> statement-breakpoint
CREATE INDEX "idx_invoices_employee" ON "invoices" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_status" ON "invoices" USING btree ("status");