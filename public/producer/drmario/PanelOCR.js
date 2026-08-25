// Reads the score-panel text fields (TOP, SCORE, LEVEL, VIRUS, SPEED) from raw pixel data.
// Same DOM-free { width, height, data } image shape as BoardOCR.js; see shapeMatch.js for the
// shared sampling/matching machinery both modules build on.

import { CELL_SIZE } from './constants.js';
import { DIGIT_TEMPLATES, SPEED_TEMPLATES } from './digitTemplates.js';
import {
	sampleRegion,
	trimToContent,
	matchBestTemplate,
} from './shapeMatch.js';

// Digits and the SPEED word render pixel-identical across every field/capture they were
// observed in (see digitTemplates.js), so unlike bottle cells, a real match should always score
// exactly 0 against a clean capture. This threshold exists only to leave room for capture noise
// once this reads real (not emulator-clean) video; it doesn't need to be as generous as
// BoardOCR's, since the digit font has no visually-close pairs at small edit distance.
const DEFAULT_MAX_DISTANCE = 3;

// A digit field's crop is just its first digit's position; each subsequent digit is another
// CELL_SIZE to the right (see constants.js REFERENCE_LOCATIONS -- 'DDDDDDD' for TOP/SCORE,
// 'DD' for LEVEL/VIRUS).
function readDigit(image, x, y, height, options) {
	const grid = sampleRegion(image, x, y, CELL_SIZE, height, true);
	const trimmed = trimToContent(grid);

	if (!trimmed) return null; // blank slot: not expected for a numeric field, but be defensive

	const litGrid = trimmed.map(row => row.map(p => p.lit));
	const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
	const { template, distance } = matchBestTemplate(litGrid, DIGIT_TEMPLATES);

	return distance <= maxDistance ? template.value : null;
}

// Reads a REFERENCE_LOCATIONS digit-sequence field (e.g. constants.REFERENCE_LOCATIONS.score)
// as an integer. Returns null if any digit couldn't be read confidently, rather than guessing
// -- a wrong digit is worse than a missing read for something as consequential as score/level.
export function readNumber(image, location, options = {}) {
	const digitCount = location.pattern.length;
	let value = 0;

	for (let i = 0; i < digitCount; i++) {
		const x = location.crop.x + i * CELL_SIZE;
		const digit = readDigit(
			image,
			x,
			location.crop.y,
			location.crop.h,
			options
		);

		if (digit === null) return null;

		value = value * 10 + digit;
	}

	return value;
}

// Reads the SPEED field (constants.REFERENCE_LOCATIONS.speed) as 'low' | 'med' | 'hi'. Unlike
// digits, this matches the whole word as one shape rather than per-letter, and deliberately
// does NOT trim the sampled region to its lit content first: the 3 words differ in length and
// are rendered at different horizontal positions within the field (see digitTemplates.js), and
// that positioning is itself part of what distinguishes them, not incidental padding to discard.
export function readSpeed(image, location, options = {}) {
	const { crop } = location;
	const grid = sampleRegion(image, crop.x, crop.y, crop.w, crop.h, true);
	const litGrid = grid.map(row => row.map(p => p.lit));
	const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
	const { template, distance } = matchBestTemplate(litGrid, SPEED_TEMPLATES);

	return distance <= maxDistance ? template.value : null;
}
