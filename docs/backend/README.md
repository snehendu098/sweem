# Backend

Sweem's backend is a stateless Cloudflare Worker. It owns only metadata and UI pre-fill state — all financial source of truth lives on-chain.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| Router | Hono |
| Database | PostgreSQL (via Cloudflare Hyperdrive) |
| ORM | Drizzle |
| Sui reads | `@mysten/sui` SDK (fetch-based, works in CF edge runtime) |

---

## Design Principles

**The worker never touches funds.** No private keys, no transaction signing, no PTB construction. It stores metadata and reads on-chain state.

**Wallet address = identity.** No email/password auth. Write endpoints require a wallet signature proving ownership of the address in the request.

**DB is pre-fill, not source of truth.** Claimable amounts, pool balances, stream state — all come from Sui RPC reads. The DB stores org names, employee aliases, vault labels, and yield routing preferences. Nothing financial.

**Separate deployments per network.** Testnet and mainnet are different worker deployments with different D1 databases and different Sui RPC endpoints. Controlled via `wrangler.toml` environments.

**One pool per token per group.** Enforced by contract design. The DB mirrors it: a `payment_group_pools` row stores the `on_chain_pool_id` for each (group × token) pair.

---

## Folder Structure

```
src/
  index.ts                  — Hono app entry, route registration
  routes/
    orgs.ts                 — org + group + employee management
    employees.ts            — vault + allocation management, stream reads
    compute.ts              — slice calc, runway, max-yield resolution
  db/
    schema.ts               — Drizzle table definitions
    client.ts               — Hyperdrive + Drizzle client setup
    migrations/             — generated SQL migration files
  lib/
    sui.ts                  — Sui RPC helpers (read-only)
    slice.ts                — slice_per_ms calculation
    yield.ts                — AUTO_MAX_YIELD protocol resolution
    auth.ts                 — wallet signature verification
  types.ts                  — shared request/response types
wrangler.toml
drizzle.config.ts
```

---

## Auth

Write endpoints (`POST`, `PUT`, `DELETE`) require a wallet signature header:

```
X-Wallet-Address: <sui_address>
X-Signature:      <base64 bcs-encoded PersonalMessage signature>
X-Message:        <the signed message string>
```

The message format is: `sweem:<method>:<path>:<unix_timestamp_seconds>`. The timestamp must be within 60 seconds of the server time to prevent replay attacks. Verification uses `@mysten/sui`'s `verifyPersonalMessageSignature`.

Read endpoints (`GET`) are public — no signature required.

---

## Environments

```toml
# wrangler.toml

[env.testnet]
name = "sweem-api-testnet"
vars = { SUI_NETWORK = "testnet" }

[env.mainnet]
name = "sweem-api-mainnet"
vars = { SUI_NETWORK = "mainnet" }
```

Each environment binds its own Hyperdrive instance (pointing to a separate Postgres database) and has its own set of secrets (yield API keys).

---

## Docs

- [api.md](api.md) — full endpoint reference
- [db.md](db.md) — D1 schema and migration strategy
- [compute.md](compute.md) — slice calculation, runway, AUTO_MAX_YIELD
