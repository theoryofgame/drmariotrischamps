// Drives BoardOCR.js/PanelOCR.js/CrownOCR.js against live video, the DOM-facing counterpart to
// those DOM-free modules. Mirrors the shape of ../TetrisOCR.js/../cpuTetrisOCR.js
// (EventTarget, processVideoFrame(frame) with frame = { video, videoFrame }, dispatches a
// 'frame' CustomEvent), but is much simpler: since cell identification here works by matching
// exact NES tile shapes rather than sampling a flat color (see templates.js), there's no need
// for TetrisOCR's per-task packing canvas -- one canvas, normalized to REFERENCE_SIZE, is
// sampled directly by the same pure functions the offline tests use.
//
// Calibration is deliberately minimal for now: a single axis-aligned crop rectangle (in source
// video pixel coordinates) that maps onto the 256x224 reference frame, set via setCalibration().
// It does not (yet) handle skew/rotation the way the Tetris OCR's calibration UI does for
// capture-card artifacts -- if real capture footage needs that, it'll need building out later.

import {
	REFERENCE_SIZE,
	LAYOUT,
	CONFIGS,
	FIELD,
	REFERENCE_LOCATIONS,
	REFERENCE_LOCATIONS_VERSUS,
	VERSUS,
} from './constants.js';
import { scanBoard, identifyNextPill } from './BoardOCR.js';
import { readNumber, readSpeed } from './PanelOCR.js';
import { readCrowns } from './CrownOCR.js';
import { readResult } from './ResultOCR.js';
import { hasBottle, isTitleScreen } from './ScreenOCR.js';

export class DrMarioOCR extends EventTarget {
	constructor(config) {
		super();

		this.reference_canvas = document.createElement('canvas');
		this.reference_canvas.width = REFERENCE_SIZE.w;
		this.reference_canvas.height = REFERENCE_SIZE.h;

		this.reference_ctx = this.reference_canvas.getContext('2d', {
			alpha: false,
			willReadFrequently: true,
		});
		this.reference_ctx.imageSmoothingEnabled = false; // preserve crisp NES pixel edges when scaling

		this.setConfig(config);
	}

	setConfig(config) {
		const layout = config.layout ?? LAYOUT.SINGLE_PLAYER;

		if (!CONFIGS[layout]) {
			throw new Error(`DrMarioOCR: unknown layout "${layout}"`);
		}

		this.layout = layout;
		this.setCalibration(config.calibration);
	}

	// { x, y, w, h } in source video pixel coordinates, i.e. the rectangle of the captured video
	// that shows the NES's 256x224 screen. null means "not calibrated yet" -- processVideoFrame()
	// is then a no-op, same as a producer with no capture region configured.
	setCalibration(calibration) {
		this.calibration = calibration ?? null;
	}

	// Exposes the normalized frame this OCR actually reads from, so a calibration UI can display
	// it directly for feedback (see harness.js) instead of recomputing the same crop separately.
	getReferenceCanvas() {
		return this.reference_canvas;
	}

	processVideoFrame(frame) {
		if (!this.calibration) return null;

		const { video, videoFrame } = frame;
		const { x, y, w, h } = this.calibration;

		this.reference_ctx.drawImage(
			videoFrame || video,
			x,
			y,
			w,
			h,
			0,
			0,
			REFERENCE_SIZE.w,
			REFERENCE_SIZE.h
		);

		const imageData = this.reference_ctx.getImageData(
			0,
			0,
			REFERENCE_SIZE.w,
			REFERENCE_SIZE.h
		);
		const image = {
			width: imageData.width,
			height: imageData.height,
			data: imageData.data,
		};

		// Whole-screen fact, not a per-bottle one, but attached to each per-bottle shape below (the
		// same way hasBottle is) so RoundTracker -- which only ever sees one bottle's frames --
		// can act on it: a soft reset jumps straight to the title screen mid-round, with none of
		// the usual 'game_over'/'topout' result on the way.
		const titleScreen = isTitleScreen(image);

		const result =
			this.layout === LAYOUT.VERSUS
				? this.#scanVersus(image, titleScreen)
				: this.#scanSinglePlayer(image, titleScreen);

		this.dispatchEvent(new CustomEvent('frame', { detail: result }));

		return result;
	}

	// Screens with no bottle at all (pause, title, the 1P/2P setup menu -- see ScreenOCR.js)
	// would otherwise still get read by every function below, which don't know any better and
	// just produce misleading output pointed at the wrong thing (an all-black pause screen
	// reads as an empty board; ResultOCR's default reads as an ordinary in-progress round).
	// Checking first avoids both the wasted work and the bad data.
	#scanBottle(image, field) {
		if (!hasBottle(image, field)) {
			return {
				hasBottle: false,
				result: null,
				board: null,
				nextPill: null,
				level: null,
				virus: null,
				speed: null,
			};
		}

		return { hasBottle: true, result: readResult(image, field) };
	}

	#scanSinglePlayer(image, titleScreen) {
		const bottle = this.#scanBottle(image, FIELD);

		if (!bottle.hasBottle) {
			return {
				layout: LAYOUT.SINGLE_PLAYER,
				top: null,
				score: null,
				isTitleScreen: titleScreen,
				...bottle,
			};
		}

		return {
			layout: LAYOUT.SINGLE_PLAYER,
			isTitleScreen: titleScreen,
			...bottle,
			board: scanBoard(image),
			nextPill: identifyNextPill(image),
			top: readNumber(image, REFERENCE_LOCATIONS.top),
			score: readNumber(image, REFERENCE_LOCATIONS.score),
			level: readNumber(image, REFERENCE_LOCATIONS.level),
			virus: readNumber(image, REFERENCE_LOCATIONS.virus),
			speed: readSpeed(image, REFERENCE_LOCATIONS.speed),
		};
	}

	#scanVersusBottle(image, field, nextPillPosition, loc, titleScreen) {
		const bottle = this.#scanBottle(image, field);

		if (!bottle.hasBottle) return { ...bottle, isTitleScreen: titleScreen };

		return {
			...bottle,
			isTitleScreen: titleScreen,
			board: scanBoard(image, { field }),
			nextPill: identifyNextPill(image, { position: nextPillPosition }),
			level: readNumber(image, loc.level),
			speed: readSpeed(image, loc.speed),
			virus: readNumber(image, loc.virus),
		};
	}

	#scanVersus(image, titleScreen) {
		const loc = REFERENCE_LOCATIONS_VERSUS;

		return {
			layout: LAYOUT.VERSUS,
			player1: this.#scanVersusBottle(
				image,
				VERSUS.BOTTLE_1P,
				VERSUS.NEXT_PILL_1P,
				{
					level: loc.level_1p,
					speed: loc.speed_1p,
					virus: loc.virus_1p,
				},
				titleScreen
			),
			player2: this.#scanVersusBottle(
				image,
				VERSUS.BOTTLE_2P,
				VERSUS.NEXT_PILL_2P,
				{
					level: loc.level_2p,
					speed: loc.speed_2p,
					virus: loc.virus_2p,
				},
				titleScreen
			),
			crowns: readCrowns(image),
		};
	}
}
