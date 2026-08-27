import { describe, it, expect } from '@jest/globals';

import {
	PILL_SPRITES,
	VIRUS_SPRITES,
	PILL_TONES,
	CLEARING_PATTERN,
} from '../public/producer/drmario/spriteBitmaps.js';
import { CELL_SIZE } from '../public/producer/drmario/constants.js';

// spriteBitmaps.js is generated data (see its own header comment for provenance), not hand-
// written -- these are structural sanity checks (every expected entry exists, is well-formed,
// native-cell-sized) to catch a malformed/missing entry from a re-run of the extraction script,
// not a pixel-exact visual regression. Visual correctness was verified once by rendering a sprite
// sheet and inspecting it directly; that's not something Jest can usefully assert on its own.

const COLORS = ['red', 'blue', 'yellow'];
const PILL_SHAPES = ['left', 'right', 'top', 'bottom', 'single'];

function expectValidBitmap(bitmap) {
	expect(Array.isArray(bitmap)).toBe(true);
	expect(bitmap).toHaveLength(CELL_SIZE);
	bitmap.forEach(row => {
		expect(row).toHaveLength(CELL_SIZE);
		row.forEach(px => {
			if (px === null) return;
			expect(Array.isArray(px)).toBe(true);
			expect(px).toHaveLength(3);
			px.forEach(channel => {
				expect(channel).toBeGreaterThanOrEqual(0);
				expect(channel).toBeLessThanOrEqual(255);
			});
		});
	});
	// A cell with every pixel transparent isn't a real sprite -- would indicate a bad crop.
	expect(bitmap.flat().some(px => px !== null)).toBe(true);
}

describe('spriteBitmaps', () => {
	describe('PILL_SPRITES', () => {
		it.each(COLORS)('%s has all 5 shapes, each a valid 8x8 bitmap', color => {
			PILL_SHAPES.forEach(shape => {
				expect(PILL_SPRITES[color]).toHaveProperty(shape);
				expectValidBitmap(PILL_SPRITES[color][shape]);
			});
		});
	});

	describe('VIRUS_SPRITES', () => {
		it.each(COLORS)(
			'%s has both animation frames, each a valid 8x8 bitmap',
			color => {
				expect(VIRUS_SPRITES[color]).toHaveLength(2);
				VIRUS_SPRITES[color].forEach(bitmap => expectValidBitmap(bitmap));
			}
		);

		it.each(COLORS)("%s's two frames aren't identical", color => {
			expect(VIRUS_SPRITES[color][0]).not.toEqual(VIRUS_SPRITES[color][1]);
		});
	});

	describe('PILL_TONES', () => {
		it.each(COLORS)('%s has a [base, highlight] RGB pair', color => {
			expect(PILL_TONES[color]).toHaveLength(2);
			PILL_TONES[color].forEach(tone => {
				expect(tone).toHaveLength(3);
			});
			// base != highlight, or there'd only be one real tone, not two
			expect(PILL_TONES[color][0]).not.toEqual(PILL_TONES[color][1]);
		});
	});

	describe('CLEARING_PATTERN', () => {
		it('is an 8x8 boolean grid with at least one lit pixel', () => {
			expect(CLEARING_PATTERN).toHaveLength(CELL_SIZE);
			CLEARING_PATTERN.forEach(row => {
				expect(row).toHaveLength(CELL_SIZE);
				row.forEach(v => expect(typeof v).toBe('boolean'));
			});
			expect(CLEARING_PATTERN.flat().some(Boolean)).toBe(true);
		});
	});
});
