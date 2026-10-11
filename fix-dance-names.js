/**
 * Bablo CDN expects {emoteName}.webp
 * Capture saved dances as dance-{suffix}.webp
 * Upload aliases: dance-silly10.webp → dancesilly10.webp
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ACCOUNT = '465a71c126c1683de83ae568a89b1a57';
const BUCKET = 'emote';
const EMOTE_DIR = __dirname;
const ANIM_JSON = String.raw`D:\Drama_City\txData\Qbox_Drama_ City\resources\[qbx]\bablo-animations\animations.json`;
const CONCURRENCY = 20;
const STATE = path.join(__dirname, '.fix-dance-names-state.json');

function token() {
	const toml = fs.readFileSync(
		path.join(os.homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),
		'utf8',
	);
	const m = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
	if (!m) throw new Error('no oauth token');
	return m[1];
}

function captureRel(imageId, category) {
	const id = String(imageId || '');
	if ((category === 'dances' || category === 'dance') && id.startsWith('dance')) {
		return `dance-${id.slice(5)}.webp`;
	}
	return `${id}.webp`;
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
	for (let attempt = 0; attempt < 8; attempt++) {
		const res = await fetch(url, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'image/webp' },
			body,
		});
		if (res.ok) return;
		if (res.status !== 429 && res.status < 500) {
			throw new Error(`${res.status} ${key}`);
		}
		await sleep(Math.min(15000, 400 * 2 ** attempt));
	}
	throw new Error(`retry exhausted ${key}`);
}

async function main() {
	const list = JSON.parse(fs.readFileSync(ANIM_JSON, 'utf8'));
	const jobs = [];
	for (const item of list) {
		if (item.category !== 'dances' && item.category !== 'dance') continue;
		const name = item.name || item.imageId;
		if (!name) continue;
		const srcName = captureRel(item.imageId || item.name, item.category);
		const srcPath = path.join(EMOTE_DIR, srcName);
		const destKey = `${name}.webp`;
		if (srcName === destKey) continue; // already correct (e.g. dj.webp)
		if (!fs.existsSync(srcPath)) continue;
		jobs.push({ srcPath, destKey, srcName });
	}

	const done = loadDone();
	const pending = jobs.filter((j) => !done.has(j.destKey));
	console.log(`dance aliases: total=${jobs.length} pending=${pending.length} already=${done.size}`);
	if (!pending.length) {
		console.log('Nothing to upload.');
		return;
	}

	const tok = token();
	let ok = 0;
	let fail = 0;
	let i = 0;
	const t0 = Date.now();

	async function worker() {
		while (i < pending.length) {
			const idx = i++;
			const job = pending[idx];
			try {
				const body = fs.readFileSync(job.srcPath);
				await put(tok, job.destKey, body);
				// also keep local alias for convenience
				const localAlias = path.join(EMOTE_DIR, job.destKey);
				if (!fs.existsSync(localAlias)) fs.copyFileSync(job.srcPath, localAlias);
				done.add(job.destKey);
				ok++;
			} catch (e) {
				fail++;
				console.error(`[FAIL] ${job.destKey}: ${e.message}`);
			}
			if ((ok + fail) % 100 === 0 || ok + fail === pending.length) {
				saveDone(done);
				const rate = (ok / ((Date.now() - t0) / 1000)).toFixed(1);
				console.log(`[progress] ${ok + fail}/${pending.length} ok=${ok} fail=${fail} ~${rate}/s`);
			}
		}
	}

	await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
	saveDone(done);
	console.log(`Done — ok=${ok} fail=${fail}`);
	if (fail) process.exitCode = 2;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
