import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'url';

import { hasBottle } from '../public/producer/drmario/ScreenOCR.js';
import { FIELD, VERSUS } from '../public/producer/drmario/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'dr_mario');

function loadFixture(filename) {
	const png = PNG.sync.read(readFileSync(path.join(FIXTURES_DIR, filename)));
	return { width: png.width, height: png.height, data: png.data };
}

describe('DrMarioScreenOCR', () => {
	describe('screens with no bottle at all', () => {
		it.each([
			['pause', 'pause.png'],
			['title screen', 'title_screen.png'],
			['1P game-setup menu', 'menu_1p.png'],
			['2P game-setup menu', 'menu_2p.png'],
		])('reports no bottle on the %s', (_label, filename) => {
			expect(hasBottle(loadFixture(filename), FIELD)).toBe(false);
		});
	});

	describe('single-player gameplay and round-end fixtures', () => {
		let images;

		beforeAll(() => {
			images = [
				'level00_frameA.png',
				'level00_frameB.png',
				'level00_pill_shapes.png',
				'level05_hi_speed.png',
				'level13_low_speed.png',
				'level19_low_speed.png',
				'piece_clear.png',
				'single_player_stage_clear.png',
				'single_player_game_over.png',
			].map(loadFixture);
		});

		it('reports a bottle present on every fixture', () => {
			images.forEach(image => {
				expect(hasBottle(image, FIELD)).toBe(true);
			});
		});
	});

	describe('versus gameplay and round-end fixtures', () => {
		it.each([
			'versus_reference.png',
			'versus_left_player_clear.png',
			'versus_left_player_topout.png',
			'versus_game_over_left_wins.png',
		])('reports both bottles present on %s', filename => {
			const image = loadFixture(filename);
			expect(hasBottle(image, VERSUS.BOTTLE_1P)).toBe(true);
			expect(hasBottle(image, VERSUS.BOTTLE_2P)).toBe(true);
		});
	});
});
