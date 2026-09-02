import {
	describe,
	it,
	expect,
	beforeEach,
	afterEach,
	jest,
} from '@jest/globals';
import RoundTracker from '../public/producer/drmario/RoundTracker.js';
import LiveMetrics from '../public/producer/drmario/LiveMetrics.js';
import { COLS, ROWS } from '../public/producer/drmario/constants.js';

// LiveMetrics only ever reacts to RoundTracker's own events, never raw pixels, so it's tested
// the same way RoundTracker itself is: small hand-built frame sequences driving a real
// RoundTracker, with a real LiveMetrics listening in -- there's no OCR involved in what either
// does.

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

// A readable next-pill reading, used only to seed/restore RoundTracker's "was readable" baseline
// around each spawnPiece() call below -- see its own comment, and RoundTracker.js's
// #detectPillThrown, for why pill_thrown only fires on a *readable*-to-blank transition, not off
// an unknown/never-yet-observed starting state. The actual color is irrelevant to every test that
// uses this; only its readable-ness matters.
const READABLE_NEXT_PILL = {
	left: { type: 'pill', shape: 'left', color: 'red' },
	right: { type: 'pill', shape: 'right', color: 'red' },
};

// Spawns a piece at the fixed spawn columns, shows it one row lower (descent evidence -- see
// RoundTracker.js's header comment for why this is needed to reliably re-arm detection for the
// *next* spawn in a hand-built sequence with no next-pill data), then clears it away entirely.
// Also carries a next-pill reading that goes blank on the first frame (simulating the real game's
// own pill-throw animation) and back to readable afterward -- see RoundTracker.js's
// #detectPillThrown/pill_thrown -- so that consecutive calls correctly fire it once each (the
// caller must seed an initial READABLE_NEXT_PILL reading, e.g. on the frame that starts the
// round, before the first call -- see #detectPillThrown's own doc comment for why the very first
// frame of a round never fires it on its own).
function spawnPiece(tracker, leftColor, rightColor, virus = 0) {
	tracker.processFrame(
		frame({
			virus,
			nextPill: null, // blank during the throw
			cells: [
				{ col: 3, row: 0, type: 'pill', shape: 'left', color: leftColor },
				{ col: 4, row: 0, type: 'pill', shape: 'right', color: rightColor },
			],
		})
	);
	tracker.processFrame(
		frame({
			virus,
			nextPill: READABLE_NEXT_PILL, // readable again, showing the next piece in the queue
			cells: [
				{ col: 3, row: 1, type: 'pill', shape: 'left', color: leftColor },
				{ col: 4, row: 1, type: 'pill', shape: 'right', color: rightColor },
			],
		})
	);
	tracker.processFrame(frame({ virus, nextPill: READABLE_NEXT_PILL }));
}

