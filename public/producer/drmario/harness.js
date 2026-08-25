// Wiring for harness.html: video source selection, click-to-calibrate, and a live render of
// whatever DrMarioOCR decodes each frame. See DrMarioOCR.js for the actual OCR logic -- this
// file is just DOM glue around it.

import { LAYOUT, REFERENCE_SIZE, COLOR_PALETTE } from './constants.js';
import { DrMarioOCR } from './DrMarioOCR.js';
import {
	playVideoFromDevice,
	playVideoFromScreenCap,
	getConnectedDevices,
} from '../MediaUtils.js';

const video = document.getElementById('video');
const previewCanvas = document.getElementById('preview-canvas');
const previewCtx = previewCanvas.getContext('2d');
const layoutSelect = document.getElementById('layout');
const deviceSelect = document.getElementById('devices');
const results = document.getElementById('results');
const referenceHolder = document.getElementById('reference-canvas-holder');

const calInputs = {
	x: document.getElementById('cal-x'),
	y: document.getElementById('cal-y'),
	w: document.getElementById('cal-w'),
	h: document.getElementById('cal-h'),
};

const STORAGE_KEY = 'drmario_ocr_harness_calibration';

function loadCalibration() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch (_err) {
		return null;
	}
}

function saveCalibration(calibration) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(calibration));
	} catch (_err) {
		// ignore -- calibration just won't persist across reloads
	}
}

let calibration = loadCalibration();
const ocr = new DrMarioOCR({ layout: layoutSelect.value, calibration });

const referenceCanvas = ocr.getReferenceCanvas();
referenceCanvas.style.width = `${REFERENCE_SIZE.w * 2}px`;
referenceCanvas.style.height = `${REFERENCE_SIZE.h * 2}px`;
referenceHolder.appendChild(referenceCanvas);

function updateCalInputs() {
	calInputs.x.value = calibration ? Math.round(calibration.x) : '';
	calInputs.y.value = calibration ? Math.round(calibration.y) : '';
	calInputs.w.value = calibration ? Math.round(calibration.w) : '';
	calInputs.h.value = calibration ? Math.round(calibration.h) : '';
}
updateCalInputs();

function applyCalibration(next) {
	calibration = next;
	ocr.setCalibration(calibration);
	saveCalibration(calibration);
	updateCalInputs();
}

Object.values(calInputs).forEach(input => {
	input.addEventListener('input', () => {
		applyCalibration({
			x: Number(calInputs.x.value) || 0,
			y: Number(calInputs.y.value) || 0,
			w: Number(calInputs.w.value) || 1,
			h: Number(calInputs.h.value) || 1,
		});
	});
});

document.getElementById('cal-reset').addEventListener('click', () => {
	calibration = null;
	ocr.setCalibration(null);
	localStorage.removeItem(STORAGE_KEY);
	updateCalInputs();
});

layoutSelect.addEventListener('change', () => {
	ocr.setConfig({ layout: layoutSelect.value, calibration });
	buildResultsSkeleton();
});

let pendingCorner = null;

previewCanvas.addEventListener('click', event => {
	const rect = previewCanvas.getBoundingClientRect();
	const scaleX = previewCanvas.width / rect.width;
	const scaleY = previewCanvas.height / rect.height;
	const x = (event.clientX - rect.left) * scaleX;
	const y = (event.clientY - rect.top) * scaleY;

	if (!pendingCorner) {
		pendingCorner = { x, y };
		return;
	}

	const x0 = Math.min(pendingCorner.x, x);
	const y0 = Math.min(pendingCorner.y, y);
	const w = Math.abs(x - pendingCorner.x);
	const h = Math.abs(y - pendingCorner.y);
	pendingCorner = null;

	if (w > 4 && h > 4) {
		applyCalibration({ x: x0, y: y0, w, h });
	}
});

async function populateDevices() {
	const devices = await getConnectedDevices('videoinput');

	deviceSelect.innerHTML = '';
	devices.forEach(device => {
		const option = document.createElement('option');
		option.value = device.deviceId;
		option.textContent = device.label || device.deviceId;
		deviceSelect.appendChild(option);
	});
}
populateDevices();

