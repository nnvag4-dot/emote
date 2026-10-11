const fs=require('fs');const path=require('path');const os=require('os');
const ACCOUNT='465a71c126c1683de83ae568a89b1a57';const BUCKET='emote';
const toml=fs.readFileSync(path.join(os.homedir(),'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),'utf8');
const token=(toml.match(/oauth_token\s*=\s*"([^"]+)"/)||[])[1];
const keys=['dance-silly10.webp','dancesilly10.webp','dance-slow.webp','danceslow.webp','dj.webp','dance-upper.webp'];
(async()=>{
  for (const key of keys){
    const url=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
    const res=await fetch(url,{method:'HEAD',headers:{Authorization:`Bearer ${token}`}});
    console.log(key, res.status);
  }
})();
