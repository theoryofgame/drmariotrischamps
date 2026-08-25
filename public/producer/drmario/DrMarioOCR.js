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
	REFERENCE_LOCATIONS,
	REFERENCE_LOCATIONS_VERSUS,
	VERSUS,
} from './constants.js';
import { scanBoard, identifyNextPill } from './BoardOCR.js';
import { readNumber, readSpeed } from './PanelOCR.js';
import { readCrowns } from './CrownOCR.js';

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

		const result =
			this.layout === LAYOUT.VERSUS
				? this.#scanVersus(image)
				: this.#scanSinglePlayer(image);

		this.dispatchEvent(new CustomEvent('frame', { detail: result }));

		return result;
	}

	#scanSinglePlayer(image) {
		return {
			layout: LAYOUT.SINGLE_PLAYER,
			board: scanBoard(image),
			nextPill: identifyNextPill(image),
			top: readNumber(image, REFERENCE_LOCATIONS.top),
			score: readNumber(image, REFERENCE_LOCATIONS.score),
			level: readNumber(image, REFERENCE_LOCATIONS.level),
			virus: readNumber(image, REFERENCE_LOCATIONS.virus),
			speed: readSpeed(image, REFERENCE_LOCATIONS.speed),
		};
	}

	#scanVersus(image) {
		const loc = REFERENCE_LOCATIONS_VERSUS;

		return {
			layout: LAYOUT.VERSUS,
			player1: {
				board: scanBoard(image, { field: VERSUS.BOTTLE_1P }),
				nextPill: identifyNextPill(image, { position: VERSUS.NEXT_PILL_1P }),
				level: readNumber(image, loc.level_1p),
				speed: readSpeed(image, loc.speed_1p),
				virus: readNumber(image, loc.virus_1p),
			},
			player2: {
				board: scanBoard(image, { field: VERSUS.BOTTLE_2P }),
				nextPill: identifyNextPill(image, { position: VERSUS.NEXT_PILL_2P }),
				level: readNumber(image, loc.level_2p),
				speed: readSpeed(image, loc.speed_2p),
				virus: readNumber(image, loc.virus_2p),
			},
			crowns: readCrowns(image),
		};
	}
}
