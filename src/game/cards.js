export const SUITS = ['H', 'D', 'C', 'S'];
export const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
export const isRedSuit = (s) => s === 'H' || s === 'D';
export const cardId = (c) => `${c.rank}${c.suit}`;
export const eqCard = (a, b) => a.suit === b.suit && a.rank === b.rank;
export const isAceOfHearts = (c) => c.suit === 'H' && c.rank === 'A';
export const SUIT_LABELS = {
    H: 'Hearts',
    D: 'Diamonds',
    C: 'Clubs',
    S: 'Spades',
};
export const SUIT_GLYPHS = {
    H: '♥',
    D: '♦',
    C: '♣',
    S: '♠',
};
export function buildDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank });
        }
    }
    return deck;
}
export function shuffle(arr, rng = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
    return a;
}
