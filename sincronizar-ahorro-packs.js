/**
 * Recalcula el ahorro real de cada pack de cantidad y lo guarda en el producto,
 * para que la tarjeta lo muestre antes de que el cliente entre.
 *
 * Por qué en el monitor: el porcentaje se congela al calcularlo. Si el dueño
 * cambia el precio de un pack y nadie recalcula, la tarjeta sigue anunciando un
 * descuento que ya no es cierto — el mismo problema que nos hizo quitar los
 * precios tachados. Aquí se revisa en cada corrida.
 *
 * ⚠️ EL CÁLCULO CORRECTO ES nivel / NIVEL BASE, no el número de la etiqueta.
 * Los parches van X10/X20/X30 y el masajeador X2/X4/X6: usar el número literal
 * daba 93% y 73% de ahorro, cifras falsas. Contra el nivel base dan 35% y 46%.
 *
 * Escribe custom.ahorro_pct y custom.ahorro_texto, y SOLO cuando cambian.
 * Si un porcentaje sale por encima del tope, no lo escribe y avisa: es señal
 * de que el cálculo se rompió, y es preferible no anunciar nada que mentir.
 *
 * Equivalente manual: ~/.shopify/ahorro-packs.ps1
 */
const API = '2025-01';
const TOPE_SOSPECHOSO = 60;   // por encima de esto se asume error de cálculo
const MINIMO_PARA_ANUNCIAR = 5;
const log = (m) => console.log(`[ahorro-packs] ${m}`);

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
      id title status
      bundleComponents(first:3){ edges{ node{ componentProduct{ id } } } }
      variants(first:20){ edges{ node{ title price } } }
      pct: metafield(namespace:"custom", key:"ahorro_pct"){ value }
      texto: metafield(namespace:"custom", key:"ahorro_texto"){ value }
    } }
  }
}`;

const M = `mutation($m:[MetafieldsSetInput!]!){
  metafieldsSet(metafields:$m){ metafields{ id } userErrors{ field message } }
}`;

function unidades(etiqueta) {
  const m = String(etiqueta || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function sincronizarAhorroPacks(cfg) {
  const { STORE, CID, CS } = cfg;
  const t = await token(STORE, CID, CS);

  const pendientes = [];
  let packs = 0, sospechosos = 0, cursor = null, pagina = 0;
  do {
    const d = await gql(STORE, t, Q, { c: cursor });
    for (const e of d.products.edges) {
      const n = e.node;
      // un pack de cantidad tiene exactamente UN componente; con 2+ es un kit
      if ((n.bundleComponents?.edges || []).length !== 1) continue;
      if (n.status !== 'ACTIVE') continue;

      const niveles = (n.variants?.edges || [])
        .map((v) => ({ u: unidades(v.node.title), precio: Number(v.node.price) }))
        .filter((x) => x.u && x.precio > 0)
        .sort((a, b) => a.u - b.u);
      if (niveles.length < 2) continue;
      packs++;

      const base = niveles[0];
      let mejorPct = 0, mejorMult = 0;
      for (const nivel of niveles) {
        const mult = Math.round(nivel.u / base.u);
        if (mult <= 1) continue;
        const sinDescuento = base.precio * mult;
        const pct = Math.round((1 - nivel.precio / sinDescuento) * 100);
        if (pct > mejorPct) { mejorPct = pct; mejorMult = mult; }
      }

      if (mejorPct > TOPE_SOSPECHOSO) {
        sospechosos++;
        log(`⚠️ ${mejorPct}% en "${n.title.slice(0, 45)}" supera el tope: no se anuncia`);
        continue;
      }
      if (mejorPct < MINIMO_PARA_ANUNCIAR) continue;

      const texto = `Ahorra ${mejorPct}% llevando ${mejorMult}`;
      const pctViejo = n.pct?.value || '';
      const textoViejo = n.texto?.value || '';
      if (pctViejo === String(mejorPct) && textoViejo === texto) continue;

      pendientes.push({ id: n.id, titulo: n.title, pct: String(mejorPct), texto });
    }
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    pagina++;
  } while (cursor && pagina < 60);

  if (!pendientes.length) {
    log(`${packs} packs revisados, ninguno cambió` + (sospechosos ? `, ${sospechosos} descartados por tope` : ''));
    return { packs, actualizados: 0, sospechosos };
  }

  // el API acepta 25 metafields por llamada y aquí van 2 por producto
  let escritos = 0;
  for (let i = 0; i < pendientes.length; i += 12) {
    const lote = [];
    for (const p of pendientes.slice(i, i + 12)) {
      lote.push({ ownerId: p.id, namespace: 'custom', key: 'ahorro_pct', type: 'number_integer', value: p.pct });
      lote.push({ ownerId: p.id, namespace: 'custom', key: 'ahorro_texto', type: 'single_line_text_field', value: p.texto });
    }
    const d = await gql(STORE, t, M, { m: lote });
    const ue = d.metafieldsSet.userErrors || [];
    if (ue.length) throw new Error('metafieldsSet: ' + JSON.stringify(ue).slice(0, 200));
    escritos += (d.metafieldsSet.metafields || []).length;
  }

  for (const p of pendientes.slice(0, 5)) log(`${p.texto} -> ${p.titulo.slice(0, 45)}`);
  if (pendientes.length > 5) log(`... y ${pendientes.length - 5} más`);
  log(`${packs} packs revisados, ${pendientes.length} actualizados (${escritos} metafields)`);
  return { packs, actualizados: pendientes.length, sospechosos };
}

module.exports = { sincronizarAhorroPacks };
