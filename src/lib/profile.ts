// Visitor profile created at the start of each booth session.
// Holds the parent's email, consent flags, and an id used for per-profile
// rate limiting and analytics.
export type Profile = {
  id: string;
  email: string; // collected at the END (certificate "Email me!"); "" until then
  childName?: string;
  consentPhoto: boolean; // required: AI photo processing (Google)
  consentData: boolean; // required: usage data collection
  newsletter: boolean; // marketing opt-in (asked alongside the email)
  createdAt: number;
};

const KEY = "mk.profile.v1";
let cached: Profile | null = null;

export function saveProfile(p: Omit<Profile, "id" | "createdAt">): Profile {
  const full: Profile = {
    ...p,
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  cached = full;
  try {
    localStorage.setItem(KEY, JSON.stringify(full));
    // keep a device-local roster of all profiles for the staff export
    const all = JSON.parse(localStorage.getItem(KEY + ".all") || "[]");
    all.push(full);
    localStorage.setItem(KEY + ".all", JSON.stringify(all));
  } catch {
    /* storage full — session continues in memory */
  }
  // durable server-side copy (consented; graceful no-op when no store is connected)
  fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mk-profile": full.id },
    body: JSON.stringify({ kind: "profile", profile: full }),
  }).catch(() => {});
  return full;
}

// silent anonymous profile created at Start — links the session's assets,
// events and rate limits; the real details arrive at the end (Email me!)
export function ensureProfile(): Profile {
  const existing = getProfile();
  if (existing) return existing;
  return saveProfile({ email: "", consentPhoto: false, consentData: false, newsletter: false });
}

// called from the certificate's "Email me!" popup: email + child name +
// the consents are recorded here (merged into the session profile)
export function completeProfile(details: { email: string; childName?: string; newsletter: boolean }) {
  const p = getProfile() ?? ensureProfile();
  const next: Profile = {
    ...p,
    email: details.email,
    childName: details.childName || p.childName,
    newsletter: details.newsletter,
    consentPhoto: true,
    consentData: true,
  };
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    const all: Profile[] = JSON.parse(localStorage.getItem(KEY + ".all") || "[]");
    const i = all.findIndex((x) => x.id === next.id);
    if (i >= 0) all[i] = next;
    else all.push(next);
    localStorage.setItem(KEY + ".all", JSON.stringify(all));
  } catch {
    /* best effort */
  }
  // overwrite the server-side profile with the completed details
  fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mk-profile": next.id },
    body: JSON.stringify({ kind: "profile", profile: next }),
  }).catch(() => {});
}

export function getProfile(): Profile | null {
  if (cached) return cached;
  try {
    cached = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    cached = null;
  }
  return cached;
}

export function clearProfile() {
  cached = null;
  localStorage.removeItem(KEY);
}

export function allProfiles(): Profile[] {
  try {
    return JSON.parse(localStorage.getItem(KEY + ".all") || "[]");
  } catch {
    return [];
  }
}
