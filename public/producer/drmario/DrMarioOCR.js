// Drives BoardOCR.js/PanelOCR.js/CrownOCR.js against live video, the DOM-facing counterpart to
// those DOM-free modules. Mirrors the shape of ../TetrisOCR.js/../cpuTetrisOCR.js
// (EventTarget, processVideoFrame(frame) with frame = { video, videoFrame }, dispatches a
// 'frame' CustomEvent), but is much simpler: since cell identification here works by matching
// exact NES tile shapes rather than sampling a flat color (see templates.js), there's no need
// for TetrisOCR's per-task packing canvas -- one canvas, normalized to REFERENCE_SIZE, is
// sampled directly by the same pure functions the offline tests use.
//
// Calibration: versus mode (unchanged, deferred -- see CLAUDE.md) still uses a single
// axis-aligned crop rectangle (source video pixels -> the 256x224 reference frame). Single-player
// instead captures each of CALIBRATION_REGIONS independently -- see constants.js's own comment
// for why (ported from the existing Tetris OCR's own per-task-canvas model after a real remote/
// Twitch-relayed capture showed a single shared transform can't represent a non-uniformly cropped
// source). The whole-screen rect is still captured too, even in single-player: isTitleScreen()
// needs a genuine whole-screen anchor (no bottle exists on the title screen to be field-relative
// to), and it's also the "quick seed" derivation's source (see producer.js) and what
// getReferenceCanvas() still shows for a coarse, whole-picture sanity check.

import {
	REFERENCE_SIZE,
	LAYOUT,
	CONFIGS,
	REFERENCE_LOCATIONS_VERSUS,
	VERSUS,
	CALIBRATION_REGIONS,
} from './constants.js';
import { scanBoard, identifyNextPill } from './BoardOCR.js';
import {
	readNumberDebug,
	readSpeedDebug,
	digitsToValue,
	readNumber,
	readSpeed,
} from './PanelOCR.js';
import { readCrowns } from './CrownOCR.js';
import { readResult } from './ResultOCR.js';
import { hasBottle, isTitleScreen } from './ScreenOCR.js';

