# Database

PostgreSQL accessed via Cloudflare Hyperdrive. Drizzle for schema, queries, and migrations.

---

## Connection

```ts
// src/db/client.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

export function createDb(env: Env) {
  // env.DB is the Hyperdrive binding — connectionString routes through the CF proxy
  const client = postgres(env.DB.connectionString)
  return drizzle(client)
}
```

`wrangler.toml` binds Hyperdrive per environment:

```toml
[env.testnet]
[[env.testnet.hyperdrive]]
binding = "DB"
id = "<testnet-hyperdrive-id>"

[env.mainnet]
[[env.mainnet.hyperdrive]]
binding = "DB"
id = "<mainnet-hyperdrive-id>"
```

---

## Schema

### organizations

```sql
CREATE TABLE organizations (
  wallet_address TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  logo_url       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### payment_groups

```sql
CREATE TABLE payment_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_wallet TEXT        NOT NULL REFERENCES organizations(wallet_address) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_groups_org ON payment_groups(org_wallet);
```

### payment_group_pools

One row per token per group — each row maps to one `StreamPool` on-chain.

```sql
CREATE TABLE payment_group_pools (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_group_id  UUID NOT NULL REFERENCES payment_groups(id) ON DELETE CASCADE,
  token             TEXT NOT NULL,  -- 'USDC' | 'SUI' | etc.
  on_chain_pool_id  TEXT NOT NULL,  -- Sui object ID of the StreamPool
  UNIQUE (payment_group_id, token)
);

CREATE INDEX idx_pgp_group ON payment_group_pools(payment_group_id);
```

### employees

An employee row is scoped to a (wallet × group) pair — the same wallet can appear in multiple groups.

```sql
CREATE TABLE employees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias             TEXT NOT NULL,
  wallet_address    TEXT NOT NULL,
  payment_group_id  UUID NOT NULL REFERENCES payment_groups(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (wallet_address, payment_group_id)
);

CREATE INDEX idx_employees_group  ON employees(payment_group_id);
CREATE INDEX idx_employees_wallet ON employees(wallet_address);
```

### employee_token_rates

One row per token per employee. Holds either a MODE A individual rate or a MODE B percentage.

```sql
CREATE TABLE employee_token_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID    NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token       TEXT    NOT NULL,  -- must match a token in payment_group_pools for that group
  -- MODE A
  rate_amount NUMERIC,           -- e.g. 5000.00
  rate_type   TEXT,              -- 'MONTHLY' | 'HOURLY'
  -- MODE B
  percentage  NUMERIC,           -- e.g. 30.0 (%)
  UNIQUE (employee_id, token),
  CHECK (
    (rate_amount IS NOT NULL AND rate_type IS NOT NULL AND percentage IS NULL)
    OR
    (rate_amount IS NULL AND rate_type IS NULL AND percentage IS NOT NULL)
  )
);

CREATE INDEX idx_etr_employee ON employee_token_rates(employee_id);
```

### employee_vaults

```sql
CREATE TABLE employee_vaults (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_wallet   TEXT NOT NULL,
  name              TEXT NOT NULL,
  on_chain_vault_id TEXT NOT NULL UNIQUE,  -- Sui EmployeeVault object ID
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vaults_wallet ON employee_vaults(employee_wallet);
```

### vault_allocations

UI pre-fill for employee claim routing. Not source of truth — the actual on-chain call parameters come from these rows at claim time.

```sql
CREATE TABLE vault_allocations (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id   UUID    NOT NULL REFERENCES employee_vaults(id) ON DELETE CASCADE,
  token      TEXT    NOT NULL,
  yield_type TEXT    NOT NULL,   -- 'L' | 'Y' | 'S'
  percentage NUMERIC NOT NULL,   -- % of this token going to this protocol
  protocol   TEXT    NOT NULL,   -- 'SCALLOP' | 'NAVI' | 'USDY' | 'BUCKET' | 'AUTO_MAX_YIELD'
  UNIQUE (vault_id, token, protocol)
);

CREATE INDEX idx_va_vault ON vault_allocations(vault_id);
```

Percentages per (vault_id × token) should sum to 100 — enforced at the API layer, not DB.

### last_yield_routes

Org UI pre-fill for the next deposit routing decision. Not source of truth.

```sql
CREATE TABLE last_yield_routes (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_group_pool_id   UUID    NOT NULL REFERENCES payment_group_pools(id) ON DELETE CASCADE,
  protocol                TEXT    NOT NULL,  -- 'SCALLOP' | 'NAVI' | 'USDY' | 'BUCKET'
  yield_type              TEXT    NOT NULL,  -- 'L' | 'Y' | 'S'
  allocation_pct          NUMERIC NOT NULL,
  UNIQUE (payment_group_pool_id, protocol)
);

CREATE INDEX idx_lyr_pool ON last_yield_routes(payment_group_pool_id);
```

`allocation_pct` values per `payment_group_pool_id` must sum to 100 — enforced at the API layer.

---

## Drizzle Setup

```ts
// drizzle.config.ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config
```

Generate and apply migrations locally:

```sh
drizzle-kit generate
drizzle-kit migrate
```

Apply to each environment's Postgres instance with the appropriate `DATABASE_URL`. Hyperdrive is only used at Worker runtime — migrations run against the DB directly.
