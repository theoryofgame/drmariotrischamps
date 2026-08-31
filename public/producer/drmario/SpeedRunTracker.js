// Turns one player's own RoundTracker events into Speed-mode race state: a wall-clock run timer
// spanning a configured set of consecutive levels, per-level split times, and a virus count
// normalized across levels not yet reached (see totalVirusesRemaining below). Mirrors
// LiveMetrics.js's relationship to RoundTracker -- pure logic, EventTarget-based, no DOM, fully
// unit-testable off hand-built frame sequences.
//
// Deliberately has no notion of "match," "opponent," or "victories" -- that state lives
// server-side in DrMarioSpeedRoom and gets combined with two independent SpeedRunTrackers at the
// view layer, the same separation-of-concerns principle RoundTracker.js's own header comment
// already establishes for cross-player coordination ("living in the consumer, not either
// per-[player] instance").
//
// Per DrMC's own Speed rules, the total time is genuinely wall clock from the first level's start
// to the last level's clear -- a topout mid-set doesn't end the run, it just costs time, since the
// player restarts only the level they died on (not the whole set) and the clock never pauses. So
// unlike a typical "attempt" tracker, a same-level retry is deliberately a no-op on runStartTime
// and splits already recorded; it just lets time keep elapsing.

import { virusTarget } from './RoundTracker.js';

const STATUS = {
	IDLE: 'idle',
	IN_PROGRESS: 'in_progress',
	COMPLETE: 'complete',
};

export default class SpeedRunTracker extends EventTarget {
	#levelSet = [];
	#status = STATUS.IDLE;
	#currentLevelSetIndex = 0;
	#currentLevel = null;
	#runStartTime = null;
	#completedAt = null;
	#splits = {};
	#attemptsPerLevel = {};
	#remainingViruses = null;
	#pendingClearTimestamp = null;

	constructor(roundTracker) {
		super();

		// round_start's own level is non-null whenever it was already readable on the frame that
		// triggered it (the common case) -- round_level_confirmed only fires later, and only for a
		// round that *started* with level: null, to supply the correction once it becomes
		// readable. These two are mutually exclusive per round (round_level_confirmed only fires
		// when round_start's own level was null), so both safely feed the same handler.
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

	// Reconfiguring the level set means a new race -- resets all state, same as reset().
	setLevelSet(levelSet) {
		this.#levelSet = [...levelSet];
		this.#reset();
	}

	// Manual override (from the admin's resetPlayerRun/recordRaceResult), independent of
	// automatic level-set-boundary detection.
	reset() {
		this.#reset();
	}

	#reset() {
		this.#status = STATUS.IDLE;
		this.#currentLevelSetIndex = 0;
		this.#currentLevel = null;
		this.#runStartTime = null;
		this.#completedAt = null;
		this.#splits = {};
		this.#attemptsPerLevel = {};
		this.#remainingViruses = null;
		this.#pendingClearTimestamp = null;

		this.#emitUpdate();
	}

	#onLevelKnown({ level }) {
		if (level === null || level === undefined) return; // still unknown -- wait for the real event

		this.#currentLevel = level;

		const isRunStart =
			(this.#status === STATUS.IDLE || this.#status === STATUS.COMPLETE) &&
			level === this.#levelSet[0];

		if (isRunStart) {
			this.#status = STATUS.IN_PROGRESS;
			this.#currentLevelSetIndex = 0;
			this.#runStartTime = Date.now();
			this.#completedAt = null;
			this.#splits = {};
			this.#attemptsPerLevel = {};
			this.#remainingViruses = null;
			this.#pendingClearTimestamp = null;
		}
		// Otherwise: a same-level retry (in_progress, level matches the current slot), or an
		// unrelated level observed while idle (e.g. the player practicing outside the configured
		// set) -- #currentLevel is already updated above for display; nothing else to do. Kept
		// forgiving rather than asserted against, consistent with this codebase's general
		// live-broadcast robustness bias.

		this.#emitUpdate();
	}

	#onRoundReady({ virusCount }) {
		if (this.#status !== STATUS.IN_PROGRESS) return;

		this.#remainingViruses = virusCount;
		this.#pendingClearTimestamp = null;

		this.#emitUpdate();
	}

	// Precise split timing: stash the moment remainingViruses first reaches 0 here, but
	// #onRoundEnd only *uses* it once round_end actually confirms stage_clear on the expected
	// level -- so a single garbled OCR frame misreading virus count can't corrupt state.
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

		const level = this.#levelSet[this.#currentLevelSetIndex];
		const isExpectedLevel = this.#currentLevel === level;

		if (outcome === 'stage_clear' && isExpectedLevel) {
			const clearedAt = this.#pendingClearTimestamp ?? Date.now();
			this.#splits[level] = clearedAt - this.#runStartTime;

			if (this.#currentLevelSetIndex === this.#levelSet.length - 1) {
				this.#status = STATUS.COMPLETE;
				this.#completedAt = clearedAt;
			} else {
				this.#currentLevelSetIndex++;
			}
		} else {
			// A topout/game_over retry of the expected level, or a stage_clear reported on an
			// unexpected level (anomalous data) -- either way, the run keeps ticking and this
			// counts as a spent attempt rather than progress.
			this.#attemptsPerLevel[level] = (this.#attemptsPerLevel[level] || 0) + 1;
		}

		this.#pendingClearTimestamp = null;
		this.#remainingViruses = null;

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
		} else if (this.#status === STATUS.COMPLETE) {
			elapsedMs = this.#completedAt - this.#runStartTime;
		}

		return {
			status: this.#status,
			currentLevel: this.#currentLevel,
			currentLevelSetIndex: this.#currentLevelSetIndex,
			runStartTime: this.#runStartTime,
			splits: { ...this.#splits },
			elapsedMs,
			remainingViruses: this.#remainingViruses,
			totalVirusesRemaining: this.#getTotalVirusesRemaining(),
			attemptsPerLevel: { ...this.#attemptsPerLevel },
		};
	}

	// The live remaining virus count on the current level, plus the full virus target for every
	// level in the set not yet reached -- gives a figure that's always comparable between two
	// players even when they're on different levels (see SpeedRunTracker.js's header comment and
	// CLAUDE.md for why this replaces a same-level-only comparison).
	#getTotalVirusesRemaining() {
		if (this.#status === STATUS.COMPLETE) return 0;

		if (this.#status === STATUS.IDLE) {
			return this.#levelSet.reduce(
				(sum, level) => sum + (virusTarget(level) || 0),
				0
			);
		}

		const remainingOnCurrentLevel =
			this.#remainingViruses ?? virusTarget(this.#currentLevel) ?? 0;

		const remainingFutureLevels = this.#levelSet
			.slice(this.#currentLevelSetIndex + 1)
			.reduce((sum, level) => sum + (virusTarget(level) || 0), 0);

		return remainingOnCurrentLevel + remainingFutureLevels;
	}
}
