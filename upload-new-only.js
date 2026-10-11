/** Upload only webp for captures newer than N hours in html/images */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = String.raw`D:\Drama_City\txData\Qbox_Drama_ City\resources\[qbx]\[chupanhemote]\0r-emote-capture\html\images`;
const DEST = __dirname;
const ACCOUNT = '465a71c126c1683de83ae568a89b1a57';
const BUCKET = 'emote';
const CONC = 20;
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
		if (res.status !== 429 && res.status < 500) throw new Error(String(res.status));
		await sleep(Math.min(15000, 500 * 2 ** a));
	}
	throw new Error('retry exhausted');
}

async function main() {
	const now = Date.now();
	const keys = [];
	for (const name of fs.readdirSync(SRC)) {
		const ext = path.extname(name).toLowerCase();
		if (!['.gif', '.png', '.webp'].includes(ext)) continue;
		const st = fs.statSync(path.join(SRC, name));
		if (now - st.mtimeMs > MAX_AGE_MS) continue;
		const base = path.basename(name, ext);
		const webp = path.join(DEST, `${base}.webp`);
		if (!fs.existsSync(webp)) {
			console.error(`[skip no webp] ${base}`);
			continue;
		}
		keys.push(`${base}.webp`);
	}
	const uniq = [...new Set(keys)].sort();
	console.log(`New captures to upload: ${uniq.length}`);
	const tok = token();
	let i = 0;
	let ok = 0;
	let fail = 0;
	const t0 = Date.now();

	async function worker() {
		while (i < uniq.length) {
			const idx = i++;
			const key = uniq[idx];
			try {
				await put(tok, key, fs.readFileSync(path.join(DEST, key)));
				ok++;
			} catch (e) {
				fail++;
				console.error(`[FAIL] ${key}: ${e.message}`);
			}
			if ((ok + fail) % 25 === 0 || ok + fail === uniq.length) {
				const rate = (ok / ((Date.now() - t0) / 1000) || 0).toFixed(1);
				console.log(`[progress] ${ok + fail}/${uniq.length} ok=${ok} fail=${fail} ~${rate}/s`);
			}
		}
	}

	await Promise.all(Array.from({ length: CONC }, () => worker()));
	console.log(`Done — ok=${ok} fail=${fail}`);

	// quick CDN spot-check 0pf
	const sample = uniq.filter((k) => k.startsWith('0pf')).slice(0, 12);
	for (const key of sample) {
		const r = await fetch(`https://emote.f7studio.store/${key}`, { method: 'GET' });
		console.log(`CDN ${r.status} ${key}`);
	}
	if (fail) process.exitCode = 2;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
