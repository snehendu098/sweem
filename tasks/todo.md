# Dashboard → dark bento look, Sweem-branded, real data

Goal: replace present Sweem dashboard look with dark bento aesthetic (dark + mint/lavender),
rebrand template→Sweem, keep ALL present features wired (on-chain + API), full-screen,
optimized bento. End-to-end functional.

## Tasks
- [x] Scoped `.rv-dash` dark theme + legacy-class overrides (Payroll/Employees/Portal/
      placeholders go dark, no logic change)
- [x] Rewrite shell: dashboard-layout, sidebar, navbar, wallet-button (Sweem dark,
      full-screen, Sweem brand; keep nav items + wallet connect/disconnect/copy)
- [x] Rebuild Overview (org-home) as Sweem bento wired to real useOrgPool data:
      live streamed ticker, pool composition donut, per-employee analytics bars,
      recent on-chain activity, yields, create-org gate, Fund/Employees/Portal CTAs
- [x] Keep providers.tsx + dashboard/layout.tsx (react-query + Sui wallet) untouched
- [x] Verify: tsc + next build clean; /dashboard + feature routes render (all 200)

## Review
- Shell rewritten to full-screen Sweem dark (h-screen flex, sidebar + topbar + scroll main).
  Sweem brand, real nav items + routes, wallet connect/disconnect/copy preserved.
- Overview = Sweem bento on REAL data (useOrgPool/useSweemApi/readRecentActivity): live
  streamed ticker, pool composition, monthly-payroll recharts bars, recent on-chain
  activity w/ explorer links, live Navi/Scallop APY, connect + create-org gates,
  Fund-payroll green CTA. Reuses components/bento primitives + grid + motion.
- Other feature screens (Payroll/Employees/Portal/placeholders) inherit dark via
  `.rv-dash` legacy overrides in globals.css — zero logic change, fully functional.
- Caught: CSS comment `*/` inside `.dashboard-*/.sweem-*` closed the comment early →
  dev 500. Fixed by rewording. tsc + next build clean; routes 200.
- NOT committed. No browser tool to screenshot — review at localhost:3000/dashboard.

## Notes
- Accent colors kept; only brand text/logo → Sweem.
- Bento primitives reused from components/bento/*.
