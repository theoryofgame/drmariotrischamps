// Reads a bottle's round/match result state -- STAGE CLEAR, GAME OVER, or (versus only) an
// immediate topout mark -- from raw pixel data. Same DOM-free { width, height, data } image
// shape as BoardOCR.js/PanelOCR.js/CrownOCR.js; see shapeMatch.js for the shared sampling/
// matching machinery all four modules build on.
//
// Both result-overlay boxes replace the bottle's contents entirely and are anchored to the
// bottle's own position (see resultTemplates.js for why one fixed oversized sample region
// covers both), so readResult() takes a `field` the same way BoardOCR.identifyCell() does --
// constants.FIELD for single-player, VERSUS.BOTTLE_1P/BOTTLE_2P for versus.

import { RESULT_BOX_TEMPLATES, TOPOUT_TEMPLATE } from './resultTemplates.js';
import {
	sampleRegion,
	trimToContent,
	matchBestTemplate,
} from './shapeMatch.js';

// Both boxes are sampled from this same bottle-relative rectangle regardless of which one (if
// either) is actually showing -- generous enough to contain the taller of the two (STAGE
// CLEAR); GAME OVER's shorter box just trims to a smaller region within it, the same way a
// bottle cell's content trims within its 8x8 sample.
const RESULT_BOX_OFFSET = { x: 2, y: 10, w: 60, h: 68 };

// The topout mark sits lower and is much smaller, since (unlike the two boxes above) it doesn't
// replace the bottle's contents -- the overflowed pieces stay frozen and visible above it.
const TOPOUT_OFFSET = { x: 13, y: 73, w: 32, h: 30 };

// Both templates are large (thousands of pixels) clean geometric shapes -- solid borders/fills
// -- with nothing else in this game resembling them at even a fraction of this pixel count, so
// a genuine match should score at or near 0 and there's no risk of confusion with normal
// gameplay (scattered small virus/pill shapes) even with a generous allowance for capture noise.
const DEFAULT_MAX_DISTANCE = 40;

export function readResult(image, field, options = {}) {
	const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;

	const boxGrid = sampleRegion(
		image,
		field.x + RESULT_BOX_OFFSET.x,
		field.y + RESULT_BOX_OFFSET.y,
		RESULT_BOX_OFFSET.w,
		RESULT_BOX_OFFSET.h
	);
	const boxTrimmed = trimToContent(boxGrid);

	if (boxTrimmed) {
		const litGrid = boxTrimmed.map(row => row.map(p => p.lit));
		const { template, distance } = matchBestTemplate(
			litGrid,
			RESULT_BOX_TEMPLATES
		);

		if (distance <= maxDistance) return template.result;
	}

	const topoutGrid = sampleRegion(
		image,
		field.x + TOPOUT_OFFSET.x,
		field.y + TOPOUT_OFFSET.y,
		TOPOUT_OFFSET.w,
		TOPOUT_OFFSET.h
	);
	const topoutTrimmed = trimToContent(topoutGrid);

	if (topoutTrimmed) {
		const litGrid = topoutTrimmed.map(row => row.map(p => p.lit));
		const { distance } = matchBestTemplate(litGrid, [TOPOUT_TEMPLATE]);

		if (distance <= maxDistance) return 'topout';
	}

	return 'playing';
}
