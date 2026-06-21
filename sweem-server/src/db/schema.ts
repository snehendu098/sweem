import {
  pgTable, text, uuid, timestamp, numeric, unique, check, index, foreignKey
} from 'drizzle-orm/pg-core'
import { sql, relations } from 'drizzle-orm'

export const organizations = pgTable('organizations', {
  walletAddress: text('wallet_address').primaryKey(),
  name: text('name').notNull(),
  logoUrl: text('logo_url'),
  // Org admin contact email. `email` is set on verification-start (unverified);
  // `emailVerifiedAt` is stamped once the OTP is confirmed.
  email: text('email'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Pending email OTP, one row per org (upserted on each start). Stores only the
// HASH of the code (sha256 of salt+code), never the code itself.
export const emailVerifications = pgTable('email_verifications', {
  orgWallet: text('org_wallet').primaryKey().references(() => organizations.walletAddress, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: numeric('attempts').notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Publishable API keys for the @sweem/react checkout SDK. One org can have many.
// `receivingAddress` is OPTIONAL — when null the checkout falls back to the org's
// own wallet address. `revokedAt` null = active.
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgWallet: text('org_wallet').notNull().references(() => organizations.walletAddress, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  key: text('key').notNull().unique(),                 // pk_live_…  (client-safe)
  receivingAddress: text('receiving_address'),         // optional override; falls back to orgWallet
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_api_keys_org').on(t.orgWallet),
])

// Payment groups are OFF-CHAIN categories (Engineering, Marketing, …). They do
// NOT own a pool — everyone in an org streams from the org's single pool.
export const paymentGroups = pgTable('payment_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgWallet: text('org_wallet').notNull().references(() => organizations.walletAddress, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_payment_groups_org').on(t.orgWallet),
])

// ONE on-chain StreamPool per org per token. All employees (across all groups)
// stream from it. Replaces the old per-group pool.
export const orgPools = pgTable('org_pools', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgWallet: text('org_wallet').notNull(),
  token: text('token').notNull(),
  onChainPoolId: text('on_chain_pool_id').notNull(),
}, (t) => [
  foreignKey({ columns: [t.orgWallet], foreignColumns: [organizations.walletAddress], name: 'org_pools_org_fk' }).onDelete('cascade'),
  unique().on(t.orgWallet, t.token),
  index('idx_org_pools_org').on(t.orgWallet),
])

// Employees are an ORG-LEVEL roster. groupId is an optional off-chain category.
export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  alias: text('alias').notNull(),
  walletAddress: text('wallet_address').notNull(),
  orgWallet: text('org_wallet').notNull(),
  groupId: uuid('group_id'),
  // Optional employee email captured from CSV import. Unverified (informational).
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.orgWallet], foreignColumns: [organizations.walletAddress], name: 'emp_org_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.groupId], foreignColumns: [paymentGroups.id], name: 'emp_group_fk' }).onDelete('set null'),
  unique().on(t.walletAddress, t.orgWallet),
  index('idx_employees_org').on(t.orgWallet),
  index('idx_employees_group').on(t.groupId),
  index('idx_employees_wallet').on(t.walletAddress),
])

export const employeeTokenRates = pgTable('employee_token_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  rateAmount: numeric('rate_amount'),
  rateType: text('rate_type'),    // 'MONTHLY' | 'HOURLY'
  percentage: numeric('percentage'),
}, (t) => [
  unique().on(t.employeeId, t.token),
  index('idx_etr_employee').on(t.employeeId),
  check('mode_xor', sql`(rate_amount IS NOT NULL AND rate_type IS NOT NULL AND percentage IS NULL) OR (rate_amount IS NULL AND rate_type IS NULL AND percentage IS NOT NULL)`),
])

export const employeeVaults = pgTable('employee_vaults', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeWallet: text('employee_wallet').notNull(),
  name: text('name').notNull(),
  onChainVaultId: text('on_chain_vault_id').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_vaults_wallet').on(t.employeeWallet),
])

