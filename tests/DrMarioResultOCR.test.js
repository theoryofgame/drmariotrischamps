import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'url';

import { readResult } from '../public/producer/drmario/ResultOCR.js';
import { FIELD, VERSUS } from '../public/producer/drmario/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'dr_mario');

function loadFixture(filename) {
	const png = PNG.sync.read(readFileSync(path.join(FIXTURES_DIR, filename)));
	return { width: png.width, height: png.height, data: png.data };
}

describe('DrMarioResultOCR', () => {
	let allFixtures;

	beforeAll(() => {
		allFixtures = [
			'level00_frameA.png',
			'level00_frameB.png',
			'level00_pill_shapes.png',
			'level05_hi_speed.png',
			'level13_low_speed.png',
			'level19_low_speed.png',
			'piece_clear.png',
		].map(loadFixture);
	});

	describe('single-player', () => {
		it('identifies the STAGE CLEAR overlay', () => {
			expect(
				readResult(loadFixture('single_player_stage_clear.png'), FIELD)
			).toBe('stage_clear');
		});

		it('identifies the GAME OVER overlay', () => {
			expect(
				readResult(loadFixture('single_player_game_over.png'), FIELD)
			).toBe('game_over');
		});
	});

	describe('versus', () => {
		it('identifies one bottle showing STAGE CLEAR while the other keeps playing', () => {
			const image = loadFixture('versus_left_player_clear.png');
			expect(readResult(image, VERSUS.BOTTLE_1P)).toBe('stage_clear');
			expect(readResult(image, VERSUS.BOTTLE_2P)).toBe('playing');
		});

		it('identifies a topped-out bottle (pieces still frozen and visible above the mark) while the other keeps playing', () => {
			const image = loadFixture('versus_left_player_topout.png');
			expect(readResult(image, VERSUS.BOTTLE_1P)).toBe('topout');
			expect(readResult(image, VERSUS.BOTTLE_2P)).toBe('playing');
		});

		it('identifies GAME OVER on both bottles at once (final match result)', () => {
			const image = loadFixture('versus_game_over_left_wins.png');
			expect(readResult(image, VERSUS.BOTTLE_1P)).toBe('game_over');
			expect(readResult(image, VERSUS.BOTTLE_2P)).toBe('game_over');
		});
	});

	describe('no false positives during ordinary gameplay', () => {
		it('reports "playing" for every normal-gameplay single-player fixture', () => {
			allFixtures.forEach(image => {
				expect(readResult(image, FIELD)).toBe('playing');
			});
		});

		it('reports "playing" for both bottles on the plain versus reference', () => {
			const image = loadFixture('versus_reference.png');
			expect(readResult(image, VERSUS.BOTTLE_1P)).toBe('playing');
			expect(readResult(image, VERSUS.BOTTLE_2P)).toBe('playing');
		});
	});
});
