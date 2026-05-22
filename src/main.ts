import './style.css';
import { Suit } from './game/cards';
import {
  dealHand,
  discardAndDraw,
  getLegalBidOptions,
  makeInitialState,
  playCard,
  redealAfterPassout,
  resolveScorePhase,
  setTrumpAndTakeKitty,
  submitBidAction,
  chooseNormalKitty,
  chooseOneCardKitty,
  finalizeOneCardKittyKeep,
} from './game/flow';
import {
  GameState,
  HUMAN_SEAT,
  Phase,
  Seat,
  loadState,
  saveState,
  clearSavedState,
} from './game/state';
import {
  aiBid,
  aiBidderDiscard,
  aiNonBidderDiscard,
  aiPickCard,
  pickBestTrump,
} from './ai/index';
import { Renderer, UICallbacks } from './ui/render';

const AI_BID_DELAY_MS = 1100;
const AI_CARD_DELAY_MS = 800;
const AI_DISCARD_DELAY_MS = 500;
const TRICK_WINNER_PAUSE_MS = 1300;
const PASSOUT_MODAL_MS = 1800;
const AUTO_DEAL_DELAY_MS = 700;

const appEl = document.getElementById('app')!;

let state: GameState = loadState() || makeInitialState(Date.now());
let pendingTrump: Suit | null = null;

/** Read phase fresh (avoids TS narrowing sticking after mutations). */
const ph = (): Phase => state.phase;

/** Wrap renderer.render to also persist state. */
const render = (options: Parameters<Renderer['render']>[1] = {}) => {
  saveState(state);
  renderer.render(state, options);
};

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
    render({ trickWinner: winner });
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
    render();
    if (ph() === 'bid_on_kitty') {
      if (state.contract?.bidder !== HUMAN_SEAT) scheduleAIBidOnKitty();
    } else if (ph() === 'bid') {
      scheduleAIBid();
    } else if (ph() === 'passout') {
      schedulePassoutRedeal();
    }
  },

  onKittyOptionClick(option) {
    if (ph() !== 'bid_on_kitty') return;
    if (option === 'normal') {
      chooseNormalKitty(state);
    } else {
      chooseOneCardKitty(state);
    }
    render();
  },

  onKittyKeepClick(idx) {
    if (ph() !== 'bid_on_kitty' || !state.bidOnKitty) return;
    finalizeOneCardKittyKeep(state, idx);
    render();
    if (ph() === 'kitty' && state.contract?.bidder !== HUMAN_SEAT) scheduleAIKitty();
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
    render();
    if (ph() === 'discard') scheduleAIDiscard();
  },

  onDiscardConfirm(seat, discards) {
    if (ph() !== 'discard') return;
    discardAndDraw(state, seat, discards);
    render();
    if (ph() === 'discard') scheduleAIDiscard();
    else if (ph() === 'play') scheduleAIPlay();
  },

  onDealClick() {
    if (ph() === 'gameOver') {
      state = makeInitialState(Date.now());
    }
    dealAndStartBidding();
  },

  onScoreClose() {
    if (ph() !== 'score') return;
    resolveScorePhase(state);
    render();
    // Once the score is acknowledged, deal the next hand automatically (unless
    // the game just ended, in which case resolveScorePhase moved us to gameOver).
    if (ph() === 'deal') scheduleAutoDeal();
  },

  onIntroClose() {
    if (ph() !== 'intro') return;
    state.phase = 'deal';
    render();
  },

  onRestart() {
    clearSavedState();
    window.location.reload();
  },
};

const renderer = new Renderer(appEl, callbacks);

function handleRouting() {
  const hash = window.location.hash;
  if (hash.startsWith('#/play')) {
    renderer.setView('GAME');
    // If we're navigated to play but still in intro phase, advance to deal
    if (state.phase === 'intro') {
      state.phase = 'deal';
    }
  } else if (hash.startsWith('#/stats')) {
    renderer.setView('STATS');
  } else {
    renderer.setView('HOME');
    // If we navigate back home, we don't necessarily reset the game, 
    // but we ensure the phase is reflected if it was just started.
  }
  render();
}

window.addEventListener('hashchange', handleRouting);
handleRouting();

// Deal a fresh hand and start bidding. Shared by the manual "Start Game" button
// and the automatic deal between hands.
function dealAndStartBidding(): void {
  dealHand(state);
  render({ dealAnimation: true });
  scheduleAIBid();
}

// Auto-deal the next hand after a short beat (no manual "Deal Next Hand" button).
function scheduleAutoDeal(): void {
  setTimeout(() => {
    if (ph() === 'deal') dealAndStartBidding();
  }, AUTO_DEAL_DELAY_MS);
}

// Resume AI if it's their turn on load
function resumeAI() {
  if (ph() === 'bid') scheduleAIBid();
  else if (ph() === 'bid_on_kitty' && state.contract?.bidder !== HUMAN_SEAT) scheduleAIBidOnKitty();
  else if (ph() === 'kitty' && state.contract?.bidder !== HUMAN_SEAT) scheduleAIKitty();
  else if (ph() === 'discard' && state.discardQueue[0] !== HUMAN_SEAT && state.discardQueue.length > 0) scheduleAIDiscard();
  else if (ph() === 'play' && state.toAct !== HUMAN_SEAT && state.toAct !== null) scheduleAIPlay();
  else if (ph() === 'passout') schedulePassoutRedeal();
  // A persisted 'deal' phase between hands (handsPlayed > 0) has no button, so
  // deal it automatically. The very first hand (handsPlayed === 0) keeps its
  // "Start Game" button.
  else if (ph() === 'deal' && state.handsPlayed > 0) scheduleAutoDeal();
}
resumeAI();

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
    render();
  }
  if (ph() === 'bid_on_kitty' && state.contract) {
    if (state.contract.bidder !== HUMAN_SEAT) scheduleAIBidOnKitty();
  } else if (ph() === 'passout') {
    schedulePassoutRedeal();
  }
}

async function schedulePassoutRedeal(): Promise<void> {
  await delay(PASSOUT_MODAL_MS);
  if (ph() !== 'passout') return;
  redealAfterPassout(state);
  render({ dealAnimation: true });
  if (ph() === 'bid') scheduleAIBid();
}

async function scheduleAIBidOnKitty(): Promise<void> {
  await delay(AI_BID_DELAY_MS);
  if (ph() !== 'bid_on_kitty' || !state.contract) return;
  const bidder = state.contract.bidder;
  if (bidder === HUMAN_SEAT) return;

  // AI always picks normal for now
  chooseNormalKitty(state);
  render();
  if (ph() === 'kitty') scheduleAIKitty();
}

async function scheduleAIKitty(): Promise<void> {
  await delay(AI_BID_DELAY_MS);
  if (ph() !== 'kitty' || !state.contract) return;
  const bidder = state.contract.bidder;
  if (bidder === HUMAN_SEAT) return;
  const { suit } = pickBestTrump(state.hands[bidder]);
  const discards = aiBidderDiscard(state.hands[bidder], state.kitty, suit);
  setTrumpAndTakeKitty(state, suit, discards);
  render();
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
    render();
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
    render({ trickWinner: winner });
    if (trickJustCompleted && ph() === 'play') {
      await delay(TRICK_WINNER_PAUSE_MS);
      skipDelay = true; // The pause IS the gap; don't add another delay before the lead.
    }
  }
}
