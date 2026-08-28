import { describe, it, expect } from '@jest/globals';

import { calculateInternalSpeed } from '../public/producer/drmario/InternalSpeed.js';

describe('calculateInternalSpeed', () => {
	it.each([
		['low', 15],
		['med', 25],
		['hi', 31],
	])('returns the base speed for %s at 0 pieces entered', (speed, base) => {
		expect(calculateInternalSpeed(speed, 0)).toBe(base);
	});

	it('has not increased yet at 8 pieces entered (8th pill not yet locked)', () => {
		expect(calculateInternalSpeed('low', 8)).toBe(15);
	});

	it('increases by 1 as the 9th pill enters (8th just locked)', () => {
		expect(calculateInternalSpeed('low', 9)).toBe(16);
	});

	it('stays at +1 through 18 pieces entered', () => {
		expect(calculateInternalSpeed('low', 18)).toBe(16);
	});

	it('increases by 1 again as the 19th pill enters (10 more pieces later)', () => {
		expect(calculateInternalSpeed('low', 19)).toBe(17);
	});

	it('continues increasing every 10 pieces', () => {
		expect(calculateInternalSpeed('low', 29)).toBe(18);
		expect(calculateInternalSpeed('low', 39)).toBe(19);
	});

	it.each([
		['low', 64],
		['med', 74],
		['hi', 80],
	])('caps at 49 increases for %s', (speed, cap) => {
		// 49th increase takes effect at piecesEntered = 9 + 10*48 = 489
		expect(calculateInternalSpeed(speed, 489)).toBe(cap);
		// far beyond the cap -- must not keep climbing
		expect(calculateInternalSpeed(speed, 10000)).toBe(cap);
	});

	it('returns null for an unrecognized speed name', () => {
		expect(calculateInternalSpeed('unknown', 5)).toBeNull();
		expect(calculateInternalSpeed(null, 5)).toBeNull();
	});

	it('returns null when piecesEntered is null or undefined', () => {
		expect(calculateInternalSpeed('low', null)).toBeNull();
		expect(calculateInternalSpeed('low', undefined)).toBeNull();
	});
});
