// vpnd.io reseller dashboard integration. No clean API — we drive the Laravel
// dashboard like a browser: login (session cookie) → read CSRF `_token` from the
// dashboard HTML → POST get_config_vless to mint a VLESS Reality key per purchase.
// Session + token are cached and re-established on expiry.
import config from '../config.js';
import axios from 'axios';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

let session = { cookie: '', token: '', dashboardHtml: '', at: 0 };
const SESSION_TTL = 10 * 60 * 1000; // re-auth every 10 min

const BASE = () => (config.vpn.baseUrl || 'https://en.vpnd.io').replace(/\/$/, '');

// Egress proxy (clean/residential IP) so vpnd.io's Cloudflare doesn't 403 our
// datacenter IP. VPND_PROXY_URL = http(s)://[user:pass@]host:port  or  socks5://host:port
function proxyConf() {
  const u = process.env.VPND_PROXY_URL;
  if (!u) return { proxy: false };
  try {
    const url = new URL(u);
    if (url.protocol.startsWith('socks')) return { socks: u };
    return { proxy: { protocol: url.protocol.replace(':', ''), host: url.hostname, port: Number(url.port) || 80,
      ...(url.username ? { auth: { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } } : {}) } };
  } catch { return { proxy: false }; }
}
let _socks;
async function socksAgent(u) {
  if (!_socks) { const { SocksProxyAgent } = await import('socks-proxy-agent'); _socks = new SocksProxyAgent(u); }
  return _socks;
}

// One HTTP call via axios (optional proxy). Returns the axios response (data = text).
async function http(method, path, { headers = {}, form = null, manualRedirect = false } = {}) {
  const pc = proxyConf();
  const opts = {
    method, url: `${BASE()}${path}`,
    headers: { 'User-Agent': UA, ...headers },
    data: form ? new URLSearchParams(form).toString() : undefined,
    maxRedirects: manualRedirect ? 0 : 5,
    validateStatus: () => true,
    timeout: 25000,
    responseType: 'text',
    transformResponse: (x) => x,
  };
  if (pc.socks) { const ag = await socksAgent(pc.socks); opts.httpsAgent = ag; opts.httpAgent = ag; opts.proxy = false; }
  else opts.proxy = pc.proxy;
  return axios(opts);
}

