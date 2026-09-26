import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const PROFILE_URL = 'https://steamcommunity.com/id/Ch1mpleo/';
const PROFILE_XML_URL = 'https://steamcommunity.com/id/Ch1mpleo/?xml=1';
const ART_URL = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3065800/library_hero.jpg';
const OUTPUT = new URL('../assets/steam-card.svg', import.meta.url);
const README = new URL('../README.md', import.meta.url);

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

function xmlValue(xml, tag) {
  const value = requiredMatch(xml, new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`), tag);
  return decodeHtml(value.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''));
}

function parseProfile(html, xml) {
  const name = xmlValue(xml, 'steamID');
  const avatarUrl = xmlValue(xml, 'avatarFull');
  const playtime = decodeHtml(requiredMatch(html, /recentgame_recentplaytime"[\s\S]*?<div>([^<]+)<\/div>/, 'recent playtime')).trim();
  const games = [...xml.matchAll(/<mostPlayedGame>([\s\S]*?)<\/mostPlayedGame>/g)]
    .slice(0, 4)
    .map(([, block]) => ({
      name: xmlValue(block, 'gameName'),
      capsuleUrl: xmlValue(block, 'gameLogo'),
      recentHours: xmlValue(block, 'hoursPlayed'),
      totalHours: xmlValue(block, 'hoursOnRecord'),
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
    const y = 102 + index * 38;
    return `
    <image href="${capsules[index]}" x="15" y="${y - 17}" width="82" height="31" preserveAspectRatio="xMidYMid slice"/>
    <text x="106" y="${y}" class="game">${escapeXml(game.name)}</text>
    <text x="106" y="${y + 14}" class="label">${escapeXml(`${game.recentHours}h last 2 weeks · ${game.totalHours}h total`)}</text>`;
  }).join('') : '<text x="15" y="110" class="game">No games played in the past two weeks</text>';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="250" viewBox="0 0 420 250" role="img" aria-label="${escapeXml(`${name}'s Steam card: ${playtime}; ${games.map((game) => `${game.name}, ${game.recentHours} hours in the past two weeks`).join('; ')}`)}">
  <defs>
    <clipPath id="card"><rect width="420" height="250" rx="10"/></clipPath>
    <clipPath id="avatar"><rect x="15" y="13" width="50" height="50" rx="6"/></clipPath>
    <linearGradient id="shade" x1="0" x2="1" y1="0" y2="0"><stop stop-color="#080c14" stop-opacity=".95"/><stop offset=".72" stop-color="#080c14" stop-opacity=".77"/><stop offset="1" stop-color="#080c14" stop-opacity=".45"/></linearGradient>
  </defs>
  <style>
    text { font-family: Arial, Helvetica, sans-serif; fill: #fff; }
    .name { font-size: 19px; font-weight: 700; }
    .game { font-size: 14px; font-weight: 700; }
    .label { font-size: 11px; fill: #cad5de; }
    .time { font-size: 12px; fill: #e7f6f1; }
  </style>
  <g clip-path="url(#card)">
    <rect width="420" height="250" fill="#151e26"/>
    <image href="${art}" width="420" height="250" preserveAspectRatio="xMidYMid slice"/>
    <rect width="420" height="250" fill="url(#shade)"/>
    <image href="${avatar}" x="15" y="13" width="50" height="50" clip-path="url(#avatar)"/>
    <text x="77" y="34" class="name">${escapeXml(name)}</text>
    <text x="77" y="52" class="time">${escapeXml(playtime)}</text>
    <path d="M15 73H405" stroke="#b5f5dd" stroke-opacity=".45"/>
${rows}
  </g>
</svg>\n`;
}

async function main() {
  const [html, xml] = await Promise.all([
    download(PROFILE_URL, 'text/html'), download(PROFILE_XML_URL, 'text/xml'),
  ]);
  const profile = parseProfile(html.toString('utf8'), xml.toString('utf8'));
  const [avatar, art, ...capsules] = await Promise.all([
    embed(profile.avatarUrl), embed(ART_URL), ...profile.games.map((game) => embed(game.capsuleUrl)),
  ]);
  const svg = render(profile, { avatar, art, capsules });
  const version = createHash('sha256').update(svg).digest('hex').slice(0, 12);
  const readme = await readFile(README, 'utf8');
  if (!readme.includes('./assets/steam-card.svg')) {
    throw new Error('README is missing the Steam card image');
  }
  const updatedReadme = readme.replace(/\.\/assets\/steam-card\.svg(?:\?v=[\da-f]+)?/, `./assets/steam-card.svg?v=${version}`);
  await mkdir(new URL('../assets/', import.meta.url), { recursive: true });
  await writeFile(OUTPUT, svg);
  if (updatedReadme !== readme) await writeFile(README, updatedReadme);
  console.log(`Updated Steam card: ${profile.games.map((game) => game.name).join(', ') || 'no recent games'}`);
}

await main();
