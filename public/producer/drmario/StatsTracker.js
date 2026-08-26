// Turns a RoundTracker's events into live derived stats -- pieces/virus-clears per minute, per-
// color droughts, a same-piece "rush" streak, and (versus only) garbage-sent stats including
// SALT. Mirrors the relationship Tetris's BaseGame.js/Player.js have with GameTracker.js: RoundTracker
// is the discrete-event state machine off raw OCR frames, this is a stats layer built on top of
// its events, not folded into it -- see RoundTracker.js's own header comment for why the two new
// events this reads (virus_cleared, garbage_entered's restRows/maxRestRows) exist there and not
// here. Pure logic, EventTarget-based, no DOM -- same discipline as RoundTracker.js, fully
// unit-testable without a browser.
//
// One instance tracks one bottle, same as RoundTracker. Dispatches a single 'stats_updated' event
// (detail = a full snapshot via getSnapshot()) on any change, rather than one event per stat, so
// a view only needs one listener.

import { COLOR_PALETTE } from './constants.js';

const COLORS = Object.keys(COLOR_PALETTE);
const RUSH_MIN_LENGTH = 4; // pieces; below this, isRushing is false even though raw counting continues
const SALT_SECONDS_PER_ROW = 0.25; // garbage falls at a constant rate regardless of game speed

export default class StatsTracker extends EventTarget {
	#carryAcrossLevels;
	#roundId = null;
	#runStartTime = null;
	#lastRoundEndOutcome = null;

	#piecesCount = 0;
	#virusClearsCount = 0;
	#colorDroughts = { red: 0, blue: 0, yellow: 0 };
	#lastPieceColors = null; // [leftColor, rightColor] of the most recent piece, in that order
	#rushStreak = 0;
	#maxRushStreak = 0;

	#garbageWavesSent = 0;
	#garbageCellsSent = 0;
	#saltSeconds = 0;

	// carryAcrossLevels: single-player only. Dr Mario's own round boundary fires on every level,
	// not just when a playthrough actually ends (see RoundTracker.js -- a round_end with
	// outcome: 'stage_clear' just advances to the next, harder level, same continuous
	// playthrough). Resetting rate/streak/drought stats on every one of those would make them
	// visibly jump each time a level clears, which isn't the intent -- they should span the whole
	// playthrough ("run"), only truly resetting when it ends (round_end with any *other* outcome).
	// Versus has no such ambiguity today (no "advance to a harder level, same run" concept there),
	// so it keeps the simpler always-reset-on-round_start behavior, the default here.
	constructor(roundTracker, { carryAcrossLevels = false } = {}) {
		super();

		this.#carryAcrossLevels = carryAcrossLevels;

		roundTracker.addEventListener('round_start', e =>
			this.#onRoundStart(e.detail)
		);
		roundTracker.addEventListener('round_end', e => this.#onRoundEnd(e.detail));
		roundTracker.addEventListener('piece_entered', e =>
			this.#onPieceEntered(e.detail)
		);
		roundTracker.addEventListener('virus_cleared', e =>
			this.#onVirusCleared(e.detail)
		);
	}

	#onRoundStart({ roundId }) {
		this.#roundId = roundId;

		const isNewRun =
			!this.#carryAcrossLevels || this.#lastRoundEndOutcome !== 'stage_clear';

		if (isNewRun) {
			this.#reset();
		} else {
			this.#emitUpdate();
		}
	}

	#onRoundEnd({ outcome }) {
		this.#lastRoundEndOutcome = outcome;
	}

	#onPieceEntered({ cells }) {
		this.#piecesCount++;

		const colors = cells.map(cell => cell.color);

		for (const color of COLORS) {
			if (colors.includes(color)) {
				this.#colorDroughts[color] = 0;
			} else {
				this.#colorDroughts[color]++;
			}
		}

		// Same piece including orientation, not just the same color set -- e.g. red-blue then
		// blue-red does NOT continue the streak (confirmed report).
		if (
			this.#lastPieceColors &&
			colors.length === this.#lastPieceColors.length &&
			colors.every((color, i) => color === this.#lastPieceColors[i])
		) {
			this.#rushStreak++;
		} else {
			this.#rushStreak = 1;
		}
		this.#lastPieceColors = colors;
		if (this.#rushStreak > this.#maxRushStreak) {
			this.#maxRushStreak = this.#rushStreak;
		}

		this.#emitUpdate();
	}

	#onVirusCleared({ count }) {
		this.#virusClearsCount += count;
		this.#emitUpdate();
	}

	// Versus only. Garbage a wave sent to the OPPONENT's bottle is credited here, on the SENDER's
	// own StatsTracker -- the consumer calls this on player A's tracker when player B's
	// garbage_entered fires. Cross-player coordination living in the consumer, not either
	// per-bottle instance, mirrors RoundTracker.js's endRound()/syncRoundStart() split for exactly
	// the same reason.
	recordGarbageSent({ cellCount, maxRestRows }) {
		this.#garbageWavesSent++;
		this.#garbageCellsSent += cellCount;
		this.#saltSeconds += maxRestRows * SALT_SECONDS_PER_ROW;

		this.#emitUpdate();
	}

	// Manual override, independent of the automatic round/run detection above -- a pragmatic
	// safety valve for the operator (e.g. restarting a recording session) regardless of what the
	// game/OCR currently reports.
	resetRun() {
		this.#reset();
	}

	#reset() {
		this.#runStartTime = Date.now();
		this.#piecesCount = 0;
		this.#virusClearsCount = 0;
		this.#colorDroughts = { red: 0, blue: 0, yellow: 0 };
		this.#lastPieceColors = null;
		this.#rushStreak = 0;
		this.#maxRushStreak = 0;
		this.#garbageWavesSent = 0;
		this.#garbageCellsSent = 0;
		this.#saltSeconds = 0;

		this.#emitUpdate();
	}

	#emitUpdate() {
		this.dispatchEvent(
			new CustomEvent('stats_updated', { detail: this.getSnapshot() })
		);
	}

	getSnapshot() {
		const elapsedMinutes = this.#runStartTime
			? (Date.now() - this.#runStartTime) / 60000
			: 0;
		const rate = count => (elapsedMinutes > 0 ? count / elapsedMinutes : 0);

		return {
			roundId: this.#roundId,
			piecesPerMinute: rate(this.#piecesCount),
			virusClearsPerMinute: rate(this.#virusClearsCount),
			colorDroughts: { ...this.#colorDroughts },
			rushStreak: this.#rushStreak,
			maxRushStreak: this.#maxRushStreak,
			isRushing: this.#rushStreak >= RUSH_MIN_LENGTH,
			garbageWavesSentPerMinute: rate(this.#garbageWavesSent),
			averageGarbageWaveSize:
				this.#garbageWavesSent > 0
					? this.#garbageCellsSent / this.#garbageWavesSent
					: 0,
			saltSeconds: this.#saltSeconds,
		};
	}
}
