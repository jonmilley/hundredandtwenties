import { Card, SUIT_GLYPHS, SUIT_LABELS, Suit, isRedSuit } from '../game/cards';
import { legalBidOptions } from '../game/bidding';
import { scoreHand, applyEndgameRule } from '../game/scoring';
import { GameState, HUMAN_SEAT, Seat, teamOf } from '../game/state';
import { legalPlayIndices } from '../game/play';
import { isTrump } from '../game/ranking';

export type RenderOptions = {
  trickWinner?: Seat;
  dealAnimation?: boolean;
};

const SEAT_NAMES: Record<Seat, string> = { 0: 'You', 1: 'West', 2: 'North', 3: 'East' };
const SEAT_DIR: Record<Seat, string> = { 0: 'south', 1: 'west', 2: 'north', 3: 'east' };
const TRICK_SLOT: Record<Seat, string> = { 0: 's', 1: 'w', 2: 'n', 3: 'e' };

export type UICallbacks = {
  onCardClick: (seat: Seat, cardIdx: number) => void;
  onBidClick: (amount: number | 'pass') => void;
  onTrumpClick: (suit: Suit) => void;
  onKittyConfirm: (discards: Card[]) => void;
  onDiscardConfirm: (seat: Seat, discards: Card[]) => void;
  onDealClick: () => void;
  onScoreClose: () => void;
  onIntroClose: () => void;
  onRestart: () => void;
  onKittyOptionClick: (option: 'normal' | 'one-card') => void;
  onKittyKeepClick: (cardIdx: number) => void;
};

export type View = 'HOME' | 'GAME' | 'STATS';

export class Renderer {
  private root: HTMLElement;
  private cb: UICallbacks;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private discardSelected = new Set<number>();
  private discardAutoInitDone = false;
  private logExpanded = false;
  private currentView: View = 'HOME';

  constructor(root: HTMLElement, cb: UICallbacks) {
    this.root = root;
    this.cb = cb;
  }

  setView(view: View): void {
    this.currentView = view;
  }

  render(state: GameState, options: RenderOptions = {}): void {
    this.root.innerHTML = '';
    const fragment = document.createDocumentFragment();

    if (this.currentView === 'HOME') {
      fragment.appendChild(this.renderHomeView(state));
    } else if (this.currentView === 'GAME') {
      fragment.appendChild(this.renderGameView(state, options));
    }

    this.root.appendChild(fragment);
  }

  private renderHomeView(state: GameState): HTMLElement {
    const view = el('div', 'view view--home');
    
    const content = el('div', 'home-content');
    
    const title = el('h1', 'home-title');
    title.textContent = 'Hundred And Twenties';
    content.appendChild(title);

    const desc = el('p', 'home-desc');
    desc.innerHTML = 'A classic Newfoundland trick-taking game.<br>First team to 120 points wins!';
    content.appendChild(desc);

    const actions = el('div', 'home-actions');
    
    const startBtn = el('button', 'btn is-primary is-large') as HTMLButtonElement;
    startBtn.textContent = 'Start New Game';
    startBtn.addEventListener('click', () => {
      window.location.hash = '#/play';
      this.cb.onIntroClose();
    });
    actions.appendChild(startBtn);

    if (state.handsPlayed > 0 || state.phase !== 'intro') {
      const resumeBtn = el('button', 'btn') as HTMLButtonElement;
      resumeBtn.textContent = 'Resume Game';
      resumeBtn.addEventListener('click', () => {
        window.location.hash = '#/play';
        if (state.phase === 'intro') this.cb.onIntroClose();
      });
      actions.appendChild(resumeBtn);
    }

    content.appendChild(actions);

    const rulesSection = el('div', 'home-rules');
    rulesSection.innerHTML = `
      <h3>Rules at a Glance</h3>
      <ul>
        <li><b>Bidding:</b> Players bid 20-30 points. High bidder picks trump and takes the 3-card kitty.</li>
        <li><b>Trump Ranking:</b> 5 (High), Jack, Ace of Hearts, Ace of Trump, K, Q, 10...</li>
        <li><b>Off-suit Ranking:</b> "Highest in Red, Lowest in Black"</li>
        <li><b>Scoring:</b> Each trick is 5 points. Best trump is +5.</li>
      </ul>
      <p style="margin-top:12px;font-size:12px;opacity:0.8">
        Rules based on: <a href="https://www.cs.mun.ca/~paul/nahanni/paul/c120.html" target="_blank" rel="noreferrer" style="color:var(--gold)">Paul Rice's Guide</a>
      </p>
    `;
    content.appendChild(rulesSection);

    view.appendChild(content);
    return view;
  }

