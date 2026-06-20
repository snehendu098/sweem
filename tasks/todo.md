# Org onboarding flow — `/onboarding` wizard

Goal: replace the inline "Create your organization" card with a smooth, resumable,
top-level `/onboarding` wizard. Decisions locked: Workers AI (Llama) for CSV mapping,
email for BOTH org (verified) + employees (unverified from CSV), 6-digit OTP via Resend,
top-level `/onboarding` route with minimal chrome.

## Flow
1. Connect wallet + org name (+ optional logo) → `ensureOrg`. (org now exists → resumable)
2. Import employees (skippable): CSV dropzone → client parses (papaparse) → headers+sample
   to AI mapping → apply mapping to all rows in code → preview/edit table w/ per-row
   validation → bulk insert. Captures employee email column if present (unverified).
3. Connect org email (skippable): enter email → Resend OTP → enter 6-digit code → verified.
4. Done → redirect to `/dashboard`.

## Gating / routing
- `/dashboard` Overview: wallet connected + no org → redirect to `/onboarding` (replaces
  CreateOrgCard). Keep ConnectPrompt when no wallet.
- `/onboarding`: compute start step from state (no org → step1; org exists → step2). Org
  required before steps 2-3. "Finish"/all-done → `/dashboard`. Avoid redirect loops.

## Frontend (fe/)
- [ ] `app/onboarding/layout.tsx` — DashboardProviders + Toaster + slim header (brand +
      WalletButton). Root layout already gives fonts/SmoothScroll/html-body.
- [ ] `app/onboarding/page.tsx` — renders `<OnboardingWizard/>`.
- [ ] `components/onboarding/onboarding-wizard.tsx` — step state machine + animated stepper
      (framer-motion), reads orgQuery/employeesQuery to pick start step.
- [ ] `components/onboarding/steps/connect-step.tsx` — wallet gate + org name/logo → ensureOrg.
- [ ] `components/onboarding/steps/import-step.tsx` — dropzone, AI map, preview/edit table
      (editable cells, status badge: Ready/Fix wallet/Dup/Missing rate), bulk submit, skip.
- [ ] `components/onboarding/steps/email-step.tsx` — email input → send code → OTP boxes →
      confirm, skip. Resend cooldown timer.
- [ ] `components/onboarding/steps/done-step.tsx` — success + "Go to dashboard".
- [ ] `components/onboarding/csv.ts` — papaparse + applyMapping + normalize (strip $/commas,
      split name, HOURLY/MONTHLY detect, email regex) + isValidSuiAddress (@mysten/sui/utils).
- [ ] `lib/api.ts` — add: mapCsv(headers,samples), bulkAddEmployees(w,emps),
      startEmailVerification(w,email), confirmEmail(w,code). Extend Org{email,emailVerifiedAt},
      AddEmployeeInput{email?}.
- [ ] dep: papaparse + @types/papaparse.
- [ ] Update org-home CreateOrgCard → redirect to /onboarding.

## Backend (sweem-server/)
- [ ] Drizzle migration: organizations += email(text), email_verified_at(timestamptz);
      employees += email(text null); NEW email_verifications(org_wallet PK/FK, code_hash,
      expires_at, attempts int default 0).
- [ ] `POST /v1/ai/map-csv` (auth): body {headers, samples[][]}. Heuristic fuzzy header
      match FIRST (name/wallet/salary/email/rate_type/group), Workers AI (llama-3.3-70b)
      only for unmapped/ambiguous cols. Zod-validate AI output; fall back to heuristic on
      junk. Returns {mapping, defaults:{token:'USDC',rate_type:'MONTHLY'}, notes}.
- [ ] `POST /v1/orgs/:wallet/employees/bulk` (auth): {employees:[AddEmployeeInput]} →
      txn insert, dedupe (wallet_address,org_wallet), return {created, skipped[], errors[]}.
      Optional: resolve group names → create+map ids.
- [ ] `POST /v1/orgs/:wallet/email/start` (auth): {email} → store email unverified, gen
      6-digit, hash (sha256+secret), upsert verification row +10min TTL, send via Resend.
      Rate-limit (cooldown).
- [ ] `POST /v1/orgs/:wallet/email/confirm` (auth): {code} → check hash/expiry/attempts →
      set email_verified_at, delete verification row.
- [ ] wrangler.jsonc: add AI binding `"ai":{"binding":"AI"}`; secrets RESEND_API_KEY,
      RESEND_FROM, VERIFICATION_SALT.
- [ ] Resend client (fetch https://api.resend.com/emails). Branded OTP email template.

## Resolved decisions
1. No verified domain yet → EMAIL_DEV_MODE flag: backend hashes/stores OTP + attempts
   Resend send (resend.dev sender) AND returns code in response so flow is demoable to any
   email. Flip flag off after adding a domain → real delivery only, no other changes.
2. AI scraping stays in-worker (Workers AI / Llama). Mapping isolated behind one function
   so a Python microservice (pandas+LLM on DigitalOcean) is a drop-in swap if Llama is
   flaky (same req/resp contract). NOT building Python service now. Group column →
   best-effort auto-create groups.
3. /dashboard unregistered (wallet + no org) → AUTO-REDIRECT to /onboarding (escapable:
   disconnect + back-to-site link; never fires once org exists). No-wallet → ConnectPrompt.
4. Step 1 = name only. Logo deferred (paste later).

## Env / config to add
- Worker: AI binding; secrets RESEND_API_KEY, RESEND_FROM (default onboarding@resend.dev),
  VERIFICATION_SALT; var EMAIL_DEV_MODE (true for now).
- Note: DB migration + new bindings must be applied by user (Hyperdrive/CF account). I write
  schema+SQL+code; user runs drizzle-kit migration & sets secrets & deploys.

## Suggested build order
A. Backend schema + 4 endpoints + bindings (testable via curl).
B. FE api.ts methods + csv.ts utils.
C. Wizard shell + connect-step (gets redirect working end-to-end).
D. import-step (the big one). E. email-step. F. done + polish.

## Review — DONE
- Backend (sweem-server): schema +email/+email_verified_at/+employees.email/+email_verifications
  table (migration 0001_clever_prima.sql generated). New endpoints: POST /v1/ai/map-csv
  (Workers AI Llama, heuristic-first), POST /v1/orgs/:w/employees/bulk (dedupe + group
  auto-create), POST /v1/orgs/:w/email/start + /confirm (OTP hashed + Resend, EMAIL_DEV_MODE
  returns code). AI binding + email vars in wrangler.jsonc. tsc clean, 31 tests pass.
- FE (fe): /onboarding wizard (chrome+stepper+connect/import/email/done steps), api.ts
  methods, csv.ts (papaparse+normalize+isValidSuiAddress), shadcn Select earlier, dashboard
  auto-redirect for unregistered orgs (CreateOrgCard removed). Build clean.
- Protocol logos: ProtocolLogo component → ProtocolRow + YieldChip (fe) and ProtocolRow
  (employee, images copied to employee/public). Both build clean.

## USER MUST RUN (needs CF account / DB)
1. Apply DB migration:  cd sweem-server && bun run db:migrate   (or psql the 0001 SQL)
2. Resend secret (optional now, EMAIL_DEV_MODE=true returns code in API meanwhile):
     wrangler secret put RESEND_API_KEY --env mainnet
     wrangler secret put VERIFICATION_SALT --env mainnet
   When a verified domain exists: set RESEND_FROM + flip EMAIL_DEV_MODE off in wrangler.jsonc.
3. Deploy worker (registers AI binding): cd sweem-server && bun run deploy
4. Workers AI must be enabled on the CF account (free tier ok).
