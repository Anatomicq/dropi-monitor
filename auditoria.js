/**
 * Auditoría 3 vías (P6): compara el stock de Dropi contra el inventario de
 * Shopify variante por variante, y revisa la jerarquía categoría↔subcategoría
 * de cada producto activo. Escribe la pestaña "Auditoría" del Sheet (tipo
 * 'auditoria' en el Apps Script). El Excel se genera de Dropi cada hora, así
 * que la comparación real de divergencia es Dropi vs Shopify.
 * Corre lunes 7:00 Colombia (12:00 UTC) y a mano (auditoria.yml).
 * Env: DROPI_EMAIL, DROPI_PASSWORD, SHEETS_WEBAPP_URL, SHEETS_SECRET,
 *      SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
 */
const EMAIL = process.env.DROPI_EMAIL;
const PASSWORD = process.env.DROPI_PASSWORD;
const WEBAPP = process.env.SHEETS_WEBAPP_URL;
const SECRET = process.env.SHEETS_SECRET || '';
const STORE = process.env.SHOPIFY_STORE;
const PAUSA_MS = 350;

const log = (m) => console.log(`[auditoria] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mapa del INICIO de la tienda (templates/index.json, 2026-08-24): categoría
// madre (handle de su colección) → subcategorías. Si se reorganiza el inicio,
// actualizar este mapa.
const CATEGORIAS = {
  'skincare': { nombre: 'PIEL Y BELLEZA', subs: ['envejecimiento-facial-arrugas-flacidez-papada-ojeras', 'manchas-e-hiperpigmentacion', 'piel-seca-e-hidratacion', 'acne-poros-y-piel-grasa', 'cuidado-corporal-y-detalles-vello-unas-venas-callos', 'celulitis-flacidez-corporal-y-estrias', 'salud-dental-y-sonrisa'] },
  'capilar': { nombre: 'CAPILAR', subs: ['tratamiento-capilar', 'herramientas-de-estilizado'] },
  'control-de-peso': { nombre: 'PESO Y METABOLISMO', subs: ['sobrepeso-y-quema-de-grasa', 'digestion-hinchazon-y-detox', 'salud-hormonal-femenina', 'salud-hormonal-masculina-y-vitalidad'] },
  'fitness-en-casa': { nombre: 'FITNESS Y RENDIMIENTO', subs: ['fuerza', 'cardiovascular', 'suplementos-y-proteinas', 'flexibilidad'] },
  'recuperacion-muscular': { nombre: 'DOLOR Y MOVILIDAD', subs: ['migrana-dolor-de-cabeza', 'cuello-y-cervical', 'articular-rodilla-hombro-codo-tobillo-y-rigidez', 'espalda-lumbar-y-postura', 'manos-dedos-y-muneca', 'muscular-post-ejercicio-y-calambres', 'medicion-y-monitoreo-de-salud', 'circulacion-y-piernas-cansadas'] },
  'sueno-y-descanso': { nombre: 'SUEÑO Y CALMA', subs: ['insomnio-mal-sueno', 'ansiedad-y-estres', 'ronquidos', 'ambiente-y-relajacion'] },
};
const KITS_COLECCIONES = ['kits-skincare', 'kits-control-de-peso', 'kits-fitness-en-casa', 'kits-recuperacion-muscular', 'kits-sueno-y-descanso'];

function subAMadre() {
  const m = {};
  for (const [cat, v] of Object.entries(CATEGORIAS)) for (const s of v.subs) m[s] = cat;
  return m;
}

// ── Shopify Admin API ──────────────────────────────────────────────────────
async function shopifyToken() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Sin token de Shopify');
  return j.access_token;
}

async function gql(token, query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

async function productosShopify(token) {
  const out = [];
  let cursor = null;
  for (let pg = 0; pg < 30; pg++) {
    const d = await gql(token, `
      query($c: String) {
        products(first: 50, after: $c, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          edges { node {
            title handle
            metafield(namespace: "dropi", key: "_dropi_product") { value }
            collections(first: 30) { edges { node { handle } } }
            variants(first: 60) { edges { node { title sku barcode inventoryQuantity } } }
          } }
        }
      }`, { c: cursor });
    const conn = d.products;
    for (const e of conn.edges) {
      const n = e.node;
      let dropiId = null;
      try { dropiId = n.metafield && String(JSON.parse(n.metafield.value).id); } catch {}
      out.push({
        titulo: n.title, handle: n.handle, dropiId,
        colecciones: n.collections.edges.map((c) => c.node.handle),
        variantes: n.variants.edges.map((v) => ({ titulo: v.node.title, sku: v.node.sku || '', barcode: v.node.barcode || '', stock: v.node.inventoryQuantity })),
      });
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

// ── Dropi ──────────────────────────────────────────────────────────────────
function apiHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
    'Origin': 'https://app.dropi.co', 'Referer': 'https://app.dropi.co/',
    'Accept-Language': 'es-419',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Dest': 'empty',
  };
}

async function loginDropi() {
  const res = await fetch('https://api-v2.dropi.co/bff/auth/core/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, white_brand_id: 1, brand: '', ipAddress: '', otp: null, with_cdc: false }),
  });
  const j = await res.json().catch(() => ({}));
  const token = j && j.data && j.data.token;
  if (!token) throw new Error('Login Dropi fallo (' + res.status + ')');
  return token;
}

async function stockDropi(id, token) {
  try {
    const res = await fetch(`https://api.dropi.co/api/products/productlist/v1/show/?id=${id}`, { headers: apiHeaders(token) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.isSuccess || !d.objects) return null;
    const o = d.objects;
    if (Array.isArray(o.variations) && o.variations.length) {
      const porVariacion = {};
      for (const v of o.variations) porVariacion[String(v.id)] = Number(v.stock) || 0;
      return { variable: true, porVariacion, total: Object.values(porVariacion).reduce((a, b) => a + b, 0) };
    }
    return { variable: false, total: Number(o.stock) || 0 };
  } catch { return null; }
}

