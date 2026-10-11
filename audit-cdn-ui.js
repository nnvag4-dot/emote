/**
 * Check CDN has images for recently captured emotes (esp. 0pf* Fortnite)
 * and dance-silly* → dancesilly* style names used by bablo UI.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const SRC = String.raw`D:\Drama_City\txData\Qbox_Drama_ City\resources\[qbx]\[chupanhemote]\0r-emote-capture\html\images`;
const CDN = 'https://emote.f7studio.store';
const ANIM = String.raw`D:\Drama_City\txData\Qbox_Drama_ City\resources\[qbx]\bablo-animations\animations.json`;

function head(url) {
	return new Promise((resolve) => {
		const req = https.request(url, { method: 'GET' }, (res) => {
			res.resume();
			resolve(res.statusCode || 0);
		});
		req.on('error', () => resolve(0));
		req.setTimeout(12000, () => {
			req.destroy();
			resolve(0);
		});
		req.end();
	});
}

function captureBases() {
	const set = new Set();
	for (const name of fs.readdirSync(SRC)) {
		const ext = path.extname(name).toLowerCase();
		if (!['.gif', '.png', '.webp'].includes(ext)) continue;
		set.add(path.basename(name, ext).toLowerCase());
	}
	return set;
}

function uiNameForDance(imageId, category) {
	// bablo CDN: {emoteName}.webp
	return String(imageId || '').toLowerCase();
}

async function checkKeys(keys, label) {
	let ok = 0;
	let miss = [];
	let i = 0;
	const conc = 16;
	async function worker() {
		while (i < keys.length) {
			const idx = i++;
			const key = keys[idx];
			const code = await head(`${CDN}/${key}.webp`);
			if (code === 200) ok++;
			else miss.push(key);
		}
	}
	await Promise.all(Array.from({ length: conc }, () => worker()));
	console.log(`[${label}] ok=${ok}/${keys.length} missing=${miss.length}`);
	if (miss.length && miss.length <= 40) console.log(' missing:', miss.join(', '));
	else if (miss.length) console.log(' missing sample:', miss.slice(0, 25).join(', '), '...');
	return { ok, miss };
}

async function main() {
	const captured = captureBases();
	const pf = [...captured].filter((b) => b.startsWith('0pf')).sort();
	console.log(`Local 0pf* captures: ${pf.length}`);

	const r1 = await checkKeys(pf, 'Fortnite 0pf UI names');

	// From animations.json: dances that have local capture under dance-* or name
	let list = [];
	try {
		list = JSON.parse(fs.readFileSync(ANIM, 'utf8'));
	} catch {
		console.log('animations.json unreadable — skip full dance audit');
	}

	const danceUi = [];
	for (const item of list) {
		if (item.category !== 'dances' && item.category !== 'dance') continue;
		const name = String(item.name || item.imageId || '').toLowerCase();
		if (!name) continue;
		// only check if we captured something for it
		const id = String(item.imageId || item.name || '').toLowerCase();
		let captureBase = id;
		if (id.startsWith('dance') && id.length > 5) {
			captureBase = `dance-${id.slice(5)}`;
		}
		const hasLocal =
			captured.has(id) ||
			captured.has(captureBase) ||
			captured.has(name);
		if (!hasLocal) continue;
		danceUi.push(name);
	}
	console.log(`Captured dances to verify UI names: ${danceUi.length}`);
	const r2 = await checkKeys(danceUi, 'Dance UI names');

	const totalMiss = r1.miss.length + r2.miss.length;
	console.log(`TOTAL missing on CDN for captured items: ${totalMiss}`);
	if (totalMiss) process.exitCode = 2;
	else console.log('UI CDN OK — all captured actions checked have images.');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
