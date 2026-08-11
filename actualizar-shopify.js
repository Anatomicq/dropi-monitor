/**
 * Actualiza el stock en Shopify para que coincida con el stock leído en Dropi.
 * Se llama desde dropi-cloud.js con un mapa { sku -> cantidad } (el mismo número
 * que va al Excel). Empareja por SKU con las variantes de Shopify y fija el
 * inventario disponible en la ubicación de la tienda.
 *
 * Requiere en el app de Shopify los permisos: read_products, read_locations,
 * read_inventory, write_inventory.
 * Variables de entorno: SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
 */
const API = '2025-01';
const log = (m) => console.log(`[shopify] ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function token(STORE, CID, CS) {
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CID, client_secret: CS, grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Shopify sin token: ' + JSON.stringify(j).slice(0, 150));
  return j.access_token;
}
async function gql(STORE, t, query, variables) {
  const r = await fetch(`https://${STORE}/admin/api/${API}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': t },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

const Q_LOC = `{ locations(first:5, query:"active:true"){ edges{ node{ id name } } } }`;
const Q_VARS = `query($c:String){ productVariants(first:250, after:$c){ pageInfo{hasNextPage endCursor} edges{ node{ sku inventoryItem{ id tracked } } } } }`;
const M_TRACK = `mutation($id:ID!){ inventoryItemUpdate(id:$id, input:{tracked:true}){ userErrors{ message } } }`;
const M_SET = `mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`;

/**
 * @param {Object} cfg { STORE, CID, CS }
 * @param {Map<string,number>|Object} stockPorSku  sku -> cantidad (stock de Dropi)
 */
async function actualizarStockShopify(cfg, stockPorSku) {
  const { STORE, CID, CS } = cfg;
  if (!STORE || !CID || !CS) { log('Faltan credenciales de Shopify, se omite la actualización.'); return; }
  const stock = stockPorSku instanceof Map ? stockPorSku : new Map(Object.entries(stockPorSku));
  const t = await token(STORE, CID, CS);

  // 1) Ubicación de la tienda
  const dl = await gql(STORE, t, Q_LOC);
  const loc = dl.locations.edges[0]?.node;
  if (!loc) throw new Error('No hay ubicación activa en Shopify.');
  log(`Ubicación: ${loc.name}`);

  // 2) Todas las variantes por SKU
  const bySku = new Map(); // sku -> { inventoryItemId, tracked }
  let cursor = null, page = 0;
  do {
    const d = await gql(STORE, t, Q_VARS, { c: cursor });
    for (const e of d.productVariants.edges) {
      const n = e.node;
      if (n.sku && n.inventoryItem?.id) bySku.set(String(n.sku).trim(), { id: n.inventoryItem.id, tracked: !!n.inventoryItem.tracked });
    }
    cursor = d.productVariants.pageInfo.hasNextPage ? d.productVariants.pageInfo.endCursor : null;
    page++;
  } while (cursor && page < 60);
  log(`Variantes con SKU en Shopify: ${bySku.size}`);

  // 3) Emparejar y fijar stock
  const quantities = [];
  let sinMatch = 0, activarTrack = [];
  for (const [sku, cant] of stock) {
    const v = bySku.get(String(sku).trim());
    if (!v) { sinMatch++; continue; }
    if (!v.tracked) activarTrack.push(v.id);
    quantities.push({ inventoryItemId: v.id, locationId: loc.id, quantity: Math.max(0, Math.round(Number(cant) || 0)) });
  }
  log(`A actualizar: ${quantities.length} | sin match: ${sinMatch} | activar tracking: ${activarTrack.length}`);

  // 3a) Activar tracking donde falte (necesario para que Shopify controle inventario)
  for (const id of activarTrack) {
    try { await gql(STORE, t, M_TRACK, { id }); } catch (e) { log('tracking ' + id.split('/').pop() + ': ' + e.message); }
    await sleep(120);
  }

  // 3b) Fijar el inventario disponible en lotes (ignoramos comparación de cantidad previa)
  let ok = 0, err = 0;
  const LOTE = 100;
  for (let i = 0; i < quantities.length; i += LOTE) {
    const lote = quantities.slice(i, i + LOTE);
    const input = { name: 'available', reason: 'correction', ignoreCompareQuantity: true, quantities: lote };
    try {
      const r = await gql(STORE, t, M_SET, { input });
      const ue = r.inventorySetQuantities.userErrors;
      if (ue.length) { err += lote.length; log('lote ' + (i / LOTE + 1) + ' errores: ' + JSON.stringify(ue).slice(0, 200)); }
      else ok += lote.length;
    } catch (e) { err += lote.length; log('lote ' + (i / LOTE + 1) + ': ' + e.message); }
    await sleep(300);
  }
  log(`✅ Stock actualizado en Shopify: ${ok} | con error: ${err}`);
  return { actualizados: ok, errores: err, sinMatch };
}

module.exports = { actualizarStockShopify };
