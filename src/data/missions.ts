export type SolutionPath = {
  id: string;
  label: string;
  emoji: string;
  success: string; // {name} is replaced with the monster's name
};

export type Mission = {
  id: string;
  title: string;
  emoji: string;
  tagline: string; // one line shown on the quest-select card
  prompt: string; // short, read aloud
  paths: SolutionPath[];
};

// Veggie-creature quests. Two design rules:
// 1) The CHILD chooses the quest AND the approach (self-direction) — no wrong answers.
// 2) Every path is a different creative idea the creature acts out (divergent thinking).
export const MISSIONS: Mission[] = [
  {
    id: "garden",
    title: "Wake the Sleepy Garden",
    emoji: "🌻",
    tagline: "The garden won't wake up!",
    prompt: "Oh no — the veggie garden is fast asleep! How will you two wake it up?",
    paths: [
      { id: "dance", label: "Sunshine dance", emoji: "☀️", success: "{name} wiggle-danced and the garden stretched awake, giggling!" },
      { id: "song", label: "Good-morning song", emoji: "🎵", success: "{name} sang la-la-laaa — every veggie popped up to join the chorus!" },
      { id: "rain", label: "Sprinkle a rain shower", emoji: "💧", success: "Splash-splash! {name} made it drizzle and the garden woke up fresh!" },
      { id: "tickle", label: "Tickle the leaves", emoji: "🪶", success: "Tee-hee! {name} tickled every leaf and the garden burst out laughing!" },
    ],
  },
  {
    id: "party",
    title: "The Veggie Party",
    emoji: "🎉",
    tagline: "Friends are coming over!",
    prompt: "The veggie friends are coming to play! What surprise will you two make for the party?",
    paths: [
      { id: "band", label: "A crunchy veggie band", emoji: "🥁", success: "{name} drummed on a pumpkin and shook carrot shakers — best band ever!" },
      { id: "tower", label: "A giant veggie tower", emoji: "🗼", success: "{name} stacked veggies sky-high — whoa, don't wobble!" },
      { id: "crowns", label: "Leafy crowns for everyone", emoji: "👑", success: "{name} made leaf crowns and everyone became veggie royalty!" },
      { id: "show", label: "A silly shadow show", emoji: "🎭", success: "{name} made funny veggie shadows on the wall — the friends laughed and clapped!" },
    ],
  },
];

export const missionById = (id: string) => MISSIONS.find((m) => m.id === id);