function mergeCookies(prev, setCookieList) {
  const jar = new Map();
  for (const c of (prev ? prev.split('; ') : [])) {
    const [k, ...v] = c.split('='); if (k) jar.set(k, v.join('='));
  }
  for (const sc of (setCookieList || [])) {
    const first = sc.split(';')[0];
    const [k, ...v] = first.split('='); if (k) jar.set(k.trim(), v.join('='));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function setCookiesOf(res) {
  const sc = res.headers?.['set-cookie'];
  return Array.isArray(sc) ? sc : (sc ? [sc] : []);
}

async function login() {
  const res = await http('POST', '/dashboard/login', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    form: { username: config.vpn.username, password: config.vpn.password, remember: 'remember-me' },
    manualRedirect: true,
  });
  return mergeCookies('', setCookiesOf(res));
}

async function fetchDashboard(cookie) {
  const res = await http('GET', '/dashboard', { headers: { Cookie: cookie, Accept: 'text/html' } });
  return { cookie: mergeCookies(cookie, setCookiesOf(res)), html: String(res.data || '') };
}

function parseToken(html) {
  const m = html.match(/_token\s*=\s*'([a-f0-9]{16,})'/i);
  return m ? m[1] : '';
}

// Ensure a live session (cookie + CSRF token + dashboard HTML), re-auth on TTL.
async function ensureSession(force = false) {
  const fresh = Date.now() - session.at < SESSION_TTL && session.token && session.cookie;
  if (fresh && !force) return session;
  const loginCookie = await login();
  const { cookie, html } = await fetchDashboard(loginCookie);
  const token = parseToken(html);
  if (!token) throw new Error('vpnd: CSRF token not found after login');
  session = { cookie, token, dashboardHtml: html, at: Date.now() };
  return session;
}

// Country → ISO2 for flag rendering on the client (best-effort; '' if unknown).
const ISO2 = {
  'UAE': 'ae', 'Bahrain': 'bh', 'Israel': 'il', 'Kyrgyzstan': 'kg', 'Kazakhstan': 'kz',
  'Pakistan': 'pk', 'Saudi Arabia': 'sa', 'Turkey': 'tr', 'Uzbekistan': 'uz', 'Egypt': 'eg',
  'Kenya': 'ke', 'Morocco': 'ma', 'Nigeria': 'ng', 'South Africa': 'za', 'China': 'cn',
  'Indonesia': 'id', 'India': 'in', 'Japan': 'jp', 'South Korea': 'kr', 'Malaysia': 'my',
  'Philippines': 'ph', 'Singapore': 'sg', 'Thailand': 'th', 'Taiwan': 'tw', 'Vietnam': 'vn',
  'Albania': 'al', 'Armenia': 'am', 'Azerbaijan': 'az', 'Bosnia and Herzegovina': 'ba',
  'Bulgaria': 'bg', 'Belarus': 'by', 'Georgia': 'ge', 'Croatia': 'hr', 'Hungary': 'hu',
  'Moldova': 'md', 'North Macedonia': 'mk', 'Poland': 'pl', 'Romania': 'ro', 'Serbia': 'rs',
  'Russia': 'ru', 'Slovenia': 'si', 'Slovakia': 'sk', 'Kosovo': 'xk', 'Austria': 'at',
  'Germany': 'de', 'Netherlands': 'nl', 'France': 'fr', 'Finland': 'fi', 'Sweden': 'se',
  'United Kingdom': 'gb', 'USA': 'us', 'United States': 'us', 'Canada': 'ca', 'Spain': 'es',
  'Italy': 'it', 'Switzerland': 'ch', 'Norway': 'no', 'Denmark': 'dk', 'Ireland': 'ie',
  'Czechia': 'cz', 'Czech Republic': 'cz', 'Portugal': 'pt', 'Greece': 'gr', 'Estonia': 'ee',
  'Latvia': 'lv', 'Lithuania': 'lt', 'Ukraine': 'ua', 'Australia': 'au', 'Brazil': 'br',
  // Russian country names (vpnd.io serves the RU locale — en.vpnd.io is Cloudflare-blocked from datacenters).
  'Австралия': 'au', 'Австрия': 'at', 'Азербайджан': 'az', 'Албания': 'al', 'Аргентина': 'ar',
  'Армения': 'am', 'Бахрейн': 'bh', 'Беларусь': 'by', 'Бельгия': 'be', 'Болгария': 'bg',
  'Боливия': 'bo', 'Босния и Герцеговина': 'ba', 'Бразилия': 'br', 'Великобритания': 'gb',
  'Венгрия': 'hu', 'Вьетнам': 'vn', 'Гватемала': 'gt', 'Германия': 'de', 'Греция': 'gr',
  'Грузия': 'ge', 'Дания': 'dk', 'Египет': 'eg', 'Израиль': 'il', 'Индия': 'in', 'Индонезия': 'id',
  'Ирландия': 'ie', 'Исландия': 'is', 'Испания': 'es', 'Италия': 'it', 'Казахстан': 'kz',
  'Канада': 'ca', 'Кения': 'ke', 'Кипр': 'cy', 'Киргизия': 'kg', 'Китай': 'cn', 'Колумбия': 'co',
  'Косово': 'xk', 'Коста-Рика': 'cr', 'Латвия': 'lv', 'Литва': 'lt', 'Лихтенштейн': 'li',
  'Люксембург': 'lu', 'Малайзия': 'my', 'Мальта': 'mt', 'Марокко': 'ma', 'Мексика': 'mx',
  'Молдова': 'md', 'Нигерия': 'ng', 'Нидерланды': 'nl', 'Новая Зеландия': 'nz', 'Норвегия': 'no',
  'ОАЭ': 'ae', 'Пакистан': 'pk', 'Перу': 'pe', 'Польша': 'pl', 'Португалия': 'pt',
  'Пуэрто-Рико': 'pr', 'Россия': 'ru', 'Румыния': 'ro', 'США - Восток': 'us', 'США - Запад': 'us',
  'Саудовская Аравия': 'sa', 'Северная Македония': 'mk', 'Сербия': 'rs', 'Сингапур': 'sg',
  'Словакия': 'sk', 'Словения': 'si', 'Таиланд': 'th', 'Тайвань': 'tw', 'Турция': 'tr',
  'Узбекистан': 'uz', 'Филиппины': 'ph', 'Финляндия': 'fi', 'Франция': 'fr', 'Хорватия': 'hr',
  'Чехия': 'cz', 'Чили': 'cl', 'Швейцария': 'ch', 'Швеция': 'se', 'Эквадор': 'ec',
  'Эстония': 'ee', 'Южная Африка': 'za', 'Южная Корея': 'kr', 'Япония': 'jp',
};

let locCache = { at: 0, list: [] };

// Parse the location <option>s from the dashboard HTML (self-updating catalog).
function parseLocations(html) {
  const out = [];
  const re = /<option[^>]*value="?(\d+)"?[^>]*>([^<]+)<\/option>/gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) !== null) {
    const id = parseInt(m[1], 10);
    const label = m[2].trim();
    if (!id || seen.has(id) || !label.includes(',') && !/[A-Za-z]/.test(label)) continue;
    seen.add(id);
    const [country, ...rest] = label.split(',');
    const city = rest.join(',').trim();
    const c = country.trim();
    out.push({ id, country: c, city, iso2: ISO2[c] || '', ru: c === 'Russia' || c === 'Россия' });
  }
  return out;
}

