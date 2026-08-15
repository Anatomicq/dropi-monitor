/**
 * Editor puntual de Shopify por API (custom app, client_credentials).
 * Se ejecuta desde GitHub Actions con los secrets ya guardados.
 *
 *   ACCION = 'buscar'  → SOLO LECTURA: lista productos/variantes que coinciden
 *                        (título, SKU, precio). No cambia nada.
 *   ACCION = 'precio'  → ESCRITURA: fija un precio nuevo a las variantes del
 *                        producto encontrado. Requiere el permiso write_products.
 *
 * Variables de entorno:
 *   SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET (secrets)
 *   ACCION    = 'buscar' | 'precio'   (por defecto 'buscar')
 *   CONSULTA  = texto del título a buscar, o 'sku:1234' para SKU exacto
 *   PRECIO    = nuevo precio (solo en ACCION=precio), ej '43000'
 */
const API = '2025-01';
const log = (m) => console.log(`[shopify] ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const STORE  = process.env.SHOPIFY_STORE;
const CID    = process.env.SHOPIFY_CLIENT_ID;
const CS     = process.env.SHOPIFY_CLIENT_SECRET;
const ACCION = (process.env.ACCION || 'buscar').trim().toLowerCase();
const CONSULTA = (process.env.CONSULTA || '').trim();
const PRECIO = (process.env.PRECIO || '').trim();

async function token() {
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CID, client_secret: CS, grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Shopify sin token: ' + JSON.stringify(j).slice(0, 150));
  return j.access_token;
}
async function gql(t, query, variables) {
  const r = await fetch(`https://${STORE}/admin/api/${API}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': t },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors).slice(0, 400));
  return j.data;
}

const Q_PROD = `query($q:String){ products(first:20, query:$q){ edges{ node{
  id title status
  variants(first:100){ edges{ node{ id title sku price } } }
}}}}`;

const Q_VARS = `query($c:String){ productVariants(first:250, after:$c){
  pageInfo{ hasNextPage endCursor }
  edges{ node{ id title sku price product{ id title } } }
}}`;

const M_PRECIO = `mutation($pid:ID!,$vars:[ProductVariantsBulkInput!]!){
  productVariantsBulkUpdate(productId:$pid, variants:$vars){
    productVariants{ id sku price } userErrors{ field message }
  }
}`;

// Devuelve [{ productId, title, variants:[{id,title,sku,price}] }] que coinciden con CONSULTA.
async function buscar(t) {
  if (/^sku:/i.test(CONSULTA)) {
    const sku = CONSULTA.replace(/^sku:/i, '').trim();
    const porProd = new Map();
    let cursor = null, page = 0;
    do {
      const d = await gql(t, Q_VARS, { c: cursor });
      for (const e of d.productVariants.edges) {
        const n = e.node;
        if (n.sku && String(n.sku).trim() === sku) {
          const pid = n.product.id;
          if (!porProd.has(pid)) porProd.set(pid, { productId: pid, title: n.product.title, variants: [] });
          porProd.get(pid).variants.push({ id: n.id, title: n.title, sku: n.sku, price: n.price });
        }
      }
      cursor = d.productVariants.pageInfo.hasNextPage ? d.productVariants.pageInfo.endCursor : null;
      page++;
    } while (cursor && page < 60);
    return [...porProd.values()];
  }
  // Búsqueda por título
  const d = await gql(t, Q_PROD, { q: `title:*${CONSULTA}*` });
  return d.products.edges.map(e => ({
    productId: e.node.id, title: e.node.title, status: e.node.status,
    variants: e.node.variants.edges.map(v => ({ id: v.node.id, title: v.node.title, sku: v.node.sku, price: v.node.price })),
  }));
}

function mostrar(res) {
  if (!res.length) { log('No se encontró ningún producto con esa consulta.'); return; }
  log(`Coincidencias: ${res.length} producto(s).`);
  res.forEach((p, i) => {
    console.log(`\n[${i + 1}] ${p.title}  (${p.productId})`);
    p.variants.forEach(v => console.log(`     - variante "${v.title}"  SKU=${v.sku || '—'}  precio=$${v.price}`));
  });
}

(async () => {
  if (!STORE || !CID || !CS) throw new Error('Faltan credenciales de Shopify (SHOPIFY_STORE/CLIENT_ID/CLIENT_SECRET).');
  if (!CONSULTA) throw new Error('Falta CONSULTA (título del producto o "sku:1234").');
  const t = await token();
  const res = await buscar(t);

  if (ACCION === 'buscar') {
    mostrar(res);
    log('\nModo BUSCAR (solo lectura): no se cambió nada.');
    return;
  }

  if (ACCION === 'precio') {
    if (!PRECIO || isNaN(Number(PRECIO))) throw new Error('Falta un PRECIO numérico válido.');
    if (res.length === 0) throw new Error('No hay producto que coincida; no cambio nada.');
    if (res.length > 1) { mostrar(res); throw new Error(`Coinciden ${res.length} productos: sé más específico (o usa sku:1234) para no cambiar el equivocado.`); }
    const p = res[0];
    log(`Cambiando precio a $${PRECIO} en: ${p.title}  (${p.variants.length} variante/s)`);
    const vars = p.variants.map(v => ({ id: v.id, price: String(PRECIO) }));
    const d = await gql(t, M_PRECIO, { pid: p.productId, vars });
    const ue = d.productVariantsBulkUpdate.userErrors;
    if (ue.length) throw new Error('No se pudo cambiar el precio: ' + JSON.stringify(ue).slice(0, 300));
    log('✅ Precio actualizado:');
    d.productVariantsBulkUpdate.productVariants.forEach(v => console.log(`     - SKU=${v.sku || '—'}  nuevo precio=$${v.price}`));
    return;
  }

  throw new Error(`ACCION desconocida: "${ACCION}". Usa 'buscar' o 'precio'.`);
})().catch(e => { console.error('❌ ERROR:', e.message); process.exit(1); });
