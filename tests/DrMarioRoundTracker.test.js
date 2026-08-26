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
	hasBottle = true,
	nextPill = null,
} = {}) {
	return { result, level, virus, board: boardWith(cells), hasBottle, nextPill };
}

// Matches BoardOCR.identifyNextPill()'s return shape. Omitted (frame()'s default of
// nextPill: null) means "couldn't read it this frame" -- RoundTracker treats that as
// inconclusive rather than as evidence either way.
function nextPill(leftColor, rightColor) {
	return {
		left: { type: 'pill', shape: 'left', color: leftColor },
		right: { type: 'pill', shape: 'right', color: rightColor },
	};
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
			'round_level_confirmed',
			'round_ready',
			'round_end',
			'piece_entered',
			'garbage_entered'
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

		it('endRound() fires round_end with the given outcome for a round that has no result of its own (versus: the other bottle winning/losing)', () => {
			tracker.processFrame(frame({ level: 0, virus: 4 }));
			events.length = 0;

			tracker.endRound('opponent_stage_clear');

			expect(events).toEqual([
				{
					type: 'round_end',
					detail: {
						roundId: 1,
						outcome: 'opponent_stage_clear',
						virusCount: 4,
					},
				},
			]);
		});

		it('endRound() is a no-op if this bottle already ended its own round -- no double-fire from cross-wiring both trackers', () => {
			tracker.processFrame(frame({ level: 0, virus: 4 }));
			tracker.processFrame(frame({ result: 'topout' }));
			events.length = 0;

			tracker.endRound('opponent_stage_clear');

			expect(events).toEqual([]);
		});

		it('does not self-detect a new round after endRound() -- waits for syncRoundStart() instead, even once its own board data already looks like a new round', () => {
			tracker.processFrame(frame({ level: 0, virus: 4 }));
			tracker.endRound('opponent_topout');
			events.length = 0;

			// this bottle's own board/panel can already reflect the next round before the
			// opponent's own win/loss overlay has cleared (confirmed live) -- self-detecting off
			// that would fire a round_start a real amount of time before the actually-affected
			// bottle's own (later, real) round_start does, which is the bug being fixed here
			tracker.processFrame(frame({ level: 3, virus: 0 }));
			tracker.processFrame(frame({ level: 3, virus: 5 }));

			expect(events).toEqual([]);
		});

		it('syncRoundStart() starts the next round with the given roundId, but never borrows level from the linked tracker -- each player sets their own level independently', () => {
			tracker.processFrame(frame({ level: 0, virus: 4 }));
			tracker.endRound('opponent_topout');
			events.length = 0;

			// reproduces a live bug report: the linked tracker relayed its own level (0) here,
			// which incorrectly forced this bottle onto the same target even though it was really
			// on level 7 (target 32) -- causing round_ready to fire far too early
			tracker.syncRoundStart({ roundId: 2 });

			expect(events).toEqual([
				{
					type: 'round_start',
					detail: { roundId: 2, level: null, virusTarget: null },
				},
			]);

			// this bottle's own (independent) level self-heals from its own frames exactly like
			// an ordinary unreadable-at-round_start case
			events.length = 0;
			tracker.processFrame(frame({ level: 7, virus: 2 }));
			expect(events).toEqual([
				{
					type: 'round_level_confirmed',
					detail: { roundId: 2, level: 7, virusTarget: 32 },
				},
			]);

			events.length = 0;
			tracker.processFrame(frame({ level: 7, virus: 32 }));
			expect(events).toEqual([
				{
					type: 'round_ready',
					detail: { roundId: 2, virusCount: 32 },
				},
			]);
		});

		it('syncRoundStart() is a no-op if this tracker was not actually waiting for one', () => {
			tracker.processFrame(frame({ level: 0, virus: 4 })); // round_start, self-detected
			events.length = 0;

			tracker.syncRoundStart({ roundId: 99 });

			expect(events).toEqual([]);
		});

		it('keeps picking up level (and its virus target) on later frames if it was unreadable on the round_start frame, confirming it via round_level_confirmed', () => {
			// e.g. an unstable read right at a round boundary -- reported live, not yet tied to
			// a specific captured cause (possibly whatever screen precedes round start)
			tracker.processFrame(frame({ level: null, virus: null }));
			expect(events).toEqual([
				{
					type: 'round_start',
					detail: { roundId: 1, level: null, virusTarget: null },
				},
			]);

			// level becomes readable on a later frame, still mid-population
			tracker.processFrame(frame({ level: 5, virus: 2 }));
			tracker.processFrame(frame({ level: 5, virus: 24 })); // target = 4 * (5 + 1) = 24

			expect(events.map(e => e.type)).toEqual([
				'round_start',
				'round_level_confirmed',
				'round_ready',
			]);
			expect(events[1].detail).toEqual({
				roundId: 1,
				level: 5,
				virusTarget: 24,
			});
			expect(events[2].detail).toEqual({ roundId: 1, virusCount: 24 });
		});

		it('does not fire round_level_confirmed when level was already known at round_start', () => {
			tracker.processFrame(frame({ level: 0, virus: 0 }));
			tracker.processFrame(frame({ level: 0, virus: 4 }));

			expect(events.map(e => e.type)).toEqual(['round_start', 'round_ready']);
		});
	});

	describe('piece entry detection', () => {
		const bluePill = [
			{ col: 3, row: 0, type: 'pill', shape: 'left', color: 'blue' },
			{ col: 4, row: 0, type: 'pill', shape: 'right', color: 'blue' },
		];

		it('fires once, with both halves, when a pill appears at the top row -- not on every frame it stays there', () => {
			tracker.processFrame(frame({ virus: 0 })); // round_start, empty board
			events.length = 0;

			tracker.processFrame(frame({ virus: 0, cells: bluePill }));
			expect(events).toEqual([
				{
					type: 'piece_entered',
					detail: {
						roundId: 1,
						cells: [
							{ col: 3, shape: 'left', color: 'blue' },
							{ col: 4, shape: 'right', color: 'blue' },
						],
					},
				},
			]);

			events.length = 0;
			// same piece, one row lower -- still occupying col 3/4, just not row 0 anymore
			tracker.processFrame(frame({ virus: 0 }));
			tracker.processFrame(frame({ virus: 0 }));
			expect(events).toEqual([]); // no re-fire just because time passed
		});

		it('does NOT re-fire while the player shifts the same piece sideways across row 0 before it falls', () => {
			// reproduces a live bug report: moving/rotating a piece that's still sitting in row
			// 0 slid it through columns 3 -> 2 -> 1, and each new column falsely looked like a
			// separate new piece under the old per-column detection
			tracker.processFrame(frame({ virus: 0 })); // round_start
			events.length = 0;

			tracker.processFrame(frame({ virus: 0, cells: bluePill })); // spawns at col 3/4
			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 2, row: 0, type: 'pill', shape: 'left', color: 'blue' },
						{ col: 3, row: 0, type: 'pill', shape: 'right', color: 'blue' },
					],
				})
			); // shifted left by 1
			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 1, row: 0, type: 'pill', shape: 'left', color: 'blue' },
						{ col: 2, row: 0, type: 'pill', shape: 'right', color: 'blue' },
					],
				})
			); // shifted left again

			expect(events.filter(e => e.type === 'piece_entered')).toHaveLength(1);
		});

		it("detects each spawn of a 'rush' of identically-colored pills, using descent evidence since color alone can't tell them apart", () => {
			tracker.processFrame(frame({ virus: 0 })); // round_start
			events.length = 0;

			// first blue-blue pill spawns...
			tracker.processFrame(frame({ virus: 0, cells: bluePill }));
			// ...and is seen one row lower -- real descent, proving it's actually falling rather
			// than just sitting in row 0 -- before locking somewhere off top row
			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 3, row: 1, type: 'pill', shape: 'left', color: 'blue' },
						{ col: 4, row: 1, type: 'pill', shape: 'right', color: 'blue' },
					],
				})
			);
			tracker.processFrame(frame({ virus: 0 })); // top row empty again

			// second blue-blue pill spawns -- identical color to the last one, but the descent
			// observed in between is what proves this is a genuinely new piece, not color
			tracker.processFrame(frame({ virus: 0, cells: bluePill }));

			expect(events.filter(e => e.type === 'piece_entered')).toHaveLength(2);
		});

		it('does not re-fire when a piece is rotated through vertical and back to horizontal in place (colors reversed) -- reproduces a live bug report', () => {
			const redYellowPill = [
				{ col: 3, row: 0, type: 'pill', shape: 'left', color: 'red' },
				{ col: 4, row: 0, type: 'pill', shape: 'right', color: 'yellow' },
			];

			tracker.processFrame(frame({ virus: 0 })); // round_start
			events.length = 0;

			tracker.processFrame(frame({ virus: 0, cells: redYellowPill })); // spawns at col 3/4
			// rotated to vertical -- only the pivot (col 3) remains on row 0; the other half moves
			// up, off the top of the bottle (per confirmed report), so col 4 goes empty
			tracker.processFrame(
				frame({
					virus: 0,
					cells: [{ col: 3, row: 0, type: 'pill', shape: 'top', color: 'red' }],
				})
			);
			// rotated back to horizontal -- same piece, but which color sits on which side has
			// flipped (reproduces the exact live-log pattern: red/yellow -> yellow/red)
			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 3, row: 0, type: 'pill', shape: 'left', color: 'yellow' },
						{ col: 4, row: 0, type: 'pill', shape: 'right', color: 'red' },
					],
				})
			);

			expect(events.filter(e => e.type === 'piece_entered')).toHaveLength(1);
		});

		it('does not re-fire when a piece shifts off the spawn pair and back onto it before falling -- reproduces a live bug report', () => {
			tracker.processFrame(frame({ virus: 0 })); // round_start
			events.length = 0;

			tracker.processFrame(frame({ virus: 0, cells: bluePill })); // spawns at col 3/4
			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 2, row: 0, type: 'pill', shape: 'left', color: 'blue' },
						{ col: 3, row: 0, type: 'pill', shape: 'right', color: 'blue' },
					],
				})
			); // shifted left -- spawn pair no longer both occupied
			tracker.processFrame(frame({ virus: 0, cells: bluePill })); // shifted back onto col 3/4

			expect(events.filter(e => e.type === 'piece_entered')).toHaveLength(1);
		});

		it('confirms a genuine new spawn via the next-pill preview changing, even with no descent evidence observed', () => {
			tracker.processFrame(
				frame({ virus: 0, nextPill: nextPill('red', 'yellow') })
			); // round_start
			events.length = 0;

			// first piece spawns; preview reveals what comes after it
			tracker.processFrame(
				frame({
					virus: 0,
					cells: bluePill,
					nextPill: nextPill('red', 'yellow'),
				})
			);
			// it locks immediately (no descent ever observed -- e.g. flush against a tall stack);
			// the spawn pair reads empty for a frame with the preview still unchanged
			tracker.processFrame(
				frame({ virus: 0, nextPill: nextPill('red', 'yellow') })
			);
			// the previewed piece spawns; the preview updates to reveal the *next* one
			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 3, row: 0, type: 'pill', shape: 'left', color: 'red' },
						{ col: 4, row: 0, type: 'pill', shape: 'right', color: 'yellow' },
					],
					nextPill: nextPill('yellow', 'blue'),
				})
			);

			expect(events.filter(e => e.type === 'piece_entered')).toHaveLength(2);
		});

		it('documents the accepted blind spot: two real consecutive spawns sharing a color pair, with no descent observed, under-count as one', () => {
			// Both disambiguating signals are unavailable here on purpose: the piece never shows
			// descent (as if it locked flush against a tall stack), and by coincidence shares its
			// color pair with the very next spawn -- see the header comment on RoundTracker for
			// why this specific combination is the one case that isn't closed.
			tracker.processFrame(
				frame({ virus: 0, nextPill: nextPill('blue', 'blue') })
			); // round_start
			events.length = 0;

			tracker.processFrame(
				frame({ virus: 0, cells: bluePill, nextPill: nextPill('blue', 'blue') })
			);
			tracker.processFrame(
				frame({ virus: 0, nextPill: nextPill('blue', 'blue') })
			); // locks, no descent seen
			tracker.processFrame(
				frame({ virus: 0, cells: bluePill, nextPill: nextPill('blue', 'blue') })
			);

			expect(events.filter(e => e.type === 'piece_entered')).toHaveLength(1);
		});

		it('does not report a lone half in a non-spawn column (that would be garbage, which this deliberately does not detect yet)', () => {
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

			expect(events.filter(e => e.type === 'piece_entered')).toEqual([]);
		});

		it('does not report a single half sitting alone at just one of the two spawn columns', () => {
			tracker.processFrame(frame({ virus: 0 }));
			events.length = 0;

			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 3, row: 0, type: 'pill', shape: 'left', color: 'blue' },
					],
				})
			);

			expect(events.filter(e => e.type === 'piece_entered')).toEqual([]);
		});

		it('ignores viruses occupying the spawn columns during population', () => {
			tracker.processFrame(frame({ virus: 0 }));
			events.length = 0;

			tracker.processFrame(
				frame({
					virus: 2,
					cells: [
						{ col: 3, row: 0, type: 'virus', color: 'yellow', frame: 0 },
						{ col: 4, row: 0, type: 'virus', color: 'red', frame: 0 },
					],
				})
			);

			expect(events.filter(e => e.type === 'piece_entered')).toEqual([]);
		});
	});

	describe('frames with no bottle on screen (pause/title/menu -- see ScreenOCR.js)', () => {
		it('does not start a round off a title/menu screen sitting in front of the capture', () => {
			// hasBottle:false, as DrMarioOCR reports for a screen with no bottle at all --
			// everything else on the frame is null and must not be interpreted
			tracker.processFrame({
				hasBottle: false,
				result: null,
				level: null,
				virus: null,
				board: null,
			});

			expect(events).toEqual([]);
		});

		it('freezes tracker state across a pause mid-round instead of treating it as a round boundary', () => {
			tracker.processFrame(frame({ level: 0, virus: 4 })); // round_start + round_ready
			events.length = 0;

			tracker.processFrame({
				hasBottle: false,
				result: null,
				level: null,
				virus: null,
				board: null,
			});
			tracker.processFrame({
				hasBottle: false,
				result: null,
				level: null,
				virus: null,
				board: null,
			});
			expect(events).toEqual([]); // no round_end just because the screen went black

			// unpausing back to ordinary play shouldn't look like a new round either
			tracker.processFrame(
				frame({
					level: 0,
					virus: 4,
					cells: [
						{ col: 3, row: 0, type: 'pill', shape: 'left', color: 'blue' },
						{ col: 4, row: 0, type: 'pill', shape: 'right', color: 'blue' },
					],
				})
			);
			expect(events).toEqual([
				{
					type: 'piece_entered',
					detail: {
						roundId: 1,
						cells: [
							{ col: 3, shape: 'left', color: 'blue' },
							{ col: 4, shape: 'right', color: 'blue' },
						],
					},
				},
			]);
		});

		it('ends an in-progress round when a soft reset jumps straight to the title screen, with no game_over/topout on the way', () => {
			tracker.processFrame(frame({ level: 0, virus: 4 })); // round_start + round_ready
			events.length = 0;

			tracker.processFrame({
				hasBottle: false,
				isTitleScreen: true,
				result: null,
				level: null,
				virus: null,
				board: null,
			});

			expect(events).toEqual([
				{
					type: 'round_end',
					detail: { roundId: 1, outcome: 'title_screen', virusCount: 4 },
				},
			]);
		});

		it('does not fire round_end for the title screen if no round was actually in progress yet', () => {
			// e.g. the tracker's very first frame happens to be the title screen -- nothing to end
			tracker.processFrame({
				hasBottle: false,
				isTitleScreen: true,
				result: null,
				level: null,
				virus: null,
				board: null,
			});

			expect(events).toEqual([]);
		});

		it('does not double-fire round_end across consecutive title-screen frames', () => {
			tracker.processFrame(frame({ level: 0, virus: 4 }));
			events.length = 0;

			const titleFrame = {
				hasBottle: false,
				isTitleScreen: true,
				result: null,
				level: null,
				virus: null,
				board: null,
			};
			tracker.processFrame(titleFrame);
			tracker.processFrame(titleFrame);
			tracker.processFrame(titleFrame);

			expect(events).toEqual([
				{
					type: 'round_end',
					detail: { roundId: 1, outcome: 'title_screen', virusCount: 4 },
				},
			]);
		});

		it('starts a new round normally once play resumes after a soft-reset round_end', () => {
			tracker.processFrame(frame({ level: 0, virus: 4 }));
			tracker.processFrame({
				hasBottle: false,
				isTitleScreen: true,
				result: null,
				level: null,
				virus: null,
				board: null,
			});
			events.length = 0;

			tracker.processFrame(frame({ level: 2, virus: 0 }));

			expect(events).toEqual([
				{
					type: 'round_start',
					detail: { roundId: 2, level: 2, virusTarget: 12 },
				},
			]);
		});
	});

	describe('garbage entry detection', () => {
		it('fires with one entry when a single loose half appears in a previously-empty column', () => {
			tracker.processFrame(frame({ virus: 0 })); // round_start
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
					type: 'garbage_entered',
					detail: {
						roundId: 1,
						cells: [{ col: 0, shape: 'single', color: 'red' }],
					},
				},
			]);
		});

		it('batches multiple halves that enter on the same frame into one event', () => {
			tracker.processFrame(frame({ virus: 0 }));
			events.length = 0;

			// 2, 3, or 4 can enter at once, always with at least a column of gap between them
			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 0, row: 0, type: 'pill', shape: 'single', color: 'red' },
						{ col: 2, row: 0, type: 'pill', shape: 'single', color: 'blue' },
						{ col: 6, row: 0, type: 'pill', shape: 'single', color: 'yellow' },
					],
				})
			);

			expect(events).toEqual([
				{
					type: 'garbage_entered',
					detail: {
						roundId: 1,
						cells: [
							{ col: 0, shape: 'single', color: 'red' },
							{ col: 2, shape: 'single', color: 'blue' },
							{ col: 6, shape: 'single', color: 'yellow' },
						],
					},
				},
			]);
		});

		it('does not re-fire on later frames while the same garbage half just sits there', () => {
			tracker.processFrame(frame({ virus: 0 }));
			events.length = 0;

			const cells = [
				{ col: 0, row: 0, type: 'pill', shape: 'single', color: 'red' },
			];
			tracker.processFrame(frame({ virus: 0, cells }));
			events.length = 0;

			tracker.processFrame(frame({ virus: 0, cells }));
			tracker.processFrame(frame({ virus: 0, cells }));

			expect(events).toEqual([]);
		});

		it('does not report a garbage half landing on a column that was already occupied (an overwrite, not a new entry)', () => {
			tracker.processFrame(
				frame({
					virus: 2,
					cells: [{ col: 0, row: 0, type: 'virus', color: 'yellow', frame: 0 }],
				})
			); // round_start with a virus already sitting in column 0
			events.length = 0;

			tracker.processFrame(
				frame({
					virus: 2,
					cells: [
						{ col: 0, row: 0, type: 'pill', shape: 'single', color: 'red' },
					],
				})
			); // garbage overwrites the virus that was there

			expect(events).toEqual([]);
		});

		it('reports a fresh entry once a column empties out and new garbage lands there again', () => {
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
			tracker.processFrame(frame({ virus: 0 })); // that half fell away, column 0 empty again
			events.length = 0;

			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 0, row: 0, type: 'pill', shape: 'single', color: 'blue' },
					],
				})
			);

			expect(events).toEqual([
				{
					type: 'garbage_entered',
					detail: {
						roundId: 1,
						cells: [{ col: 0, shape: 'single', color: 'blue' }],
					},
				},
			]);
		});

		it('does not mistake a garbage half landing on a spawn column for part of a real piece spawn', () => {
			tracker.processFrame(frame({ virus: 0 }));
			events.length = 0;

			// a loose half at col 3 (one of the two spawn columns), alone -- not a paired spawn
			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 3, row: 0, type: 'pill', shape: 'single', color: 'red' },
					],
				})
			);

			expect(events).toEqual([
				{
					type: 'garbage_entered',
					detail: {
						roundId: 1,
						cells: [{ col: 3, shape: 'single', color: 'red' }],
					},
				},
			]);
		});

		it('does not mistake independent garbage halves landing on both spawn columns for a real piece spawn', () => {
			tracker.processFrame(frame({ virus: 0 }));
			events.length = 0;

			tracker.processFrame(
				frame({
					virus: 0,
					cells: [
						{ col: 3, row: 0, type: 'pill', shape: 'single', color: 'red' },
						{ col: 4, row: 0, type: 'pill', shape: 'single', color: 'blue' },
					],
				})
			);

			expect(events.filter(e => e.type === 'piece_entered')).toEqual([]);
			expect(events.filter(e => e.type === 'garbage_entered')).toHaveLength(1);
		});
	});
});
