import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'url';

import {
	readNumber,
	readSpeed,
	readNumberDebug,
	readSpeedDebug,
	digitsToValue,
} from '../public/producer/drmario/PanelOCR.js';
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

	// Debug variants exist purely for the calibration UI's own diagnostics (see producer.js) --
	// readNumber()/readSpeed() above are themselves built directly on these, so a passing clean
	// read here is already covered by every test above; what's worth checking directly is the
	// debug-specific shape and the distance-0/bestGuess-matches-value case on an unambiguous read.
	describe('readNumberDebug / digitsToValue', () => {
		it('returns one entry per digit, each with value/distance/bestGuess, on a clean read', () => {
			const digits = readNumberDebug(level05HiSpeed, REFERENCE_LOCATIONS.level);

			expect(digits).toHaveLength(2);
			digits.forEach(d => {
				expect(d.distance).toBe(0);
				expect(d.value).toBe(d.bestGuess);
			});
			expect(digitsToValue(digits)).toBe(5);
		});

		it('digitsToValue mirrors readNumber() exactly on the same input', () => {
			const digits = readNumberDebug(level19Low, REFERENCE_LOCATIONS.score);
			expect(digitsToValue(digits)).toBe(
				readNumber(level19Low, REFERENCE_LOCATIONS.score)
			);
		});

		it('digitsToValue returns null if any digit slot failed to match confidently', () => {
			// an unreasonably strict maxDistance forces every digit to "fail" even on a clean
			// capture, so digitsToValue must bail out to null rather than assembling a bogus value
			// from whatever bestGuess happened to be closest.
			const digits = readNumberDebug(level13Low, REFERENCE_LOCATIONS.virus, {
				maxDistance: -1,
			});

			expect(digits.some(d => d.value === null)).toBe(true);
			expect(digitsToValue(digits)).toBeNull();
			// bestGuess should still reflect the real closest template even though it was rejected
			expect(digits[0].bestGuess).not.toBeNull();
		});
	});

	describe('readSpeedDebug', () => {
		it('returns value/distance/bestGuess, with distance 0 on a clean read', () => {
			const debug = readSpeedDebug(level05HiSpeed, REFERENCE_LOCATIONS.speed);

			expect(debug.value).toBe('hi');
			expect(debug.distance).toBe(0);
			expect(debug.bestGuess).toBe('hi');
		});

		it('still reports a bestGuess when rejected by an unreasonably strict maxDistance', () => {
			const debug = readSpeedDebug(level05HiSpeed, REFERENCE_LOCATIONS.speed, {
				maxDistance: -1,
			});

			expect(debug.value).toBeNull();
			expect(debug.bestGuess).toBe('hi');
			expect(debug.distance).toBe(0);
		});
	});
});
