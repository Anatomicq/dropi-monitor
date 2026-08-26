/**
 * Carga en Shopify el COSTO por unidad (precio base de Dropi) de cada producto.
 *
 * Por qué aquí: el monitor ya consulta Dropi 5 veces al día y tiene el precio
 * base en memoria; volver a pedírselo desde la auditoría costaría otros ~13
 * minutos de ejecución por corrida. Con el costo guardado en Shopify, la
 * auditoría calcula el margen sin tocar Dropi, y de paso los informes de
 * ganancia de Shopify empiezan a funcionar.
 *
 * Se le pasa un mapa  idDropi -> precioBase  (mismo criterio de emparejamiento
 * que el stock: el ID de Dropi vive en el código de barras de la variante).
 */
const API = '2025-01';
const log = (m) => console.log(`[costos] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function token(STORE, CID, CS) {
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CID, client_secret: CS, grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Shopify sin token');
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

const Q_VARS = `query($c:String){ productVariants(first:250, after:$c){
  pageInfo{ hasNextPage endCursor }
  edges{ node{ sku barcode inventoryItem{ id unitCost{ amount } } } } } }`;
const M_COST = `mutation($id:ID!,$cost:Decimal!){
  inventoryItemUpdate(id:$id, input:{ cost:$cost }){ userErrors{ message } } }`;

/**
 * @param {Object} cfg { STORE, CID, CS }
 * @param {Map<string,number>} costoPorId  idDropi -> precio base en COP
 */
async function sincronizarCostos(cfg, costoPorId) {
  const { STORE, CID, CS } = cfg;
  if (!STORE || !CID || !CS) { log('Sin credenciales de Shopify, se omite.'); return; }
  if (!costoPorId || costoPorId.size === 0) { log('Sin costos que cargar.'); return; }

  const t = await token(STORE, CID, CS);

  // Índice barcode/SKU -> item de inventario y costo actual
  const porClave = new Map();
  let cursor = null, page = 0;
  do {
    const d = await gql(STORE, t, Q_VARS, { c: cursor });
    for (const e of d.productVariants.edges) {
      const n = e.node;
      if (!n.inventoryItem?.id) continue;
      const ref = {
        id: n.inventoryItem.id,
        costoActual: n.inventoryItem.unitCost ? Number(n.inventoryItem.unitCost.amount) : null,
      };
      if (n.barcode) porClave.set(String(n.barcode).trim(), ref);
      if (n.sku && !porClave.has(String(n.sku).trim())) porClave.set(String(n.sku).trim(), ref);
    }
    cursor = d.productVariants.pageInfo.hasNextPage ? d.productVariants.pageInfo.endCursor : null;
    page++;
  } while (cursor && page < 20);

  let ok = 0, iguales = 0, sinMatch = 0, err = 0;
  for (const [id, precio] of costoPorId) {
    const v = porClave.get(String(id).trim());
    if (!v) { sinMatch++; continue; }
    const nuevo = Math.round(Number(precio) || 0);
    if (!(nuevo > 0)) continue;
    // Solo se escribe cuando cambia: evita miles de llamadas inútiles cada corrida.
    if (v.costoActual !== null && Math.round(v.costoActual) === nuevo) { iguales++; continue; }
    try {
      const r = await gql(STORE, t, M_COST, { id: v.id, cost: String(nuevo) });
      if (r.inventoryItemUpdate.userErrors.length) err++;
      else ok++;
    } catch { err++; }
    await sleep(120);
  }
  log(`costos actualizados: ${ok} | ya estaban: ${iguales} | sin match: ${sinMatch} | errores: ${err}`);
  return { ok, iguales, sinMatch, err };
}

module.exports = { sincronizarCostos };
