# Migrate employee portal → standalone `employee/` app

Goal: standalone Next.js app at `employee/` containing the full employee portal. Slim top-bar chrome (wallet connect), no org sidebar. `fe/` keeps its copies (shared libs copied, not moved).

Key fact: `employee` alias `@/*` → `./src/*`. So all `@/...` and relative imports copy VERBATIM as long as layout under `src/` mirrors `fe/` root. Portal becomes the app's root route (`src/app/page.tsx`).

## Steps

- [ ] 1. package.json: add deps from fe (@mysten/dapp-kit, @mysten/sui, @tanstack/react-query, framer-motion, lucide-react, radix-ui, recharts, sonner, lenis, clsx, tailwind-merge). Align next/react versions to fe.
- [ ] 2. next.config.ts: add turbopack root pin (HMR fix, same as fe).
- [ ] 3. Copy libs → `src/lib/`: utils.ts, format.ts, api.ts, sweem.ts, tx.ts
- [ ] 4. Copy shared UI:
      - `src/components/sweem-ui/`: primitives.tsx, use-mounted.ts, motion.ts
      - `src/components/dashboard/`: icons.tsx, dashboard-screen.tsx, providers.tsx, wallet-button.tsx
      - `src/components/dashboard/sweem/`: employee-portal-screen.tsx, ui.tsx, live-ticker.tsx, helpers.ts
      - `src/components/ui/`: scroll-area.tsx
      - `src/components/providers/`: smooth-scroll.tsx
- [ ] 5. Copy `app/globals.css` → `src/app/globals.css` VERBATIM (3053 lines; `.sw-dash`-scoped `--sw-*` theme vars are critical).
- [ ] 6. NEW `src/components/dashboard/employee-shell.tsx`: client; = dashboard-layout MINUS sidebar/scrim. Keeps `.sw-dash` wrapper + ambient glow + ScrollArea. Wraps DashboardProviders + slim navbar + Toaster.
- [ ] 7. NEW slim navbar (or trim navbar.tsx): brand + WalletButton (+ Support/Feedback). Drop sidebar menu toggle.
- [ ] 8. Rewrite `src/app/layout.tsx`: fonts (Poppins/Geist/Inter), globals.css, metadata, SmoothScroll → EmployeeShell.
- [ ] 9. Rewrite `src/app/page.tsx`: `<EmployeePortalScreen />`.
- [ ] 10. `.env.local` / note: NEXT_PUBLIC_NETWORK=mainnet, NEXT_PUBLIC_API_BASE (has default).
- [ ] 11. Verify: `bun install` + `bun run build` in `employee/`. Fix type/import errors.

## NOT copied (org-only): sidebar.tsx, dashboard-layout.tsx, org-home.tsx, payroll/employees screens, navbar.tsx (replaced by slim).

## Review
- DONE. Standalone `employee/` app builds clean (`bun run build`, next 16.2.7) and
  serves `/` → 200 with `.sw-dash` theme + Sweem brand + wallet connect rendering.
- 21 files copied verbatim into `src/` (alias `@/*`→`./src/*` made imports resolve as-is).
- New: employee-shell.tsx (dashboard-layout minus sidebar/scrim, keeps .sw-dash + glow +
  scroll), employee-navbar.tsx (slim: brand + Support/Feedback + wallet). layout.tsx
  (fonts + SmoothScroll + EmployeeShell), page.tsx (EmployeePortalScreen).
- Configs: package.json (fe runtime deps incl. shadcn + tw-animate-css, versions aligned),
  next.config.ts (turbopack root pin), tsconfig target ES2017→ES2020 (BigInt literals),
  .env.local (NEXT_PUBLIC_NETWORK=mainnet + API_BASE).
- Gotchas hit: missing tw-animate-css + shadcn (globals.css @imports); ES2017 target broke
  BigInt literals in tx readers.
- fe/ untouched — shared libs copied, not moved. NOT committed.