  private renderGameView(state: GameState, options: RenderOptions): HTMLElement {
    const view = el('div', 'view view--game');
    
    // Clear discard selection whenever it's no longer the human's turn to discard.
    if (state.phase !== 'discard' || state.discardQueue[0] !== HUMAN_SEAT) {
      this.discardSelected.clear();
      this.discardAutoInitDone = false;
    }
    // Auto-select all non-trump cards the first time the human reaches discard phase.
    if (
      state.phase === 'discard' &&
      state.discardQueue[0] === HUMAN_SEAT &&
      state.trump &&
      !this.discardAutoInitDone
    ) {
      state.hands[HUMAN_SEAT].forEach((c, i) => {
        if (!isTrump(c, state.trump!)) this.discardSelected.add(i);
      });
      this.discardAutoInitDone = true;
    }

    const table = el('div', 'table');
    view.appendChild(table);

    const dealCounter = { n: 0 };

    // North seat (partner, seat 2)
    table.appendChild(this.renderSeat(state, 2, options, dealCounter));
    // West seat (opponent, seat 1)
    table.appendChild(this.renderSeat(state, 1, options, dealCounter));
    // Center trick area
    table.appendChild(this.renderCenter(state, options));
    // East seat (opponent, seat 3)
    table.appendChild(this.renderSeat(state, 3, options, dealCounter));
    // South seat (human, seat 0)
    table.appendChild(this.renderSeat(state, 0, options, dealCounter));

    // Side panel
    view.appendChild(this.renderPanel(state));

    // Overlays
    if (state.phase === 'bid_on_kitty') {
      view.appendChild(this.renderBidOnKittyModal(state));
    }
    if (state.phase === 'kitty') {
      view.appendChild(this.renderKittyModal(state));
    }
    if (state.phase === 'score') {
      view.appendChild(this.renderScoreModal(state));
    }
    if (state.phase === 'gameOver') {
      view.appendChild(this.renderGameOverModal(state));
    }

    return view;
  }

