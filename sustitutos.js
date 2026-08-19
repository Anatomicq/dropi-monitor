/** BUSCADOR DE SUSTITUTOS (muestra): para cada producto, busca en el catálogo Dropi el MISMO producto
 *  de OTRO proveedor con stock > 150, emparejando por nombre + descripción. Imprime top 3 con su score. */
const fs = require('fs');
const EMAIL = process.env.DROPI_EMAIL, PASSWORD = process.env.DROPI_PASSWORD;
const MIN_STOCK = 150;
const SAMPLE = parseInt(process.env.SAMPLE || '8', 10);

function apiHeaders(token) {
  return { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'Content-Type': 'application/json',
    'Origin': 'https://app.dropi.co', 'Referer': 'https://app.dropi.co/', 'Accept-Language': 'es-419',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="127"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Dest': 'empty' };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function login() {
  const res = await fetch('https://api-v2.dropi.co/bff/auth/core/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, white_brand_id: 1, brand: '', ipAddress: '', otp: null, with_cdc: false }) });
  return (await res.json()).data.token;
}
async function show(t, id) {
  const r = await fetch(`https://api.dropi.co/api/products/productlist/v1/show/?id=${id}`, { headers: apiHeaders(t) });
  const j = await r.json().catch(() => ({}));
  return j.objects || null;
}
async function search(t, keywords) {
  const r = await fetch('https://api.dropi.co/api/products/index', { method: 'POST', headers: apiHeaders(t), body: JSON.stringify({ pageSize: 100, startData: 0, keywords }) });
  const j = await r.json().catch(() => ({}));
  return j.objects || [];
}
const STOP = new Set('para con los las una unas unos del una tuyo tuya sin mas más que como este esta estos estas cuerpo mientras desde raiz raíz casa tu su de la el en y a o u por al se lo un x10 x3 x2'.split(' '));
// Palabras demasiado genéricas para buscar solas (traen catálogo entero):
const GENERICAS = new Set('combo kit set pack nuevo nueva oferta promo unidad unidades producto aparato dispositivo mascara'.split(' '));
function norm(s) { return String(s || '').toLowerCase().replace(/<[^>]+>/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim(); }
function singular(w) { return w.length > 4 ? w.replace(/es$/, '').replace(/s$/, '') : w; } // plural simple
function toks(s) { return norm(s).split(' ').filter(w => w.length > 3 && !STOP.has(w)).map(singular); }
function jaccard(a, b) { const A = new Set(toks(a)), B = new Set(toks(b)); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }
// Score que pesa MÁS el nombre (identifica el mismo producto) que la descripción larga.
function score(miNombre, miDesc, cNombre, cDesc) { return 0.7 * jaccard(miNombre, cNombre) + 0.3 * jaccard(miDesc, cDesc); }
function stockDe(o) { if (o.stock != null) return Number(o.stock) || 0; const w = o.warehouse_product && o.warehouse_product[0]; return w ? Number(w.stock) || 0 : 0; }
// Busca candidatos: primero con las 2 primeras palabras del nombre Dropi (el tipo de producto),
// si trae pocas, reintenta con 1 sola palabra. Devuelve lista de candidatos.
async function buscarCandidatos(t, nombreDropi) {
  const all = toks(nombreDropi);
  const buenas = all.filter(w => !GENERICAS.has(w)); // sin palabras ultra-genéricas
  const base = buenas.length ? buenas : all;
  const intentos = [];
  if (base.length >= 2) intentos.push(base.slice(0, 2).join(' '));          // tipo de producto (2 palabras)
  const larga = [...base].sort((a, b) => b.length - a.length)[0];
  if (larga) intentos.push(larga);                                          // palabra más específica sola
  if (base[0]) intentos.push(base[0]);
  let cands = [], usado = '';
  for (const kw of intentos) {
    cands = await search(t, kw); await sleep(350);
    usado = kw;
    if (cands.length >= 3) break;
  }
  return { cands, usado };
}

(async () => {
  const t = await login(); console.log('Login OK.\n');
  const productos = JSON.parse(fs.readFileSync('productos.json', 'utf8')).slice(0, SAMPLE);
  for (const p of productos) {
    const mio = await show(t, p.dropiId); await sleep(300);
    if (!mio) { console.log(`\n### ${p.titulo.slice(0, 45)} → no se pudo leer en Dropi`); continue; }
    const { cands, usado: kw } = await buscarCandidatos(t, mio.name);
    const todos = cands
      .filter(c => c.id !== mio.id && c.user_id !== mio.user_id && c.active && !c.deleted_at)
      .map(c => ({ c, stock: stockDe(c), score: score(mio.name, mio.description, c.name, c.description) }))
      .sort((a, b) => b.score - a.score);
    const scored = todos.filter(x => x.stock > MIN_STOCK && x.score >= 0.28).slice(0, 3);
    console.log(`\n### ${mio.name.slice(0, 50)}  (mi stock: ${stockDe(mio)}, proveedor: ${mio.user ? (mio.user.name + ' ' + (mio.user.surname || '')) : mio.user_id})`);
    console.log(`   keywords: "${kw}" | candidatos: ${cands.length} | sustitutos válidos: ${scored.length}`);
    scored.forEach((x, i) => console.log(`   OK ${i + 1}. [${Math.round(x.score * 100)}%] ${String(x.c.name).slice(0, 45)} | prov:${x.c.user ? x.c.user.name : x.c.user_id} | stock:${x.stock} | $${x.c.sale_price}`));
    if (!scored.length && todos[0]) { const b = todos[0]; console.log(`   mejor candidato (no pasa): [${Math.round(b.score * 100)}%] ${String(b.c.name).slice(0, 45)} | stock:${b.stock}`); }
  }
  console.log('\n=== FIN ===');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
