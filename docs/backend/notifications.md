# Notifications

Sweem is a B2B payroll protocol. The on-chain `deposit` enforces a 4-week coverage minimum, but after that it is the org's responsibility to keep pools funded. The notification layer monitors on-chain state and proactively alerts both orgs and employees.

---

## Architecture

A background worker (Cloudflare Worker with Cron Trigger, or equivalent) runs every hour:

1. Reads all registered pools from the DB
2. Fetches on-chain state for each pool (idle balance, yield positions, `total_weekly_committed`)
3. Computes effective runway per pool
4. Triggers notification events based on thresholds

Notifications are delivered via the org's configured channel (Telegram, Slack, or email), set at onboarding.

---

## Org Notifications

| Trigger | Message | Severity |
|---|---|---|
| Runway ≤ 4 weeks | "Your {token} pool has {N} weeks of runway left. Top up to avoid missed payments." | Warning |
| Runway ≤ 1 week | "URGENT: Your {token} pool runs out in {N} days. Employees will miss payments." | Critical |
| Runway = 0 (pool insolvent) | "Your {token} pool is underfunded. Employees cannot claim — top up immediately." | Critical |
| Pool recovered (runway > 4 weeks after topup) | "Your {token} pool is fully funded. Runway: {N} weeks." | Info |

### Runway calculation

```
effective_pool_value = pool_idle_cash + scallop_deposited_value + navi_deposited_value
active_rate_per_ms   = sum(rate_amount / rate_period_ms) for all ACTIVE streams
runway_ms            = effective_pool_value / active_rate_per_ms
runway_weeks         = runway_ms / (7 * 24 * 60 * 60 * 1_000)
```

`deposited_value` from position DFs (not live market rate) is used intentionally — avoids overestimating runway due to unrealized yield.

---

## Employee Notifications

| Trigger | Message |
|---|---|
| Pool runway ≤ 1 week | "Your employer's payroll pool is running low. Your next claim may be delayed — contact your employer." |
| Claim attempted, pool insolvent | "Claim failed: insufficient pool funds. Your earnings are safe and will be available when your employer tops up." |
| Pool recovered after insolvency | "Good news: your employer has topped up the pool. You can now claim your pending earnings." |

### Note on failed claims

When a claim reverts with `EInsufficientPoolLiquidity`, the employee's `claimed_at` is unchanged — all accrued earnings are preserved. The backend should catch this error code and surface the message above rather than a generic failure.

---

## Chatbot Integration

The worker emits structured events via webhook. The chatbot layer handles formatting and delivery.

### Event payload

```json
{
  "event": "pool_low_runway",
  "severity": "warning",
  "org_wallet": "0x...",
  "pool_id": "0x...",
  "token": "USDC",
  "runway_weeks": 3.2,
  "total_weekly_committed_usdc": 5000
}
```

Event types: `pool_low_runway`, `pool_critical_runway`, `pool_insolvent`, `pool_recovered`, `claim_failed_insolvent`.

### Org notification config

```
PUT /v1/orgs/:wallet/notification-config
{
  "channel": "telegram",
  "telegram_chat_id": "...",
  "slack_webhook_url": null,
  "email": null
}
```

---

## What the Protocol Does NOT Do

- **No automatic top-up** — Sweem does not hold reserve funds for automatic refills. The org is responsible.
- **No slashing or penalties** — a pool going insolvent is not a protocol error. Earnings queue as backpay.
- **No claim blocking** — the stream keeps accruing even when the pool is insolvent. The employee is owed everything the formula says, paid in full when the org tops up.