  private renderSeat(state: GameState, seat: Seat, options: RenderOptions, dealCounter: { n: number }): HTMLElement {
    const dir = SEAT_DIR[seat];
    const div = el('div', `seat seat--${dir}`);

    // Label row
    const label = el('div', 'seat__label');
    const nameEl = el('span', 'seat__name');
    nameEl.textContent = SEAT_NAMES[seat];
    if (state.toAct === seat || (state.bidding && state.bidding.order[state.bidding.cursor] === seat)) {
      nameEl.classList.add('is-acting');
    }
    label.appendChild(nameEl);
    if (state.dealer === seat) {
      const chip = el('span', 'dealer-chip');
      chip.textContent = 'D';
      label.appendChild(chip);
    }
    if (state.phase === 'bid' && state.bidding) {
      const lastAction = [...state.bidding.history].reverse().find(e => e.seat === seat);
      if (lastAction) {
        const chip = el('span', lastAction.option === 'pass' ? 'bid-chip bid-chip--pass' : 'bid-chip');
        chip.textContent = lastAction.option === 'pass' ? 'Pass' : String(lastAction.option);
        label.appendChild(chip);
      }
    }
    if (state.contract?.bidder === seat && state.phase !== 'deal') {
      const chip = el('span', 'bid-chip');
      chip.textContent = `Bid ${state.contract.amount}`;
      label.appendChild(chip);
    }
    div.appendChild(label);

    // Kitty pile — shown next to dealer during bidding
    if (
      state.dealer === seat &&
      state.kitty.length > 0 &&
      (state.phase === 'bid' || state.phase === 'bid_on_kitty')
    ) {
      const pileWrapper = el('div', `kitty-pile-wrapper`);
      const pileLabel = el('div', 'kitty-pile__label');
      pileLabel.textContent = 'Kitty';
      pileWrapper.appendChild(pileLabel);
      const pile = el('div', 'kitty-pile');
      for (let i = 0; i < state.kitty.length; i++) {
        pile.appendChild(cardBack());
      }
      pileWrapper.appendChild(pile);
      div.appendChild(pileWrapper);
    }

    // Hand of cards
    const hand = el('div', `hand hand--${dir}`);
    const cards = state.hands[seat];

    // Legal indices (only matter for human in play phase)
    let legalSet = new Set<number>();
    if (
      seat === HUMAN_SEAT &&
      state.phase === 'play' &&
      state.toAct === HUMAN_SEAT &&
      state.trump &&
      state.currentTrick
    ) {
      const trick = state.currentTrick.plays.map((p) => p.card);
      legalPlayIndices(cards, trick, state.trump).forEach((i) => legalSet.add(i));
    }

    if (seat !== HUMAN_SEAT || state.phase === 'deal' || state.phase === 'gameOver') {
      // Show face-down for all AI seats; also during some phases
      const count = cards.length;
      for (let i = 0; i < count; i++) {
        const cardEl = cardBack();
        if (options.dealAnimation) {
          cardEl.classList.add('card--deal');
          cardEl.style.setProperty('--deal-delay', `${dealCounter.n * 40}ms`);
        }
        dealCounter.n++;
        hand.appendChild(cardEl);
      }
    } else {
      // Human hand: show face-up
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i]!;
        const cardEl = cardFace(c);
        if (options.dealAnimation) {
          cardEl.classList.add('card--deal');
          cardEl.style.setProperty('--deal-delay', `${dealCounter.n * 40}ms`);
        }
        dealCounter.n++;
        if (state.phase === 'play' && state.toAct === HUMAN_SEAT) {
          const isLegal = legalSet.has(i);
          cardEl.classList.add(isLegal ? 'is-legal' : 'is-illegal');
          if (isLegal) {
            const idx = i;
            cardEl.addEventListener('click', () => this.cb.onCardClick(HUMAN_SEAT, idx));
          }
        } else if (state.phase === 'discard' && state.discardQueue[0] === HUMAN_SEAT) {
          cardEl.classList.add('is-legal');
          const idx = i;
          if (this.discardSelected.has(idx)) cardEl.classList.add('is-selected');
          cardEl.addEventListener('click', () => {
            if (this.discardSelected.has(idx)) this.discardSelected.delete(idx);
            else this.discardSelected.add(idx);
            this.render(state, options);
          });
        } else if (state.phase !== 'score') {
          cardEl.classList.add('is-legal');
        }
        hand.appendChild(cardEl);
      }
    }

    div.appendChild(hand);
    return div;
  }

  private renderCenter(state: GameState, options: RenderOptions): HTMLElement {
    const center = el('div', 'center');

    // Active trick cards (in progress)
    if (state.currentTrick && state.currentTrick.plays.length > 0) {
      for (const play of state.currentTrick.plays) {
        const slot = el('div', `trick-slot trick-slot--${TRICK_SLOT[play.seat]}`);
        slot.appendChild(cardFace(play.card));
        center.appendChild(slot);
      }
    }

    // Last completed trick — show when current trick is empty (just resolved) or null during score.
    const currentEmpty = !state.currentTrick || state.currentTrick.plays.length === 0;
    if (currentEmpty && state.completedTricks.length > 0 && (state.phase === 'play' || state.phase === 'score')) {
      const last = state.completedTricks[state.completedTricks.length - 1]!;
      for (const play of last.plays) {
        const slot = el('div', `trick-slot trick-slot--${TRICK_SLOT[play.seat]}`);
        const cardEl = cardFace(play.card);
        if (last.winner !== undefined && play.seat === last.winner) {
          cardEl.classList.add('is-trick-winner');
        }
        slot.appendChild(cardEl);
        center.appendChild(slot);
      }
    }

    // Hub
    const hub = el('div', 'trick-slot trick-slot--hub');
    const hubInner = el('div', 'hub');
    if (options.trickWinner !== undefined) {
      const winnerEl = el('span', 'hub__winner');
      winnerEl.textContent = `${SEAT_NAMES[options.trickWinner]} wins!`;
      hubInner.appendChild(winnerEl);
    }
    const phase = el('span', 'hub__phase');
    phase.textContent = phaseLabel(state);
    hubInner.appendChild(phase);
    if (state.trump) {
      const trumpEl = el('span', 'hub__trump');
      trumpEl.textContent = SUIT_GLYPHS[state.trump];
      trumpEl.classList.add(isRedSuit(state.trump) ? 'is-red' : 'is-black');
      hubInner.appendChild(trumpEl);
    }
    hub.appendChild(hubInner);
    center.appendChild(hub);

    return center;
  }

  private renderPanel(state: GameState): HTMLElement {
    const panel = el('div', 'panel');

    // Score
    const scoreTitle = el('div', 'panel__title');
    scoreTitle.textContent = 'Score';
    panel.appendChild(scoreTitle);
    const scoreboard = el('div', 'scoreboard');
    const teamLabels = ['You & North', 'West & East'];
    for (let t = 0; t < 2; t++) {
      const sc = el('div', `score-card${t === 0 ? ' is-yours' : ''}`);
      const lbl = el('div', 'score-card__label');
      lbl.textContent = teamLabels[t]!;
      const val = el('div', 'score-card__value');
      val.textContent = String(state.totalScore[t]);
      sc.appendChild(lbl);
      sc.appendChild(val);
      scoreboard.appendChild(sc);
    }
    panel.appendChild(scoreboard);

    // Action section
    const section = el('div', 'action-section');
    const sectionTitle = el('div', 'action-section__title');
    section.appendChild(sectionTitle);

    if (state.phase === 'deal') {
      sectionTitle.textContent = 'Ready';
      const btn = el('button', 'btn is-primary') as HTMLButtonElement;
      btn.textContent = state.handsPlayed === 0 ? 'Start Game' : 'Deal Next Hand';
      btn.addEventListener('click', () => this.cb.onDealClick());
      section.appendChild(btn);
    } else if (state.phase === 'bid' && state.bidding && !state.bidding.done) {
      const currentBidder = state.bidding.order[state.bidding.cursor];
      if (currentBidder === HUMAN_SEAT) {
        sectionTitle.textContent = 'Your Bid';
        const row = el('div', 'button-row');
        const isDealer = HUMAN_SEAT === state.dealer;
        const hand = state.hands[HUMAN_SEAT];
        const legalOpts = state.bidding ? legalBidOptions(state.bidding, state.dealer, hand) : [];
        for (const opt of legalOpts) {
          const btn = el('button', 'btn') as HTMLButtonElement;
          if (opt === 'pass') {
            btn.textContent = 'Pass';
          } else if (isDealer && opt === state.bidding.highBid) {
            btn.textContent = `Take ${opt}`;
            btn.classList.add('is-primary');
          } else {
            btn.textContent = `Bid ${opt}`;
            if (opt === 30) btn.classList.add('is-primary');
          }
          btn.addEventListener('click', () => this.cb.onBidClick(opt));
          row.appendChild(btn);
        }
        section.appendChild(row);
      } else {
        sectionTitle.textContent = `${SEAT_NAMES[currentBidder!]} is bidding…`;
      }
    } else if (state.phase === 'kitty') {
      sectionTitle.textContent = 'Pick Trump';
    } else if (state.phase === 'discard') {
      if (state.discardQueue[0] === HUMAN_SEAT) {
        const n = this.discardSelected.size;
        sectionTitle.textContent = 'Discard';
        const hint = el('div', '');
        hint.style.fontSize = '12px';
        hint.style.color = 'var(--muted)';
        hint.textContent = n === 0
          ? 'Click cards in your hand to select them for discard.'
          : `${n} card${n !== 1 ? 's' : ''} selected`;
        section.appendChild(hint);
        const btn = el('button', 'btn is-primary') as HTMLButtonElement;
        btn.textContent = n === 0 ? 'Keep All (no discard)' : `Discard ${n} card${n !== 1 ? 's' : ''}`;
        btn.addEventListener('click', () => {
          const discards = [...this.discardSelected].map(i => state.hands[HUMAN_SEAT][i]!);
          this.discardSelected.clear();
          this.cb.onDiscardConfirm(HUMAN_SEAT, discards);
        });
        section.appendChild(btn);
      } else {
        sectionTitle.textContent = `${SEAT_NAMES[state.discardQueue[0]!]} discarding…`;
      }
    } else if (state.phase === 'play') {
      if (state.toAct === HUMAN_SEAT) {
        sectionTitle.textContent = 'Your Turn — Play a Card';
      } else if (state.toAct !== null) {
        sectionTitle.textContent = `${SEAT_NAMES[state.toAct]} is playing…`;
      } else {
        sectionTitle.textContent = 'Trick complete';
      }
      // Show tricks won this hand
      const tricksInfo = el('div', '');
      tricksInfo.style.fontSize = '12px';
      tricksInfo.style.color = 'var(--muted)';
      const t0 = state.tricksWon[0];
      const t1 = state.tricksWon[1];
      tricksInfo.textContent = `Tricks — You/North: ${t0}  |  West/East: ${t1}`;
      section.appendChild(tricksInfo);
      if (state.contract) {
        const bidInfo = el('div', '');
        bidInfo.style.fontSize = '12px';
        bidInfo.style.color = 'var(--muted)';
        const bidderTeam = teamOf(state.contract.bidder);
        bidInfo.textContent = `Bid: ${state.contract.amount} by ${SEAT_NAMES[state.contract.bidder]} (Team ${bidderTeam === 0 ? 'You/N' : 'W/E'})`;
        section.appendChild(bidInfo);
      }
    }

    panel.appendChild(section);

    // Log
    const logHeader = el('div', 'log-header');
    const logTitle = el('div', 'panel__title');
    logTitle.textContent = 'Log';
    logHeader.appendChild(logTitle);
    
    const expandBtn = el('button', 'btn is-text is-tiny') as HTMLButtonElement;
    expandBtn.textContent = this.logExpanded ? 'Collapse' : 'Expand';
    expandBtn.addEventListener('click', () => {
      this.logExpanded = !this.logExpanded;
      this.render(state);
    });
    logHeader.appendChild(expandBtn);
    panel.appendChild(logHeader);

    const log = el('div', `log${this.logExpanded ? '' : ' log--collapsed'}`);
    const entries = this.logExpanded 
      ? [...state.log].reverse().slice(0, 30)
      : (state.log.length > 0 ? [[...state.log].pop()!] : []);

    for (const entry of entries) {
      const row = el('div', 'log__entry');
      row.textContent = entry;
      log.appendChild(row);
    }
    panel.appendChild(log);

    // Restart button
    const restartContainer = el('div', 'restart-container');
    const restartBtn = el('button', 'btn is-small') as HTMLButtonElement;
    restartBtn.textContent = 'Restart Game';
    restartBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to restart the game? Your current progress will be lost.')) {
        this.cb.onRestart();
      }
    });
    restartContainer.appendChild(restartBtn);
    panel.appendChild(restartContainer);

    // BMC button
    const bmcContainer = el('div', 'bmc-container');
    const bmcLink = el('a', 'bmc-link');
    bmcLink.setAttribute('href', 'https://www.buymeacoffee.com/jonmilley');
    bmcLink.setAttribute('target', '_blank');
    bmcLink.setAttribute('rel', 'noreferrer');
    
    const bmcImg = el('img', 'bmc-img');
    bmcImg.setAttribute('src', 'https://cdn.buymeacoffee.com/buttons/v2/default-blue.png');
    bmcImg.setAttribute('alt', 'Buy me a coffee');
    
    bmcLink.appendChild(bmcImg);
    bmcContainer.appendChild(bmcLink);
    panel.appendChild(bmcContainer);

    return panel;
  }

  private renderKittyModal(state: GameState): HTMLElement {
    if (!state.contract) return el('div', '');
    const modal = el('div', 'modal');
    const inner = el('div', 'modal__inner');
    const title = el('div', 'modal__title');
    inner.appendChild(title);

    if (state.contract.bidder !== HUMAN_SEAT) {
      title.textContent = `${SEAT_NAMES[state.contract.bidder]} is naming trump…`;
      modal.appendChild(inner);
      return modal;
    }

    title.textContent = 'Name Trump & Use Kitty';

    const hint = el('div', '');
    hint.style.fontSize = '13px';
    hint.style.color = 'var(--muted)';

    const handRow = el('div', 'modal__hand');
    const bidder = state.contract.bidder;

    if (state.bidOnKitty) {
      // Bid on the Kitty: player already kept 1 card; reveal kitty and pick trump.
      hint.textContent = 'You chose Bid on the Kitty. Here are the 3 kitty cards added to your kept card. Now name trump:';
      [...state.hands[bidder], ...state.kitty].forEach(c => handRow.appendChild(cardFace(c)));
    } else {
      // Normal: player picks trump before seeing the kitty.
      hint.textContent = `Pick a trump suit. You'll then see the ${state.kitty.length} kitty cards and discard down to 5.`;
      state.hands[bidder].forEach(c => handRow.appendChild(cardFace(c)));
    }
    inner.appendChild(hint);
    inner.appendChild(handRow);

    // Trump buttons
    const suitGrid = el('div', 'suit-grid');
    for (const suit of ['H', 'D', 'C', 'S'] as Suit[]) {
      const btn = el('button', 'btn suit-btn') as HTMLButtonElement;
      const glyph = el('span', `suit-glyph ${isRedSuit(suit) ? 'is-red' : 'is-black'}`);
      glyph.textContent = SUIT_GLYPHS[suit];
      const lbl = el('span', '');
      lbl.textContent = SUIT_LABELS[suit];
      btn.appendChild(glyph);
      btn.appendChild(lbl);
      btn.addEventListener('click', () => this.cb.onTrumpClick(suit));
      suitGrid.appendChild(btn);
    }
    inner.appendChild(suitGrid);

    modal.appendChild(inner);
    return modal;
  }

  private renderTrumpSelectedKittyModal(state: GameState, trump: Suit): HTMLElement {
    if (!state.contract) return el('div', '');
    const modal = el('div', 'modal');
    const inner = el('div', 'modal__inner');
    const title = el('div', 'modal__title');
    title.textContent = `Trump: ${SUIT_GLYPHS[trump]} ${SUIT_LABELS[trump]} — Select Discards`;
    inner.appendChild(title);

    const combined = [...state.hands[state.contract.bidder], ...state.kitty];
    const minDiscard = Math.max(0, combined.length - 5);

    // Pre-select all non-trump cards; player can deselect to keep.
    const selected = new Set<number>(
      combined.map((c, i) => ({ c, i }))
        .filter(({ c }) => !isTrump(c, trump))
        .map(({ i }) => i)
    );

    const hint = el('div', '');
    hint.style.fontSize = '13px';
    hint.style.color = 'var(--muted)';
    hint.textContent = `Non-trump cards are pre-selected for discard. Click to keep any you want.`;
    inner.appendChild(hint);

    const status = el('div', '');
    status.style.fontSize = '12px';
    status.style.color = 'var(--muted)';
    status.style.marginTop = '4px';
    inner.appendChild(status);

    const handDiv = el('div', 'modal__hand');

    const confirmBtn = el('button', 'btn is-primary') as HTMLButtonElement;
    confirmBtn.textContent = 'Confirm Discards';
    confirmBtn.disabled = true;

    const updateButtons = () => {
      const n = selected.size;
      const draws = n - minDiscard;
      confirmBtn.disabled = n < minDiscard;
      if (n === 0) {
        status.textContent = `Select at least ${minDiscard} cards to discard`;
      } else if (draws > 0) {
        status.textContent = `Discarding ${n} — will draw ${draws} replacement${draws > 1 ? 's' : ''} from deck`;
      } else {
        status.textContent = `Discarding ${n}`;
      }
    };
    updateButtons();

    combined.forEach((c, i) => {
      const cardEl = cardFace(c);
      if (selected.has(i)) cardEl.classList.add('is-selected');
      cardEl.addEventListener('click', () => {
        if (selected.has(i)) selected.delete(i);
        else selected.add(i);
        cardEl.classList.toggle('is-selected', selected.has(i));
        updateButtons();
      });
      handDiv.appendChild(cardEl);
    });
    inner.appendChild(handDiv);
    confirmBtn.addEventListener('click', () => {
      const discards = [...selected].map((i) => combined[i]!);
      this.cb.onKittyConfirm(discards);
    });
    inner.appendChild(confirmBtn);

    modal.appendChild(inner);
    return modal;
  }

  private renderScoreModal(state: GameState): HTMLElement {
    const modal = el('div', 'modal');
    const inner = el('div', 'modal__inner');
    const title = el('div', 'modal__title');
    inner.appendChild(title);

    if (state.contract && state.trump) {
      // Compute the hand result here (pure, no mutation) so the modal shows
      // accurate points and the new running score.
      const result = scoreHand(state.completedTricks, state.trump, state.contract);
      const newScore = applyEndgameRule(
        state.totalScore,
        result.pointsByTeam,
        state.contract,
        state.settings.inHoleVariant,
      );
      const bidMade = result.bidMade;
      title.textContent = bidMade ? 'Bid Made!' : 'Bid Failed';
      title.style.color = bidMade ? '#b8e0c4' : '#ff7780';

      const body = el('div', '');
      body.style.fontSize = '14px';
      body.style.color = 'var(--muted)';
      body.style.lineHeight = '1.8';

      const bidderName = SEAT_NAMES[state.contract.bidder];
      const ep0 = result.trickPointsByTeam[0] + result.bonusByTeam[0];
      const ep1 = result.trickPointsByTeam[1] + result.bonusByTeam[1];
      const bestSeat = result.bestTrumpSeat;
      const bestLabel = bestSeat !== null ? `${SEAT_NAMES[bestSeat]} held best trump (+5)` : '';

      body.innerHTML = `
        <div><b style="color:var(--text)">${bidderName}</b> bid <b style="color:var(--gold-bright)">${state.contract.amount}</b>
          in <b style="color:${isRedSuit(state.trump) ? '#ff7780' : 'var(--text)'}">${SUIT_GLYPHS[state.trump]} ${SUIT_LABELS[state.trump]}</b></div>
        <div>Tricks — You/North: <b style="color:var(--text)">${state.tricksWon[0]}</b>
          &nbsp; West/East: <b style="color:var(--text)">${state.tricksWon[1]}</b></div>
        <div>Earned — You/North: <b style="color:var(--text)">${ep0}</b>
          &nbsp; West/East: <b style="color:var(--text)">${ep1}</b></div>
        ${bestLabel ? `<div style="font-size:12px">${bestLabel}</div>` : ''}
        <div style="margin-top:10px;font-size:18px;color:var(--text)">
          New score: <b style="color:#b8e0c4">${newScore[0]}</b> – <b style="color:var(--text)">${newScore[1]}</b>
        </div>
      `;
      inner.appendChild(body);
    } else {
      title.textContent = 'Hand Complete';
    }

    const btn = el('button', 'btn is-primary') as HTMLButtonElement;
    btn.textContent = 'Next Hand';
    btn.addEventListener('click', () => this.cb.onScoreClose());
    inner.appendChild(btn);

    modal.appendChild(inner);
    return modal;
  }

  private renderGameOverModal(state: GameState): HTMLElement {
    const modal = el('div', 'modal');
    const inner = el('div', 'modal__inner');
    const title = el('div', 'modal__title');
    const winner = state.totalScore[0] >= 120 ? 'You & North Win!' : 'West & East Win!';
    title.textContent = winner;
    inner.appendChild(title);

    const score = el('div', '');
    score.style.fontSize = '18px';
    score.style.color = 'var(--muted)';
    score.textContent = `Final: You/North ${state.totalScore[0]} — West/East ${state.totalScore[1]}`;
    inner.appendChild(score);

    const btn = el('button', 'btn is-primary') as HTMLButtonElement;
    btn.textContent = 'Play Again';
    btn.addEventListener('click', () => this.cb.onDealClick());
    inner.appendChild(btn);

    modal.appendChild(inner);
    return modal;
  }


  private renderBidOnKittyModal(state: GameState): HTMLElement {
    const modal = el('div', 'modal');
    const inner = el('div', 'modal__inner');
    const title = el('div', 'modal__title');
    inner.appendChild(title);

    if (state.contract?.bidder !== HUMAN_SEAT) {
      title.textContent = `${SEAT_NAMES[state.contract?.bidder ?? 1]} is choosing kitty option...`;
      modal.appendChild(inner);
      return modal;
    }

    if (!state.bidOnKitty) {
      title.textContent = 'How will you use the kitty?';
      const body = el('div', '');
      body.style.fontSize = '14px';
      body.style.color = 'var(--muted)';
      body.innerHTML = `
        <p><b>Normal:</b> Pick trump suit first, then take the 3 cards and discard back to 5.</p>
        <p style="margin-top:10px"><b>Bid on the Kitty:</b> Keep only 1 card from your current hand, then see the kitty and choose trump.</p>
      `;
      inner.appendChild(body);

      const handDiv = el('div', 'modal__hand');
      state.hands[HUMAN_SEAT].forEach(c => handDiv.appendChild(cardFace(c)));
      inner.appendChild(handDiv);

      const row = el('div', 'button-row');
      const btn1 = el('button', 'btn is-primary') as HTMLButtonElement;
      btn1.textContent = 'Normal';
      btn1.addEventListener('click', () => this.cb.onKittyOptionClick('normal'));
      row.appendChild(btn1);

      const btn2 = el('button', 'btn') as HTMLButtonElement;
      btn2.textContent = 'Bid on the Kitty';
      btn2.addEventListener('click', () => this.cb.onKittyOptionClick('one-card'));
      row.appendChild(btn2);
      inner.appendChild(row);
    } else {
      title.textContent = 'Bid on the Kitty — Pick 1 card to KEEP';
      const body = el('div', '');
      body.style.fontSize = '13px';
      body.style.color = 'var(--muted)';
      body.textContent = 'Discard all others, then see the kitty and name trump.';
      inner.appendChild(body);

      const handDiv = el('div', 'modal__hand');
      state.hands[HUMAN_SEAT].forEach((c, i) => {
        const cardEl = cardFace(c);
        cardEl.addEventListener('click', () => this.cb.onKittyKeepClick(i));
        handDiv.appendChild(cardEl);
      });
      inner.appendChild(handDiv);
    }

    modal.appendChild(inner);
    return modal;
  }

  showTrumpSelectedKittyModal(state: GameState, trump: Suit): void {
    // Replace kitty modal with discard modal.
    const existing = this.root.querySelector('.modal');
    if (existing) existing.remove();
    this.root.appendChild(this.renderTrumpSelectedKittyModal(state, trump));
  }

  showToast(message: string, durationMs = 1800): void {
    const existing = this.root.querySelector('.toast');
    if (existing) existing.remove();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    const toast = el('div', 'toast');
    toast.textContent = message;
    this.root.appendChild(toast);
    this.toastTimer = setTimeout(() => toast.remove(), durationMs);
  }
}

