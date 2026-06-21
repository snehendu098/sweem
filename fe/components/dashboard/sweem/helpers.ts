import type { Employee } from "@/lib/api";
import type { TokenSymbol } from "@/lib/tokens";

// Monthly rate for an employee in a given token (defaults to USDC).
// NOTE: the backend returns numeric columns as strings, coerce with Number().
export function monthlyRate(e: Employee, token: TokenSymbol = "USDC"): number {
  const r = e.rates.find((x) => x.token === token);
  return r ? Number(r.rateAmount) || 0 : 0;
}

// All non-zero monthly rates for an employee, keyed by token symbol.
export function ratesByToken(e: Employee): Partial<Record<TokenSymbol, number>> {
  const out: Partial<Record<TokenSymbol, number>> = {};
  for (const r of e.rates) {
    const amt = Number(r.rateAmount) || 0;
    if (amt > 0) out[r.token as TokenSymbol] = amt;
  }
  return out;
}

export const NANO = 1_000_000_000n;

// Format nano-USDC (1e-9 USDC, bigint) as "int.fffffffff" (9 decimals).
export function formatNano(nano: bigint): string {
  return `${nano / NANO}.${(nano % NANO).toString().padStart(9, "0")}`;
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
