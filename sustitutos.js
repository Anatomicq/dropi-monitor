/** BUSCADOR DE SUSTITUTOS (completo): para cada producto, busca en el catálogo Dropi el MISMO producto
 *  de OTRO proveedor con stock > 150, emparejando por nombre + descripción. Escribe sustitutos-resultado.json. */
const fs = require('fs');
const EMAIL = process.env.DROPI_EMAIL, PASSWORD = process.env.DROPI_PASSWORD;
const MIN_STOCK = 150;
const UMBRAL = 0.40;
const LIMIT = process.env.SAMPLE ? parseInt(process.env.SAMPLE, 10) : 0; // 0 = todos

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
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(`https://api.dropi.co/api/products/productlist/v1/show/?id=${id}`, { headers: apiHeaders(t) }); if (r.ok) { const j = await r.json(); return j.objects || null; } } catch {}
    await sleep(3000);
  }
  return null;
}
async function search(t, keywords) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch('https://api.dropi.co/api/products/index', { method: 'POST', headers: apiHeaders(t), body: JSON.stringify({ pageSize: 100, startData: 0, keywords }) }); if (r.ok) { const j = await r.json(); return j.objects || []; } } catch {}
    await sleep(3000);
  }
  return [];
}
const STOP = new Set('para con los las una unas unos del una tuyo tuya sin mas más que como este esta estos estas cuerpo mientras desde raiz raíz casa tu su de la el en y a o u por al se lo un x10 x3 x2'.split(' '));
const GENERICAS = new Set('combo kit set pack nuevo nueva oferta promo unidad unidades producto aparato dispositivo mascara'.split(' '));
function norm(s) { return String(s || '').toLowerCase().replace(/<[^>]+>/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim(); }
function singular(w) { return w.length > 4 ? w.replace(/es$/, '').replace(/s$/, '') : w; }
function palabras(s) { return norm(s).split(' ').filter(w => w.length > 3 && !STOP.has(w)); }
function toks(s) { return palabras(s).map(singular); }
function jaccard(a, b) { const A = new Set(toks(a)), B = new Set(toks(b)); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }
function score(mn, md, cn, cd) { return 0.7 * jaccard(mn, cn) + 0.3 * jaccard(md, cd); }
function stockDe(o) { if (o.stock != null) return Number(o.stock) || 0; const w = o.warehouse_product && o.warehouse_product[0]; return w ? Number(w.stock) || 0 : 0; }
function prov(o) { return o.user ? (o.user.store_name || ((o.user.name || '') + ' ' + (o.user.surname || '')).trim()) : ('proveedor ' + o.user_id); }
async function buscarCandidatos(t, nombre) {
  const all = palabras(nombre); const buenas = all.filter(w => !GENERICAS.has(w)); const base = buenas.length ? buenas : all;
  const terms = new Set();
  if (base.length >= 2) terms.add(base.slice(0, 2).join(' '));
  const larga = [...base].sort((a, b) => b.length - a.length)[0]; if (larga) terms.add(larga);
  if (base[0]) terms.add(base[0]);
  const byId = new Map();
  for (const kw of terms) { const cs = await search(t, kw); await sleep(300); for (const c of cs) if (!byId.has(c.id)) byId.set(c.id, c); if (byId.size > 130) break; }
  return [...byId.values()];
}
(async () => {
  const t = await login(); console.log('Login OK.');
  let productos = JSON.parse(fs.readFileSync('productos.json', 'utf8'));
  if (LIMIT) productos = productos.slice(0, LIMIT);
  console.log('Procesando', productos.length, 'productos...');
  const out = [];
  let conSust = 0;
  for (let i = 0; i < productos.length; i++) {
    const p = productos[i];
    try {
      const mio = await show(t, p.dropiId); await sleep(250);
      if (!mio) { out.push({ producto: p.titulo, sku: p.sku, dropiId: p.dropiId, error: 'no leído en Dropi', sustitutos: [] }); continue; }
      const cands = await buscarCandidatos(t, mio.name);
      const scored = cands
        .filter(c => c.id !== mio.id && c.user_id !== mio.user_id && c.active && !c.deleted_at)
        .map(c => ({ c, stock: stockDe(c), s: score(mio.name, mio.description, c.name, c.description) }))
        .filter(x => x.stock > MIN_STOCK && x.s >= UMBRAL)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);
      if (scored.length) conSust++;
      out.push({
        producto: p.titulo, sku: p.sku, dropiId: p.dropiId,
        nombreDropi: mio.name, miStock: stockDe(mio), miProveedor: prov(mio),
        sustitutos: scored.map(x => ({ nombre: x.c.name, proveedor: prov(x.c), stock: x.stock, precio: x.c.sale_price, precioSugerido: x.c.suggested_price, dropiId: x.c.id, match: Math.round(x.s * 100) })),
      });
    } catch (e) { out.push({ producto: p.titulo, sku: p.sku, dropiId: p.dropiId, error: e.message, sustitutos: [] }); }
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${productos.length} (con sustituto: ${conSust})`);
  }
  fs.writeFileSync('sustitutos-resultado.json', JSON.stringify(out, null, 2));
  console.log(`\n✅ LISTO. ${out.length} productos | con al menos 1 sustituto: ${conSust} | sin sustituto: ${out.length - conSust}`);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
