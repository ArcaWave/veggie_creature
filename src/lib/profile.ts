// Visitor profile created at the start of each booth session.
// Holds the parent's email, consent flags, and an id used for per-profile
// rate limiting and analytics.
export type Profile = {
  id: string;
  email: string;
  childName?: string;
  consentPhoto: boolean; // required: AI photo processing (Google)
  consentData: boolean; // required: usage data collection
  newsletter: boolean; // marketing opt-in
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
