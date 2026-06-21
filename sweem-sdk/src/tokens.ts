// Tokens the SDK can accept. Mainnet types — mirror of the dashboard registry.

export type TokenSymbol = "USDC" | "SUI";

export interface TokenConfig {
  symbol: TokenSymbol;
  coinType: string; // full Move type for the transfer + balance calls
  decimals: number;
  icon: string; // remote logo URL (no local assets in a published package)
}

export const TOKENS: Record<TokenSymbol, TokenConfig> = {
  USDC: {
    symbol: "USDC",
    coinType:
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    decimals: 6,
    icon: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
  },
  SUI: {
    symbol: "SUI",
    coinType:
      "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
    decimals: 9,
    icon: "https://assets.coingecko.com/coins/images/26375/small/sui-ocean-square.png",
  },
};

export const SUPPORTED_TOKENS = Object.values(TOKENS);

export function toRaw(token: TokenConfig, amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** token.decimals));
}
