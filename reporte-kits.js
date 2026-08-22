/**
 * Pestaña "Kits" del Sheet: inventario de cada componente de cada kit (bundle de Shopify).
 * Corre en la misma corrida horaria, DESPUES de sincronizar el stock, asi que el
 * inventario de los componentes ya refleja el de Dropi.
 *
 * Filas: Kit | Estado del kit | Stock minimo | Componente | Proveedor | SKU | Stock | Cant. en kit
 * Orden: primero los kits con algun componente en 0, luego los que tienen alguno con <=50,
 * luego el resto (dentro de cada kit, los componentes con menos stock primero).
 * Los colores (naranja 1-50, rojo 0) los aplica el Apps Script de la hoja (tipo: 'kits').
 *
 * El kit "Agotado" lo marca Shopify solo: el inventario de un bundle se deriva del
 * minimo de sus componentes (verificado 2026-08-21). Aqui solo se reporta.
 *
 * Seguridad: solo se envia al Sheet si KITS_SHEET=1 (el Apps Script debe tener el
 * manejador de tipo 'kits'; si no, el relay podria escribir en la pestaña equivocada).
 */
const API = '2025-01';
const UMBRAL_BAJO = 50;
const log = (m) => console.log(`[kits] ${m}`);

async function token(STORE, CID, CS) {
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CID, client_secret: CS, grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('sin token de Shopify');
  return j.access_token;
}
async function gql(STORE, t, query, variables) {
  const r = await fetch(`https://${STORE}/admin/api/${API}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': t },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors).slice(0, 200));
  return j.data;
}

const Q = `query($c:String){ products(first:100, after:$c, query:"status:active"){
  pageInfo{ hasNextPage endCursor }
  edges{ node{ title
    bundleComponents(first:20){ edges{ node{ quantity
      componentProduct{ title vendor }
      componentVariants(first:5){ edges{ node{ title sku inventoryQuantity } } } } } } } } } }`;

/** Lee todos los bundles y arma las filas de la pestaña. */
async function armarFilasKits(cfg) {
  const { STORE, CID, CS } = cfg;
  const t = await token(STORE, CID, CS);
  const kits = [];
  let cursor = null, pagina = 0;
  do {
    const d = await gql(STORE, t, Q, { c: cursor });
    for (const e of d.products.edges) {
      const comps = e.node.bundleComponents.edges;
      if (!comps.length) continue;
      const componentes = [];
      for (const c of comps) {
        const n = c.node;
        // stock del componente = suma de las variantes que el kit usa (normalmente 1)
        let stock = 0, skus = [];
        for (const v of n.componentVariants.edges) { stock += Number(v.node.inventoryQuantity) || 0; if (v.node.sku) skus.push(v.node.sku); }
        componentes.push({ nombre: n.componentProduct.title, proveedor: n.componentProduct.vendor || '', sku: skus.join(' / '), stock, cantidad: n.quantity });
      }
      componentes.sort((a, b) => a.stock - b.stock);
      const minimo = Math.min(...componentes.map(c => c.stock));
      kits.push({ nombre: e.node.title, minimo, componentes });
    }
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    pagina++;
    await new Promise(r => setTimeout(r, 250));
  } while (cursor && pagina < 20);

  // prioridad: 0 = agotado, 1 = bajo (<=50), 2 = ok
  const prio = k => (k.minimo <= 0 ? 0 : (k.minimo <= UMBRAL_BAJO ? 1 : 2));
  kits.sort((a, b) => prio(a) - prio(b) || a.minimo - b.minimo || a.nombre.localeCompare(b.nombre));

  const rows = [['Kit', 'Estado del kit', 'Stock mínimo', 'Componente', 'Proveedor', 'SKU', 'Stock', 'Cant. en kit']];
  for (const k of kits) {
    const estado = k.minimo <= 0 ? 'AGOTADO' : (k.minimo <= UMBRAL_BAJO ? 'STOCK BAJO' : 'Disponible');
    for (const c of k.componentes) rows.push([k.nombre, estado, k.minimo, c.nombre, c.proveedor, c.sku, c.stock, c.cantidad]);
  }
  const agotados = kits.filter(k => k.minimo <= 0).length, bajos = kits.filter(k => k.minimo > 0 && k.minimo <= UMBRAL_BAJO).length;
  log(`kits: ${kits.length} | agotados: ${agotados} | con stock bajo (<=${UMBRAL_BAJO}): ${bajos}`);
  return rows;
}

/** Envia la pestaña al Sheet (mismo relay del monitor, tipo 'kits'). */
async function reportarKits(cfg, WEBAPP_URL, SECRET) {
  if (!cfg.STORE) return;
  try {
    const rows = await armarFilasKits(cfg);
    if (process.env.KITS_SHEET !== '1') { log(`KITS_SHEET != 1: no se envia al Sheet (${rows.length - 1} filas listas).`); return; }
    if (!WEBAPP_URL) { log('sin SHEETS_WEBAPP_URL; se omite.'); return; }
    const timestamp = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    const r = await fetch(WEBAPP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: SECRET, tipo: 'kits', timestamp, rows }), redirect: 'follow' });
    const txt = await r.text(); let ok = false; try { ok = JSON.parse(txt).ok; } catch {}
    log(ok ? '✅ Pestaña "Kits" actualizada en el Sheet.' : '⚠️ Respuesta del Sheet: ' + txt.slice(0, 150));
  } catch (e) {
    log('error (no fatal): ' + e.message);
  }
}

module.exports = { reportarKits, armarFilasKits };
