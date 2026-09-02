// Turns one player's own RoundTracker events into open-ended "qualifying practice" run state: a
// wall-clock timer spanning an unbounded number of levels (no configured set, unlike
// SpeedRunTracker), the live/previous level's own duration, and a one-shot "qualifying score"
// snapshot (level + remaining viruses) captured the instant total elapsed time first reaches 30
// minutes -- the exact stat used for DrMC Speed-tournament qualifying. Same
// EventTarget/getSnapshot() shape as SpeedRunTracker.js, pure logic, fully unit-testable off
// hand-built frame sequences.
//
// Unlike Speed mode, a topout/game_over is NOT a same-level retry that the clock shrugs off -- a
// real qualifying attempt is a single continuous life, so either outcome ends the tracked run
// (status: 'ended') and freezes elapsedMs, exactly like a clean finish would. The practicer starts
// their next attempt with an explicit reset() (wired to a button in the view), same as
// SpeedRunTracker's own manual-override precedent.
//
// No per-level split map is exposed to the outside -- per direct instruction, this view only ever
// needs "time this level" and "time last level," not a full history -- but internally it's built
// the same way SpeedRunTracker's splits are (a cumulative-elapsed-at-clear checkpoint per level),
// since that's what actually lets "this level" be computed correctly regardless of when a level's
// own start time became known (round_level_confirmed can report it well after the round itself
// began, whereas round_end's timing is always exact).

import { virusTarget } from './RoundTracker.js';

const STATUS = {
	IDLE: 'idle',
	IN_PROGRESS: 'in_progress',
	ENDED: 'ended',
};

const QUALIFY_THRESHOLD_MS = 30 * 60 * 1000;

// Reported live: a level's own split can freeze at a stale virus-zero-crossing timestamp while
// wall-clock time keeps advancing normally, if something stalls play between the last virus
// clearing and the STAGE CLEAR screen actually being confirmed (e.g. a pause) -- see
// #onRoundEnd's own comment for the exact reasoning.
const MAX_CLEAR_TIMESTAMP_LAG_MS = 5000;

export default class QualifyRunTracker extends EventTarget {
	#status = STATUS.IDLE;
	#currentLevel = null;
	#runStartTime = null;
	#endedAt = null;
	#splits = {};
	#completedLevels = [];
	#remainingViruses = null;
	#pendingClearTimestamp = null;
	#qualifySnapshot = null;

