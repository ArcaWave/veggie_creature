import { useState } from "react";
import { saveProfile } from "../lib/profile";
import { track } from "../lib/analytics";

// Grown-up gate before the play starts: email (our "admission ticket" — doubles
// as the newsletter list), required consents, optional child name.
export function Profile({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [childName, setChildName] = useState("");
  const [consentPhoto, setConsentPhoto] = useState(false);
  const [consentData, setConsentData] = useState(false);
  const [newsletter, setNewsletter] = useState(true);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = emailOk && consentPhoto && consentData;

  function submit() {
    if (!ready) return;
    const p = saveProfile({
      email: email.trim(),
      childName: childName.trim() || undefined,
      consentPhoto,
      consentData,
      newsletter,
    });
    track("profile_created", { newsletter, hasChildName: !!childName.trim(), profileId: p.id });
    onDone();
  }

  return (
    <div className="screen profile">
      <div className="profile-card">
        <h2>👋 Grown-ups first!</h2>
        <p className="profile-sub">30 seconds, then the fun begins.</p>

        <label className="field">
          <span>Parent email *</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoFocus
          />
        </label>

        <label className="field">
          <span>Child's first name (optional)</span>
          <input value={childName} onChange={(e) => setChildName(e.target.value)} placeholder="Alex" maxLength={20} />
        </label>

        <label className="check">
          <input type="checkbox" checked={consentPhoto} onChange={(e) => setConsentPhoto(e.target.checked)} />
          <span>
            I'm a parent/guardian. Photos taken here are processed by AI (Google) to create the character, then
            discarded from the AI service. *
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={consentData} onChange={(e) => setConsentData(e.target.checked)} />
          <span>I agree to usage data collection to improve Monggle Kids. *</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} />
          <span>Send me the Monggle Kids newsletter (unsubscribe anytime).</span>
        </label>

        <button className="btn-primary big" disabled={!ready} onClick={submit}>
          Let's play! →
        </button>
      </div>
    </div>
  );
}