export const vaultAllocations = pgTable('vault_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  vaultId: uuid('vault_id').notNull().references(() => employeeVaults.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  yieldType: text('yield_type').notNull(),   // 'L' | 'Y' | 'S'
  percentage: numeric('percentage').notNull(),
  protocol: text('protocol').notNull(),       // 'SCALLOP' | 'NAVI' | 'USDY' | 'BUCKET' | 'AUTO_MAX_YIELD'
}, (t) => [
  unique().on(t.vaultId, t.token, t.protocol),
  index('idx_va_vault').on(t.vaultId),
])

// Yield routing per org pool (out of demo scope, kept coherent — now points at org_pools).
export const lastYieldRoutes = pgTable('last_yield_routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgPoolId: uuid('org_pool_id').notNull(),
  protocol: text('protocol').notNull(),
  yieldType: text('yield_type').notNull(),
  allocationPct: numeric('allocation_pct').notNull(),
}, (t) => [
  foreignKey({ columns: [t.orgPoolId], foreignColumns: [orgPools.id], name: 'lyr_pool_fk' }).onDelete('cascade'),
  unique().on(t.orgPoolId, t.protocol),
  index('idx_lyr_pool').on(t.orgPoolId),
])

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  groups: many(paymentGroups),
  employees: many(employees),
  pools: many(orgPools),
  invoices: many(invoices),
  apiKeys: many(apiKeys),
}))

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  org: one(organizations, { fields: [apiKeys.orgWallet], references: [organizations.walletAddress] }),
}))

export const paymentGroupsRelations = relations(paymentGroups, ({ one, many }) => ({
  org: one(organizations, { fields: [paymentGroups.orgWallet], references: [organizations.walletAddress] }),
  employees: many(employees),
}))

export const orgPoolsRelations = relations(orgPools, ({ one, many }) => ({
  org: one(organizations, { fields: [orgPools.orgWallet], references: [organizations.walletAddress] }),
  yieldRoutes: many(lastYieldRoutes),
}))

export const employeesRelations = relations(employees, ({ one, many }) => ({
  org: one(organizations, { fields: [employees.orgWallet], references: [organizations.walletAddress] }),
  group: one(paymentGroups, { fields: [employees.groupId], references: [paymentGroups.id] }),
  rates: many(employeeTokenRates),
  invoices: many(invoices),
}))

export const employeeTokenRatesRelations = relations(employeeTokenRates, ({ one }) => ({
  employee: one(employees, { fields: [employeeTokenRates.employeeId], references: [employees.id] }),
}))

export const employeeVaultsRelations = relations(employeeVaults, ({ many }) => ({
  allocations: many(vaultAllocations),
}))

export const vaultAllocationsRelations = relations(vaultAllocations, ({ one }) => ({
  vault: one(employeeVaults, { fields: [vaultAllocations.vaultId], references: [employeeVaults.id] }),
}))

export const lastYieldRoutesRelations = relations(lastYieldRoutes, ({ one }) => ({
  pool: one(orgPools, { fields: [lastYieldRoutes.orgPoolId], references: [orgPools.id] }),
}))

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgWallet: text('org_wallet').notNull(),
  employeeId: uuid('employee_id').notNull(),
  amount: numeric('amount').notNull(),
  token: text('token').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('PENDING'),
  dueDate: timestamp('due_date', { withTimezone: true }),
  attachmentKey: text('attachment_key'),
  note: text('note'),
  txHash: text('tx_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
}, (t) => [
  foreignKey({ columns: [t.orgWallet], foreignColumns: [organizations.walletAddress], name: 'inv_org_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.employeeId], foreignColumns: [employees.id], name: 'inv_emp_fk' }).onDelete('cascade'),
  index('idx_invoices_org').on(t.orgWallet),
  index('idx_invoices_employee').on(t.employeeId),
  index('idx_invoices_status').on(t.status),
])

export const invoicesRelations = relations(invoices, ({ one }) => ({
  org: one(organizations, { fields: [invoices.orgWallet], references: [organizations.walletAddress] }),
  employee: one(employees, { fields: [invoices.employeeId], references: [employees.id] }),
}))
