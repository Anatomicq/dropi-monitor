/** EXPLORADOR (solo lectura): descubre cómo buscar productos en el catálogo de Dropi.
 *  Usa la cuenta del monitor (DROPI_EMAIL / DROPI_PASSWORD). Prueba varios endpoints y muestra qué responde. */
const EMAIL = process.env.DROPI_EMAIL, PASSWORD = process.env.DROPI_PASSWORD;
function apiHeaders(token) {
  return { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'Content-Type': 'application/json',
    'Origin': 'https://app.dropi.co', 'Referer': 'https://app.dropi.co/', 'Accept-Language': 'es-419',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Dest': 'empty' };
}
async function login() {
  const res = await fetch('https://api-v2.dropi.co/bff/auth/core/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, white_brand_id: 1, brand: '', ipAddress: '', otp: null, with_cdc: false }) });
  const j = await res.json().catch(() => ({}));
  const token = j && j.data && j.data.token;
  if (!token) throw new Error('Login falló: ' + JSON.stringify(j).slice(0, 200));
  return token;
}
async function probe(method, url, token, body) {
  try {
    const opt = { method, headers: apiHeaders(token) };
    if (body) opt.body = JSON.stringify(body);
    const r = await fetch(url, opt);
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    let resumen = txt.slice(0, 160);
    if (j) {
      const arr = j.objects || j.data || j.products || (Array.isArray(j) ? j : null);
      const n = Array.isArray(arr) ? arr.length : (arr && arr.data && Array.isArray(arr.data) ? arr.data.length : '?');
      const sample = Array.isArray(arr) && arr[0] ? Object.keys(arr[0]).slice(0, 12).join(',') : '';
      resumen = `isSuccess=${j.isSuccess} count=${j.count} items=${n} keys0=[${sample}]`;
    }
    console.log(`\n[${r.status}] ${method} ${url}${body ? ' body=' + JSON.stringify(body) : ''}\n   → ${resumen}`);
    return { status: r.status, j };
  } catch (e) { console.log(`\n[ERR] ${method} ${url} → ${e.message}`); return {}; }
}
(async () => {
  console.log('Login...'); const t = await login(); console.log('Login OK.\n=== Probando endpoints de búsqueda de catálogo ===');
  const q = 'serum';
  await probe('GET', `https://api.dropi.co/api/products/productlist/v1/?textToSearch=${q}&pageSize=5&startData=0`, t);
  await probe('GET', `https://api.dropi.co/api/products/productlist/v1?textToSearch=${q}&pageSize=5`, t);
  await probe('GET', `https://api.dropi.co/api/products/productlist/v1/index?textToSearch=${q}&pageSize=5`, t);
  await probe('POST', `https://api.dropi.co/api/products/index`, t, { pageSize: 5, startData: 0, textToSearch: q });
  await probe('POST', `https://api.dropi.co/api/products/productlist/v1/index`, t, { pageSize: 5, startData: 0, textToSearch: q });
  await probe('GET', `https://api.dropi.co/api/products/productlist/v1/?keywords=${q}&pageSize=5`, t);
  await probe('POST', `https://api.dropi.co/api/products/productlist/v1`, t, { pageSize: 5, startData: 0, textToSearch: q, orderBy: 'id', orderDirection: 'desc' });
  await probe('GET', `https://api.dropi.co/api/products?search=${q}&pageSize=5`, t);
  console.log('\n=== FIN ===');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
