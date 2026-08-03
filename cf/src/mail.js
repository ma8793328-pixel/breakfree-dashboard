// Minimal Resend email wrapper. No-op (skips silently) when RESEND_API_KEY is
// unset so local/dev runs and the Node parity server work without a key.

export async function sendEmail(env, { to, subject, html, text }) {
  const key = env?.RESEND_API_KEY;
  if (!key) {
    console.log(`[mail] RESEND_API_KEY not set — skipped "${subject}" to ${to}`);
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.RESEND_FROM || 'BreakFree <onboarding@resend.dev>',
      to,
      subject,
      html,
      ...(text ? { text } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}
