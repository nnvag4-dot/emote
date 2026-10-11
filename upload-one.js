const fs = require('fs');
const path = require('path');
const os = require('os');

const key = process.argv[2] || 'cartauntk.webp';
const ACCOUNT = '465a71c126c1683de83ae568a89b1a57';
const BUCKET = 'emote';
const filePath = path.join(__dirname, key);

const toml = fs.readFileSync(
	path.join(os.homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),
	'utf8',
);
const token = (toml.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
if (!token) {
	console.error('no oauth token');
	process.exit(1);
}
if (!fs.existsSync(filePath)) {
	console.error('missing file', filePath);
	process.exit(1);
}

const body = fs.readFileSync(filePath);
const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;

(async () => {
	const res = await fetch(url, {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'image/webp',
		},
		body,
	});
	const text = await res.text();
	if (!res.ok) {
		console.error('upload fail', res.status, text.slice(0, 300));
		process.exit(1);
	}
	console.log('uploaded', key, body.length);

	const statePath = path.join(__dirname, '.upload-r2-state.json');
	let j = { done: [] };
	try {
		j = JSON.parse(fs.readFileSync(statePath, 'utf8'));
	} catch {}
	if (!j.done.includes(key)) j.done.push(key);
	fs.writeFileSync(statePath, JSON.stringify(j));
	console.log('state done', j.done.length);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
