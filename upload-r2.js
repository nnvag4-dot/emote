/**
 * Fast resume upload *.webp → R2 "emote"
 * High concurrency + retry only on 429/5xx
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ACCOUNT_ID = '465a71c126c1683de83ae568a89b1a57';
const BUCKET = 'emote';
const SRC = __dirname;
const CONCURRENCY = 24;
const STATE_FILE = path.join(__dirname, '.upload-r2-state.json');
const MAX_RETRIES = 10;

function readOAuthToken() {
	const p = path.join(
		os.homedir(),
		'AppData',
		'Roaming',
		'xdg.config',
		'.wrangler',
		'config',
		'default.toml',
	);
	const toml = fs.readFileSync(p, 'utf8');
	const m = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
	if (!m) throw new Error('No oauth_token — run: npx wrangler login');
	return m[1];
}

function loadDone() {
	try {
		return new Set(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).done || []);
	} catch {
		return new Set();
	}
}

function saveDone(done) {
	fs.writeFileSync(STATE_FILE, JSON.stringify({ done: [...done] }));
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function putObject(token, filePath, key) {
	const body = fs.readFileSync(filePath);
	const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
	const res = await fetch(url, {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'image/webp',
		},
		body,
	});
	if (!res.ok) {
		const text = await res.text();
		const err = new Error(`${res.status} ${text.slice(0, 160)}`);
		err.status = res.status;
		throw err;
	}
}

async function putWithRetry(token, filePath, key) {
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			await putObject(token, filePath, key);
			return;
		} catch (e) {
			const retryable = e.status === 429 || e.status >= 500;
			if (!retryable || attempt === MAX_RETRIES - 1) throw e;
			await sleep(Math.min(20000, 400 * 2 ** attempt + Math.random() * 300));
		}
	}
}

async function main() {
	const token = readOAuthToken();
	const done = loadDone();
	const files = fs
		.readdirSync(SRC)
		.filter((f) => f.toLowerCase().endsWith('.webp'))
		.sort();
	const pending = files.filter((f) => !done.has(f));
	console.log(`Total ${files.length} | already ${done.size} | pending ${pending.length} | conc=${CONCURRENCY}`);
	if (!pending.length) {
		console.log('Nothing left to upload.');
		return;
	}

	let ok = 0;
	let fail = 0;
	let i = 0;
	const t0 = Date.now();
	let lastSave = 0;

	async function worker() {
		while (i < pending.length) {
			const idx = i++;
			const name = pending[idx];
			try {
				await putWithRetry(token, path.join(SRC, name), name);
				done.add(name);
				ok++;
			} catch (e) {
				fail++;
				console.error(`[FAIL] ${name}: ${e.message}`);
			}
			const finished = ok + fail;
			const now = Date.now();
			if (now - lastSave > 3000 || finished === pending.length) {
				lastSave = now;
				saveDone(done);
				const rate = (ok / ((now - t0) / 1000)).toFixed(1);
				console.log(`[progress] ${finished}/${pending.length} ok=${ok} fail=${fail} totalDone=${done.size} ~${rate}/s`);
			}
		}
	}

	await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
	saveDone(done);
	console.log(`Done — ok=${ok} fail=${fail} totalDone=${done.size}/${files.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	if (fail > 0) process.exitCode = 2;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