	constructor(roundTracker) {
		super();

		roundTracker.addEventListener('round_start', e =>
			this.#onLevelKnown(e.detail)
		);
		roundTracker.addEventListener('round_level_confirmed', e =>
			this.#onLevelKnown(e.detail)
		);
		roundTracker.addEventListener('round_ready', e =>
			this.#onRoundReady(e.detail)
		);
		roundTracker.addEventListener('virus_cleared', e =>
			this.#onVirusCleared(e.detail)
		);
		roundTracker.addEventListener('round_end', e => this.#onRoundEnd(e.detail));
	}

	// Manual override -- the practicer's own "start a fresh attempt" action (see reasoning above
	// on why topout/game_over doesn't auto-restart the run the way Speed mode's same-level retry
	// does).
	reset() {
		this.#status = STATUS.IDLE;
		this.#currentLevel = null;
		this.#runStartTime = null;
		this.#endedAt = null;
		this.#splits = {};
		this.#completedLevels = [];
		this.#remainingViruses = null;
		this.#pendingClearTimestamp = null;
		this.#qualifySnapshot = null;

		this.#emitUpdate();
	}

	#onLevelKnown({ level }) {
		if (level === null || level === undefined) return; // still unknown -- wait for the real event

		if (this.#status === STATUS.IDLE) {
			// The very first level observed after a reset begins the run -- no fixed starting level
			// is enforced (the practicer resets right before they're about to begin their real
			// attempt, same as clicking "start").
			this.#status = STATUS.IN_PROGRESS;
			this.#runStartTime = Date.now();
		}
		// A status of ENDED intentionally does *not* resume here -- see the header comment. Only
		// IDLE (a fresh run) and IN_PROGRESS (an ordinary level transition, handled in
		// #onRoundEnd) update #currentLevel below.
		if (this.#status !== STATUS.IN_PROGRESS) return;

		this.#currentLevel = level;
		this.#emitUpdate();
	}

	#onRoundReady({ virusCount }) {
		if (this.#status !== STATUS.IN_PROGRESS) return;

		this.#remainingViruses = virusCount;
		this.#pendingClearTimestamp = null;

		this.#emitUpdate();
	}

	#onVirusCleared({ count }) {
		if (this.#status !== STATUS.IN_PROGRESS || this.#remainingViruses === null)
			return;

		this.#remainingViruses = Math.max(0, this.#remainingViruses - count);

		if (this.#remainingViruses === 0 && this.#pendingClearTimestamp === null) {
			this.#pendingClearTimestamp = Date.now();
		}

		this.#emitUpdate();
	}

	#onRoundEnd({ outcome }) {
		if (this.#status !== STATUS.IN_PROGRESS) return;

		if (outcome === 'stage_clear') {
			// pendingClearTimestamp is normally within a fraction of a second of this round_end
			// firing (the STAGE CLEAR animation/OCR confirmation lag) -- but if something stalls
			// play in between (a pause, a capture/OCR hang), that stale timestamp can lag *this*
			// moment by a lot, which both under-reports this level's own split (frozen at the
			// stale, too-early timestamp) and leaks the missing time onto the next level's live
			// "current level elapsed" display (built from wall-clock elapsed minus this split --
			// see getSnapshot() -- so a too-small split makes the next level look like it already
			// had a head start). Confirmed live: a 17s gap left a level's split reading 10s
			// instead of the real 27s, with the missing 17s showing up as already-elapsed time on
			// the very next level. Past MAX_CLEAR_TIMESTAMP_LAG_MS, trust this round_end's own
			// timestamp instead -- less "precise" than the virus-zero-crossing moment in the
			// ordinary case, but never wrong in the direction that corrupts the next level's
			// display.
			const now = Date.now();
			const clearedAt =
				this.#pendingClearTimestamp !== null &&
				now - this.#pendingClearTimestamp <= MAX_CLEAR_TIMESTAMP_LAG_MS
					? this.#pendingClearTimestamp
					: now;
			this.#splits[this.#currentLevel] = clearedAt - this.#runStartTime;
			this.#completedLevels.push(this.#currentLevel);
		} else {
			// topout / game_over -- ends the tracked run; see header comment.
			this.#status = STATUS.ENDED;
			this.#endedAt = Date.now();
		}

		this.#pendingClearTimestamp = null;
		this.#remainingViruses = null;

		this.#emitUpdate();
	}

	// Called by the view on its own polling cadence (ticking the live clock, same as
	// SpeedRunTracker's consumers do) -- captures the qualifying score the instant elapsed
	// wall-clock time first reaches 30 minutes, exactly once, and never overwrites it afterward
	// even if the player keeps going past the mark (per direct instruction: continuing past 30:00
	// is expected and must not disturb the captured score).
	checkQualifySnapshot() {
		if (this.#status !== STATUS.IN_PROGRESS || this.#qualifySnapshot !== null)
			return;

		const elapsedMs = Date.now() - this.#runStartTime;
		if (elapsedMs < QUALIFY_THRESHOLD_MS) return;

		this.#qualifySnapshot = {
			level: this.#currentLevel,
			remainingViruses:
				this.#remainingViruses ?? virusTarget(this.#currentLevel) ?? null,
		};

		this.#emitUpdate();
	}

	#emitUpdate() {
		this.dispatchEvent(
			new CustomEvent('run_updated', { detail: this.getSnapshot() })
		);
	}

	getSnapshot() {
		let elapsedMs = 0;
		if (this.#status === STATUS.IN_PROGRESS) {
			elapsedMs = Date.now() - this.#runStartTime;
		} else if (this.#status === STATUS.ENDED) {
			elapsedMs = this.#endedAt - this.#runStartTime;
		}

		const lastCompletedLevel =
			this.#completedLevels[this.#completedLevels.length - 1] ?? null;
		const secondLastCompletedLevel =
			this.#completedLevels[this.#completedLevels.length - 2] ?? null;

		const lastCumulative =
			lastCompletedLevel !== null ? this.#splits[lastCompletedLevel] : 0;
		const secondLastCumulative =
			secondLastCompletedLevel !== null
				? this.#splits[secondLastCompletedLevel]
				: 0;

		const currentLevelElapsedMs =
			this.#status === STATUS.IDLE ? null : elapsedMs - lastCumulative;
		const previousLevelElapsedMs =
			lastCompletedLevel !== null
				? lastCumulative - secondLastCumulative
				: null;

		return {
			status: this.#status,
			currentLevel: this.#currentLevel,
			runStartTime: this.#runStartTime,
			elapsedMs,
			remainingViruses: this.#remainingViruses,
			currentLevelElapsedMs,
			previousLevelElapsedMs,
			qualifySnapshot: this.#qualifySnapshot,
		};
	}
}
