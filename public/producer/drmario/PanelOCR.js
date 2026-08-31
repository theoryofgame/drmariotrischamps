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
// BoardOCR's, since the digit font has no visually-close pairs at small edit distance. Raised
// from an initial 3 alongside BoardOCR's own increase -- a real remote/Twitch-relayed capture
// (confirmed correctly calibrated) still failed to read every single panel field, consistent
// with the same compression-noise cause documented on BoardOCR.js's DEFAULT_MAX_DISTANCE, and
// readNumber() requires *every* digit in a field to match confidently, so a 7-digit field like
// TOP/SCORE compounds each digit's own noise-driven failure risk multiplicatively -- a small per-
// digit tolerance bump matters more than it would for a single-shape read.
const DEFAULT_MAX_DISTANCE = 6;

// Every digit template is exactly this wide (see digitTemplates.js) -- one column short of a
// full CELL_SIZE. Digit *slots* are still spaced a full CELL_SIZE apart (each digit's crop.x
// below), but the sample itself is kept to the glyph's own width: versus mode's LEVEL field for
// 1P packs its two digits only 7px apart (every other digit field observed uses the full 8px),
// and sampling a full CELL_SIZE there pulls in the neighboring digit's first column.
const DIGIT_WIDTH = CELL_SIZE - 1;

// Diagnostic version of the per-digit match -- returns the full match detail (the accepted
// value, its distance, and the closest template regardless of whether it was actually accepted)
// instead of just null-or-value, so a calibration UI can show *why* a digit failed to read (see
// readNumberDebug() below) rather than only that it did. readNumber() is built directly on this,
// so there's exactly one place the actual matching logic lives.
//
// A digit field's crop is just its first digit's position; each subsequent digit is another
// CELL_SIZE to the right (see constants.js REFERENCE_LOCATIONS -- 'DDDDDDD' for TOP/SCORE,
// 'DD' for LEVEL/VIRUS).
function readDigitDebug(image, x, y, height, options) {
	const grid = sampleRegion(image, x, y, DIGIT_WIDTH, height, true);
	const trimmed = trimToContent(grid);

	// blank slot: not expected for a numeric field, but be defensive -- nothing lit at all, so
	// there's no shape to even attempt a match against.
	if (!trimmed) return { value: null, distance: null, bestGuess: null };

	const litGrid = trimmed.map(row => row.map(p => p.lit));
	const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
	const { template, distance } = matchBestTemplate(litGrid, DIGIT_TEMPLATES);

	return {
		value: distance <= maxDistance ? template.value : null,
		distance,
		bestGuess: template.value,
	};
}

// Diagnostic counterpart to readNumber() -- same digit-by-digit read, but returns the full match
// detail for *every* digit slot (not just null-or-value, and doesn't stop at the first failure)
// so a calibration UI can show exactly which digit(s) are missing and how close the nearest
// template actually was, instead of only "read failed."
export function readNumberDebug(image, location, options = {}) {
	const digitCount = location.pattern.length;
	const digits = [];

	for (let i = 0; i < digitCount; i++) {
		const x = location.crop.x + i * CELL_SIZE;
		digits.push(
			readDigitDebug(image, x, location.crop.y, location.crop.h, options)
		);
	}

	return digits;
}

// Assembles a readNumberDebug() result into the same plain value readNumber() itself returns --
// exported so a caller that already has the debug array (e.g. DrMarioOCR.js, for its own
// diagnostics) doesn't need to re-run the OCR a second time just to also get the plain value.
export function digitsToValue(digits) {
	let value = 0;

	for (const digit of digits) {
		if (digit.value === null) return null;
		value = value * 10 + digit.value;
	}

	return value;
}

// Reads a REFERENCE_LOCATIONS digit-sequence field (e.g. constants.REFERENCE_LOCATIONS.score)
// as an integer. Returns null if any digit couldn't be read confidently, rather than guessing
// -- a wrong digit is worse than a missing read for something as consequential as score/level.
export function readNumber(image, location, options = {}) {
	return digitsToValue(readNumberDebug(image, location, options));
}

// Diagnostic counterpart to readSpeed() -- see readNumberDebug()'s own comment for why. readSpeed
// is built directly on this.
export function readSpeedDebug(image, location, options = {}) {
	const { crop } = location;
	const grid = sampleRegion(image, crop.x, crop.y, crop.w, crop.h, true);
	const litGrid = grid.map(row => row.map(p => p.lit));
	const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
	const { template, distance } = matchBestTemplate(litGrid, SPEED_TEMPLATES);

	return {
		value: distance <= maxDistance ? template.value : null,
		distance,
		bestGuess: template.value,
	};
}

// Reads the SPEED field (constants.REFERENCE_LOCATIONS.speed) as 'low' | 'med' | 'hi'. Unlike
// digits, this matches the whole word as one shape rather than per-letter, and deliberately
// does NOT trim the sampled region to its lit content first: the 3 words differ in length and
// are rendered at different horizontal positions within the field (see digitTemplates.js), and
// that positioning is itself part of what distinguishes them, not incidental padding to discard.
export function readSpeed(image, location, options = {}) {
	return readSpeedDebug(image, location, options).value;
}