export async function listLocations() {
  if (Date.now() - locCache.at < SESSION_TTL && locCache.list.length) return locCache.list;
  const s = await ensureSession();
  const list = parseLocations(s.dashboardHtml);
  if (list.length) locCache = { at: Date.now(), list };
  return locCache.list;
}

// Mint a VLESS Reality key for a location. Returns { config, qr } (qr is base64 PNG
// when withQr). Retries once on session/token expiry. Respects the ~3s rate limit.
export async function createVlessKey(locationId, { withQr = false, retry = true } = {}) {
  const s = await ensureSession();
  const form = { _token: s.token, location: String(locationId) };
  if (withQr) form.qr = '1';
  const res = await http('POST', '/dashboard/get_config_vless', {
    headers: {
      Cookie: s.cookie,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
    },
    form,
  });
  let data = null;
  try { data = JSON.parse(res.data); } catch { data = null; }
  // Session expired → dashboard returns HTML/redirect, not JSON. Re-auth once.
  if (!data && retry) { await ensureSession(true); return createVlessKey(locationId, { withQr, retry: false }); }
  if (data?.alert) { const e = new Error(data.alert); e.code = 'VPND_RATELIMIT'; throw e; }
  if (data?.status === 'success') return { config: data.config || null, qr: data.qr || null };
  const e = new Error('vpnd: failed to create VLESS key'); e.detail = data; throw e;
}

// Curated "Config for RF" servers — Shadowsocks keys on `-tun` hosts with a
// TLS-mimicking prefix that bypass Russian DPI. These are what we serve to users
// in Russia (the panel shows them only for non-RF servers + RF users). Parsed
// from the dashboard HTML; the ss:// key IS the config (shared per server).
function parseRfServers(html) {
  const out = [];
  const seen = new Set();
  // key part has no spaces; the #label may contain spaces — capture both up to the
  // closing HTML quote so the ss key stays intact and we get a readable name.
  const re = /ss:\/\/(\S+?)#([^"<\n]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const key = m[1];
    const h = key.match(/@([a-z0-9-]+)-tun\.vpnd\.io/i);
    if (!h) continue; // only -tun (RF DPI-bypass) keys
    const host = h[1].toLowerCase();
    if (seen.has(host)) continue;
    seen.add(host);
    let label = m[2].trim();
    try { label = decodeURIComponent(label); } catch { /* keep */ }
    const ss = `ss://${key}#${encodeURIComponent(label)}`;
    out.push({ host, name: label, ss });
  }
  return out;
}

export async function listRfServers() {
  const s = await ensureSession();
  return parseRfServers(s.dashboardHtml);
}

// Fetch an OpenVPN config for a location. proto: 'tcp' | 'udp' | 'udp_ru'.
export async function getOvpnConfig(proto, locationId) {
  const p = ['tcp', 'udp', 'udp_ru'].includes(proto) ? proto : 'udp';
  const s = await ensureSession();
  const res = await http('GET', `/dashboard/get_config_ovpn/${p}/${locationId}`, {
    headers: { Cookie: s.cookie, Accept: '*/*' },
  });
  const text = String(res.data || '');
  if (!text.includes('remote ') && !text.includes('client')) return null; // not a real .ovpn
  return text;
}
