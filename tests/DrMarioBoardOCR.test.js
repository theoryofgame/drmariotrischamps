import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'url';

import {
	identifyCell,
	identifyNextPill,
	scanBoard,
} from '../public/producer/drmario/BoardOCR.js';
import { COLS, ROWS } from '../public/producer/drmario/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'dr_mario');

function loadFixture(filename) {
	const png = PNG.sync.read(readFileSync(path.join(FIXTURES_DIR, filename)));
	// PNG.data is already RGBA row-major, i.e. the same shape identifyCell()/scanBoard() expect.
	return { width: png.width, height: png.height, data: png.data };
}

describe('DrMarioBoardOCR', () => {
	let frameA, frameB, pillShapes, level05HiSpeed, pieceClear;

	beforeAll(() => {
		frameA = loadFixture('level00_frameA.png');
		frameB = loadFixture('level00_frameB.png');
		pillShapes = loadFixture('level00_pill_shapes.png');
		level05HiSpeed = loadFixture('level05_hi_speed.png');
		pieceClear = loadFixture('piece_clear.png');
	});

	describe('empty cells', () => {
		it('reports untouched corners of the bottle as empty', () => {
			expect(identifyCell(frameA, 0, 0)).toEqual({
				type: 'empty',
				col: 0,
				row: 0,
			});
			expect(identifyCell(frameA, 7, 15)).toEqual({
				type: 'empty',
				col: 7,
				row: 15,
			});
		});
	});

	describe('virus animation frames (level00_frameA/frameB)', () => {
		// Same game state captured a fraction of a second apart: viruses don't move, only their
		// 2-frame idle animation and the (unrelated) falling pill's position differ between them.
		it('identifies the red virus and its animation frame', () => {
			expect(identifyCell(frameA, 3, 9)).toMatchObject({
				type: 'virus',
				color: 'red',
				frame: 0,
			});
			expect(identifyCell(frameB, 3, 9)).toMatchObject({
				type: 'virus',
				color: 'red',
				frame: 1,
			});
		});

		it('identifies the blue virus and its animation frame', () => {
			expect(identifyCell(frameA, 6, 7)).toMatchObject({
				type: 'virus',
				color: 'blue',
				frame: 0,
			});
			expect(identifyCell(frameB, 6, 7)).toMatchObject({
				type: 'virus',
				color: 'blue',
				frame: 1,
			});
		});

		it('identifies the yellow virus and its animation frame', () => {
			expect(identifyCell(frameA, 7, 13)).toMatchObject({
				type: 'virus',
				color: 'yellow',
				frame: 0,
			});
			expect(identifyCell(frameB, 7, 13)).toMatchObject({
				type: 'virus',
				color: 'yellow',
				frame: 1,
			});
		});

		it('identifies the same red virus repeated lower in the bottle', () => {
			expect(identifyCell(frameA, 3, 14)).toMatchObject({
				type: 'virus',
				color: 'red',
				frame: 0,
			});
		});
	});

	describe('falling horizontal pill (level00_frameA/frameB)', () => {
		it('identifies both halves of the blue pill, and tracks it falling between frames', () => {
			expect(identifyCell(frameA, 3, 4)).toMatchObject({
				type: 'pill',
				shape: 'left',
				color: 'blue',
			});
			expect(identifyCell(frameA, 4, 4)).toMatchObject({
				type: 'pill',
				shape: 'right',
				color: 'blue',
			});

			// same pill, 3 rows lower, in the other capture
			expect(identifyCell(frameB, 3, 7)).toMatchObject({
				type: 'pill',
				shape: 'left',
				color: 'blue',
			});
			expect(identifyCell(frameB, 4, 7)).toMatchObject({
				type: 'pill',
				shape: 'right',
				color: 'blue',
			});
		});
	});

	describe('next-pill preview (Dr. Mario holds it above his head)', () => {
		// This is a fixed screen position, not part of the 8x16 bottle grid, previewing the
		// piece that will spawn *after* the one currently falling -- confirmed by frameA/frameB
		// showing the same preview while the in-bottle piece keeps falling, and level05_hi_speed
		// showing a preview that differs from its own currently-falling piece (left blue, right
		// red -- see the 'different level/speed' tests below).
		it('stays constant across frames while the current piece is still falling', () => {
			expect(identifyNextPill(frameA)).toMatchObject({
				left: { type: 'pill', shape: 'left', color: 'blue' },
				right: { type: 'pill', shape: 'right', color: 'blue' },
			});
			expect(identifyNextPill(frameB)).toMatchObject({
				left: { type: 'pill', shape: 'left', color: 'blue' },
				right: { type: 'pill', shape: 'right', color: 'blue' },
			});
		});

		it('identifies a two-colored preview', () => {
			expect(identifyNextPill(pillShapes)).toMatchObject({
				left: { type: 'pill', shape: 'left', color: 'yellow' },
				right: { type: 'pill', shape: 'right', color: 'red' },
			});
		});

		it('differs from the piece actually falling in the bottle', () => {
			expect(identifyNextPill(level05HiSpeed)).toMatchObject({
				left: { type: 'pill', shape: 'left', color: 'red' },
				right: { type: 'pill', shape: 'right', color: 'red' },
			});
			// the currently-falling piece in this same capture is blue/red, not red/red
			expect(identifyCell(level05HiSpeed, 3, 3)).toMatchObject({
				color: 'blue',
			});
			expect(identifyCell(level05HiSpeed, 4, 3)).toMatchObject({
				color: 'red',
			});
		});
	});

	describe('landed pill shapes (level00_pill_shapes)', () => {
		it('identifies a connected vertical pill (top+bottom halves)', () => {
			expect(identifyCell(pillShapes, 7, 2)).toMatchObject({
				type: 'pill',
				shape: 'top',
				color: 'red',
			});
			expect(identifyCell(pillShapes, 7, 3)).toMatchObject({
				type: 'pill',
				shape: 'bottom',
				color: 'red',
			});
		});

		it('identifies a connected horizontal pill with two different colors per half', () => {
			expect(identifyCell(pillShapes, 0, 15)).toMatchObject({
				type: 'pill',
				shape: 'left',
				color: 'red',
			});
			expect(identifyCell(pillShapes, 1, 15)).toMatchObject({
				type: 'pill',
				shape: 'right',
				color: 'blue',
			});
		});

		it('identifies two mismatched-color half-pills stacked on top of each other', () => {
			expect(identifyCell(pillShapes, 0, 12)).toMatchObject({
				type: 'pill',
				shape: 'top',
				color: 'blue',
			});
			expect(identifyCell(pillShapes, 0, 13)).toMatchObject({
				type: 'pill',
				shape: 'bottom',
				color: 'red',
			});
		});

		it('tells an orphaned single half-pill (rounded on every side) apart from top/bottom halves', () => {
			expect(identifyCell(pillShapes, 3, 7)).toMatchObject({
				type: 'pill',
				shape: 'single',
				color: 'red',
			});
			expect(identifyCell(pillShapes, 3, 8)).toMatchObject({
				type: 'pill',
				shape: 'single',
				color: 'blue',
			});
		});

		it('identifies a yellow half of a horizontal pill', () => {
			expect(identifyCell(pillShapes, 4, 13)).toMatchObject({
				type: 'pill',
				shape: 'left',
				color: 'yellow',
			});
			expect(identifyCell(pillShapes, 5, 13)).toMatchObject({
				type: 'pill',
				shape: 'right',
				color: 'blue',
			});
		});
	});

	describe('different level/speed (level05_hi_speed)', () => {
		// This capture has a different checkerboard background color (speed HI shifts it from
		// purple to gray) and a much busier board, but the in-bottle virus/pill colors and the
		// grid geometry are unaffected: this is the cross-check that the module isn't secretly
		// tuned to one capture's background.
		it('still identifies pieces correctly against a different background palette', () => {
			expect(identifyCell(level05HiSpeed, 3, 3)).toMatchObject({
				type: 'pill',
				shape: 'left',
				color: 'blue',
			});
			expect(identifyCell(level05HiSpeed, 4, 3)).toMatchObject({
				type: 'pill',
				shape: 'right',
				color: 'red',
			});
			expect(identifyCell(level05HiSpeed, 2, 6)).toMatchObject({
				type: 'virus',
				color: 'red',
				frame: 1,
			});
			expect(identifyCell(level05HiSpeed, 5, 6)).toMatchObject({
				type: 'virus',
				color: 'blue',
				frame: 1,
			});
			expect(identifyCell(level05HiSpeed, 5, 7)).toMatchObject({
				type: 'virus',
				color: 'yellow',
				frame: 1,
			});
		});

		it('identifies an isolated virus sitting alone at the bottom edge of the board', () => {
			expect(identifyCell(level05HiSpeed, 3, 15)).toMatchObject({
				type: 'virus',
				color: 'blue',
				frame: 1,
			});
		});
	});

	describe('match-clear animation (piece_clear)', () => {
		// 4 blue pieces (a mix of virus and pill segments, per direct observation of the capture
		// this came from) stacked in column 0, mid-clear. Both render the exact same hollow-ring
		// shape while clearing, so type/shape can't distinguish virus from pill here -- only
		// color survives.
		it('identifies all 4 clearing cells by color, with no shape/type distinction', () => {
			[6, 7, 8, 9].forEach(row => {
				expect(identifyCell(pieceClear, 0, row)).toMatchObject({
					type: 'clearing',
					color: 'blue',
				});
			});
		});

		it('still reads ordinary viruses elsewhere on the same board correctly', () => {
			expect(identifyCell(pieceClear, 3, 6)).toMatchObject({
				type: 'virus',
				color: 'yellow',
			});
			expect(identifyCell(pieceClear, 2, 7)).toMatchObject({
				type: 'virus',
				color: 'red',
			});
			expect(identifyCell(pieceClear, 7, 7)).toMatchObject({
				type: 'virus',
				color: 'blue',
			});
		});
	});

	describe('scanBoard', () => {
		it('returns a ROWS x COLS grid covering every cell', () => {
			const board = scanBoard(frameA);

			expect(board).toHaveLength(ROWS);
			board.forEach(row => expect(row).toHaveLength(COLS));
			expect(board[9][3]).toMatchObject({ type: 'virus', color: 'red' });
			expect(board[4][3]).toMatchObject({ type: 'pill', shape: 'left' });
		});
	});
});
