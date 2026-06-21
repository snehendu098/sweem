export type Bindings = {
  DB: Hyperdrive
  SUI_NETWORK: string
  ALLOWED_ORIGIN?: string
  AI: Ai
  ATTACHMENTS: R2Bucket
  RESEND_API_KEY?: string
  RESEND_FROM?: string
  VERIFICATION_SALT?: string
  EMAIL_DEV_MODE?: string
}