const REGION_NAMES = Object.keys(CALIBRATION_REGIONS);

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

		// One small canvas per independently-calibrated single-player region (see constants.js's
		// CALIBRATION_REGIONS) -- created once, redrawn every frame, exposed via getRegionCanvas()
		// the same way getReferenceCanvas() already exposes the whole-screen one.
		this.region_canvases = {};
		this.region_ctxs = {};
		REGION_NAMES.forEach(name => {
			const { size } = CALIBRATION_REGIONS[name];
			const canvas = document.createElement('canvas');
			canvas.width = size.w;
			canvas.height = size.h;
			const ctx = canvas.getContext('2d', {
				alpha: false,
				willReadFrequently: true,
			});
			ctx.imageSmoothingEnabled = false;
			this.region_canvases[name] = canvas;
			this.region_ctxs[name] = ctx;
		});

		// Single-player only -- the last frame's panel-field diagnostics (readNumberDebug()/
		// readSpeedDebug() results for top/score/level/virus/speed), exposed via
		// getLastPanelDebug() for the calibration UI. Not part of the broadcast frame itself
		// (result only carries the plain values) since this is only ever useful locally, while
		// setting up -- see getLastPanelDebug()'s own comment.
		this.last_panel_debug = null;

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

	// { screen, regions }. screen: { x, y, w, h } in source video pixel coordinates, the whole NES
	// 256x224 screen -- used by both layouts for isTitleScreen() (no bottle exists on the title
	// screen to be field-relative to) and by single-player as the "quick seed" source (see
	// producer.js) and what getReferenceCanvas() shows. regions: single-player only, one
	// { x, y, w, h } per CALIBRATION_REGIONS key, in source video pixel coordinates, each
	// independently capturing just that region instead of being read as a fixed offset within the
	// whole-screen capture -- see constants.js's own comment for why. null (the whole object, or
	// an individual region) means "not calibrated yet" -- processVideoFrame() is then a no-op for
	// whatever it's missing, same as a producer with no capture region configured.
	setCalibration(calibration) {
		this.calibration = calibration ?? null;
	}

	// Exposes the normalized whole-screen frame, so a calibration UI can display it directly for
	// feedback (see harness.js/producer.js) instead of recomputing the same crop separately.
	getReferenceCanvas() {
		return this.reference_canvas;
	}

	// Single-player only -- exposes one independently-calibrated region's own captured canvas, for
	// the same reason getReferenceCanvas() exposes the whole-screen one: so the calibration UI can
	// show exactly what a region is capturing without recomputing the crop itself.
	getRegionCanvas(name) {
		return this.region_canvases[name];
	}

	// Single-player only -- { top, score, level, virus, speed }, each a readNumberDebug()/
	// readSpeedDebug() result (top/score/level/virus: an array, one entry per digit; speed: a
	// single { value, distance, bestGuess }) from the most recent frame, for a calibration UI to
	// show *why* a field isn't reading (which digit, how close the nearest template actually
	// was) instead of just that it isn't -- see producer.js. null until the first frame with every
	// region calibrated has been processed.
	getLastPanelDebug() {
		return this.last_panel_debug;
	}

	#drawAndSample(source, rect, ctx, targetSize) {
		ctx.drawImage(
			source,
			rect.x,
			rect.y,
			rect.w,
			rect.h,
			0,
			0,
			targetSize.w,
			targetSize.h
		);

		const imageData = ctx.getImageData(0, 0, targetSize.w, targetSize.h);

		return {
			width: imageData.width,
			height: imageData.height,
			data: imageData.data,
		};
	}

	processVideoFrame(frame) {
		if (!this.calibration?.screen) return null;

		const { video, videoFrame } = frame;
		const source = videoFrame || video;

		const image = this.#drawAndSample(
			source,
			this.calibration.screen,
			this.reference_ctx,
			REFERENCE_SIZE
		);

		// Whole-screen fact, not a per-bottle one, but attached to each per-bottle shape below (the
		// same way hasBottle is) so RoundTracker -- which only ever sees one bottle's frames --
		// can act on it: a soft reset jumps straight to the title screen mid-round, with none of
		// the usual 'game_over'/'topout' result on the way.
		const titleScreen = isTitleScreen(image);

		const result =
			this.layout === LAYOUT.VERSUS
				? this.#scanVersus(image, titleScreen)
				: this.#scanSinglePlayer(source, titleScreen);

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

	// Captures every CALIBRATION_REGIONS entry independently from the raw source (see
	// constants.js's own comment on why -- a single shared whole-screen capture can't represent a
	// non-uniformly cropped source). Returns null for any region not yet calibrated.
	#captureRegions(source) {
		const images = {};

		REGION_NAMES.forEach(name => {
			const rect = this.calibration.regions?.[name];
			images[name] = rect
				? this.#drawAndSample(
						source,
						rect,
						this.region_ctxs[name],
						CALIBRATION_REGIONS[name].size
					)
				: null;
		});

		return images;
	}

	#scanSinglePlayer(source, titleScreen) {
		const regions = this.#captureRegions(source);

		// Not fully calibrated yet -- same "no-op" shape a producer with no capture region
		// configured already gets, just per-field instead of all-or-nothing.
		if (REGION_NAMES.some(name => !regions[name])) {
			this.last_panel_debug = null;

			return {
				layout: LAYOUT.SINGLE_PLAYER,
				isTitleScreen: titleScreen,
				hasBottle: false,
				result: null,
				board: null,
				nextPill: null,
				level: null,
				virus: null,
				speed: null,
				top: null,
				score: null,
			};
		}

		// Computed (and diagnostics stashed) regardless of hasBottle below -- these regions are
		// captured independently of the field/bottle one, so a calibration UI can debug them even
		// while there's no bottle on screen at all (paused on a menu, say) to look at otherwise.
		const topDebug = readNumberDebug(
			regions.top,
			CALIBRATION_REGIONS.top.local
		);
		const scoreDebug = readNumberDebug(
			regions.score,
			CALIBRATION_REGIONS.score.local
		);
		const levelDebug = readNumberDebug(
			regions.level,
			CALIBRATION_REGIONS.level.local
		);
		const virusDebug = readNumberDebug(
			regions.virus,
			CALIBRATION_REGIONS.virus.local
		);
		const speedDebug = readSpeedDebug(
			regions.speed,
			CALIBRATION_REGIONS.speed.local
		);

		this.last_panel_debug = {
			top: topDebug,
			score: scoreDebug,
			level: levelDebug,
			virus: virusDebug,
			speed: speedDebug,
		};

		const fieldImage = regions.field;
		const fieldLocal = CALIBRATION_REGIONS.field.local;
		const bottle = this.#scanBottle(fieldImage, fieldLocal);

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
			board: scanBoard(fieldImage, { field: fieldLocal }),
			nextPill: identifyNextPill(regions.next_pill, {
				position: CALIBRATION_REGIONS.next_pill.local,
			}),
			top: digitsToValue(topDebug),
			score: digitsToValue(scoreDebug),
			level: digitsToValue(levelDebug),
			virus: digitsToValue(virusDebug),
			speed: speedDebug.value,
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
