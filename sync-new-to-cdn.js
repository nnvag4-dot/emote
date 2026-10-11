/**
 * Convert new/updated gif|png from capture html/images → webp,
 * upload to R2 bucket emote as {basename}.webp (bablo CDN name).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const SRC = String.raw`D:\Drama_City\txData\Qbox_Drama_ City\resources\[qbx]\[chupanhemote]\0r-emote-capture\html\images`;
const DEST = __dirname;
const ACCOUNT = '465a71c126c1683de83ae568a89b1a57';
const BUCKET = 'emote';
const CONV_CONC = 6;
const UP_CONC = 20;

function token() {
	const toml = fs.readFileSync(
		path.join(os.homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),
		'utf8',
	);
	const m = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
	if (!m) throw new Error('no oauth — npx wrangler login');
	return m[1];
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function listNeedConvert() {
	const out = [];
	for (const name of fs.readdirSync(SRC)) {
		const ext = path.extname(name).toLowerCase();
		if (!['.gif', '.png', '.jpg', '.jpeg'].includes(ext)) continue;
		const base = path.basename(name, ext);
		const srcPath = path.join(SRC, name);
		const destPath = path.join(DEST, `${base}.webp`);
		const srcStat = fs.statSync(srcPath);
		if (!fs.existsSync(destPath) || srcStat.mtimeMs > fs.statSync(destPath).mtimeMs + 1000) {
			out.push({ srcPath, destPath, key: `${base}.webp`, base });
		}
	}
	return out;
}

async function convertOne(job) {
	const animated = path.extname(job.srcPath).toLowerCase() === '.gif';
	await sharp(job.srcPath, animated ? { animated: true, limitInputPixels: false } : { limitInputPixels: false })
		.webp({ quality: 80, effort: 4, ...(animated ? { loop: 0 } : {}) })
		.toFile(job.destPath);
}

async function put(tok, key, body) {
	const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
	for (let a = 0; a < 8; a++) {
		const res = await fetch(url, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'image/webp' },
			body,
		});
		if (res.ok) return;
		if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${key}`);
		await sleep(Math.min(12000, 400 * 2 ** a));
	}
	throw new Error(`retry fail ${key}`);
}

async function pool(items, conc, fn) {
	let i = 0;
	let ok = 0;
	let fail = 0;
	const workers = Array.from({ length: Math.min(conc, items.length || 1) }, async () => {
		while (i < items.length) {
			const idx = i++;
			try {
				await fn(items[idx]);
				ok++;
			} catch (e) {
				fail++;
				console.error(`[FAIL] ${items[idx].key || items[idx].base}: ${e.message}`);
			}
			if ((ok + fail) % 50 === 0 || ok + fail === items.length) {
				console.log(`[progress] ${ok + fail}/${items.length} ok=${ok} fail=${fail}`);
			}
		}
	});
	await Promise.all(workers);
	return { ok, fail };
}

async function main() {
	const jobs = listNeedConvert();
	console.log(`Need convert+upload: ${jobs.length}`);
	if (!jobs.length) {
		console.log('Nothing new.');
		return;
	}

	console.log('--- convert ---');
	const c = await pool(jobs, CONV_CONC, convertOne);
	console.log(`Convert done ok=${c.ok} fail=${c.fail}`);

	const tok = token();
	const uploadJobs = jobs.filter((j) => fs.existsSync(j.destPath));
	console.log('--- upload ---');
	const u = await pool(uploadJobs, UP_CONC, async (j) => {
		await put(tok, j.key, fs.readFileSync(j.destPath));
	});
	console.log(`Upload done ok=${u.ok} fail=${u.fail}`);
	if (u.fail) process.exitCode = 2;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
