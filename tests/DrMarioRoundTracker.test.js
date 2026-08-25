import { describe, it, expect, beforeEach } from '@jest/globals';
import RoundTracker from '../public/producer/drmario/RoundTracker.js';
import { COLS, ROWS } from '../public/producer/drmario/constants.js';

// RoundTracker only ever looks at already-decoded frame data (board/level/virus/result), never
// raw pixels, so it's tested against small hand-built frame sequences rather than image
// fixtures -- there's no OCR involved in what it does.

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
} = {}) {
	return { result, level, virus, board: boardWith(cells) };
}

function collectEvents(tracker, ...types) {
	const events = [];
	types.forEach(type => {
		tracker.addEventListener(type, e =>
			events.push({ type, detail: e.detail })
		);
	});
	return events;
}

describe('RoundTracker', () => {
	let tracker, events;

	beforeEach(() => {
		tracker = new RoundTracker();
		events = collectEvents(
			tracker,
			'round_start',
			'round_ready',
			'round_end',
			'piece_entered'
		);
	});

	describe('round lifecycle', () => {
		it('starts a round on the first playing frame, tracks population, then flags it ready', () => {
			// level 0 -> target = 4 * (0 + 1) = 4
			tracker.processFrame(frame({ level: 0, virus: 0 }));
			expect(events.map(e => e.type)).toEqual(['round_start']);
			expect(events[0].detail).toEqual({
				roundId: 1,
				level: 0,
				virusTarget: 4,
			});

			tracker.processFrame(frame({ level: 0, virus: 2 }));
			expect(events.map(e => e.type)).toEqual(['round_start']); // no new event yet

			tracker.processFrame(frame({ level: 0, virus: 4 }));
			expect(events.map(e => e.type)).toEqual(['round_start', 'round_ready']);
			expect(events[1].detail).toEqual({ roundId: 1, virusCount: 4 });
		});

		it('caps the virus target at 84 for level 21+ instead of letting 4*(level+1) keep climbing', () => {
			tracker.processFrame(frame({ level: 21, virus: 0 }));
			expect(events[0].detail).toEqual({
				roundId: 1,
				level: 21,
				virusTarget: 84,
			});

			// without the cap this would need virus: 88 to ever fire round_ready
			tracker.processFrame(frame({ level: 21, virus: 84 }));
			expect(events.map(e => e.type)).toEqual(['round_start', 'round_ready']);
		});

		it('fires round_end exactly once when the result leaves "playing", not every frame, with virus count frozen at its last real value', () => {
			tracker.processFrame(frame({ level: 0, virus: 4 }));
			events.length = 0;

			// the end-screen frame doesn't carry a meaningful virus count; round_end should
			// report the last one actually observed during play (4), not this frame's
			tracker.processFrame(frame({ result: 'stage_clear', virus: 0 }));
			tracker.processFrame(frame({ result: 'stage_clear', virus: 0 }));
			tracker.processFrame(frame({ result: 'stage_clear', virus: 0 }));

			expect(events).toEqual([
				{
					type: 'round_end',
					detail: { roundId: 1, outcome: 'stage_clear', virusCount: 4 },
				},
			]);
		});

		it('starts a new round (new id) once play resumes after a round ends', () => {
			tracker.processFrame(frame({ level: 0, virus: 4 }));
			tracker.processFrame(frame({ result: 'stage_clear' }));
			events.length = 0;

			tracker.processFrame(frame({ level: 3, virus: 0 }));

			expect(events).toEqual([
				{
					type: 'round_start',
					detail: { roundId: 2, level: 3, virusTarget: 16 },
				},
			]);
		});
	});

	describe('piece entry detection', () => {
		it('fires once when a pill half appears at the top row, not on every frame it stays there', () => {
			tracker.processFrame(frame({ virus: 0 })); // round_start, empty board
			events.length = 0;

			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 3, row: 0, type: 'pill', shape: 'left', color: 'blue' },
						{ col: 4, row: 0, type: 'pill', shape: 'right', color: 'blue' },
					],
				})
			);
			expect(events).toEqual([
				{
					type: 'piece_entered',
					detail: { roundId: 1, col: 3, shape: 'left', color: 'blue' },
				},
				{
					type: 'piece_entered',
					detail: { roundId: 1, col: 4, shape: 'right', color: 'blue' },
				},
			]);

			events.length = 0;
			// same piece, one row lower -- still occupying col 3/4, just not row 0 anymore
			tracker.processFrame(frame({ virus: 0 }));
			tracker.processFrame(frame({ virus: 0 }));
			expect(events).toEqual([]); // no re-fire just because time passed
		});

		it("detects each spawn of a 'rush' of identically-colored pills, since detection is position-based, not color-diff-based", () => {
			tracker.processFrame(frame({ virus: 0 })); // round_start
			events.length = 0;

			const bluePill = [
				{ col: 3, row: 0, type: 'pill', shape: 'left', color: 'blue' },
				{ col: 4, row: 0, type: 'pill', shape: 'right', color: 'blue' },
			];

			// first blue-blue pill spawns, then clears the top row as it falls
			tracker.processFrame(frame({ virus: 0, cells: bluePill }));
			tracker.processFrame(frame({ virus: 0 })); // top row empty again (piece fell)

			// second blue-blue pill spawns -- identical color to the last one
			tracker.processFrame(frame({ virus: 0, cells: bluePill }));

			expect(events.filter(e => e.type === 'piece_entered')).toHaveLength(4); // 2 columns x 2 spawns
		});

		it('detects a lone half entering a column other than the spawn columns (groundwork for garbage)', () => {
			tracker.processFrame(frame({ virus: 0 }));
			events.length = 0;

			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 0, row: 0, type: 'pill', shape: 'single', color: 'red' },
					],
				})
			);

			expect(events).toEqual([
				{
					type: 'piece_entered',
					detail: { roundId: 1, col: 0, shape: 'single', color: 'red' },
				},
			]);
		});

		it('ignores viruses appearing at the top row during population', () => {
			tracker.processFrame(frame({ virus: 0 }));
			events.length = 0;

			tracker.processFrame(
				frame({
					virus: 1,
					cells: [{ col: 2, row: 0, type: 'virus', color: 'yellow', frame: 0 }],
				})
			);

			expect(events.filter(e => e.type === 'piece_entered')).toEqual([]);
		});
	});
});
