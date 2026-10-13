// Production read-only smoke test. Never logs imported learner data.
const ORIGIN = 'https://weather-mister.github.io';
const URL = 'https://hanzi-steps-api.weatherisgood06.workers.dev/widget?username=eren';

const response = await fetch(URL, {
  method: 'GET',
  headers: { Origin: ORIGIN },
  cache: 'no-store',
  redirect: 'error',
  signal: AbortSignal.timeout(15000)
});
if (response.status !== 200) throw new Error(`Hanzi Cloudflare widget returned HTTP ${response.status}`);
if (response.headers.get('access-control-allow-origin') !== ORIGIN) {
  throw new Error('Hanzi Cloudflare widget is not CORS-accessible from GitHub Pages');
}
const data = await response.json();
if (!data || data.version !== 2 || data.username !== 'eren' ||
    !Number.isFinite(data.streak) || !Number.isFinite(data.todayProgress) ||
    !Number.isFinite(data.todayGoal) || !Array.isArray(data.nextCharacters) ||
    typeof data.unitColor !== 'string') {
  throw new Error('Hanzi Cloudflare widget payload is incomplete or incompatible');
}
console.log('Cloudflare Hanzi widget v2 read and GitHub Pages CORS: PASS');
