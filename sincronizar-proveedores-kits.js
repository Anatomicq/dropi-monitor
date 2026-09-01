/**
 * Guarda en cada kit/pack el metafield  custom.proveedores  con los vendors
 * REALES de sus componentes.
 *
 * Por qué existe: el vendor de un bundle en Shopify es "ANATOMICQ" (no un
 * proveedor real) y Liquid NO puede ver los componentes de un bundle — la
 * línea del carrito solo expone `has_components`, sin la lista. Sin este
 * metafield, el aviso de envío del carrito contaba 1 proveedor donde hay 4
 * o 5, y un carrito con solo un kit no mostraba nada.
 *
 * Ojo: el COBRO del checkout nunca dependió de esto. Shopify sí expande los
 * bundles antes de pedirle la tarifa al carrier service (api/shipping-rates.js
 * del proyecto anatomicq-shipping), así que el envío siempre se cobró bien.
 * Esto solo alinea lo que el cliente LEE con lo que se le va a cobrar.
 *
 * Por qué en el monitor: los componentes de un kit cambian cuando el dueño
 * edita el bundle, y nadie se acuerda de correr un script después. Aquí se
 * revisa en cada corrida. Escribe SOLO los que cambiaron, así que lo normal
 * es que no escriba nada.
 *
 * Equivalente manual: ~/.shopify/proveedores-de-kits.ps1
 */
const API = '2025-01';
const log = (m) => console.log(`[proveedores-kits] ${m}`);

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
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': t },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors).slice(0, 200));
  return j.data;
}

const Q = `query($c:String){
  products(first:100, after:$c){
    pageInfo{ hasNextPage endCursor }
    edges{ node{
      id
      title
      status
      tags
      bundleComponents(first:25){ edges{ node{ componentProduct{ vendor } } } }
      metafield(namespace:"custom", key:"proveedores"){ value }
    } }
  }
}`;

const M = `mutation($m:[MetafieldsSetInput!]!){
  metafieldsSet(metafields:$m){ metafields{ id } userErrors{ field message } }
}`;

const M_TAG = `mutation($id:ID!,$t:[String!]!){
  tagsAdd(id:$id, tags:$t){ userErrors{ message } }
}`;

async function sincronizarProveedoresKits(cfg) {
  const { STORE, CID, CS } = cfg;
  const t = await token(STORE, CID, CS);

  // ── 1) recorrer productos y quedarnos con los que tienen componentes ──
  const pendientes = [];
  const sinEtiquetaKit = [];
  let bundles = 0, cursor = null, pagina = 0;
  do {
    const d = await gql(STORE, t, Q, { c: cursor });
    for (const e of d.products.edges) {
      const n = e.node;
      const comps = n.bundleComponents?.edges || [];
      if (!comps.length) continue;
      bundles++;

      // Un kit es, sin ambigüedad, un producto con 2+ componentes distintos.
      // (Con 1 componente es un pack de cantidad: x2, x3 del mismo producto,
      // y ESE no lleva etiqueta kit.) Sin la etiqueta, el reordenamiento de
      // colecciones lo mandaría al bloque de aplicables, al fondo.
      if (comps.length >= 2 && n.status === 'ACTIVE' && !(n.tags || []).includes('kit')) {
        sinEtiquetaKit.push({ id: n.id, titulo: n.title });
      }

      // vendors de los componentes: sin vacíos, sin repetidos y ordenados
      // (el orden fijo permite comparar contra lo ya guardado como texto)
      const vendors = [...new Set(
        comps.map((c) => (c?.node?.componentProduct?.vendor || '').trim()).filter(Boolean),
      )].sort();
      if (!vendors.length) continue;

      const nuevo = JSON.stringify(vendors);
      if ((n.metafield?.value || '') !== nuevo) {
        pendientes.push({ ownerId: n.id, titulo: n.title, value: nuevo });
      }
    }
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    pagina++;
  } while (cursor && pagina < 60);

  // ── 2) poner la etiqueta 'kit' a los kits nuevos ──
  let etiquetados = 0;
  for (const k of sinEtiquetaKit) {
    const d = await gql(STORE, t, M_TAG, { id: k.id, t: ['kit'] });
    const ue = d.tagsAdd.userErrors || [];
    if (ue.length) throw new Error('tagsAdd: ' + JSON.stringify(ue).slice(0, 200));
    etiquetados++;
    log(`etiquetado como kit: ${k.titulo.slice(0, 55)}`);
  }

  if (!pendientes.length) {
    log(`${bundles} kits/packs revisados, ninguno cambió` +
        (etiquetados ? `, ${etiquetados} etiquetados como kit` : ''));
    return { bundles, actualizados: 0, etiquetados };
  }

  // ── 3) escribir solo los que cambiaron ──
  let escritos = 0;
  for (let i = 0; i < pendientes.length; i += 25) {
    const lote = pendientes.slice(i, i + 25).map((p) => ({
      ownerId: p.ownerId,
      namespace: 'custom',
      key: 'proveedores',
      type: 'list.single_line_text_field',
      value: p.value,
    }));
    const d = await gql(STORE, t, M, { m: lote });
    const ue = d.metafieldsSet.userErrors || [];
    if (ue.length) throw new Error('metafieldsSet: ' + JSON.stringify(ue).slice(0, 200));
    escritos += (d.metafieldsSet.metafields || []).length;
  }

  for (const p of pendientes.slice(0, 5)) log(`actualizado: ${p.titulo.slice(0, 55)}`);
  if (pendientes.length > 5) log(`... y ${pendientes.length - 5} más`);
  log(`${bundles} kits/packs revisados, ${escritos} actualizados` +
      (etiquetados ? `, ${etiquetados} etiquetados como kit` : ''));
  return { bundles, actualizados: escritos, etiquetados };
}

module.exports = { sincronizarProveedoresKits };