document.getElementById('use-camera').addEventListener('click', async () => {
	await playVideoFromDevice(video, { device_id: deviceSelect.value });
});

document.getElementById('use-screen').addEventListener('click', async () => {
	await playVideoFromScreenCap(video);
});

video.addEventListener('loadedmetadata', () => {
	previewCanvas.width = video.videoWidth;
	previewCanvas.height = video.videoHeight;
});

function colorFor(cell) {
	if (!cell || cell.type === 'empty') return '#000';
	if (cell.type === 'unknown') return '#888';

	const rgb = COLOR_PALETTE[cell.color];
	return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : '#f0f';
}

function renderBoard(container, board) {
	container.innerHTML = '';
	container.className = 'board-grid';
	container.style.gridTemplateColumns = `repeat(${board[0].length}, 12px)`;

	board.flat().forEach(cell => {
		const div = document.createElement('div');
		div.className = 'board-cell';
		div.style.background = colorFor(cell);
		div.title = JSON.stringify(cell);
		container.appendChild(div);
	});
}

function renderNextPill(container, nextPill) {
	container.innerHTML = '';

	['left', 'right'].forEach(slot => {
		const span = document.createElement('span');
		span.className = 'next-pill-cell';
		span.style.background = colorFor(nextPill[slot]);
		container.appendChild(span);
	});
}

function buildResultsSkeleton() {
	if (layoutSelect.value === LAYOUT.VERSUS) {
		results.innerHTML = `
			<div class="players">
				<div>
					<h3>Player 1</h3>
					<div id="board-1p"></div>
					<p>Next: <span id="next-1p"></span></p>
					<p class="stats" id="stats-1p"></p>
				</div>
				<div>
					<h3>Player 2</h3>
					<div id="board-2p"></div>
					<p>Next: <span id="next-2p"></span></p>
					<p class="stats" id="stats-2p"></p>
				</div>
			</div>
			<p class="stats" id="crowns"></p>
		`;
	} else {
		results.innerHTML = `
			<div id="board-sp"></div>
			<p>Next: <span id="next-sp"></span></p>
			<p class="stats" id="stats-sp"></p>
		`;
	}
}
buildResultsSkeleton();

function renderResult(result) {
	if (result.layout === LAYOUT.VERSUS) {
		renderBoard(document.getElementById('board-1p'), result.player1.board);
		renderBoard(document.getElementById('board-2p'), result.player2.board);
		renderNextPill(document.getElementById('next-1p'), result.player1.nextPill);
		renderNextPill(document.getElementById('next-2p'), result.player2.nextPill);

		document.getElementById('stats-1p').textContent =
			`Level ${result.player1.level ?? '?'} / Speed ${result.player1.speed ?? '?'} / Virus ${result.player1.virus ?? '?'}`;
		document.getElementById('stats-2p').textContent =
			`Level ${result.player2.level ?? '?'} / Speed ${result.player2.speed ?? '?'} / Virus ${result.player2.virus ?? '?'}`;
		document.getElementById('crowns').textContent =
			`Crowns -- P1: ${result.crowns.player1.wins} / P2: ${result.crowns.player2.wins}`;
	} else {
		renderBoard(document.getElementById('board-sp'), result.board);
		renderNextPill(document.getElementById('next-sp'), result.nextPill);

		document.getElementById('stats-sp').textContent =
			`Top ${result.top ?? '?'} / Score ${result.score ?? '?'} / Level ${result.level ?? '?'} / Speed ${result.speed ?? '?'} / Virus ${result.virus ?? '?'}`;
	}
}

function loop() {
	requestAnimationFrame(loop);

	if (video.readyState < 2) return; // HAVE_CURRENT_DATA -- nothing decoded yet

	previewCtx.drawImage(video, 0, 0, previewCanvas.width, previewCanvas.height);

	if (!calibration) return;

	previewCtx.strokeStyle = '#0f0';
	previewCtx.lineWidth = 2;
	previewCtx.strokeRect(
		calibration.x,
		calibration.y,
		calibration.w,
		calibration.h
	);

	const result = ocr.processVideoFrame({ video });
	if (result) renderResult(result);
}
requestAnimationFrame(loop);
