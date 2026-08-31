// Wiring for practice_admin.html: a small control surface for the two solo practice views
// (drmario_speed_practice.html/drmario_qualify_practice.html), moved off the broadcast page itself
// -- their on-page config panels were reported live as awkward to reach in OBS (only reachable via
// Interact mode on the source itself). Unlike speed_admin.js there's no server-side room state to
// track (see routes/websocket.js's practice-admin route: a dumb sendToViews() relay, not a
// DrMarioSpeedRoom-style domain object), so this is just secret-persistence + a handful of buttons
// that send commands straight through -- no state pushed back from the server to render here.

import Connection from '/js/connection.js';

const SECRET_STORAGE_KEY = 'drmario_practice_admin_secret';
const LEVEL_START_KEY = 'drmario_practice_admin_level_start';
const LEVEL_COUNT_KEY = 'drmario_practice_admin_level_count';

function loadFromStorage(key) {
	try {
		return localStorage.getItem(key);
	} catch (_err) {
		return null;
	}
}

function saveToStorage(key, value) {
	try {
		localStorage.setItem(key, value);
	} catch (_err) {
		// ignore -- just won't persist across reloads
	}
}

const adminSecretInput = document.getElementById('admin-secret');
const adminStatusEl = document.getElementById('admin-status');
adminSecretInput.value = loadFromStorage(SECRET_STORAGE_KEY) || '';

const levelStartInput = document.getElementById('level-start');
const levelCountInput = document.getElementById('level-count');
const savedLevelStart = loadFromStorage(LEVEL_START_KEY);
const savedLevelCount = loadFromStorage(LEVEL_COUNT_KEY);
if (savedLevelStart !== null) levelStartInput.value = savedLevelStart;
if (savedLevelCount !== null) levelCountInput.value = savedLevelCount;

let connection = null;

function setAdminStatus(text, connected) {
	adminStatusEl.textContent = text;
	adminStatusEl.className = connected ? 'connected' : 'disconnected';
}

function send(message) {
	connection?.send(message);
}

document.getElementById('admin-connect').addEventListener('click', () => {
	const secret = adminSecretInput.value.trim();
	if (!secret) return;

	saveToStorage(SECRET_STORAGE_KEY, secret);

	if (connection) {
		connection.close();
	}

	const wsProtocol = location.protocol.match(/^https/i) ? 'wss:' : 'ws:';
	const url = `${wsProtocol}//${location.host}/ws/room/drmario/practice/admin/${secret}`;

	connection = new Connection(url);
	connection.onOpen = () => setAdminStatus('Connected', true);
	connection.onBreak = () =>
		setAdminStatus('Connection lost, retrying...', false);
	connection.onResume = () => setAdminStatus('Connected', true);
	connection.onKicked = reason => setAdminStatus(`Kicked: ${reason}`, false);

	setAdminStatus('Connecting...', false);
});

document.getElementById('admin-disconnect').addEventListener('click', () => {
	if (connection) {
		connection.close();
		connection = null;
	}
	setAdminStatus('Disconnected', false);
});

document.getElementById('levelset-set').addEventListener('click', () => {
	const start = parseInt(levelStartInput.value, 10);
	const count = parseInt(levelCountInput.value, 10);
	if (!Number.isFinite(start) || !Number.isFinite(count) || count < 1) return;

	saveToStorage(LEVEL_START_KEY, start);
	saveToStorage(LEVEL_COUNT_KEY, count);

	const levels = Array.from({ length: count }, (_, i) => start + i);
	send(['speedPracticeSetLevelSet', levels]);
});

document.getElementById('speed-reset-run').addEventListener('click', () => {
	send(['speedPracticeResetRun']);
});

document.getElementById('qualify-reset-run').addEventListener('click', () => {
	send(['qualifyPracticeResetRun']);
});
