/** Upload webp already converted (mtime within N hours) + any 0pf* */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEST = __dirname;
const ACCOUNT = '465a71c126c1683de83ae568a89b1a57';
const BUCKET = 'emote';
const CONC = 16;
const MAX_AGE_MS = 8 * 60 * 60 * 1000;

function token() {
	const toml = fs.readFileSync(
		path.join(os.homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),
		'utf8',
	);
	const m = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
	if (!m) throw new Error('no oauth');
	return m[1];
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function put(tok, key, body) {
	const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
	for (let a = 0; a < 10; a++) {
		const res = await fetch(url, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'image/webp' },
			body,
		});
		if (res.ok) return;
		if (res.status === 401) throw new Error('401 auth');
		if (res.status !== 429 && res.status < 500) throw new Error(`${res.status}`);
		await sleep(Math.min(15000, 500 * 2 ** a));
	}
	throw new Error('retry exhausted');
}

async function main() {
	const now = Date.now();
	const files = fs
		.readdirSync(DEST)
		.filter((f) => f.toLowerCase().endsWith('.webp'))
		.filter((f) => {
			const st = fs.statSync(path.join(DEST, f));
			return now - st.mtimeMs < MAX_AGE_MS || f.toLowerCase().startsWith('0pf');
		})
		.sort();
	console.log(`Upload candidates: ${files.length}`);
	const tok = token();
	let i = 0;
	let ok = 0;
	let fail = 0;
	const t0 = Date.now();

	async function worker() {
		while (i < files.length) {
			const idx = i++;
			const key = files[idx];
			try {
				await put(tok, key, fs.readFileSync(path.join(DEST, key)));
				ok++;
			} catch (e) {
				fail++;
				console.error(`[FAIL] ${key}: ${e.message}`);
			}
			if ((ok + fail) % 50 === 0 || ok + fail === files.length) {
				const rate = (ok / ((Date.now() - t0) / 1000)).toFixed(1);
				console.log(`[progress] ${ok + fail}/${files.length} ok=${ok} fail=${fail} ~${rate}/s`);
			}
		}
	}

	await Promise.all(Array.from({ length: CONC }, () => worker()));
	console.log(`Done — ok=${ok} fail=${fail}`);
	if (fail) process.exitCode = 2;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
