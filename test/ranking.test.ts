import { describe, it, expect } from 'vitest';
import { Card, Suit } from '../src/game/cards';
import { trumpPower, nonTrumpPower, trickWinnerIndex, isTrump } from '../src/game/ranking';

const c = (rank: Card['rank'], suit: Suit): Card => ({ rank, suit });

describe('trumpPower', () => {
  it('orders the top six trumps when trump is diamonds', () => {
    const order: Card[] = [
      c('5', 'D'),
      c('J', 'D'),
      c('A', 'H'),
      c('A', 'D'),
      c('K', 'D'),
      c('Q', 'D'),
    ];
    const powers = order.map((card) => trumpPower(card, 'D')!);
    for (let i = 0; i < powers.length - 1; i++) {
      expect(powers[i]).toBeGreaterThan(powers[i + 1]!);
    }
  });

  it('AH and trump-A collapse when hearts is trump', () => {
    expect(trumpPower(c('A', 'H'), 'H')).toBe(98);
  });

  it('non-trumps return null', () => {
    expect(trumpPower(c('K', 'C'), 'D')).toBeNull();
    expect(trumpPower(c('A', 'S'), 'D')).toBeNull();
  });

  it('AH is always trump', () => {
    expect(trumpPower(c('A', 'H'), 'C')).not.toBeNull();
    expect(trumpPower(c('A', 'H'), 'S')).not.toBeNull();
    expect(trumpPower(c('A', 'H'), 'D')).not.toBeNull();
  });

  it('red trump pip cards: higher pip wins', () => {
    expect(trumpPower(c('10', 'D'), 'D')!).toBeGreaterThan(trumpPower(c('9', 'D'), 'D')!);
    expect(trumpPower(c('3', 'D'), 'D')!).toBeGreaterThan(trumpPower(c('2', 'D'), 'D')!);
  });

  it('black trump pip cards: lower pip wins', () => {
    expect(trumpPower(c('2', 'C'), 'C')!).toBeGreaterThan(trumpPower(c('3', 'C'), 'C')!);
    expect(trumpPower(c('3', 'C'), 'C')!).toBeGreaterThan(trumpPower(c('10', 'C'), 'C')!);
  });

  it('Q of trump beats highest trump pip card', () => {
    expect(trumpPower(c('Q', 'D'), 'D')!).toBeGreaterThan(trumpPower(c('10', 'D'), 'D')!);
    expect(trumpPower(c('Q', 'C'), 'C')!).toBeGreaterThan(trumpPower(c('2', 'C'), 'C')!);
  });
});

describe('nonTrumpPower', () => {
  it('red non-trump: A K Q J 10 ... 2', () => {
    expect(nonTrumpPower(c('A', 'H'), 'H')).toBeGreaterThan(nonTrumpPower(c('K', 'H'), 'H'));
    expect(nonTrumpPower(c('10', 'H'), 'H')).toBeGreaterThan(nonTrumpPower(c('9', 'H'), 'H'));
    expect(nonTrumpPower(c('3', 'H'), 'H')).toBeGreaterThan(nonTrumpPower(c('2', 'H'), 'H'));
  });

  it('black non-trump: A K Q J 2 3 ... 10', () => {
    expect(nonTrumpPower(c('A', 'C'), 'C')).toBeGreaterThan(nonTrumpPower(c('K', 'C'), 'C'));
    expect(nonTrumpPower(c('J', 'C'), 'C')).toBeGreaterThan(nonTrumpPower(c('2', 'C'), 'C'));
    expect(nonTrumpPower(c('2', 'C'), 'C')).toBeGreaterThan(nonTrumpPower(c('3', 'C'), 'C'));
    expect(nonTrumpPower(c('9', 'C'), 'C')).toBeGreaterThan(nonTrumpPower(c('10', 'C'), 'C'));
  });

  it('off-suit returns -1', () => {
    expect(nonTrumpPower(c('A', 'S'), 'C')).toBe(-1);
  });
});

describe('trickWinnerIndex', () => {
  it('highest non-trump of led suit wins when no trumps', () => {
    const trump: Suit = 'C';
    const plays = [c('5', 'H'), c('A', 'H'), c('K', 'H'), c('2', 'H')];
    expect(trickWinnerIndex(plays, trump)).toBe(1);
  });

  it('any trump beats any non-trump of led suit', () => {
    const trump: Suit = 'D';
    // led is spades (a non-trump suit, AH not present); one diamond trump played
    const plays = [c('A', 'S'), c('2', 'D'), c('K', 'S'), c('Q', 'S')];
    expect(trickWinnerIndex(plays, trump)).toBe(1);
  });

  it('AH wins over plain trump pip when AH is played', () => {
    const trump: Suit = 'C';
    const plays = [c('K', 'C'), c('A', 'H'), c('2', 'C'), c('Q', 'C')];
    expect(trickWinnerIndex(plays, trump)).toBe(1);
  });

  it('5 of trump beats J of trump and AH', () => {
    const trump: Suit = 'S';
    const plays = [c('A', 'H'), c('J', 'S'), c('5', 'S'), c('Q', 'S')];
    expect(trickWinnerIndex(plays, trump)).toBe(2);
  });

  it('off-suit non-trump can never win', () => {
    const trump: Suit = 'D';
    const plays = [c('2', 'C'), c('A', 'S'), c('A', 'H')]; // led is clubs; AH is trump and wins
    expect(trickWinnerIndex(plays, trump)).toBe(2);
  });
});

describe('isTrump', () => {
  it('AH is always trump', () => {
    expect(isTrump(c('A', 'H'), 'C')).toBe(true);
  });
  it('non-trump suit is not trump', () => {
    expect(isTrump(c('K', 'D'), 'C')).toBe(false);
  });
});
