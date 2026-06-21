import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toRaw, type TokenConfig } from "./tokens";

// Build a direct token transfer from the connected customer wallet to the
// merchant's receiving address. `coinWithBalance` handles coin selection +
// gas-coin splitting for native SUI automatically.
export function buildPaymentTx(opts: {
  token: TokenConfig;
  amount: number;
  recipient: string;
}): Transaction {
  const { token, amount, recipient } = opts;
  const tx = new Transaction();
  const coin = coinWithBalance({ type: token.coinType, balance: toRaw(token, amount) });
  tx.transferObjects([coin], tx.pure.address(recipient));
  return tx;
}
