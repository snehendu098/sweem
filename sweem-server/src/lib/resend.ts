import type { Bindings } from '../env/bindings'

// Minimal Resend client. Best-effort: returns false (never throws) when no API
// key is configured or the send fails, so onboarding isn't blocked in dev.
export async function sendOtpEmail(
  env: Bindings,
  to: string,
  code: string,
): Promise<{ sent: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { sent: false, error: 'no_api_key' }

  const from = env.RESEND_FROM || 'Sweem <onboarding@resend.dev>'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: `Your Sweem verification code: ${code}`,
        html: otpHtml(code),
      }),
    })
    if (!res.ok) return { sent: false, error: `resend_${res.status}` }
    return { sent: true }
  } catch (e) {
    return { sent: false, error: (e as Error).message }
  }
}

function otpHtml(code: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:32px;color:#0f0f0f">
  <h2 style="margin:0 0 8px;font-size:18px">Verify your email</h2>
  <p style="margin:0 0 24px;color:#555;font-size:14px">Enter this code in Sweem to confirm your organization's email. It expires in 10 minutes.</p>
  <div style="font-size:34px;font-weight:700;letter-spacing:8px;background:#f4f4f5;border-radius:12px;padding:16px;text-align:center">${code}</div>
  <p style="margin:24px 0 0;color:#999;font-size:12px">If you didn't request this, you can ignore this email.</p>
</div>`
}
