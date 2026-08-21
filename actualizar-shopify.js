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

// El congelamiento de la vitrina (2026-08-20/22) se resolvio; el rastreo de
// inventario se reactivo en todas las variantes. Si vuelve a pasar (la alerta
// STRICT_VITRINA avisara), poner temporalmente en false y destrackear las
// variantes con stock para poder vender mientras soporte lo arregla.
const REACTIVAR_TRACKING = true;
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

// Incluimos inactivas/legacy para poder ver la bodega de la app 'Fulfillment Dropi'.
const Q_LOC = `{ locations(first:30, includeInactive:true, includeLegacy:true){ edges{ node{ id name isActive fulfillmentService{ handle } } } } }`;
const Q_VARS = `query($c:String){ productVariants(first:250, after:$c){ pageInfo{hasNextPage endCursor} edges{ node{ sku barcode inventoryItem{ id tracked } } } } }`;
const M_TRACK = `mutation($id:ID!){ inventoryItemUpdate(id:$id, input:{tracked:true}){ userErrors{ message } } }`;
const M_SET = `mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`;
// inventoryActivate: crea el nivel de inventario en la bodega Y fija la cantidad disponible.
const M_ACTIVATE = `mutation($id:ID!,$loc:ID!,$qty:Int){ inventoryActivate(inventoryItemId:$id, locationId:$loc, available:$qty){ inventoryLevel{ id } userErrors{ message } } }`;

/**
 * @param {Object} cfg { STORE, CID, CS }
 * @param {Map<string,number>|Object} stockPorSku  sku -> cantidad (stock de Dropi)
 */
async function actualizarStockShopify(cfg, stockPorSku) {
  const { STORE, CID, CS } = cfg;
  if (!STORE || !CID || !CS) { log('Faltan credenciales de Shopify, se omite la actualización.'); return; }
  const stock = stockPorSku instanceof Map ? stockPorSku : new Map(Object.entries(stockPorSku));
  const t = await token(STORE, CID, CS);

  // 1) Ubicación destino: la bodega de Dropi ('Fulfillment Dropi'). Es la que surte los pedidos.
  const dl = await gql(STORE, t, Q_LOC);
  const locs = dl.locations.edges.map(e => e.node);
  const loc = locs.find(n => /dropi/i.test(n.name) || (n.fulfillmentService && /dropi/i.test(n.fulfillmentService.handle)))
           || locs.find(n => n.isActive) || locs[0];
  if (!loc) throw new Error('No hay ubicación en Shopify.');
  if (!/dropi/i.test(loc.name)) log(`⚠️ No encontré 'Fulfillment Dropi'; usando ${loc.name}`);
  log(`Ubicación destino: ${loc.name}`);

  // 2) Indexar variantes. La clave FIABLE es el codigo de barras = ID de Dropi;
  //    el SKU es campo libre y estuvo duplicado (ver auditoria), por eso va de respaldo.
  const byBarcode = new Map(); // barcode -> { inventoryItemId, tracked }
  const bySku = new Map();     // sku     -> idem
  let cursor = null, page = 0, dupBarcode = 0;
  do {
    const d = await gql(STORE, t, Q_VARS, { c: cursor });
    for (const e of d.productVariants.edges) {
      const n = e.node;
      if (!n.inventoryItem?.id) continue;
      const ref = { id: n.inventoryItem.id, tracked: !!n.inventoryItem.tracked };
      if (n.barcode) {
        const b = String(n.barcode).trim();
        if (b) { if (byBarcode.has(b)) dupBarcode++; else byBarcode.set(b, ref); }
      }
      if (n.sku) {
        const s = String(n.sku).trim();
        if (s && !bySku.has(s)) bySku.set(s, ref);
      }
    }
    cursor = d.productVariants.pageInfo.hasNextPage ? d.productVariants.pageInfo.endCursor : null;
    page++;
  } while (cursor && page < 60);
  log(`Indexadas: ${byBarcode.size} por codigo de barras | ${bySku.size} por SKU` + (dupBarcode ? ` | ${dupBarcode} barcode(s) repetido(s) ignorado(s)` : ''));

  // 3) Emparejar y fijar stock. La clave que llega es el ID de Dropi.
  const quantities = [];
  let sinMatch = 0, porBarcode = 0, porSku = 0, activarTrack = [];
  for (const [dropiId, cant] of stock) {
    const clave = String(dropiId).trim();
    let v = byBarcode.get(clave);
    if (v) porBarcode++;
    else { v = bySku.get(clave); if (v) porSku++; }
    if (!v) { sinMatch++; continue; }
    if (!v.tracked) {
      if (REACTIVAR_TRACKING) activarTrack.push(v.id);
      else continue; // sin seguimiento a proposito (ver nota arriba): no fijar cantidad
    }
    quantities.push({ inventoryItemId: v.id, locationId: loc.id, quantity: Math.max(0, Math.round(Number(cant) || 0)) });
  }
  log(`A actualizar: ${quantities.length} (${porBarcode} por barcode, ${porSku} por SKU) | sin match: ${sinMatch} | activar tracking: ${activarTrack.length}`);

  // 3a) Activar tracking donde falte (necesario para que Shopify controle inventario)
  for (const id of activarTrack) {
    try { await gql(STORE, t, M_TRACK, { id }); } catch (e) { log('tracking ' + id.split('/').pop() + ': ' + e.message); }
    await sleep(120);
  }

  // 3b) Fijar el inventario. PRIMERO fijamos el valor ABSOLUTO (inventorySetQuantities);
  //     si el producto aún no tiene nivel en la bodega, lo activamos con esa cantidad.
  //     Nunca suma: siempre deja el stock EXACTO al de Dropi.
  let ok = 0, err = 0;
  for (const q of quantities) {
    let hecho = false, msg = '';
    try {
      const r = await gql(STORE, t, M_SET, { input: { name: 'on_hand', reason: 'correction', ignoreCompareQuantity: true, quantities: [q] } });
      const ue = r.inventorySetQuantities.userErrors;
      if (!ue.length) hecho = true;
      else if (/not stocked/i.test(JSON.stringify(ue))) {
        // No tiene nivel en la bodega → activarlo crea el nivel EN esa cantidad (fija, no suma).
        const r2 = await gql(STORE, t, M_ACTIVATE, { id: q.inventoryItemId, loc: q.locationId, qty: q.quantity });
        if (!r2.inventoryActivate.userErrors.length) hecho = true;
        else msg = JSON.stringify(r2.inventoryActivate.userErrors).slice(0, 150);
      } else msg = JSON.stringify(ue).slice(0, 150);
    } catch (e) { msg = e.message; }
    if (hecho) ok++;
    else { err++; if (err <= 5) log('SKU item ' + q.inventoryItemId.split('/').pop() + ': ' + msg); }
    await sleep(120);
  }
  log(`✅ Stock actualizado en Shopify: ${ok} | con error: ${err}`);
  return { actualizados: ok, errores: err, sinMatch };
}

module.exports = { actualizarStockShopify };