// ------- DOM helpers -------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classes: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const cls of classes.trim().split(/\s+/).filter(Boolean)) e.classList.add(cls);
  return e;
}

const SVG_SUIT: Record<string, string> = { H: 'heart', D: 'diamond', C: 'club', S: 'spade' };

function svgRank(rank: string): string {
  if (rank === 'A') return '1';
  if (rank === 'J') return 'jack';
  if (rank === 'Q') return 'queen';
  if (rank === 'K') return 'king';
  return rank;
}

function cardSvgUse(id: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 169.075 244.64');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `/svg-cards.svg#${id}`);
  use.setAttribute('href', `/svg-cards.svg#${id}`);
  svg.appendChild(use);
  return svg;
}

export function cardFace(c: Card): HTMLElement {
  const div = el('div', 'card');
  const id = `${SVG_SUIT[c.suit]}_${svgRank(c.rank)}`;
  div.appendChild(cardSvgUse(id));
  return div;
}

function cardBack(): HTMLElement {
  const div = el('div', 'card is-back');
  div.appendChild(cardSvgUse('back'));
  return div;
}

function phaseLabel(state: GameState): string {
  switch (state.phase) {
    case 'intro': return 'Welcome';
    case 'deal': return 'Deal';
    case 'bid': return 'Bidding';
    case 'bid_on_kitty': return 'Kitty Choice';
    case 'kitty': return 'Kitty';
    case 'discard': return 'Discard';
    case 'play': return state.trump ? 'Playing' : 'Play';
    case 'score': return 'Score';
    case 'gameOver': return 'Game Over';
  }
}
