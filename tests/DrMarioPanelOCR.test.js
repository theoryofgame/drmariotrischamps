import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'url';

import { readNumber, readSpeed } from '../public/producer/drmario/PanelOCR.js';
import { REFERENCE_LOCATIONS } from '../public/producer/drmario/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'dr_mario');

function loadFixture(filename) {
	const png = PNG.sync.read(readFileSync(path.join(FIXTURES_DIR, filename)));
	return { width: png.width, height: png.height, data: png.data };
}

function readPanel(image) {
	return {
		top: readNumber(image, REFERENCE_LOCATIONS.top),
		score: readNumber(image, REFERENCE_LOCATIONS.score),
		level: readNumber(image, REFERENCE_LOCATIONS.level),
		virus: readNumber(image, REFERENCE_LOCATIONS.virus),
		speed: readSpeed(image, REFERENCE_LOCATIONS.speed),
	};
}

describe('DrMarioPanelOCR', () => {
	let frameA, frameB, pillShapes, level05HiSpeed, level19Low, level13Low;

	beforeAll(() => {
		frameA = loadFixture('level00_frameA.png');
		frameB = loadFixture('level00_frameB.png');
		pillShapes = loadFixture('level00_pill_shapes.png');
		level05HiSpeed = loadFixture('level05_hi_speed.png');
		level19Low = loadFixture('level19_low_speed.png');
		level13Low = loadFixture('level13_low_speed.png');
	});

	it('reads every digit 0-9 correctly across all captures', () => {
		// between TOP/SCORE/LEVEL/VIRUS across these captures, every digit 0-9 appears at least
		// once, several (0, 1, 4, 5) more than once from independent fields/captures
		expect(readPanel(frameA)).toEqual({
			top: 10000,
			score: 0,
			level: 0,
			virus: 4,
			speed: 'med',
		});
		expect(readPanel(level05HiSpeed)).toEqual({
			top: 10000,
			score: 0,
			level: 5,
			virus: 24,
			speed: 'hi',
		});
		expect(readPanel(level19Low)).toEqual({
			top: 10000,
			score: 300,
			level: 19,
			virus: 78,
			speed: 'low',
		});
		expect(readPanel(level13Low)).toEqual({
			top: 10000,
			score: 0,
			level: 13,
			virus: 56,
			speed: 'low',
		});
	});

	it('reads the same values from two captures of the same game moment', () => {
		expect(readPanel(frameA)).toEqual(readPanel(frameB));
	});

	it('reads the same values from a third capture of the same level', () => {
		expect(readPanel(pillShapes)).toEqual(readPanel(frameA));
	});

	describe('readSpeed', () => {
		it('tells LOW, MED and HI apart', () => {
			expect(readSpeed(frameA, REFERENCE_LOCATIONS.speed)).toBe('med');
			expect(readSpeed(level05HiSpeed, REFERENCE_LOCATIONS.speed)).toBe('hi');
			expect(readSpeed(level19Low, REFERENCE_LOCATIONS.speed)).toBe('low');
		});
	});
});
