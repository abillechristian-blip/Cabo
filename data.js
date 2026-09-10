// Wayne Gang — static data: rooms, games, shot roulette segments

export const ROOMS = {
  1: { id: 1, label: "Room 1", color: "#FFCD00", members: ["Christian", "Jerome", "JR"] },
  2: { id: 2, label: "Room 2", color: "#2F6FED", members: ["John", "Jules"] },
  3: { id: 3, label: "Room 3", color: "#E5383B", members: [] },
};

// "simple" = one big log button
// "wheel"  = spin the wheel, then log the result (binding, no respin)
// "multi"  = several independent sub-games sharing one card (Swim-Up Bar Circuit)
export const GAMES = [
  {
    id: "marias-pick",
    name: "Maria's Pick",
    type: "simple",
    subtitle: "Her drink of choice — most by Monday wins.",
  },
  {
    id: "jules-pick",
    name: "Jules's Pick",
    type: "simple",
    subtitle: "His drink of choice — most by Monday wins.",
  },
  {
    id: "shot-roulette",
    name: "Shot Roulette",
    type: "wheel",
    subtitle: "Spin it, drink it. No respins.",
    segments: ["Tequila", "Whiskey", "Vodka", "Rum", "Mezcal", "Mystery Shot"],
  },
  {
    id: "swim-up-bar",
    name: "Swim-Up Bar Circuit",
    type: "multi",
    subtitle: "Five bars, five separate contests.",
    subGames: [
      { id: "la-iguana", name: "La Iguana" },
      { id: "tequila-bar", name: "Tequila" },
      { id: "mezcal-bar", name: "Mezcal" },
      { id: "mezcalito-bar", name: "Mezcalito" },
      { id: "ushuaia-bar", name: "Ushuaia" },
    ],
  },
  {
    id: "boat-party",
    name: "Boat Party",
    type: "simple",
    subtitle: "Most drinks overall during the boat outing.",
  },
];

export const ADMIN_PIN = "4210";
