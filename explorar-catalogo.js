/** EXPLORADOR v3: encontrar el parámetro correcto de BÚSQUEDA por texto en POST products/index. */
const EMAIL = process.env.DROPI_EMAIL, PASSWORD = process.env.DROPI_PASSWORD;
function apiHeaders(token) {
  return { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'Content-Type': 'application/json',
    'Origin': 'https://app.dropi.co', 'Referer': 'https://app.dropi.co/', 'Accept-Language': 'es-419',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="127"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Dest': 'empty' };
}
async function login() {
  const res = await fetch('https://api-v2.dropi.co/bff/auth/core/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, white_brand_id: 1, brand: '', ipAddress: '', otp: null, with_cdc: false }) });
  return (await res.json()).data.token;
}
async function search(t, body) {
  const r = await fetch('https://api.dropi.co/api/products/index', { method: 'POST', headers: apiHeaders(t), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return j;
}
(async () => {
  const t = await login(); console.log('Login OK.\n');
  const term = 'faja';
  const base = { pageSize: 5, startData: 0 };
  const intentos = [
    { ...base, keywords: term },
    { ...base, search: term },
    { ...base, name: term },
    { ...base, filterText: term },
    { ...base, textSearch: term },
    { ...base, text: term },
    { ...base, q: term },
    { ...base, filter: { keywords: term } },
    { ...base, keywords: term, orderBy: 'id', orderDirection: 'desc' },
    { ...base, textToSearch: term, keywords: term },
  ];
  for (const body of intentos) {
    const j = await search(t, body);
    const objs = j.objects || [];
    const nombres = objs.slice(0, 3).map(o => String(o.name).slice(0, 32));
    const coincide = nombres.filter(n => /faja/i.test(n)).length;
    const paramUsado = Object.keys(body).filter(k => !['pageSize', 'startData', 'orderBy', 'orderDirection'].includes(k)).join('+');
    console.log(`param[${paramUsado}] → count=${j.count} | traídos=${objs.length} | coinciden "faja":${coincide}/${nombres.length}`);
    console.log('   ej:', nombres.join(' || '));
  }
  console.log('\n=== FIN ===');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
