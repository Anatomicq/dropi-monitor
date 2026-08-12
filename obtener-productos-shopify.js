/**
 * Arma la lista de productos LEYENDO DIRECTO de Shopify (no de un archivo fijo).
 * Saca el ID de Dropi del metafield 'dropi._dropi_product' que pone la app Dropify.
 * Así cualquier producto agregado/editado/quitado en Shopify se detecta solo.
 *
 * Devuelve: [{ titulo, sku, dropiId, shopifyStatus }]
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
  products(first:100, after:$c){
    pageInfo{ hasNextPage endCursor }
    edges{ node{
      title status
      variants(first:1){ edges{ node{ sku } } }
      metafield(namespace:"dropi", key:"_dropi_product"){ value }
    } }
  }
}`;

async function obtenerProductosShopify(cfg) {
  const { STORE, CID, CS } = cfg;
  const t = await token(STORE, CID, CS);
  const out = [];
  let cursor = null, page = 0, sinDropi = 0, sinSku = 0;
  do {
    const d = await gql(STORE, t, Q, { c: cursor });
    for (const e of d.products.edges) {
      const n = e.node;
      if (!n.metafield?.value) { sinDropi++; continue; } // no es producto de Dropi
      let dropiId;
      try { dropiId = JSON.parse(n.metafield.value).id; } catch { dropiId = null; }
      if (!dropiId) { sinDropi++; continue; }
      const sku = (n.variants.edges[0]?.node?.sku || '').trim();
      if (!sku) { sinSku++; continue; } // sin SKU no se puede emparejar
      out.push({ titulo: n.title, sku, dropiId: String(dropiId), shopifyStatus: (n.status || '').toLowerCase() });
    }
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    page++;
  } while (cursor && page < 60);
  return { productos: out, sinDropi, sinSku };
}

module.exports = { obtenerProductosShopify };
