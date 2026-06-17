CREATE TABLE "employee_token_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"token" text NOT NULL,
	"rate_amount" numeric,
	"rate_type" text,
	"percentage" numeric,
	CONSTRAINT "employee_token_rates_employee_id_token_unique" UNIQUE("employee_id","token"),
	CONSTRAINT "mode_xor" CHECK ((rate_amount IS NOT NULL AND rate_type IS NOT NULL AND percentage IS NULL) OR (rate_amount IS NULL AND rate_type IS NULL AND percentage IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "employee_vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_wallet" text NOT NULL,
	"name" text NOT NULL,
	"on_chain_vault_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_vaults_on_chain_vault_id_unique" UNIQUE("on_chain_vault_id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alias" text NOT NULL,
	"wallet_address" text NOT NULL,
	"org_wallet" text NOT NULL,
	"group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_wallet_address_org_wallet_unique" UNIQUE("wallet_address","org_wallet")
);
--> statement-breakpoint
CREATE TABLE "last_yield_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_pool_id" uuid NOT NULL,
	"protocol" text NOT NULL,
	"yield_type" text NOT NULL,
	"allocation_pct" numeric NOT NULL,
	CONSTRAINT "last_yield_routes_org_pool_id_protocol_unique" UNIQUE("org_pool_id","protocol")
);
--> statement-breakpoint
CREATE TABLE "org_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_wallet" text NOT NULL,
	"token" text NOT NULL,
	"on_chain_pool_id" text NOT NULL,
	CONSTRAINT "org_pools_org_wallet_token_unique" UNIQUE("org_wallet","token")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"wallet_address" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_wallet" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"token" text NOT NULL,
	"yield_type" text NOT NULL,
	"percentage" numeric NOT NULL,
	"protocol" text NOT NULL,
	CONSTRAINT "vault_allocations_vault_id_token_protocol_unique" UNIQUE("vault_id","token","protocol")
);
--> statement-breakpoint
ALTER TABLE "employee_token_rates" ADD CONSTRAINT "employee_token_rates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "emp_org_fk" FOREIGN KEY ("org_wallet") REFERENCES "public"."organizations"("wallet_address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "emp_group_fk" FOREIGN KEY ("group_id") REFERENCES "public"."payment_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "last_yield_routes" ADD CONSTRAINT "lyr_pool_fk" FOREIGN KEY ("org_pool_id") REFERENCES "public"."org_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_pools" ADD CONSTRAINT "org_pools_org_fk" FOREIGN KEY ("org_wallet") REFERENCES "public"."organizations"("wallet_address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_groups" ADD CONSTRAINT "payment_groups_org_wallet_organizations_wallet_address_fk" FOREIGN KEY ("org_wallet") REFERENCES "public"."organizations"("wallet_address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_allocations" ADD CONSTRAINT "vault_allocations_vault_id_employee_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."employee_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_etr_employee" ON "employee_token_rates" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_vaults_wallet" ON "employee_vaults" USING btree ("employee_wallet");--> statement-breakpoint
CREATE INDEX "idx_employees_org" ON "employees" USING btree ("org_wallet");--> statement-breakpoint
CREATE INDEX "idx_employees_group" ON "employees" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_employees_wallet" ON "employees" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_lyr_pool" ON "last_yield_routes" USING btree ("org_pool_id");--> statement-breakpoint
CREATE INDEX "idx_org_pools_org" ON "org_pools" USING btree ("org_wallet");--> statement-breakpoint
CREATE INDEX "idx_payment_groups_org" ON "payment_groups" USING btree ("org_wallet");--> statement-breakpoint
CREATE INDEX "idx_va_vault" ON "vault_allocations" USING btree ("vault_id");