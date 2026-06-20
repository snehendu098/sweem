export type Bindings = {
  DB: Hyperdrive
  SUI_NETWORK: string
  // Comma-separated list of allowed CORS origins (browser clients). Optional;
  // defaults to http://localhost:3000 when unset.
  ALLOWED_ORIGIN?: string

  // Workers AI binding — infers CSV column → employee-field mapping during
  // onboarding import. Add `"ai": { "binding": "AI" }` to wrangler.jsonc.
  AI: Ai

  // Email (Resend) + OTP verification config.
  RESEND_API_KEY?: string    // secret; if unset, real send is skipped
  RESEND_FROM?: string       // e.g. "Sweem <onboarding@resend.dev>"
  VERIFICATION_SALT?: string // secret; salts the OTP hash
  // When "true", the OTP is returned in the API response (send still attempted)
  // so the flow is demoable without a verified sending domain. Flip off in prod.
  EMAIL_DEV_MODE?: string
}
