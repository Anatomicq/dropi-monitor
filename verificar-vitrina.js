/**
 * Verifica que la VITRINA PUBLICA refleje la disponibilidad que reporta el Admin.
 * Toma una muestra de variantes que segun Dropi tienen stock, ubica su producto en
 * Shopify (por SKU) y consulta el JSON publico del storefront para confirmar que la
 * variante aparezca comprable (available: true).
 *
 * Motivo: el 2026-08-20 el servicio de disponibilidad de la vitrina de Shopify se
 * congelo (admin correcto, tienda mostrando "agotado") y paso mas de un dia sin
 * detectarse. Este chequeo lo convierte en una alerta de ~1 hora.
 *
 * Modo estricto: con la variable de entorno STRICT_VITRINA=1, una discrepancia marca
 * exit code 1 y GitHub Actions notifica por correo. Mantener APAGADO mientras el bug
 * original siga abierto con soporte de Shopify (alertaria en cada corrida).
 */
const DOMINIO_PUBLICO = 'https://www.anatomicq.com';
const MUESTRA = 3;
const API = '2025-01';
const log = (m) => console.log(`[vitrina] ${m}`);

async function gql(STORE, t, query, variables) {
  const r = await fetch(`https://${STORE}/admin/api/${API}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': t },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors).slice(0, 200));
  return j.data;
}
async function token(STORE, CID, CS) {
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CID, client_secret: CS, grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('sin token');
  return j.access_token;
}

/**
 * @param {Object} cfg { STORE, CID, CS }
 * @param {Map<string,number>} stockPorId  clave (id Dropi o id de variacion) -> stock
 */
async function verificarVitrina(cfg, stockPorId) {
  const { STORE, CID, CS } = cfg;
  if (!STORE) return;
  try {
    // muestra: claves con stock suficiente (>=5) para que "comprable" sea lo esperado
    const candidatas = [...stockPorId.entries()].filter(([, s]) => Number(s) >= 5).map(([k]) => String(k));
    if (!candidatas.length) { log('sin candidatas con stock; se omite.'); return; }
    const t = await token(STORE, CID, CS);
    const muestra = [];
    for (const clave of candidatas) {
      if (muestra.length >= MUESTRA) break;
      const d = await gql(STORE, t,
        'query($q:String){ productVariants(first:1, query:$q){ edges{ node{ sku product{ handle status } } } } }',
        { q: `sku:${clave}` });
      const e = d.productVariants.edges[0];
      if (e && e.node.product.status === 'ACTIVE') muestra.push({ sku: e.node.sku, handle: e.node.product.handle });
      await new Promise(r => setTimeout(r, 150));
    }
    if (!muestra.length) { log('ninguna candidata activa en Shopify; se omite.'); return; }

    const fallas = [];
    for (const m of muestra) {
      try {
        const r = await fetch(`${DOMINIO_PUBLICO}/products/${m.handle}.js`, { redirect: 'follow' });
        if (!r.ok) { fallas.push(`${m.handle}: HTTP ${r.status}`); continue; }
        const j = await r.json();
        const v = (j.variants || []).find(x => String(x.sku).trim() === m.sku);
        if (!v) { fallas.push(`${m.handle}: SKU ${m.sku} no aparece en la pagina`); continue; }
        if (v.available !== true) fallas.push(`${m.handle} [${m.sku}]: con stock en Dropi/Admin pero NO comprable en la vitrina`);
      } catch (e) { fallas.push(`${m.handle}: ${e.message}`); }
      await new Promise(r => setTimeout(r, 300));
    }

    if (!fallas.length) { log(`OK: ${muestra.length} variantes de muestra comprables en la vitrina.`); return; }
    for (const f of fallas) log('⚠️ DISCREPANCIA: ' + f);
    log('⚠️ La vitrina publica NO refleja el inventario del Admin. Si persiste 2+ corridas, contactar soporte de Shopify.');
    if (process.env.STRICT_VITRINA === '1') {
      log('modo estricto: marcando la corrida como fallida para que GitHub notifique.');
      process.exitCode = 1;
    }
  } catch (e) {
    log('error del chequeo (no fatal): ' + e.message);
  }
}

module.exports = { verificarVitrina };
