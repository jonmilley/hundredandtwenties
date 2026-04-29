import './style.css';
import { Suit } from './game/cards';
import {
  dealHand,
  discardAndDraw,
  getLegalBidOptions,
  makeInitialState,
  playCard,
  resolveScorePhase,
  setTrumpAndTakeKitty,
  submitBidAction,
} from './game/flow';
import { GameState, HUMAN_SEAT, Phase, Seat } from './game/state';
import {
  aiBid,
  aiBidderDiscard,
  aiNonBidderDiscard,
  aiPickCard,
  pickBestTrump,
} from './ai/index';
import { Renderer, UICallbacks } from './ui/render';

const AI_BID_DELAY_MS = 850;
const AI_CARD_DELAY_MS = 800;
const AI_DISCARD_DELAY_MS = 500;
const TRICK_WINNER_PAUSE_MS = 1300;

const appEl = document.getElementById('app')!;

let state: GameState = makeInitialState(Date.now());
let pendingTrump: Suit | null = null;

/** Read phase fresh (avoids TS narrowing sticking after mutations). */
const ph = (): Phase => state.phase;

const callbacks: UICallbacks = {
  onCardClick(seat, idx) {
    if (ph() !== 'play' || state.toAct !== HUMAN_SEAT) return;
    const card = state.hands[HUMAN_SEAT][idx];
    if (!card) return;
    const tricksBefore = state.completedTricks.length;
    try {
      playCard(state, seat, card);
    } catch (err) {
      renderer.showToast(String(err));
      return;
    }
    const trickJustCompleted = state.completedTricks.length > tricksBefore;
    const winner = trickJustCompleted
      ? state.completedTricks[state.completedTricks.length - 1]!.winner
      : undefined;
    renderer.render(state, { trickWinner: winner });
    if (trickJustCompleted && ph() === 'play') {
      // Pause to show the trick winner, then let AI lead (skipping its initial delay).
      setTimeout(() => { if (ph() === 'play') scheduleAIPlay(true); }, TRICK_WINNER_PAUSE_MS);
    } else if (ph() === 'play') {
      scheduleAIPlay();
    }
  },

  onBidClick(option) {
    if (ph() !== 'bid' || !state.bidding) return;
    const legal = getLegalBidOptions(state);
    if (!legal.includes(option as (typeof legal)[number])) return;
    submitBidAction(state, HUMAN_SEAT, option as Parameters<typeof submitBidAction>[2]);
    renderer.render(state);
    if (ph() === 'kitty') {
      if (state.contract?.bidder !== HUMAN_SEAT) scheduleAIKitty();
    } else if (ph() === 'bid') {
      scheduleAIBid();
    }
  },

  onTrumpClick(suit) {
    if (ph() !== 'kitty') return;
    pendingTrump = suit;
    renderer.showTrumpSelectedKittyModal(state, suit);
  },

  onKittyConfirm(discards) {
    if (!pendingTrump || ph() !== 'kitty') return;
    setTrumpAndTakeKitty(state, pendingTrump, discards);
    pendingTrump = null;
    renderer.render(state);
    if (ph() === 'discard') scheduleAIDiscard();
  },

  onDiscardConfirm(seat, discards) {
    if (ph() !== 'discard') return;
    discardAndDraw(state, seat, discards);
    renderer.render(state);
    if (ph() === 'discard') scheduleAIDiscard();
    else if (ph() === 'play') scheduleAIPlay();
  },

  onDealClick() {
    if (ph() === 'gameOver') {
      state = makeInitialState(Date.now());
    }
    dealHand(state);
    renderer.render(state, { dealAnimation: true });
    scheduleAIBid();
  },

  onScoreClose() {
    if (ph() !== 'score') return;
    resolveScorePhase(state);
    renderer.render(state);
  },

  onIntroClose() {
    if (ph() !== 'intro') return;
    state.phase = 'deal';
    renderer.render(state);
  },
};

const renderer = new Renderer(appEl, callbacks);
renderer.render(state);

// ---- AI turn scheduling ----

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function scheduleAIBid(): Promise<void> {
  while (ph() === 'bid' && state.bidding && !state.bidding.done) {
    const bidder = state.bidding.order[state.bidding.cursor];
    if (bidder === undefined || bidder === HUMAN_SEAT) break;
    await delay(AI_BID_DELAY_MS);
    if (ph() !== 'bid') break;
    const option = aiBid(state, bidder);
    submitBidAction(state, bidder, option);
    renderer.render(state);
  }
  if (ph() === 'kitty' && state.contract) {
    if (state.contract.bidder !== HUMAN_SEAT) scheduleAIKitty();
  }
}

async function scheduleAIKitty(): Promise<void> {
  await delay(AI_BID_DELAY_MS);
  if (ph() !== 'kitty' || !state.contract) return;
  const bidder = state.contract.bidder;
  if (bidder === HUMAN_SEAT) return;
  const { suit } = pickBestTrump(state.hands[bidder]);
  const discards = aiBidderDiscard(state.hands[bidder], state.kitty, suit);
  setTrumpAndTakeKitty(state, suit, discards);
  renderer.render(state);
  if (ph() === 'discard') scheduleAIDiscard();
  else if (ph() === 'play') scheduleAIPlay();
}

async function scheduleAIDiscard(): Promise<void> {
  while (ph() === 'discard' && state.discardQueue.length > 0) {
    const seat = state.discardQueue[0] as Seat;
    if (seat === HUMAN_SEAT) break;
    await delay(AI_DISCARD_DELAY_MS);
    if (ph() !== 'discard') break;
    const discards = aiNonBidderDiscard(state.hands[seat], state.trump!);
    discardAndDraw(state, seat, discards);
    renderer.render(state);
  }
  if (ph() === 'play') scheduleAIPlay();
}

async function scheduleAIPlay(skipInitialDelay = false): Promise<void> {
  let skipDelay = skipInitialDelay;
  while (ph() === 'play' && state.toAct !== null) {
    const seat = state.toAct;
    if (seat === HUMAN_SEAT) break;
    if (!skipDelay) await delay(AI_CARD_DELAY_MS);
    skipDelay = false;
    if (ph() !== 'play' || state.toAct !== seat) break;
    const tricksBefore = state.completedTricks.length;
    const card = aiPickCard(state, seat);
    playCard(state, seat, card);
    const trickJustCompleted = state.completedTricks.length > tricksBefore;
    const winner = trickJustCompleted
      ? state.completedTricks[state.completedTricks.length - 1]!.winner
      : undefined;
    renderer.render(state, { trickWinner: winner });
    if (trickJustCompleted && ph() === 'play') {
      await delay(TRICK_WINNER_PAUSE_MS);
      skipDelay = true; // The pause IS the gap; don't add another delay before the lead.
    }
  }
}
