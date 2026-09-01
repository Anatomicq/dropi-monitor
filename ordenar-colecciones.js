/**
 * Mantiene el orden de las colecciones en cada corrida:
 *
 *     1) kits           (etiqueta 'kit')
 *     2) dispositivos   (etiqueta 'tecnologico')
 *     3) aplicables     (el resto: cremas, pastillas, lo que se acaba)
 *
 * Por qué existe: cuando se agrega un producto a una colección, Shopify lo
 * pone al final y el orden se rompe. Antes había que correr un script a mano
 * y nadie se acordaba. Aquí se revisa cada hora, así que un producto nuevo
 * queda en su bloque en menos de una hora sin que nadie haga nada.
 *
 * Dentro de cada bloque CONSERVA el orden que ya tenía la colección, para no
 * perder la curaduría del dueño.
 *
 * Solo reordena las colecciones que están fuera de sitio; si todo está bien
 * no escribe nada. Las colecciones que no estén en orden MANUAL se saltan a
 * propósito: pasarlas a manual es una decisión del dueño, no automática.
 *
 * Ojo con las etiquetas: un producto sin 'tecnologico' ni 'kit' cae al bloque
 * de aplicables. Es el default correcto para la mayoría del catálogo, y la
 * auditoría avisa si a un producto nuevo le falta clasificación.
 *
 * Equivalente manual: ~/.shopify/ordenar-colecciones.ps1
 */
const API = '2025-01';
const log = (m) => console.log(`[orden-colecciones] ${m}`);

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

const Q_COLS = `{ collections(first:60){ edges{ node{ id handle sortOrder } } } }`;
const Q_PROD = `query($id:ID!){ collection(id:$id){ products(first:250){ edges{ node{ id tags } } } } }`;
const M_ORD  = `mutation($id:ID!,$m:[MoveInput!]!){
  collectionReorderProducts(id:$id, moves:$m){ userErrors{ field message } }
}`;

function bloque(tags) {
  const t = tags || [];
  if (t.includes('kit')) return 0;
  if (t.includes('tecnologico')) return 1;
  return 2;
}

async function ordenarColecciones(cfg) {
  const { STORE, CID, CS } = cfg;
  const t = await token(STORE, CID, CS);

  const cols = (await gql(STORE, t, Q_COLS)).collections.edges.map((e) => e.node);
  let revisadas = 0, reordenadas = 0, saltadasNoManual = 0;

  for (const c of cols) {
    if (c.sortOrder !== 'MANUAL') { saltadasNoManual++; continue; }

    const d = await gql(STORE, t, Q_PROD, { id: c.id });
    const prods = d.collection.products.edges.map((e) => e.node);
    if (prods.length < 2) continue;
    revisadas++;

    // orden estable: conserva el orden actual dentro de cada bloque
    const deseado = prods
      .map((p, i) => ({ p, i, b: bloque(p.tags) }))
      .sort((x, y) => (x.b - y.b) || (x.i - y.i))
      .map((x) => x.p);

    const yaEsta = deseado.every((p, i) => p.id === prods[i].id);
    if (yaEsta) continue;

    const moves = deseado.map((p, i) => ({ id: p.id, newPosition: String(i) }));
    for (let i = 0; i < moves.length; i += 250) {
      const r = await gql(STORE, t, M_ORD, { id: c.id, m: moves.slice(i, i + 250) });
      const ue = r.collectionReorderProducts.userErrors || [];
      if (ue.length) throw new Error('reorder: ' + JSON.stringify(ue).slice(0, 200));
    }
    reordenadas++;
    log(`reordenada: ${c.handle} (${prods.length} productos)`);
  }

  log(`${revisadas} colecciones revisadas, ${reordenadas} reordenadas` +
      (saltadasNoManual ? `, ${saltadasNoManual} sin orden manual (se saltan)` : ''));
  return { revisadas, reordenadas, saltadasNoManual };
}

module.exports = { ordenarColecciones };
