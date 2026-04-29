export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';

export const SUITS: readonly Suit[] = ['H', 'D', 'C', 'S'] as const;
export const RANKS: readonly Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'] as const;

export type Card = { suit: Suit; rank: Rank };

export const isRedSuit = (s: Suit): boolean => s === 'H' || s === 'D';

export const cardId = (c: Card): string => `${c.rank}${c.suit}`;

export const eqCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

export const isAceOfHearts = (c: Card): boolean => c.suit === 'H' && c.rank === 'A';

export const SUIT_LABELS: Record<Suit, string> = {
  H: 'Hearts',
  D: 'Diamonds',
  C: 'Clubs',
  S: 'Spades',
};

export const SUIT_GLYPHS: Record<Suit, string> = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠',
};

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}
