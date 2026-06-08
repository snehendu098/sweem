# API

All endpoints are prefixed with `/v1`. Read endpoints are public. Write endpoints require wallet signature headers (see [README.md](README.md#auth)).

Base URLs:
- Testnet: `https://sweem-api-testnet.<your-subdomain>.workers.dev`
- Mainnet: `https://sweem-api-mainnet.<your-subdomain>.workers.dev`

---

## Auth Headers (write endpoints)

```
X-Wallet-Address: <sui_address>
X-Signature:      <base64 PersonalMessage signature>
X-Message:        sweem:<METHOD>:<path>:<unix_timestamp_seconds>
```

Example: `sweem:POST:/v1/orgs:1749254400`

---

## Organizations

### `POST /v1/orgs`

Register an org. Wallet must sign — becomes the org identity on-chain.

**Body:**
```json
{ "name": "Acme Corp", "logo_url": "https://..." }
```

**Response `201`:**
```json
{ "wallet_address": "0x...", "name": "Acme Corp", "logo_url": "...", "created_at": "..." }
```

---

### `GET /v1/orgs/:wallet`

Fetch org profile.

**Response `200`:**
```json
{
  "wallet_address": "0x...",
  "name": "Acme Corp",
  "logo_url": "...",
  "created_at": "..."
}
```

---

### `PUT /v1/orgs/:wallet`

Update org name or logo. Requires signature from `:wallet`.

**Body:** `{ "name"?: "...", "logo_url"?: "..." }`

---

## Payment Groups

### `POST /v1/orgs/:wallet/groups`

Create a payment group.

**Body:** `{ "name": "Engineering" }`

**Response `201`:**
```json
{ "id": "uuid", "org_wallet": "0x...", "name": "Engineering", "created_at": "..." }
```

---

### `GET /v1/orgs/:wallet/groups`

List all groups for an org.

**Response `200`:** `[{ id, name, created_at }]`

---

### `DELETE /v1/orgs/:wallet/groups/:group_id`

Delete group and all nested rows (cascades). Requires org signature.

---

## Payment Group Pools

### `POST /v1/groups/:group_id/pools`

Register a StreamPool for a token within a group. Called after deploying the on-chain StreamPool.

**Body:**
```json
{ "token": "USDC", "on_chain_pool_id": "0x..." }
```

**Response `201`:**
```json
{ "id": "uuid", "payment_group_id": "...", "token": "USDC", "on_chain_pool_id": "0x..." }
```

---

### `GET /v1/groups/:group_id/pools`

List all pools (tokens) for a group, with on-chain state merged in.

**Response `200`:**
```json
[
  {
    "id": "uuid",
    "token": "USDC",
    "on_chain_pool_id": "0x...",
    "on_chain": {
      "balance": "1000000000",
      "total_deposited": "5000000000",
      "total_claimed": "4000000000",
      "runway_ms": 86400000,
      "active_stream_count": 5
    }
  }
]
```

`on_chain` fields come from a live Sui RPC read.

---

### `GET /v1/groups/:group_id/pools/:pool_id/yield-route`

Get stored LastYieldRoute for UI pre-fill.

**Response `200`:**
```json
[
  { "protocol": "SCALLOP", "yield_type": "L", "allocation_pct": 70 },
  { "protocol": "NAVI",    "yield_type": "L", "allocation_pct": 30 }
]
```

---

### `PUT /v1/groups/:group_id/pools/:pool_id/yield-route`

Update LastYieldRoute after org deposits. Replaces all rows for this pool.

**Body:**
```json
[
  { "protocol": "SCALLOP", "yield_type": "L", "allocation_pct": 70 },
  { "protocol": "NAVI",    "yield_type": "L", "allocation_pct": 30 }
]
```

Validation: allocations must sum to 100.

---

## Employees

### `POST /v1/groups/:group_id/employees`

Add an employee to a group.

**Body:**
```json
{
  "alias": "Alice",
  "wallet_address": "0x...",
  "rates": [
    { "token": "USDC", "rate_amount": 5000, "rate_type": "MONTHLY" }
  ]
}
```

`rates` is optional — can be added/updated separately.

**Response `201`:**
```json
{ "id": "uuid", "alias": "Alice", "wallet_address": "0x...", "payment_group_id": "...", "created_at": "..." }
```

---

### `GET /v1/groups/:group_id/employees`

List employees in a group with their rates.

**Response `200`:**
```json
[
  {
    "id": "uuid",
    "alias": "Alice",
    "wallet_address": "0x...",
    "rates": [
      { "token": "USDC", "rate_amount": 5000, "rate_type": "MONTHLY" }
    ]
  }
]
```

---

### `PUT /v1/groups/:group_id/employees/:employee_id/rates`

Update rates for an employee. Replaces all rate rows.

**Body:**
```json
[
  { "token": "USDC", "rate_amount": 6000, "rate_type": "MONTHLY" }
]
```

---

### `DELETE /v1/groups/:group_id/employees/:employee_id`

Remove employee from DB. Does not stop the on-chain stream — that requires a PTB from the org.

---

## Employee Stream State (on-chain reads)

### `GET /v1/employees/:wallet/streams`

Return all streams across all pools where this wallet is an employee. Reads live from Sui RPC.

**Response `200`:**
```json
[
  {
    "pool_id": "0x...",
    "token": "USDC",
    "rate_amount": "100000000",
    "rate_period_ms": "2592000000",
    "claimable": "165696000",
    "state": "ACTIVE",
    "claimed_at": 1749254000000,
    "total_paused_ms": 0
  }
]
```

---

### `GET /v1/pools/:pool_id/claimable/:wallet`

Claimable amount for a specific wallet in a specific pool.

**Response `200`:**
```json
{ "pool_id": "0x...", "wallet": "0x...", "claimable": "165696000", "token": "USDC" }
```

---

## Employee Vaults

### `POST /v1/vaults`

Register an employee vault after the on-chain `EmployeeVault` is created.

**Body:**
```json
{ "on_chain_vault_id": "0x...", "name": "My USDC Vault" }
```

Wallet from signature = `employee_wallet`.

**Response `201`:**
```json
{ "id": "uuid", "employee_wallet": "0x...", "name": "My USDC Vault", "on_chain_vault_id": "0x..." }
```

---

### `GET /v1/vaults/:wallet`

List all vaults for a wallet, with on-chain balances merged in.

**Response `200`:**
```json
[
  {
    "id": "uuid",
    "name": "My USDC Vault",
    "on_chain_vault_id": "0x...",
    "buckets": [
      {
        "token": "USDC",
        "raw_balance": "50000000",
        "positions": {
          "scallop": { "deposited_value": "100000000" },
          "navi": null
        }
      }
    ]
  }
]
```

`buckets` and `positions` are read live from Sui RPC via dynamic fields on the vault object.

---

### `GET /v1/vaults/:vault_id/allocation`

Get stored VaultAllocation for UI pre-fill.

**Response `200`:**
```json
[
  { "token": "USDC", "yield_type": "L", "percentage": 60, "protocol": "SCALLOP" },
  { "token": "USDC", "yield_type": "L", "percentage": 40, "protocol": "AUTO_MAX_YIELD" }
]
```

---

### `PUT /v1/vaults/:vault_id/allocation`

Update VaultAllocation after employee claims. Requires employee wallet signature.

**Body:**
```json
[
  { "token": "USDC", "yield_type": "L", "percentage": 60, "protocol": "SCALLOP" },
  { "token": "USDC", "yield_type": "L", "percentage": 40, "protocol": "AUTO_MAX_YIELD" }
]
```

Validation: percentages per token must sum to 100.

---

## Compute

### `GET /v1/compute/rate-params?token=USDC&rate_amount=5000&rate_type=MONTHLY`

Compute `(rate_amount, rate_period_ms)` for use in a deposit PTB. No DB reads.

**Response `200`:**
```json
{ "token": "USDC", "rate_amount": "5000000000", "rate_period_ms": "2592000000" }
```

---

### `GET /v1/compute/runway?pool_id=0x...`

Estimate runway for a pool. Reads on-chain state live.

**Response `200`:**
```json
{
  "pool_id": "0x...",
  "token": "USDC",
  "balance": "1000000000",
  "active_slice_total": 9645,
  "runway_ms": 103679,
  "runway_days": 1.2
}
```

---

### `GET /v1/compute/max-yield?token=USDC`

Resolve `AUTO_MAX_YIELD` — returns the L-type protocol with the highest current APY for the given token.

**Response `200`:**
```json
{ "token": "USDC", "protocol": "SCALLOP", "apy": 8.2 }
```

Used by the frontend to substitute `AUTO_MAX_YIELD` with an explicit protocol name before constructing the claim PTB.

---

## Error Format

```json
{ "error": "short_code", "message": "Human readable description" }
```

Common codes: `unauthorized`, `invalid_signature`, `not_found`, `validation_error`, `allocation_sum_invalid`
