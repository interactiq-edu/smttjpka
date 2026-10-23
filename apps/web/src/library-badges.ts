export interface LibraryBadge {
  id: number;
  name: string;
  symbol: string;
  start: string;
  end: string;
}

const badgeNames = [
  ['Books', '📚'], ['Science', '🧪'], ['Code', '💻'], ['Languages', '🗣️'], ['Art', '🎨'],
  ['Mathematics', '📐'], ['Geography', '🌍'], ['Music', '🎵'], ['History', '🏛️'], ['Ideas', '💡'],
  ['Reading', '📖'], ['Nature', '🌿'], ['Space', '🚀'], ['Robotics', '🤖'], ['Puzzle', '🧩'],
  ['Writing', '✏️'], ['Sports', '🏅'], ['Health', '💗'], ['Business', '💼'], ['Photography', '📷'],
  ['Video', '🎬'], ['Presentation', '📊'], ['Quiz', '❓'], ['Assignment', '📝'], ['Achievement', '🏆'],
  ['Ocean', '🐬'], ['Garden', '🌸'], ['Technology', '⚡'], ['Creative', '✨'], ['World', '🗺️'],
] as const;

const palettes = [
  ['#c9eaff', '#376af2'], ['#d5fff1', '#00a9a0'], ['#e5d4ff', '#6749cc'],
  ['#ffe1ec', '#e76298'], ['#fff0c5', '#ec8d41'], ['#d8edff', '#168bc5'],
] as const;

export const libraryBadges: LibraryBadge[] = badgeNames.map(([name, symbol], index) => ({
  id: index + 1,
  name,
  symbol,
  start: palettes[index % palettes.length]![0],
  end: palettes[index % palettes.length]![1],
}));

export const libraryBadge = (id: number | null | undefined): LibraryBadge =>
  libraryBadges.find((badge) => badge.id === id) ?? libraryBadges[0]!;
