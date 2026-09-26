import { mkdir, writeFile } from 'node:fs/promises';

const PROFILE_URL = 'https://steamcommunity.com/id/Ch1mpleo/';
const ART_URL = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3065800/library_hero.jpg';
const OUTPUT = new URL('../assets/steam-card.svg', import.meta.url);

function requiredMatch(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Steam profile is missing ${label}; keeping the previous card`);
  return match[1];
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

function parseProfile(html) {
  const name = decodeHtml(requiredMatch(html, /<span class="actual_persona_name">([^<]+)<\/span>/, 'persona name'));
  const avatarUrl = requiredMatch(html, /playerAvatarAutoSizeInner[\s\S]*?(https:\/\/avatars\.[^"\s]+_full\.jpg)/, 'avatar URL');
  const playtime = decodeHtml(requiredMatch(html, /recentgame_recentplaytime"[\s\S]*?<div>([^<]+)<\/div>/, 'recent playtime')).trim();
  const recentStart = html.indexOf('<div class="recent_games">');
  if (recentStart < 0) throw new Error('Steam profile is missing recent games section; keeping the previous card');
  const recentSection = html.slice(recentStart, html.indexOf('commentthread_Profile_', recentStart));
  const games = [...recentSection.matchAll(/<div class="recent_game">([\s\S]*?)(?=<div class="recent_game">|$)/g)]
    .slice(0, 2)
    .map(([, block]) => ({
      name: decodeHtml(requiredMatch(block, /<div class="game_name"><a[^>]*>([^<]+)<\/a>/, 'recent game name')),
      appId: requiredMatch(block, /<div class="game_info_cap[^>]*><a href="https:\/\/steamcommunity\.com\/app\/(\d+)"/, 'recent game app ID'),
      capsuleUrl: requiredMatch(block, /<img class="game_capsule" src="([^"]+)"/, 'recent game image').replace(/&amp;/g, '&'),
    }));
  if (games.length === 0 && !/^0(?:\.0)? hours?\b/i.test(playtime)) {
    throw new Error('Steam lists recent playtime but no recent games; keeping the previous card');
  }
  return { name, avatarUrl, playtime, games };
}

async function download(url, expectedType) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GitHub profile card updater)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const type = response.headers.get('content-type')?.split(';')[0].toLowerCase();
  if (type !== expectedType) throw new Error(`${url} returned ${type || 'no content type'}`);
  return Buffer.from(await response.arrayBuffer());
}

async function embed(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const mime = response.headers.get('content-type')?.split(';')[0].toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    throw new Error(`${url} returned unsupported image type ${mime}`);
  }
  return `data:${mime};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
}

function render({ name, playtime, games }, { avatar, art, capsules }) {
  const rows = games.length ? games.map((game, index) => {
    const y = 123 + index * 46;
    return `
    <image href="${capsules[index]}" x="18" y="${y - 19}" width="92" height="35" preserveAspectRatio="xMidYMid slice" clip-path="url(#capsule)"/>
    <text x="120" y="${y - 1}" class="game">${escapeXml(game.name)}</text>
    <text x="120" y="${y + 16}" class="label">RECENTLY PLAYED</text>`;
  }).join('') : '<text x="18" y="128" class="game">No games played in the past two weeks</text>';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="205" viewBox="0 0 520 205" role="img" aria-label="${escapeXml(`${name}'s Steam card: ${playtime}; ${games.map((game) => game.name).join(', ')}`)}">
  <defs>
    <clipPath id="card"><rect width="520" height="205" rx="12"/></clipPath>
    <clipPath id="avatar"><rect x="18" y="18" width="64" height="64" rx="7"/></clipPath>
    <clipPath id="capsule"><rect x="18" y="104" width="92" height="81" rx="5"/></clipPath>
    <linearGradient id="shade" x1="0" x2="1" y1="0" y2="0"><stop stop-color="#080c14" stop-opacity=".95"/><stop offset=".72" stop-color="#080c14" stop-opacity=".77"/><stop offset="1" stop-color="#080c14" stop-opacity=".45"/></linearGradient>
  </defs>
  <style>
    text { font-family: Arial, Helvetica, sans-serif; fill: #fff; }
    .name { font-size: 20px; font-weight: 700; }
    .game { font-size: 15px; font-weight: 700; }
    .label { font-size: 10px; letter-spacing: 1.2px; fill: #cad5de; }
    .time { font-size: 13px; fill: #e7f6f1; }
  </style>
  <g clip-path="url(#card)">
    <rect width="520" height="205" fill="#151e26"/>
    <image href="${art}" width="520" height="205" preserveAspectRatio="xMidYMid slice"/>
    <rect width="520" height="205" fill="url(#shade)"/>
    <image href="${avatar}" x="18" y="18" width="64" height="64" clip-path="url(#avatar)"/>
    <text x="96" y="44" class="name">${escapeXml(name)}</text>
    <text x="96" y="64" class="time">${escapeXml(playtime)}</text>
    <path d="M18 94H502" stroke="#b5f5dd" stroke-opacity=".45"/>
${rows}
  </g>
</svg>\n`;
}

async function main() {
  const html = (await download(PROFILE_URL, 'text/html')).toString('utf8');
  const profile = parseProfile(html);
  const [avatar, art, ...capsules] = await Promise.all([
    embed(profile.avatarUrl), embed(ART_URL), ...profile.games.map((game) => embed(game.capsuleUrl)),
  ]);
  await mkdir(new URL('../assets/', import.meta.url), { recursive: true });
  await writeFile(OUTPUT, render(profile, { avatar, art, capsules }));
  console.log(`Updated Steam card: ${profile.games.map((game) => game.name).join(', ') || 'no recent games'}`);
}

await main();
