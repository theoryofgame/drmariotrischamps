// Pure calibration math shared by producer.js/harness.js, kept deliberately DOM-free (unlike
// DrMarioOCR.js, which inherently needs document.createElement('canvas') etc, and so can't be
// unit-tested directly under this project's Jest config -- testEnvironment: 'node', no jsdom).
// Extracting this here means the actual quick-seed/bottle-anchor math -- the highest-risk new
// logic in the independent-per-region calibration feature -- gets real test coverage instead of
// living untested, duplicated, inline in two UI files.

import {
	REFERENCE_SIZE,
	FIELD,
	VERSUS,
	CALIBRATION_REGIONS,
	LAYOUT,
} from './constants.js';

// versus's own bottle geometry (VERSUS.BOTTLE_1P) has the same width/height as single-player's
// FIELD, just a different x origin -- see constants.js's own comment on VERSUS.
export function fieldAnchorForLayout(layout) {
	return layout === LAYOUT.VERSUS ? VERSUS.BOTTLE_1P : FIELD;
}

// bottleRect: a clicked rect in video-pixel space, understood to be the bottle interior (the
// anchor's own position/size within the reference frame is already known) -- derives the
// equivalent whole-screen rect the same way manually clicking the screen's own corners would
// have. The bottle's solid-color walls are a much sharper, higher-contrast landmark to click
// precisely than the whole screen's own edges (especially the decorative checkerboard
// background, which is exactly the kind of fine repeating detail video compression smears first
// -- confirmed directly against a real relayed/Twitch capture).
export function calibrationFromBottleRect(bottleRect, layout) {
	const anchor = fieldAnchorForLayout(layout);
	const scaleX = bottleRect.w / anchor.w;
	const scaleY = bottleRect.h / anchor.h;

	return {
		x: bottleRect.x - anchor.x * scaleX,
		y: bottleRect.y - anchor.y * scaleY,
		w: REFERENCE_SIZE.w * scaleX,
		h: REFERENCE_SIZE.h * scaleY,
	};
}

// Inverse of calibrationFromBottleRect() -- given a whole-screen calibration rect, computes where
// the bottle interior should land in video-pixel space. Used as a direct visual check for
// bottle-anchored calibration (see producer.js's loop()) -- the whole-screen rect alone doesn't
// by itself confirm a bottle click landed precisely against the cyan walls.
export function bottleRectFromCalibration(calibrationRect, layout) {
	const anchor = fieldAnchorForLayout(layout);
	const scaleX = calibrationRect.w / REFERENCE_SIZE.w;
	const scaleY = calibrationRect.h / REFERENCE_SIZE.h;

	return {
		x: calibrationRect.x + anchor.x * scaleX,
		y: calibrationRect.y + anchor.y * scaleY,
		w: anchor.w * scaleX,
		h: anchor.h * scaleY,
	};
}

// Single-player only -- generalizes the same "extrapolate from one known anchor" math above to
// every CALIBRATION_REGIONS entry at once: the "quick seed" that gives every region a reasonable
// starting value from one whole-screen (or bottle-anchored) click, which the operator can then
// fix up independently per region wherever it's actually off (see constants.js's own comment on
// CALIBRATION_REGIONS for why one shared transform can't be trusted to get every region right on
// a non-uniformly cropped source).
export function deriveAllRegionsFromScreen(screenRect) {
	const scaleX = screenRect.w / REFERENCE_SIZE.w;
	const scaleY = screenRect.h / REFERENCE_SIZE.h;
	const regions = {};

	Object.entries(CALIBRATION_REGIONS).forEach(([name, { refPoint, size }]) => {
		regions[name] = {
			x: screenRect.x + refPoint.x * scaleX,
			y: screenRect.y + refPoint.y * scaleY,
			w: size.w * scaleX,
			h: size.h * scaleY,
		};
	});

	return regions;
}