// ── Auditoría ──────────────────────────────────────────────────────────────
async function main() {
  if (!EMAIL || !PASSWORD || !WEBAPP || !STORE) throw new Error('Faltan variables de entorno.');
  const S2M = subAMadre();

  log('Leyendo productos activos de Shopify...');
  const tokS = await shopifyToken();
  const prods = await productosShopify(tokS);
  log(`  ${prods.length} productos activos.`);

  // 1) JERARQUÍA
  const sinSubcat = [], subSinMadre = [], madreSinSub = [], kitsFueraColeccion = [];
  for (const p of prods) {
    const cols = new Set(p.colecciones);
    const esKit = KITS_COLECCIONES.some((k) => cols.has(k)) || /^kit\b/i.test(p.titulo);
    const subs = p.colecciones.filter((c) => S2M[c]);
    const madres = p.colecciones.filter((c) => CATEGORIAS[c]);
    if (esKit) {
      if (!KITS_COLECCIONES.some((k) => cols.has(k))) kitsFueraColeccion.push({ producto: p.titulo, detalle: 'Parece kit pero no está en ninguna colección de Kits y Combos' });
      continue; // los kits viven en sus colecciones de kits; no exigen subcategoría
    }
    if (!subs.length) sinSubcat.push({ producto: p.titulo, detalle: madres.length ? `Solo en categoría(s): ${madres.join(', ')}` : 'Sin categoría ni subcategoría' });
    for (const s of subs) {
      if (!cols.has(S2M[s])) subSinMadre.push({ producto: p.titulo, detalle: `Está en "${s}" pero NO en su categoría madre "${S2M[s]}"` });
    }
    for (const m of madres) {
      if (!CATEGORIAS[m].subs.some((s) => cols.has(s))) madreSinSub.push({ producto: p.titulo, detalle: `Está en la categoría "${m}" pero en ninguna de sus subcategorías` });
    }
  }
  log(`Jerarquía: ${sinSubcat.length} sin subcategoría, ${subSinMadre.length} sin madre, ${madreSinSub.length} madre sin sub, ${kitsFueraColeccion.length} kits fuera.`);

  // 2) STOCK Dropi vs Shopify
  log('Comparando stock Dropi vs Shopify...');
  const tokD = await loginDropi();
  const difStock = [], sinDropi = [];
  let comparados = 0;
  for (const p of prods) {
    const esKit = KITS_COLECCIONES.some((k) => p.colecciones.includes(k)) || /^kit\b/i.test(p.titulo);
    if (esKit) continue; // el stock de kits lo deriva Shopify Bundles
    // El ID de Dropi vive en el metafield dropi._dropi_product (igual que el monitor).
    const v0 = p.variantes[0] || {};
    if (!p.dropiId) { sinDropi.push({ producto: p.titulo, detalle: 'Sin metafield de Dropi (¿producto propio?)' }); continue; }
    const dropiId = p.dropiId;
    const d = await stockDropi(dropiId, tokD);
    await sleep(PAUSA_MS);
    if (!d) { sinDropi.push({ producto: p.titulo, detalle: `ID ${dropiId} no existe en Dropi` }); continue; }
    comparados++;
    if (d.variable) {
      for (const v of p.variantes) {
        const st = d.porVariacion[String(v.barcode)];
        if (st === undefined) { difStock.push({ producto: `${p.titulo} (${v.titulo})`, detalle: `Variante con barcode ${v.barcode} no existe como variación en Dropi ${dropiId}` }); continue; }
        if (Number(v.stock) !== st) difStock.push({ producto: `${p.titulo} (${v.titulo})`, detalle: `Shopify=${v.stock} vs Dropi=${st}` });
      }
    } else {
      const st = Number(v0.stock);
      if (st !== d.total) difStock.push({ producto: p.titulo, detalle: `Shopify=${st} vs Dropi=${d.total}` });
    }
  }
  log(`Stock: ${comparados} comparados, ${difStock.length} diferencias, ${sinDropi.length} sin Dropi.`);

  // 3) Enviar al Sheet
  const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  const secciones = [
    { titulo: `STOCK DIFERENTE Dropi vs Shopify (${difStock.length})`, filas: difStock },
    { titulo: `SIN SUBCATEGORÍA (${sinSubcat.length})`, filas: sinSubcat },
    { titulo: `EN SUBCATEGORÍA PERO NO EN SU CATEGORÍA (${subSinMadre.length})`, filas: subSinMadre },
    { titulo: `EN CATEGORÍA PERO EN NINGUNA SUBCATEGORÍA (${madreSinSub.length})`, filas: madreSinSub },
    { titulo: `KITS FUERA DE COLECCIÓN DE KITS (${kitsFueraColeccion.length})`, filas: kitsFueraColeccion },
    { titulo: `SIN PRODUCTO EN DROPI (${sinDropi.length})`, filas: sinDropi },
  ];
  const r = await fetch(WEBAPP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: SECRET, tipo: 'auditoria', fecha, secciones }),
    redirect: 'follow',
  });
  const txt = await r.text();
  let ok = false; try { ok = JSON.parse(txt).ok; } catch {}
  if (ok) log('✅ Pestaña "Auditoría" actualizada.');
  else { log('⚠️ Respuesta del Sheet: ' + txt.slice(0, 200)); process.exitCode = 1; }
}

main().catch((e) => { log('❌ ' + e.message); process.exitCode = 1; });
