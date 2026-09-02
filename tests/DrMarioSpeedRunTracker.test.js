import {
	describe,
	it,
	expect,
	beforeEach,
	afterEach,
	jest,
} from '@jest/globals';
import RoundTracker from '../public/producer/drmario/RoundTracker.js';
import SpeedRunTracker from '../public/producer/drmario/SpeedRunTracker.js';
import { COLS, ROWS } from '../public/producer/drmario/constants.js';

// SpeedRunTracker only ever reacts to RoundTracker's own events, never raw pixels, so it's tested
// the same way RoundTracker/LiveMetrics themselves are: small hand-built frame sequences driving
// a real RoundTracker, with a real SpeedRunTracker listening in.

function emptyBoard() {
	return Array.from({ length: ROWS }, () =>
		Array.from({ length: COLS }, () => ({ type: 'empty' }))
	);
}

function boardWith(cells) {
	const board = emptyBoard();
	cells.forEach(({ col, row, ...cell }) => {
		board[row][col] = cell;
	});
	return board;
}

function frame({
	result = 'playing',
	level = 0,
	virus = null,
	cells = [],
	hasBottle = true,
	nextPill = null,
} = {}) {
	return { result, level, virus, board: boardWith(cells), hasBottle, nextPill };
}

// Populates a round up to round_ready at the given level/virus target, then clears every virus
// (firing virus_cleared down to 0) without ending the round -- the caller decides whether to end
// it via a stage_clear/game_over/topout frame next. advanceMsBeforeClear lets a test control
// exactly how much wall-clock time elapses before the virus-zero-crossing moment, since that's
// what SpeedRunTracker actually times a split against, not round_end.
function populateAndClear(
	roundTracker,
	level,
	virusTarget,
	advanceMsBeforeClear = 0
) {
	roundTracker.processFrame(frame({ level, virus: 0 })); // round_start
	roundTracker.processFrame(frame({ level, virus: virusTarget })); // round_ready
	if (advanceMsBeforeClear) {
		jest.setSystemTime(new Date(Date.now() + advanceMsBeforeClear));
	}
	roundTracker.processFrame(frame({ level, virus: 0 })); // virus_cleared, full delta at once
}

