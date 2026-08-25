import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'url';

import {
	identifyCell,
	identifyNextPill,
} from '../public/producer/drmario/BoardOCR.js';
import { readNumber, readSpeed } from '../public/producer/drmario/PanelOCR.js';
import { readCrowns } from '../public/producer/drmario/CrownOCR.js';
import {
	VERSUS,
	REFERENCE_LOCATIONS_VERSUS,
} from '../public/producer/drmario/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'dr_mario');

function loadFixture(filename) {
	const png = PNG.sync.read(readFileSync(path.join(FIXTURES_DIR, filename)));
	return { width: png.width, height: png.height, data: png.data };
}

describe('Dr. Mario versus mode', () => {
	let versus;

	beforeAll(() => {
		versus = loadFixture('versus_reference.png');
	});

	describe('bottles', () => {
		// Same virus/pill templates as single-player (see templates.js), just at a different
		// field origin per player (BoardOCR.identifyCell()'s `field` option) -- both bottles
		// share the same y/h as single-player's centered one.
		it('reads both players falling pill (same colors -- versus mode shares one piece queue)', () => {
			expect(
				identifyCell(versus, 3, 2, { field: VERSUS.BOTTLE_1P })
			).toMatchObject({
				type: 'pill',
				shape: 'left',
				color: 'blue',
			});
			expect(
				identifyCell(versus, 4, 2, { field: VERSUS.BOTTLE_1P })
			).toMatchObject({
				type: 'pill',
				shape: 'right',
				color: 'yellow',
			});
			expect(
				identifyCell(versus, 3, 5, { field: VERSUS.BOTTLE_2P })
			).toMatchObject({
				type: 'pill',
				shape: 'left',
				color: 'blue',
			});
			expect(
				identifyCell(versus, 4, 5, { field: VERSUS.BOTTLE_2P })
			).toMatchObject({
				type: 'pill',
				shape: 'right',
				color: 'yellow',
			});
		});

		it("reads viruses from 1P's much busier board", () => {
			expect(
				identifyCell(versus, 0, 6, { field: VERSUS.BOTTLE_1P })
			).toMatchObject({
				type: 'virus',
				color: 'yellow',
			});
			expect(
				identifyCell(versus, 1, 6, { field: VERSUS.BOTTLE_1P })
			).toMatchObject({
				type: 'virus',
				color: 'red',
			});
			expect(
				identifyCell(versus, 2, 6, { field: VERSUS.BOTTLE_1P })
			).toMatchObject({
				type: 'virus',
				color: 'blue',
			});
		});

		it("reads viruses from 2P's much sparser board", () => {
			expect(
				identifyCell(versus, 0, 8, { field: VERSUS.BOTTLE_2P })
			).toMatchObject({
				type: 'virus',
				color: 'yellow',
			});
			expect(
				identifyCell(versus, 7, 7, { field: VERSUS.BOTTLE_2P })
			).toMatchObject({
				type: 'virus',
				color: 'red',
			});
			expect(
				identifyCell(versus, 4, 10, { field: VERSUS.BOTTLE_2P })
			).toMatchObject({
				type: 'virus',
				color: 'blue',
			});
		});
	});

	describe('next-pill previews', () => {
		// Confirms both players' previews sit correctly in their own bottle's neck, and (per
		// the shared-piece-queue finding above) agree with each other.
		it('reads matching red/yellow previews for both players', () => {
			const expected = {
				left: { type: 'pill', shape: 'left', color: 'red' },
				right: { type: 'pill', shape: 'right', color: 'yellow' },
			};
			expect(
				identifyNextPill(versus, { position: VERSUS.NEXT_PILL_1P })
			).toMatchObject(expected);
			expect(
				identifyNextPill(versus, { position: VERSUS.NEXT_PILL_2P })
			).toMatchObject(expected);
		});
	});

	describe('shared LEVEL/SPEED/VIRUS panel', () => {
		it("reads each player's value independently", () => {
			const loc = REFERENCE_LOCATIONS_VERSUS;
			expect(readNumber(versus, loc.level_1p)).toBe(10);
			expect(readNumber(versus, loc.level_2p)).toBe(0);
			expect(readSpeed(versus, loc.speed_1p)).toBe('low');
			expect(readSpeed(versus, loc.speed_2p)).toBe('med');
			expect(readNumber(versus, loc.virus_1p)).toBe(44);
			expect(readNumber(versus, loc.virus_2p)).toBe(4);
		});

		it("reads player 1's speed as 'med', not just 'low' -- regression test for a live bug report", () => {
			// speed_1p's crop was 1px too far right and 1px too narrow, clipping the leftmost
			// column of the SPEED_TEMPLATES word shape -- a solid vertical stroke in every row of
			// 'med' and 'hi', but not 'low' (whose own leftmost column is already blank), which is
			// why the bug only showed up for some speed values and not others. This fixture is
			// reconstructed from a real captured frame reported live (crop-and-scale replicated
			// from the reporter's own calibration rectangle, not an emulator-clean screenshot like
			// most other fixtures), specifically because it showed the failure and the reference
			// fixture above happens to show 'low' for player 1, which the bug never affected.
			const image = loadFixture('versus_p1_med_speed.png');
			const loc = REFERENCE_LOCATIONS_VERSUS;
			expect(readSpeed(image, loc.speed_1p)).toBe('med');
			expect(readSpeed(image, loc.speed_2p)).toBe('med');
		});
	});

	describe('crowns (round wins)', () => {
		it('reads 1 win for player 1 and 0 for player 2', () => {
			expect(readCrowns(versus)).toEqual({
				player1: { cells: [false, false, true], wins: 1 },
				player2: { cells: [false, false, false], wins: 0 },
			});
		});
	});
});
