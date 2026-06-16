import {
  pgTable, text, uuid, timestamp, numeric, unique, check, index, foreignKey
} from 'drizzle-orm/pg-core'
import { sql, relations } from 'drizzle-orm'

export const organizations = pgTable('organizations', {
  walletAddress: text('wallet_address').primaryKey(),
  name: text('name').notNull(),
  logoUrl: text('logo_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const paymentGroups = pgTable('payment_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgWallet: text('org_wallet').notNull().references(() => organizations.walletAddress, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_payment_groups_org').on(t.orgWallet),
])

export const paymentGroupPools = pgTable('payment_group_pools', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentGroupId: uuid('payment_group_id').notNull().references(() => paymentGroups.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  onChainPoolId: text('on_chain_pool_id').notNull(),
}, (t) => [
  unique().on(t.paymentGroupId, t.token),
  index('idx_pgp_group').on(t.paymentGroupId),
])

export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  alias: text('alias').notNull(),
  walletAddress: text('wallet_address').notNull(),
  paymentGroupId: uuid('payment_group_id').notNull().references(() => paymentGroups.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.walletAddress, t.paymentGroupId),
  index('idx_employees_group').on(t.paymentGroupId),
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

export const lastYieldRoutes = pgTable('last_yield_routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentGroupPoolId: uuid('payment_group_pool_id').notNull(),
  protocol: text('protocol').notNull(),
  yieldType: text('yield_type').notNull(),
  allocationPct: numeric('allocation_pct').notNull(),
}, (t) => [
  // Explicit short FK name — the auto-generated name overflowed Postgres' 63-char
  // identifier limit and was being truncated (NOTICE 42622).
  foreignKey({
    columns: [t.paymentGroupPoolId],
    foreignColumns: [paymentGroupPools.id],
    name: 'lyr_pgp_fk',
  }).onDelete('cascade'),
  unique().on(t.paymentGroupPoolId, t.protocol),
  index('idx_lyr_pool').on(t.paymentGroupPoolId),
])

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  groups: many(paymentGroups),
}))

export const paymentGroupsRelations = relations(paymentGroups, ({ one, many }) => ({
  org: one(organizations, { fields: [paymentGroups.orgWallet], references: [organizations.walletAddress] }),
  pools: many(paymentGroupPools),
  employees: many(employees),
}))

export const paymentGroupPoolsRelations = relations(paymentGroupPools, ({ one, many }) => ({
  group: one(paymentGroups, { fields: [paymentGroupPools.paymentGroupId], references: [paymentGroups.id] }),
  yieldRoutes: many(lastYieldRoutes),
}))

export const employeesRelations = relations(employees, ({ one, many }) => ({
  group: one(paymentGroups, { fields: [employees.paymentGroupId], references: [paymentGroups.id] }),
  rates: many(employeeTokenRates),
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
  pool: one(paymentGroupPools, { fields: [lastYieldRoutes.paymentGroupPoolId], references: [paymentGroupPools.id] }),
}))
