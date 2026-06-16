export type Bindings = {
  DB: Hyperdrive
  SUI_NETWORK: string
  // Comma-separated list of allowed CORS origins (browser clients). Optional;
  // defaults to http://localhost:3000 when unset.
  ALLOWED_ORIGIN?: string
}