describe('SpeedRunTracker', () => {
	let roundTracker, tracker;

	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		roundTracker = new RoundTracker();
		tracker = new SpeedRunTracker(roundTracker);
		tracker.setLevelSet([4, 5, 6, 7]);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('starts idle with totalVirusesRemaining at the full level-set target', () => {
		const snapshot = tracker.getSnapshot();
		expect(snapshot.status).toBe('idle');
		expect(snapshot.elapsedMs).toBe(0);
		// virusTarget(4)=20, (5)=24, (6)=28, (7)=32
		expect(snapshot.totalVirusesRemaining).toBe(20 + 24 + 28 + 32);
	});

	it('does not start a run on a level outside the configured set', () => {
		roundTracker.processFrame(frame({ level: 0, virus: 0 })); // round_start at an unrelated level

		expect(tracker.getSnapshot().status).toBe('idle');
	});

	it("starts a run only once round_level_confirmed reports the set's first level", () => {
		roundTracker.processFrame(frame({ level: 4, virus: 0 })); // round_start + level confirmed

		const snapshot = tracker.getSnapshot();
		expect(snapshot.status).toBe('in_progress');
		expect(snapshot.currentLevel).toBe(4);
		expect(snapshot.currentLevelSetIndex).toBe(0);
		expect(snapshot.runStartTime).toBe(Date.parse('2024-01-01T00:00:00Z'));
	});

	it('records a split at level clear and advances to the next level in the set', () => {
		populateAndClear(roundTracker, 4, 20, 60000); // virus clears 60s after round start
		roundTracker.processFrame(frame({ result: 'stage_clear' })); // confirms shortly after

		const snapshot = tracker.getSnapshot();
		expect(snapshot.splits[4]).toBe(60000);
		expect(snapshot.currentLevelSetIndex).toBe(1);
		expect(snapshot.status).toBe('in_progress');
	});

	it('records the split at the virus-zero-crossing time, not at round_end time', () => {
		roundTracker.processFrame(frame({ level: 4, virus: 0 })); // round_start
		roundTracker.processFrame(frame({ level: 4, virus: 20 })); // round_ready

		jest.setSystemTime(new Date('2024-01-01T00:00:10Z')); // virus hits 0 at t=10s
		roundTracker.processFrame(frame({ level: 4, virus: 0 }));

		jest.setSystemTime(new Date('2024-01-01T00:00:14Z')); // round_end confirms 4s later
		roundTracker.processFrame(frame({ result: 'stage_clear' }));

		expect(tracker.getSnapshot().splits[4]).toBe(10000);
	});

	// See QualifyRunTracker.js's own test of the same name for the full live-report reasoning --
	// this tracker shares the identical split-timing mechanism (and vulnerability).
	it('falls back to round_end time when pendingClearTimestamp lags implausibly far behind it', () => {
		roundTracker.processFrame(frame({ level: 4, virus: 0 })); // round_start
		roundTracker.processFrame(frame({ level: 4, virus: 20 })); // round_ready

		jest.setSystemTime(new Date('2024-01-01T00:00:10Z')); // virus hits 0 at t=10s
		roundTracker.processFrame(frame({ level: 4, virus: 0 }));

		// something stalls play for 17s -- e.g. a pause -- before round_end actually confirms the
		// clear at t=27s, well past MAX_CLEAR_TIMESTAMP_LAG_MS
		jest.setSystemTime(new Date('2024-01-01T00:00:27Z'));
		roundTracker.processFrame(frame({ result: 'stage_clear' }));

		expect(tracker.getSnapshot().splits[4]).toBe(27000); // the real 27s, not the stale 10s
	});

	it('a mid-run topout-and-retry leaves runStartTime and prior splits untouched, and bumps attemptsPerLevel', () => {
		populateAndClear(roundTracker, 4, 20);
		roundTracker.processFrame(frame({ result: 'stage_clear' })); // level 4 done
		const runStartTime = tracker.getSnapshot().runStartTime;

		roundTracker.processFrame(frame({ level: 5, virus: 0 })); // round_start for level 5
		roundTracker.processFrame(frame({ level: 5, virus: 24 })); // round_ready
		roundTracker.processFrame(frame({ result: 'game_over' })); // topped out

		let snapshot = tracker.getSnapshot();
		expect(snapshot.status).toBe('in_progress');
		expect(snapshot.runStartTime).toBe(runStartTime);
		expect(snapshot.splits[4]).toBeDefined();
		expect(snapshot.splits[5]).toBeUndefined();
		expect(snapshot.currentLevelSetIndex).toBe(1); // still expecting level 5
		expect(snapshot.attemptsPerLevel[5]).toBe(1);

		// retry: same level reported again
		roundTracker.processFrame(frame({ level: 5, virus: 0 }));
		snapshot = tracker.getSnapshot();
		expect(snapshot.status).toBe('in_progress');
		expect(snapshot.runStartTime).toBe(runStartTime); // unchanged by the retry
	});

	it("completes the run on the last level's clear, freezing elapsedMs", () => {
		[
			[4, 20],
			[5, 24],
			[6, 28],
		].forEach(([level, target]) => {
			populateAndClear(roundTracker, level, target);
			roundTracker.processFrame(frame({ result: 'stage_clear' }));
		});

		// levels 4-6 above never advance the (fake) clock, so it's still at runStartTime (t=0)
		// here -- level 7's virus count reaches 0 five minutes after that.
		populateAndClear(roundTracker, 7, 32, 5 * 60 * 1000);
		roundTracker.processFrame(frame({ result: 'stage_clear' }));

		const snapshot = tracker.getSnapshot();
		expect(snapshot.status).toBe('complete');
		expect(snapshot.splits[7]).toBe(5 * 60 * 1000);
		expect(snapshot.elapsedMs).toBe(5 * 60 * 1000);
		expect(snapshot.totalVirusesRemaining).toBe(0);

		jest.setSystemTime(new Date('2024-01-01T00:06:00Z'));
		expect(tracker.getSnapshot().elapsedMs).toBe(5 * 60 * 1000); // still frozen
	});

	it('supports a single-level set ("overtime") with no special-casing', () => {
		tracker.setLevelSet([9]);

		populateAndClear(roundTracker, 9, 40, 30000);
		roundTracker.processFrame(frame({ result: 'stage_clear' }));

		const snapshot = tracker.getSnapshot();
		expect(snapshot.status).toBe('complete');
		expect(snapshot.splits[9]).toBe(30000);
	});

	it('reset() manually returns to idle regardless of progress', () => {
		roundTracker.processFrame(frame({ level: 4, virus: 0 }));
		expect(tracker.getSnapshot().status).toBe('in_progress');

		tracker.reset();

		const snapshot = tracker.getSnapshot();
		expect(snapshot.status).toBe('idle');
		expect(snapshot.runStartTime).toBeNull();
		expect(snapshot.splits).toEqual({});
	});

	it('setLevelSet() reconfigures and resets, starting a fresh run', () => {
		populateAndClear(roundTracker, 4, 20);
		roundTracker.processFrame(frame({ result: 'stage_clear' }));
		expect(tracker.getSnapshot().splits[4]).toBeDefined();

		tracker.setLevelSet([9, 10]);
		expect(tracker.getSnapshot().status).toBe('idle');
		expect(tracker.getSnapshot().splits).toEqual({});
	});

	describe('totalVirusesRemaining', () => {
		it('is the full level-set target while idle', () => {
			expect(tracker.getSnapshot().totalVirusesRemaining).toBe(
				20 + 24 + 28 + 32
			);
		});

		it('is current-level remaining plus full targets for untouched levels, mid-level', () => {
			roundTracker.processFrame(frame({ level: 4, virus: 0 })); // round_start
			roundTracker.processFrame(frame({ level: 4, virus: 20 })); // round_ready
			roundTracker.processFrame(frame({ level: 4, virus: 12 })); // 8 cleared

			// 12 remaining on level 4 + full targets for 5,6,7
			expect(tracker.getSnapshot().totalVirusesRemaining).toBe(
				12 + 24 + 28 + 32
			);
		});

		it('is a transient approximation right after a level clear, before the next level is confirmed', () => {
			populateAndClear(roundTracker, 4, 20);
			roundTracker.processFrame(frame({ result: 'stage_clear' }));

			// level 4 is done and currentLevelSetIndex has already advanced to point at level 5,
			// but currentLevel itself is still 4 (no round_start/round_level_confirmed for level 5
			// has fired yet) and remainingViruses was reset to null on round_end. So this falls
			// back to virusTarget(currentLevel) = virusTarget(4) = 20 for the "current level" term
			// -- a stale value -- plus the actual future levels (6, 7) only, since level 5 is
			// already excluded by the advanced index. Not a steady-state value, just documenting
			// the brief gap between round boundaries.
			expect(tracker.getSnapshot().totalVirusesRemaining).toBe(20 + 28 + 32);
		});

		it('is 0 once the run is complete', () => {
			[
				[4, 20],
				[5, 24],
				[6, 28],
			].forEach(([level, target]) => {
				populateAndClear(roundTracker, level, target);
				roundTracker.processFrame(frame({ result: 'stage_clear' }));
			});
			populateAndClear(roundTracker, 7, 32);
			roundTracker.processFrame(frame({ result: 'stage_clear' }));

			expect(tracker.getSnapshot().totalVirusesRemaining).toBe(0);
		});
	});

	describe('run_updated event', () => {
		it('fires with a snapshot on every change', () => {
			const events = [];
			tracker.addEventListener('run_updated', e => events.push(e.detail));

			roundTracker.processFrame(frame({ level: 4, virus: 0 })); // round_start

			expect(events.length).toBeGreaterThan(0);
			expect(events[events.length - 1].status).toBe('in_progress');
		});
	});
});
