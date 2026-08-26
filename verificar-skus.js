/**
 * Verifica que las variantes que TENIAN SKU sigan teniendolo.
 *
 * Motivo: el 2026-08-26, entre las 15:03 y las 16:53, un proceso no identificado
 * borro el SKU de 45 variantes (los 15 productos multiunidad y 4 kits). El SKU es
 * la llave con la que Dropi empareja los pedidos ({idDropi}-{n}); sin el, la orden
 * entra con "Esta orden no tiene productos dropi" y no se despacha. Se detecto solo
 * porque un pedido alcanzo a pasar 16 segundos antes del borrado.
 *
 * Este chequeo compara el catalogo vivo contra skus-respaldo.json y falla la corrida
 * si alguna variante perdio su SKU, para que GitHub Actions notifique por correo.
 *
 * SOLO AVISA: no restaura nada. Para restaurar, ver el respaldo y aplicar a mano.
 *
 * Regenerar el respaldo despues de un cambio legitimo de SKUs:
 *   ~/.shopify/generar-respaldo-skus.ps1
 */
const fs = require('fs');
const path = require('path');

const API = '2025-01';
const RESPALDO = path.join(__dirname, 'skus-respaldo.json');
const log = (m) => console.log(`[skus] ${m}`);

async function gql(store, tok, query, variables) {
  const r = await fetch(`https://${store}/admin/api/${API}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': tok },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors).slice(0, 200));
  return j.data;
}

async function token(store, cid, cs) {
  const r = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cid, client_secret: cs, grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('no se obtuvo access_token');
  return j.access_token;
}

const QUERY = `query($c:String){
  products(first:100, after:$c, query:"status:active"){
    pageInfo{ hasNextPage endCursor }
    edges{ node{ title handle variants(first:20){ edges{ node{ title sku } } } } }
  }
}`;

async function verificarSkus() {
  try {
    const { SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = process.env;
    if (!SHOPIFY_STORE || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
      log('faltan credenciales de Shopify; chequeo omitido.');
      return;
    }
    if (!fs.existsSync(RESPALDO)) {
      log(`no existe ${path.basename(RESPALDO)}; chequeo omitido.`);
      return;
    }

    const respaldo = JSON.parse(fs.readFileSync(RESPALDO, 'utf8'));
    log(`respaldo: ${respaldo.length} variantes con SKU`);

    const tok = await token(SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET);

    // estado vivo: handle||variante -> sku
    const vivo = new Map();
    let cursor = null;
    do {
      const d = await gql(SHOPIFY_STORE, tok, QUERY, { c: cursor });
      for (const { node: p } of d.products.edges) {
        for (const { node: v } of p.variants.edges) {
          vivo.set(`${p.handle}||${v.title}`, v.sku || '');
        }
      }
      cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    } while (cursor);
    log(`catalogo vivo: ${vivo.size} variantes activas`);

    const borrados = [];
    const cambiados = [];
    const ausentes = [];

    for (const r of respaldo) {
      const clave = `${r.handle}||${r.variante}`;
      if (!vivo.has(clave)) { ausentes.push(r); continue; }
      const actual = vivo.get(clave);
      if (!actual) borrados.push(r);
      else if (actual !== r.sku) cambiados.push({ ...r, actual });
    }

    if (ausentes.length) {
      log(`nota: ${ausentes.length} variantes del respaldo ya no existen (producto borrado, despublicado o variante renombrada).`);
      for (const a of ausentes.slice(0, 10)) log(`   ausente: ${a.handle} [${a.variante}]`);
    }
    if (cambiados.length) {
      log(`nota: ${cambiados.length} variantes cambiaron de SKU (no es error, pero conviene revisar).`);
      for (const c of cambiados.slice(0, 10)) log(`   cambio: ${c.handle} [${c.variante}] ${c.sku} -> ${c.actual}`);
    }

    if (!borrados.length) {
      log(`OK: ninguna variante perdio su SKU.`);
      return;
    }

    log('');
    log(`ALERTA: ${borrados.length} variantes PERDIERON su SKU. Sus pedidos van a fallar en Dropi`);
    log('con "Esta orden no tiene productos dropi". Restaurar desde skus-respaldo.json.');
    log('');
    for (const b of borrados) {
      log(`   ${b.handle} [${b.variante}]  sku perdido: ${b.sku}`);
      log(`      ${b.titulo}`);
    }
    process.exitCode = 1;
  } catch (e) {
    log('error del chequeo (no fatal): ' + e.message);
  }
}

if (require.main === module) verificarSkus();

module.exports = { verificarSkus };