describe('LiveMetrics', () => {
	let roundTracker, stats;

	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		roundTracker = new RoundTracker();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('rate stats', () => {
		beforeEach(() => {
			stats = new LiveMetrics(roundTracker);
		});

		it('computes pieces/minute from pieces placed since the run started', () => {
			// nextPill seeds the "readable" baseline #detectPillThrown needs before it will fire
			// on the first spawnPiece() call's own blank frame -- see spawnPiece()'s own comment.
			roundTracker.processFrame(
				frame({ virus: 0, nextPill: READABLE_NEXT_PILL })
			); // round_start -> run starts now

			spawnPiece(roundTracker, 'red', 'blue');
			spawnPiece(roundTracker, 'yellow', 'red');
			spawnPiece(roundTracker, 'blue', 'yellow');

			jest.setSystemTime(new Date('2024-01-01T00:00:30Z')); // 30s later

			expect(stats.getSnapshot().piecesPerMinute).toBeCloseTo(6); // 3 pieces / 0.5 min
		});

		it('computes virus-clears/minute from the virus_cleared delta', () => {
			roundTracker.processFrame(frame({ level: 0, virus: 4 })); // round_start + round_ready

			roundTracker.processFrame(frame({ virus: 3 })); // 1 cleared
			roundTracker.processFrame(frame({ virus: 1 })); // 2 more cleared

			jest.setSystemTime(new Date('2024-01-01T00:01:00Z')); // 1 minute later

			expect(stats.getSnapshot().virusClearsPerMinute).toBeCloseTo(3); // 3 total / 1 min
		});

		it('reports 0 for both rates before any round has started', () => {
			const snapshot = stats.getSnapshot();
			expect(snapshot.piecesPerMinute).toBe(0);
			expect(snapshot.virusClearsPerMinute).toBe(0);
		});
	});

	describe('color droughts', () => {
		beforeEach(() => {
			stats = new LiveMetrics(roundTracker);
			roundTracker.processFrame(frame({ virus: 0 })); // round_start
		});

		it('zeroes a color on any piece containing it, increments the others', () => {
			spawnPiece(roundTracker, 'red', 'blue');
			expect(stats.getSnapshot().colorDroughts).toEqual({
				red: 0,
				blue: 0,
				yellow: 1,
			});

			spawnPiece(roundTracker, 'yellow', 'yellow');
			expect(stats.getSnapshot().colorDroughts).toEqual({
				red: 1,
				blue: 1,
				yellow: 0,
			});

			spawnPiece(roundTracker, 'red', 'red');
			expect(stats.getSnapshot().colorDroughts).toEqual({
				red: 0,
				blue: 2,
				yellow: 1,
			});
		});
	});

	describe('rush streak', () => {
		beforeEach(() => {
			stats = new LiveMetrics(roundTracker);
			roundTracker.processFrame(frame({ virus: 0 })); // round_start
		});

		it('flags isRushing once the exact same piece (including orientation) repeats 3+ times', () => {
			spawnPiece(roundTracker, 'red', 'red');
			expect(stats.getSnapshot().isRushing).toBe(false);

			spawnPiece(roundTracker, 'red', 'red');
			expect(stats.getSnapshot().isRushing).toBe(false);

			spawnPiece(roundTracker, 'red', 'red');
			const snapshot = stats.getSnapshot();
			expect(snapshot.isRushing).toBe(true);
			expect(snapshot.rushStreak).toBe(3);
			expect(snapshot.maxRushStreak).toBe(3);
		});

		it('does not count a same-color-set piece with swapped orientation as a repeat -- reproduces the confirmed example', () => {
			// blue-red, blue-red, red-blue, blue-red is NOT a rush (per the user's own example)
			spawnPiece(roundTracker, 'blue', 'red');
			spawnPiece(roundTracker, 'blue', 'red'); // streak now 2
			spawnPiece(roundTracker, 'red', 'blue'); // orientation swapped -- breaks the streak
			spawnPiece(roundTracker, 'blue', 'red'); // streak restarts at 1

			const snapshot = stats.getSnapshot();
			expect(snapshot.isRushing).toBe(false);
			expect(snapshot.rushStreak).toBe(1);
			expect(snapshot.maxRushStreak).toBe(2); // the best it ever reached
		});

		it('resets the streak on a genuinely different piece', () => {
			spawnPiece(roundTracker, 'red', 'red');
			spawnPiece(roundTracker, 'red', 'red');
			spawnPiece(roundTracker, 'blue', 'yellow');

			expect(stats.getSnapshot().rushStreak).toBe(1);
		});
	});

	describe('garbage sent (versus)', () => {
		beforeEach(() => {
			stats = new LiveMetrics(roundTracker);
		});

		it('accumulates waves sent, average wave size, and SALT across multiple calls', () => {
			stats.recordGarbageSent({ cellCount: 2, maxRestRows: 4 }); // 1s
			stats.recordGarbageSent({ cellCount: 4, maxRestRows: 8 }); // 2s

			const snapshot = stats.getSnapshot();
			expect(snapshot.garbageWavesSent).toBe(2);
			expect(snapshot.averageGarbageWaveSize).toBe(3); // (2 + 4) / 2 waves
			expect(snapshot.saltSeconds).toBeCloseTo(3); // 4*0.25 + 8*0.25
		});

		it('reports 0 waves sent, average wave size, and SALT before any wave has been recorded', () => {
			const snapshot = stats.getSnapshot();
			expect(snapshot.garbageWavesSent).toBe(0);
			expect(snapshot.averageGarbageWaveSize).toBe(0);
			expect(snapshot.saltSeconds).toBe(0);
		});
	});

	describe('run vs. round reset (single-player carryAcrossLevels)', () => {
		it('does not reset pace stats across a stage_clear -> next round_start, with carryAcrossLevels', () => {
			stats = new LiveMetrics(roundTracker, { carryAcrossLevels: true });

			roundTracker.processFrame(
				frame({ virus: 0, nextPill: READABLE_NEXT_PILL })
			); // round_start
			spawnPiece(roundTracker, 'red', 'blue');
			spawnPiece(roundTracker, 'yellow', 'red');

			roundTracker.processFrame(frame({ result: 'stage_clear' })); // level cleared
			roundTracker.processFrame(
				frame({ level: 1, virus: 0, nextPill: READABLE_NEXT_PILL })
			); // next level, same run -- re-seeds the baseline for the same reason as round_start

			// pace (pieces/minute) survived the level transition
			spawnPiece(roundTracker, 'blue', 'yellow');
			jest.setSystemTime(new Date('2024-01-01T00:00:30Z'));
			expect(stats.getSnapshot().piecesPerMinute).toBeCloseTo(6); // 3 pieces total / 0.5 min
		});

		it('resets rush/drought stats on every new level, even with carryAcrossLevels', () => {
			stats = new LiveMetrics(roundTracker, { carryAcrossLevels: true });

			roundTracker.processFrame(frame({ virus: 0 })); // round_start
			spawnPiece(roundTracker, 'red', 'blue');
			spawnPiece(roundTracker, 'red', 'blue');
			expect(stats.getSnapshot().colorDroughts.yellow).toBeGreaterThan(0);
			expect(stats.getSnapshot().rushStreak).toBe(2);

			roundTracker.processFrame(frame({ result: 'stage_clear' })); // level cleared
			roundTracker.processFrame(frame({ level: 1, virus: 0 })); // next level, same run

			const snapshot = stats.getSnapshot();
			expect(snapshot.colorDroughts).toEqual({ red: 0, blue: 0, yellow: 0 });
			expect(snapshot.rushStreak).toBe(0);
			expect(snapshot.maxRushStreak).toBe(0);
			expect(snapshot.isRushing).toBe(false);
		});

		it('does reset when the previous round ended in game_over, even with carryAcrossLevels', () => {
			stats = new LiveMetrics(roundTracker, { carryAcrossLevels: true });

			roundTracker.processFrame(frame({ virus: 0 })); // round_start
			spawnPiece(roundTracker, 'red', 'blue');

			roundTracker.processFrame(frame({ result: 'game_over' })); // run actually over
			roundTracker.processFrame(frame({ level: 0, virus: 0 })); // a fresh run begins

			expect(stats.getSnapshot().colorDroughts).toEqual({
				red: 0,
				blue: 0,
				yellow: 0,
			});
		});

		it('resets on every round_start regardless of outcome when carryAcrossLevels is not set (versus default)', () => {
			stats = new LiveMetrics(roundTracker); // default: no carryAcrossLevels

			roundTracker.processFrame(frame({ virus: 0 })); // round_start
			spawnPiece(roundTracker, 'red', 'blue');

			roundTracker.processFrame(frame({ result: 'stage_clear' }));
			roundTracker.processFrame(frame({ level: 0, virus: 0 })); // next round

			expect(stats.getSnapshot().colorDroughts).toEqual({
				red: 0,
				blue: 0,
				yellow: 0,
			});
		});
	});

	describe('resetRun()', () => {
		it('manually zeroes everything regardless of automatic detection', () => {
			stats = new LiveMetrics(roundTracker, { carryAcrossLevels: true });

			roundTracker.processFrame(frame({ virus: 0 }));
			spawnPiece(roundTracker, 'red', 'blue');
			stats.recordGarbageSent({ cellCount: 2, maxRestRows: 4 });

			stats.resetRun();

			const snapshot = stats.getSnapshot();
			expect(snapshot.colorDroughts).toEqual({ red: 0, blue: 0, yellow: 0 });
			expect(snapshot.averageGarbageWaveSize).toBe(0);
			expect(snapshot.saltSeconds).toBe(0);
		});
	});

	describe('stats_updated event', () => {
		it('fires with a snapshot on every change', () => {
			stats = new LiveMetrics(roundTracker);
			const events = [];
			stats.addEventListener('stats_updated', e => events.push(e.detail));

			roundTracker.processFrame(frame({ virus: 0 })); // round_start -> reset -> 1 event

			expect(events).toHaveLength(1);
			expect(events[0].piecesPerMinute).toBe(0);
		});
	});
});
