/**
 * Arma la lista de productos LEYENDO DIRECTO de Shopify (no de un archivo fijo).
 * Saca el ID de Dropi del metafield 'dropi._dropi_product' que pone la app Dropify.
 *
 * Devuelve por producto:
 *   { titulo, sku, dropiId, shopifyStatus, esBasePack, esComponente,
 *     precio, invShopify, colecciones, variantsCount }
 *   - esComponente / esBasePack: el producto es componente de algún pack/kit
 *     (misma verdad; esBasePack se conserva por compatibilidad con dropi-cloud).
 *   - precio: precio de la 1ª variante (x1) en Shopify — para la utilidad.
 *   - invShopify: inventario total del producto en Shopify — para comparar con Dropi.
 *   - colecciones: handles de colecciones — para categoría/subcategoría.
 *   - variantsCount: nº de variantes en Shopify.
 * Variables: SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
 */
const API = '2025-01';

async function token(STORE, CID, CS) {
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CID, client_secret: CS, grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Shopify sin token: ' + JSON.stringify(j).slice(0, 120));
  return j.access_token;
}
async function gql(STORE, t, query, variables) {
  const r = await fetch(`https://${STORE}/admin/api/${API}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': t },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors).slice(0, 250));
  return j.data;
}

const Q = `query($c:String){
  products(first:80, after:$c){
    pageInfo{ hasNextPage endCursor }
    edges{ node{
      id title status totalInventory
      variantsCount{ count }
      variants(first:1){ edges{ node{ sku price } } }
      collections(first:30){ edges{ node{ handle } } }
      bundleComponents(first:25){ edges{ node{ componentProduct{ id } } } }
      metafield(namespace:"dropi", key:"_dropi_product"){ value }
    } }
  }
}`;

async function obtenerProductosShopify(cfg) {
  const { STORE, CID, CS } = cfg;
  const t = await token(STORE, CID, CS);
  const crudos = [];              // todos los nodes (para cruzar componentes)
  const componentes = new Set();  // ids de productos usados dentro de un pack/kit
  let cursor = null, page = 0;
  do {
    const d = await gql(STORE, t, Q, { c: cursor });
    for (const e of d.products.edges) {
      const n = e.node;
      crudos.push(n);
      for (const c of (n.bundleComponents?.edges || [])) {
        const cid = c?.node?.componentProduct?.id;
        if (cid) componentes.add(cid);
      }
    }
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    page++;
  } while (cursor && page < 60);

  const out = [];
  let sinDropi = 0, sinSku = 0;
  for (const n of crudos) {
    if (!n.metafield?.value) { sinDropi++; continue; } // no es producto de Dropi
    let dropiId;
    try { dropiId = JSON.parse(n.metafield.value).id; } catch { dropiId = null; }
    if (!dropiId) { sinDropi++; continue; }
    const v0 = n.variants.edges[0]?.node || {};
    const sku = (v0.sku || '').trim();
    if (!sku) { sinSku++; continue; } // sin SKU no se puede emparejar
    const esComponente = componentes.has(n.id);
    out.push({
      titulo: n.title, sku, dropiId: String(dropiId),
      shopifyStatus: (n.status || '').toLowerCase(),
      esBasePack: esComponente,     // compat dropi-cloud (label "base de pack")
      esComponente,                 // Q: ¿en un kit?
      precio: Number(v0.price) || 0,
      invShopify: Number(n.totalInventory) || 0,
      colecciones: (n.collections?.edges || []).map(c => c.node.handle),
      variantsCount: Number(n.variantsCount?.count) || 1,
    });
  }
  return { productos: out, sinDropi, sinSku };
}

module.exports = { obtenerProductosShopify };
