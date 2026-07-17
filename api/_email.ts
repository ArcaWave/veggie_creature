// Keepsake email sender via Resend (https://resend.com — free tier 3k/month).
// Setup: create a Resend account, verify your sending domain, then set
//   RESEND_API_KEY  and  EMAIL_FROM (e.g. "Veggie Creature <hello@mongglekids.com>")
// Without the key this degrades gracefully to { sent:false, reason:"no_email_key" }.
type Attachment = { filename: string; dataUrl: string };

export type EmailResult = { sent: boolean; reason?: string; detail?: string };

export async function sendKeepsakes(
  to: string,
  monsterName: string,
  attachments: Attachment[]
): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY || "";
  if (!key) return { sent: false, reason: "no_email_key" };
  const from = process.env.EMAIL_FROM || "Veggie Creature <onboarding@resend.dev>";

  const files = attachments
    .map((a) => {
      const m = /^data:(.+?);base64,(.*)$/s.exec(a.dataUrl || "");
      return m ? { filename: a.filename, content: m[2] } : null;
    })
    .filter(Boolean);
  if (files.length === 0) return { sent: false, reason: "no_attachments" };

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `🥦 ${monsterName} is alive! Your Veggie Creature keepsakes`,
        html:
          `<div style="font-family:sans-serif;line-height:1.6">` +
          `<h2>🎉 ${escapeHtml(monsterName)} completed the quest!</h2>` +
          `<p>Your keepsakes are attached — the certificate, the clay artwork` +
          `${files.length > 2 ? ", and the little movie of it coming to life" : ""}. Enjoy!</p>` +
          `<p style="color:#888">— Monglekids · Veggie Creature</p></div>`,
        attachments: files,
      }),
    });
    if (!r.ok) return { sent: false, reason: "provider_error", detail: (await r.text()).slice(0, 300) };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: "network_error", detail: String((e as Error)?.message ?? e) };
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
