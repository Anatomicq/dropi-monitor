/**
 * TEMPORAL — Diagnóstico: ¿dónde vienen el proveedor y el teléfono en la API de Dropi?
 * Hace login y, para 2 productos, imprime:
 *   - las claves de primer nivel de "objects"
 *   - cualquier campo (a cualquier profundidad) cuyo nombre sugiera proveedor / teléfono / contacto
 *   - el JSON completo (por si acaso)
 * Se borra cuando terminemos.
 */
const EMAIL    = process.env.DROPI_EMAIL;
const PASSWORD = process.env.DROPI_PASSWORD;
const IDS = (process.env.DEBUG_IDS || '2088423,879675').split(',').map(s => s.trim()).filter(Boolean);

function apiHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/json',
    'Origin': 'https://app.dropi.co',
    'Referer': 'https://app.dropi.co/',
    'Accept-Language': 'es-419',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Dest': 'empty',
  };
}

async function login() {
  const res = await fetch('https://api-v2.dropi.co/bff/auth/core/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, white_brand_id: 1, brand: '', ipAddress: '', otp: null, with_cdc: false }),
  });
  const j = await res.json().catch(() => ({}));
  const token = j && j.data && j.data.token;
  if (!token) throw new Error('Login falló (' + res.status + '): ' + JSON.stringify(j).slice(0, 200));
  return token;
}

// Busca recursivamente claves que "suenen" a proveedor/teléfono/contacto.
const PATRON = /(provider|proveedor|supplier|seller|vendor|user|owner|store|shop|contact|phone|celular|cel\b|mobile|movil|whats|tel)/i;
function buscar(obj, ruta, hits, visto) {
  if (obj == null || typeof obj !== 'object') return;
  if (visto.has(obj)) return; visto.add(obj);
  if (Array.isArray(obj)) {
    // solo el primer elemento para no explotar con variaciones
    if (obj.length) buscar(obj[0], ruta + '[0]', hits, visto);
    return;
  }
  for (const k of Object.keys(obj)) {
    const val = obj[k];
    const nueva = ruta ? ruta + '.' + k : k;
    if (PATRON.test(k) && (val == null || typeof val !== 'object')) {
      hits.push(`${nueva} = ${JSON.stringify(val)}`);
    }
    buscar(val, nueva, hits, visto);
  }
}

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error('Faltan DROPI_EMAIL / DROPI_PASSWORD.');
  const token = await login();
  console.log('Login OK.\n');
  for (const id of IDS) {
    console.log('='.repeat(70));
    console.log('PRODUCTO ID:', id);
    const res = await fetch(`https://api.dropi.co/api/products/productlist/v1/show/?id=${id}`, { headers: apiHeaders(token) });
    if (!res.ok) { console.log('  HTTP', res.status); continue; }
    const data = await res.json();
    const o = data.objects;
    if (!o) { console.log('  Sin objects. Respuesta:', JSON.stringify(data).slice(0, 300)); continue; }
    console.log('\n-- Claves de primer nivel de objects --');
    console.log(Object.keys(o).join(', '));
    const hits = [];
    buscar(o, '', hits, new Set());
    console.log('\n-- Campos candidatos (proveedor / telefono / contacto) --');
    console.log(hits.length ? hits.join('\n') : '  (ninguno encontrado con el patrón)');
    console.log('\n-- JSON COMPLETO de objects --');
    console.log(JSON.stringify(o, null, 2));
    console.log('');
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
