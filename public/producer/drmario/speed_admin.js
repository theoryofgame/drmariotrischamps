// Wiring for speed_admin.html: the private control surface for a Dr Mario "Speed" race,
// completely separate from what's on stream (drmario_speed.html). Attaches two independently-
// connected players (each still just running today's ordinary, unmodified producer.html) to race
// slots by secret, configures the level set/best-of format, and calls race results manually --
// see DrMarioSpeedRoom.js for why race-winner detection can't be automatic.

import Connection from '/js/connection.js';

const SECRET_STORAGE_KEY = 'drmario_speed_admin_secret';

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
	const url = `${wsProtocol}//${location.host}/ws/room/drmario/speed/admin/${secret}`;

	connection = new Connection(url);
	connection.onOpen = () => setAdminStatus('Connected', true);
	connection.onBreak = () =>
		setAdminStatus('Connection lost, retrying...', false);
	connection.onResume = () => setAdminStatus('Connected', true);
	connection.onKicked = reason => setAdminStatus(`Kicked: ${reason}`, false);
	connection.onMessage = message => {
		const [type, payload] = message;
		if (type === 'state') renderState(payload);
	};

	setAdminStatus('Connecting...', false);
});

document.getElementById('admin-disconnect').addEventListener('click', () => {
	if (connection) {
		connection.close();
		connection = null;
	}
	setAdminStatus('Disconnected', false);
});

// Player secret inputs are deliberately not persisted -- they belong to whoever is racing this
// particular round, not to this admin page's own setup.
['player1', 'player2'].forEach((key, slot) => {
	document.getElementById(`${key}-attach`).addEventListener('click', () => {
		const secret = document.getElementById(`${key}-secret`).value.trim();
		if (!secret) return;
		send(['setPlayer', slot, secret]);
	});
});

document.getElementById('bestof-set').addEventListener('click', () => {
	const n = parseInt(document.getElementById('bestof-select').value, 10);
	send(['setBestOf', n]);
});

document.getElementById('levelset-set').addEventListener('click', () => {
	const start = parseInt(document.getElementById('level-start').value, 10);
	const count = parseInt(document.getElementById('level-count').value, 10);
	if (!Number.isFinite(start) || !Number.isFinite(count) || count < 1) return;

	const levels = Array.from({ length: count }, (_, i) => start + i);
	send(['setLevelSet', levels]);
});

document.getElementById('header-set').addEventListener('click', () => {
	send(['setHeaderText', document.getElementById('header-text').value]);
});

document.getElementById('player1-wins').addEventListener('click', () => {
	send(['recordRaceResult', 0]);
});
document.getElementById('player2-wins').addEventListener('click', () => {
	send(['recordRaceResult', 1]);
});

document.getElementById('player1-reset-run').addEventListener('click', () => {
	send(['resetPlayerRun', 0]);
});
document.getElementById('player2-reset-run').addEventListener('click', () => {
	send(['resetPlayerRun', 1]);
});

document.getElementById('reset-match').addEventListener('click', () => {
	send(['resetMatch']);
});

function renderState(state) {
	const [wins1, wins2] = state.victories;
	const levels = state.levelSet.length
		? state.levelSet.join(', ')
		: '(not set)';
	document.getElementById('match-state').textContent =
		`Best of ${state.bestof} -- Race ${state.raceNumber} -- Victories: ${wins1}-${wins2} -- Levels: ${levels}`;

	// Reflects the room's own authoritative value (e.g. on reopening this page mid-race) --
	// skipped while the field is focused so an in-progress edit here isn't clobbered by a state
	// push triggered by some other action (e.g. setting best-of).
	const headerInput = document.getElementById('header-text');
	if (document.activeElement !== headerInput) {
		headerInput.value = state.headerText ?? '';
	}

	state.players.forEach((player, slot) => {
		const key = `player${slot + 1}`;
		const statusEl = document.getElementById(`${key}-status`);
		const loginEl = document.getElementById(`${key}-login`);

		statusEl.className = player.id
			? `status-dot ${player.connected ? 'connected' : 'disconnected'}`
			: 'status-dot';
		loginEl.textContent = player.login || '';
	});
}
