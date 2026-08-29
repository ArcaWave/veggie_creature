export type Monster = {
  name: string;
  photo: string; // data URL (clay or original photo)
  eyes: { x: number; y: number }[]; // eye positions over the photo (0~1)
  traits: string[]; // picked during the wake wait (e.g. Silly · Carrots · Bounce)
};

// The two greeting loops made during "wake". `greet` (wave hello) plays while the
// child is invited to wave back; `smile` (smile & talk) plays during the dialogue.
// Either may be null when the AI key/generation is unavailable (eyes-fallback path).
export type MonsterVideos = {
  greet: string | null;
  smile: string | null;
};
