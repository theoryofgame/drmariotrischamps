import { describe, it, expect } from '@jest/globals';
import {
	fieldAnchorForLayout,
	calibrationFromBottleRect,
	bottleRectFromCalibration,
	deriveAllRegionsFromScreen,
} from '../public/producer/drmario/calibrationMath.js';
import {
	FIELD,
	FIELD_MARGIN,
	VERSUS,
	LAYOUT,
	REFERENCE_SIZE,
	CALIBRATION_REGIONS,
	CELL_SIZE,
} from '../public/producer/drmario/constants.js';

// This is the highest-risk new math from the independent-per-region calibration feature --
// DrMarioOCR.js itself can't be unit-tested directly (it needs document.createElement('canvas'),
// and this project's Jest config runs testEnvironment: 'node', no jsdom), which is exactly why
// this math was extracted into its own DOM-free module in the first place -- see
// calibrationMath.js's own header comment.

describe('fieldAnchorForLayout', () => {
	it('returns FIELD for single-player', () => {
		expect(fieldAnchorForLayout(LAYOUT.SINGLE_PLAYER)).toBe(FIELD);
	});

	it('returns VERSUS.BOTTLE_1P for versus', () => {
		expect(fieldAnchorForLayout(LAYOUT.VERSUS)).toBe(VERSUS.BOTTLE_1P);
	});
});

describe('calibrationFromBottleRect / bottleRectFromCalibration round-trip', () => {
	it('recovers the exact original whole-screen calibration (single-player)', () => {
		const originalCalibration = { x: 724, y: 151, w: 809, h: 726 };

		const bottleRect = bottleRectFromCalibration(
			originalCalibration,
			LAYOUT.SINGLE_PLAYER
		);
		const recovered = calibrationFromBottleRect(
			bottleRect,
			LAYOUT.SINGLE_PLAYER
		);

		expect(recovered.x).toBeCloseTo(originalCalibration.x);
		expect(recovered.y).toBeCloseTo(originalCalibration.y);
		expect(recovered.w).toBeCloseTo(originalCalibration.w);
		expect(recovered.h).toBeCloseTo(originalCalibration.h);
	});

	it('recovers the exact original whole-screen calibration (versus)', () => {
		const originalCalibration = { x: 100, y: 50, w: 1024, h: 896 };

		const bottleRect = bottleRectFromCalibration(
			originalCalibration,
			LAYOUT.VERSUS
		);
		const recovered = calibrationFromBottleRect(bottleRect, LAYOUT.VERSUS);

		expect(recovered.x).toBeCloseTo(originalCalibration.x);
		expect(recovered.y).toBeCloseTo(originalCalibration.y);
		expect(recovered.w).toBeCloseTo(originalCalibration.w);
		expect(recovered.h).toBeCloseTo(originalCalibration.h);
	});

	it('bottleRectFromCalibration places the bottle exactly at FIELD for an identity screen rect', () => {
		const identityScreen = {
			x: 0,
			y: 0,
			w: REFERENCE_SIZE.w,
			h: REFERENCE_SIZE.h,
		};

		const bottleRect = bottleRectFromCalibration(
			identityScreen,
			LAYOUT.SINGLE_PLAYER
		);

		expect(bottleRect).toEqual(FIELD);
	});
});

describe('deriveAllRegionsFromScreen', () => {
	it("recovers each region's exact refPoint/size for an identity screen rect", () => {
		const identityScreen = {
			x: 0,
			y: 0,
			w: REFERENCE_SIZE.w,
			h: REFERENCE_SIZE.h,
		};

		const regions = deriveAllRegionsFromScreen(identityScreen);

		Object.entries(CALIBRATION_REGIONS).forEach(
			([name, { refPoint, size }]) => {
				expect(regions[name].x).toBeCloseTo(refPoint.x);
				expect(regions[name].y).toBeCloseTo(refPoint.y);
				expect(regions[name].w).toBeCloseTo(size.w);
				expect(regions[name].h).toBeCloseTo(size.h);
			}
		);
	});

	it('populates every CALIBRATION_REGIONS key', () => {
		const regions = deriveAllRegionsFromScreen({
			x: 10,
			y: 20,
			w: 512,
			h: 448,
		});

		expect(Object.keys(regions).sort()).toEqual(
			Object.keys(CALIBRATION_REGIONS).sort()
		);
	});

	it('scales and offsets a non-identity screen rect correctly (field region)', () => {
		// 2x scale, offset by (10, 20)
		const screen = {
			x: 10,
			y: 20,
			w: REFERENCE_SIZE.w * 2,
			h: REFERENCE_SIZE.h * 2,
		};

		const regions = deriveAllRegionsFromScreen(screen);

		expect(regions.field.x).toBeCloseTo(10 + (FIELD.x - FIELD_MARGIN) * 2);
		expect(regions.field.y).toBeCloseTo(20 + (FIELD.y - FIELD_MARGIN) * 2);
		expect(regions.field.w).toBeCloseTo((FIELD.w + FIELD_MARGIN * 2) * 2);
		expect(regions.field.h).toBeCloseTo((FIELD.h + FIELD_MARGIN * 2) * 2);
	});
});

describe('CALIBRATION_REGIONS', () => {
	it("field's local offset is exactly FIELD_MARGIN in from its own padded canvas, sized to FIELD", () => {
		expect(CALIBRATION_REGIONS.field.local).toEqual({
			x: FIELD_MARGIN,
			y: FIELD_MARGIN,
			w: FIELD.w,
			h: FIELD.h,
		});
		expect(CALIBRATION_REGIONS.field.size).toEqual({
			w: FIELD.w + FIELD_MARGIN * 2,
			h: FIELD.h + FIELD_MARGIN * 2,
		});
	});

	it("next_pill captures a full 2-cell width, not REFERENCE_LOCATIONS' informational (and 1px short) crop.w", () => {
		expect(CALIBRATION_REGIONS.next_pill.size).toEqual({
			w: CELL_SIZE * 2,
			h: 7,
		});
		expect(CALIBRATION_REGIONS.next_pill.local).toEqual({ x: 0, y: 0 });
	});

	it('digit/word regions (top/score/level/virus/speed) are local to their own captured canvas, at their own existing size', () => {
		['top', 'score', 'level', 'virus'].forEach(name => {
			const region = CALIBRATION_REGIONS[name];
			expect(region.local.crop).toEqual({
				x: 0,
				y: 0,
				w: region.size.w,
				h: region.size.h,
			});
			expect(region.local.pattern).toBeTruthy();
		});

		expect(CALIBRATION_REGIONS.speed.local.crop).toEqual({
			x: 0,
			y: 0,
			w: CALIBRATION_REGIONS.speed.size.w,
			h: CALIBRATION_REGIONS.speed.size.h,
		});
		expect(CALIBRATION_REGIONS.speed.local.values).toEqual([
			'low',
			'med',
			'hi',
		]);
	});
});
