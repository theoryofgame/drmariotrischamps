import {
	describe,
	it,
	expect,
	beforeEach,
	afterEach,
	jest,
} from '@jest/globals';
import RoundTracker from '../public/producer/drmario/RoundTracker.js';
import QualifyRunTracker from '../public/producer/drmario/QualifyRunTracker.js';
import { COLS, ROWS } from '../public/producer/drmario/constants.js';

// Same hand-built-frame-sequence approach as DrMarioSpeedRunTracker.test.js -- QualifyRunTracker
// only ever reacts to RoundTracker's own events, never raw pixels.

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

describe('QualifyRunTracker', () => {
	let roundTracker, tracker;

	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		roundTracker = new RoundTracker();
		tracker = new QualifyRunTracker(roundTracker);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('starts idle', () => {
		const snapshot = tracker.getSnapshot();
		expect(snapshot.status).toBe('idle');
		expect(snapshot.elapsedMs).toBe(0);
		expect(snapshot.currentLevelElapsedMs).toBeNull();
		expect(snapshot.qualifySnapshot).toBeNull();
	});

	it('starts a run on the first level observed, regardless of which level it is', () => {
		roundTracker.processFrame(frame({ level: 0, virus: 0 })); // round_start

		const snapshot = tracker.getSnapshot();
		expect(snapshot.status).toBe('in_progress');
		expect(snapshot.currentLevel).toBe(0);
		expect(snapshot.runStartTime).toBe(Date.parse('2024-01-01T00:00:00Z'));
	});

	it("tracks the current level's own elapsed time from run start", () => {
		roundTracker.processFrame(frame({ level: 0, virus: 0 })); // round_start
		jest.setSystemTime(new Date('2024-01-01T00:01:30Z'));

		expect(tracker.getSnapshot().currentLevelElapsedMs).toBe(90000);
	});

	it('records this-level/last-level durations across a level clear', () => {
		populateAndClear(roundTracker, 0, 4, 60000); // level 0 clears at t=60s
		roundTracker.processFrame(frame({ result: 'stage_clear' }));
		roundTracker.processFrame(frame({ level: 1, virus: 0 })); // round_start for level 1

		let snapshot = tracker.getSnapshot();
		expect(snapshot.previousLevelElapsedMs).toBe(60000);
		expect(snapshot.currentLevelElapsedMs).toBe(0); // just started level 1

		jest.setSystemTime(new Date('2024-01-01T00:01:30Z')); // 30s into level 1
		snapshot = tracker.getSnapshot();
		expect(snapshot.currentLevelElapsedMs).toBe(30000);
		expect(snapshot.previousLevelElapsedMs).toBe(60000); // unchanged
	});

	it('records the split at the virus-zero-crossing time, not at round_end time', () => {
		roundTracker.processFrame(frame({ level: 0, virus: 0 })); // round_start
		roundTracker.processFrame(frame({ level: 0, virus: 4 })); // round_ready

		jest.setSystemTime(new Date('2024-01-01T00:00:10Z')); // virus hits 0 at t=10s
		roundTracker.processFrame(frame({ level: 0, virus: 0 }));

		jest.setSystemTime(new Date('2024-01-01T00:00:14Z')); // round_end confirms 4s later
		roundTracker.processFrame(frame({ result: 'stage_clear' }));
		roundTracker.processFrame(frame({ level: 1, virus: 0 }));

		expect(tracker.getSnapshot().previousLevelElapsedMs).toBe(10000);
	});

	it('ends the run on topout/game_over rather than treating it as a same-level retry', () => {
		roundTracker.processFrame(frame({ level: 0, virus: 0 })); // round_start
		jest.setSystemTime(new Date('2024-01-01T00:02:00Z'));
		roundTracker.processFrame(frame({ result: 'game_over' }));

		const snapshot = tracker.getSnapshot();
		expect(snapshot.status).toBe('ended');
		expect(snapshot.elapsedMs).toBe(120000);

		// elapsedMs stays frozen even as real time keeps advancing
		jest.setSystemTime(new Date('2024-01-01T00:05:00Z'));
		expect(tracker.getSnapshot().elapsedMs).toBe(120000);
	});

	it('a fresh round_start after an ended run does not resume it -- only reset() does', () => {
		roundTracker.processFrame(frame({ level: 0, virus: 0 })); // round_start
		roundTracker.processFrame(frame({ result: 'topout' })); // round_end -> ended
		expect(tracker.getSnapshot().status).toBe('ended');

		// RoundTracker itself already begins a new round right after the topout (a real continued
		// play session would look exactly like this) -- QualifyRunTracker must not resume from
		// that alone.
		roundTracker.processFrame(frame({ level: 0, virus: 0 }));
		expect(tracker.getSnapshot().status).toBe('ended');
		expect(tracker.getSnapshot().currentLevel).toBe(0); // unchanged from before the topout

		tracker.reset();
		expect(tracker.getSnapshot().status).toBe('idle');

		// reset() alone doesn't retroactively attach to the round already in flight -- only the
		// next genuinely new round boundary (this round ending, then a fresh one starting) does.
		roundTracker.processFrame(frame({ result: 'topout' }));
		roundTracker.processFrame(frame({ level: 0, virus: 0 }));
		expect(tracker.getSnapshot().status).toBe('in_progress');
	});

	describe('checkQualifySnapshot', () => {
		it('does nothing before 30 minutes have elapsed', () => {
			roundTracker.processFrame(frame({ level: 5, virus: 0 }));
			jest.setSystemTime(new Date('2024-01-01T00:29:59Z'));

			tracker.checkQualifySnapshot();

			expect(tracker.getSnapshot().qualifySnapshot).toBeNull();
		});

		it('captures level + remaining viruses exactly once elapsed time reaches 30 minutes', () => {
			roundTracker.processFrame(frame({ level: 13, virus: 0 })); // round_start
			roundTracker.processFrame(frame({ level: 13, virus: 56 })); // round_ready
			roundTracker.processFrame(frame({ level: 13, virus: 32 })); // 24 cleared

			jest.setSystemTime(new Date('2024-01-01T00:30:00Z'));
			tracker.checkQualifySnapshot();

			expect(tracker.getSnapshot().qualifySnapshot).toEqual({
				level: 13,
				remainingViruses: 32,
			});
		});

		it('never overwrites the snapshot even as level/viruses keep changing afterward', () => {
			roundTracker.processFrame(frame({ level: 13, virus: 0 }));
			roundTracker.processFrame(frame({ level: 13, virus: 56 }));

			jest.setSystemTime(new Date('2024-01-01T00:30:00Z'));
			tracker.checkQualifySnapshot();
			expect(tracker.getSnapshot().qualifySnapshot).toEqual({
				level: 13,
				remainingViruses: 56,
			});

			// keeps playing well past the mark -- clears level 13, starts level 14
			roundTracker.processFrame(frame({ level: 13, virus: 0 }));
			roundTracker.processFrame(frame({ result: 'stage_clear' }));
			roundTracker.processFrame(frame({ level: 14, virus: 0 }));
			jest.setSystemTime(new Date('2024-01-01T00:45:00Z'));
			tracker.checkQualifySnapshot();

			expect(tracker.getSnapshot().qualifySnapshot).toEqual({
				level: 13,
				remainingViruses: 56,
			});
		});

		it('stays null forever if the run ends before reaching 30 minutes', () => {
			roundTracker.processFrame(frame({ level: 5, virus: 0 }));
			jest.setSystemTime(new Date('2024-01-01T00:10:00Z'));
			roundTracker.processFrame(frame({ result: 'game_over' }));

			tracker.checkQualifySnapshot();

			expect(tracker.getSnapshot().qualifySnapshot).toBeNull();
		});
	});

	describe('run_updated event', () => {
		it('fires with a snapshot on every change', () => {
			const events = [];
			tracker.addEventListener('run_updated', e => events.push(e.detail));

			roundTracker.processFrame(frame({ level: 0, virus: 0 }));

			expect(events.length).toBeGreaterThan(0);
			expect(events[events.length - 1].status).toBe('in_progress');
		});
	});
});
