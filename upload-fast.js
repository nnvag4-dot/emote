/** Upload new captures — steady concurrency + shared 429 backoff */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = String.raw`D:\Drama_City\txData\Qbox_Drama_ City\resources\[qbx]\[chupanhemote]\0r-emote-capture\html\images`;
const DEST = __dirname;
const ACCOUNT = '465a71c126c1683de83ae568a89b1a57';
const BUCKET = 'emote';
const STATE = path.join(__dirname, '.upload-new-state.json');
const CONC = 12;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

let pauseUntil = 0;

function token() {
	const toml = fs.readFileSync(
		path.join(os.homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),
		'utf8',
	);
	const m = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
	if (!m) throw new Error('no oauth');
	return m[1];
}

function loadDone() {
	try {
		return new Set(JSON.parse(fs.readFileSync(STATE, 'utf8')).done || []);
	} catch {
		return new Set();
	}
}

function saveDone(done) {
	fs.writeFileSync(STATE, JSON.stringify({ done: [...done] }));
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function put(tok, key, body) {
	const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
	for (let a = 0; a < 12; a++) {
		const waitPause = pauseUntil - Date.now();
		if (waitPause > 0) await sleep(waitPause);
		const res = await fetch(url, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'image/webp' },
			body,
		});
		if (res.ok) return;
		if (res.status === 401) throw new Error('401');
		if (res.status === 429 || res.status >= 500) {
			pauseUntil = Date.now() + 1500 + a * 500;
			await sleep(800 + a * 400);
			continue;
		}
		throw new Error(String(res.status));
	}
	throw new Error('retry');
}

async function main() {
	const now = Date.now();
	const done = loadDone();
	const keys = [];
	for (const name of fs.readdirSync(SRC)) {
		const ext = path.extname(name).toLowerCase();
		if (!['.gif', '.png', '.webp'].includes(ext)) continue;
		if (now - fs.statSync(path.join(SRC, name)).mtimeMs > MAX_AGE_MS) continue;
		const base = path.basename(name, ext);
		const webp = `${base}.webp`;
		if (!fs.existsSync(path.join(DEST, webp))) continue;
		if (done.has(webp)) continue;
		keys.push(webp);
	}
	const uniq = [...new Set(keys)].sort();
	console.log(`Pending: ${uniq.length} (already ${done.size}) conc=${CONC}`);
	if (!uniq.length) {
		console.log('Done — nothing pending');
		return;
	}

	const tok = token();
	let i = 0;
	let ok = 0;
	let fail = 0;
	const t0 = Date.now();
	let lastSave = 0;

	async function worker() {
		while (i < uniq.length) {
			const idx = i++;
			const key = uniq[idx];
			try {
				await put(tok, key, fs.readFileSync(path.join(DEST, key)));
				done.add(key);
				ok++;
			} catch (e) {
				fail++;
				if (fail <= 20) console.error(`[FAIL] ${key}: ${e.message}`);
			}
			const fin = ok + fail;
			const t = Date.now();
			if (t - lastSave > 2500 || fin === uniq.length) {
				lastSave = t;
				saveDone(done);
				console.log(`[progress] ${fin}/${uniq.length} ok=${ok} fail=${fail} ~${(ok / ((t - t0) / 1000)).toFixed(1)}/s`);
			}
		}
	}

	await Promise.all(Array.from({ length: CONC }, () => worker()));
	saveDone(done);
	console.log(`Done — ok=${ok} fail=${fail} totalDone=${done.size}`);

	for (const key of ['0pfbigdawgs.webp', '0pfambitious.webp', '0pfapt.webp', '0pf360.webp', '0pfallaboutthatbass.webp']) {
		if (!fs.existsSync(path.join(DEST, key))) continue;
		const r = await fetch(`https://emote.f7studio.store/${key}`);
		console.log(`CDN ${r.status} ${key}`);
	}
	if (fail) process.exitCode = 2;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
