export type Monster = {
  name: string;
  photo: string; // data URL (clay or original photo)
  eyes: { x: number; y: number }[]; // eye positions over the photo (0~1)
  traits: string[]; // picked during the wake wait (e.g. Silly · Carrots · Bounce)
};
