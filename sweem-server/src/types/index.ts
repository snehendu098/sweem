import type { Bindings } from '../env/bindings'

export type AppEnv = { Bindings: Bindings }

export type AuthEnv = {
  Bindings: Bindings
  Variables: { walletAddress: string }
}

export type ApiError = {
  error: string
  message: string
}
