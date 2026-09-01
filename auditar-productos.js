/**
 * Auditoría automática de productos (2x/día, GitHub Actions).
 * Revisa el checklist de "producto perfecto" de ANATOMICQ:
 *   identidad (SKU/código de barras/monitor Dropi), clasificación (etiquetas,
 *   tipo, categorías/subcategorías, kits), contenido (SEO, descripción, imagen,
 *   precio) y colores del mapa de swatches.
 *
 * AUTO-ARREGLA lo mecánico: título SEO, tipo de producto, etiqueta tecnologico/aplicable.
 * Lo que requiere criterio humano solo se MARCA con la etiqueta 'revisar'
 * (y se desmarca solo cuando el producto vuelve a pasar).
 *
 * Env: SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
 * Opcional: AUDIT_AUTOFIX=0 para solo marcar sin corregir nada.
 */
const fs = require('fs');
const path = require('path');

const STORE = process.env.SHOPIFY_STORE;
const CID = process.env.SHOPIFY_CLIENT_ID;
const CS = process.env.SHOPIFY_CLIENT_SECRET;
const AUTOFIX = process.env.AUDIT_AUTOFIX !== '0';
// Margen mínimo aceptable sobre el precio de venta (%). Ajustable por variable
// de entorno sin tocar el código: AUDIT_MARGEN=35
const MARGEN_MINIMO = Number(process.env.AUDIT_MARGEN || 25);
// Días que un borrador puede quedarse sin publicar antes de avisar.
const DIAS_BORRADOR = Number(process.env.AUDIT_DIAS_BORRADOR || 14);
// Aviso por correo (via el Apps Script de la hoja, que envia con MailApp):
const WEBAPP_URL = process.env.SHEETS_WEBAPP_URL;
const SECRET = process.env.SHEETS_SECRET || '';
const API = '2025-01';
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COLORES_MAPA = ['negro', 'blanco', 'rojo', 'azul', 'verde', 'rosado', 'rosa', 'fucsia', 'beige', 'marron'];
const TIPOS = {
  supl: 'Suplementos y vitaminas', tech: 'Tecnología y dispositivos',
  capilar: 'Cuidado capilar', piel: 'Cuidado de la piel',
  fitness: 'Fitness y entrenamiento', dolor: 'Alivio y recuperación',
  sueno: 'Descanso y relajación',
};
const TIPOS_VALIDOS = Object.values(TIPOS);

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const RX_TECH = /electric|electronic|digital|inalambric|recargable|bateria|usb|\bled\b|laser|infrarroj|ultrason|radiofrecuencia|alta\s*frecuencia|vibrad|vibraci|masajead|masajeador|pistola|dispositiv|maquina|aparato|monitor|tensiometr|glucometr|oximetr|bascula|balanza|termometr|plancha|secador|rizador|alisador|depilad|humidificad|difusor|lampara|proyector|audifon|smartwatch|reloj\s|banda\s*el|estimulad|electroestim|\btens\b|compresor|bomba|calentad|manta\s*termica|almohadilla\s*termica|fomentera|caminadora|bicicleta|pedalera|eliptica|\bems\b|cepillo\s*(el|secador|ttt|de\s*radio)|pulse\s*stim|antifaz\s*bluetooth|dermapen|microaguj|espatula|fotones|fototerap|microcorriente|\bipl\b|gua\s*sha|vaporizador|bluetooth|smart\s*hand/;
const RX_INGERIBLE = /capsul|gomita|gummi|vitamin|colageno|collagen|magnesi|melatonin|proteina|whey|creatin|ashwagandha|suplement|gotas|jalea|resina|probiotic|prebiotic|omega|multivitam|shilajit|maca\b|inositol|berberin|valerian|melena de leon|citrato|biotina|turkesterone|nad\+|resveratrol|espirulina|cleanse|yerba|mate\b|oil of oregano|te verde/;

async function token() {
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CID, client_secret: CS, grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Sin token: ' + JSON.stringify(j).slice(0, 150));
  return j.access_token;
}
async function gql(t, query, variables) {
  const r = await fetch(`https://${STORE}/admin/api/${API}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': t },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

function seoDesdeTitulo(titulo) {
  const t = (titulo || '').trim();
  const mKit = t.match(/^\s*((?:Kit|Combo)[^:]*)\s*:/i);
  if (mKit) return mKit[1].trim();
  const i = t.lastIndexOf(' - ');
  if (i >= 0) {
    const nombre = t.substring(i + 3).trim();
    if (nombre.length >= 8) return nombre;
  }
  return t.slice(0, 60);
}

async function main() {
  if (!STORE || !CID || !CS) throw new Error('Faltan credenciales.');
  const productosJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'productos.json'), 'utf8'));
  const dropiIds = new Set(productosJson.map((p) => String(p.dropiId).trim()));
  const mapa = JSON.parse(fs.readFileSync(path.join(__dirname, 'categorias.json'), 'utf8'));
  const catHandles = new Set(mapa.map((c) => c.categoria));
  const subHandles = new Set(mapa.flatMap((c) => c.subs));
  const kitsHandleDeCat = (cat) => 'kits-' + cat;

  const t = await token();
  log(`Auditoría iniciada. Monitor Dropi: ${dropiIds.size} ids. AUTOFIX=${AUTOFIX}`);

  const Q = `query($c:String){ products(first:50, after:$c){ pageInfo{hasNextPage endCursor}
    edges{ node{
      id title handle status tags productType onlineStoreUrl createdAt
      description
      seo{ title }
      featuredMedia{ id }
      options{ name values }
      variants(first:50){ edges{ node{ sku barcode price compareAtPrice inventoryItem{ tracked unitCost{ amount } } } } }
      collections(first:40){ edges{ node{ handle } } }
    } } } }`;

  const prods = [];
  let cur = null, pg = 0;
  do {
    const d = await gql(t, Q, { c: cur });
    for (const e of d.products.edges) prods.push(e.node);
    cur = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    pg++;
  } while (cur && pg < 30);
  const activos = prods.filter((p) => p.status === 'ACTIVE');
  log(`Productos: ${prods.length} (activos: ${activos.length}; los borradores no se auditan)`);

  // Canal del asesor con IA: sin esto el chat no ve el producto.
  const M_PUBLICAR = `mutation($id:ID!,$p:[PublicationInput!]!){ publishablePublish(id:$id, input:$p){ userErrors{ message } } }`;
  let pubHeadless = null;
  try {
    const dp = await gql(t, `{ publications(first:20){ edges{ node{ id name } } } }`);
    const enc = dp.publications.edges.find((e) => /headless/i.test(e.node.name));
    if (enc) pubHeadless = enc.node.id;
  } catch {}
  log(pubHeadless ? 'Canal del asesor detectado.' : '⚠️ No encontré el canal del asesor (Headless).');

  const M_UPD = `mutation($in:ProductInput!){ productUpdate(input:$in){ product{ id } userErrors{ message } } }`;
  const M_TAG_ADD = `mutation($id:ID!,$t:[String!]!){ tagsAdd(id:$id, tags:$t){ userErrors{ message } } }`;
  const M_TAG_DEL = `mutation($id:ID!,$t:[String!]!){ tagsRemove(id:$id, tags:$t){ userErrors{ message } } }`;

  let fallan = 0, arreglados = 0, marcados = 0, desmarcados = 0, publicados = 0;
  const detalles = []; // para el correo de aviso

  for (const p of activos) {
    const issues = [];
    const tags = p.tags || [];
    const cols = p.collections.edges.map((e) => e.node.handle);
    const vars = p.variants.edges.map((e) => e.node);
    const esKit = tags.includes('kit') || vars.some((v) => (v.sku || '').startsWith('KIT-'));
    const nTitulo = norm(p.title);

    // ── identidad / sincronización ──
    if (!esKit) {
      for (const v of vars) {
        if (!v.barcode) { issues.push('variante sin código de barras (ID Dropi)'); break; }
      }
      for (const v of vars) {
        if (!v.sku) { issues.push('variante sin SKU'); break; }
        if (v.barcode && v.sku !== v.barcode && !v.sku.startsWith(v.barcode + '-')) {
          issues.push(`SKU '${v.sku}' no deriva del código de barras '${v.barcode}'`); break;
        }
      }
      const bar = vars[0] && vars[0].barcode ? String(vars[0].barcode).trim() : '';
      if (bar && !dropiIds.has(bar)) issues.push('no está en productos.json del monitor Dropi (su stock no se sincroniza)');
    } else {
      if (!tags.includes('kit')) issues.push("es kit (SKU KIT-*) pero le falta la etiqueta 'kit'");
    }

    // ── clasificación ──
    const tieneTech = tags.includes('tecnologico');
    const tieneApl = tags.includes('aplicable');
    const fixes = { tagsAdd: [], tagsDel: [], update: {} };
    if (tieneTech && tieneApl) {
      const esTech = RX_TECH.test(nTitulo);
      fixes.tagsDel.push(esTech ? 'aplicable' : 'tecnologico');
    } else if (!tieneTech && !tieneApl) {
      fixes.tagsAdd.push(RX_TECH.test(nTitulo) ? 'tecnologico' : 'aplicable');
    }

    if (!TIPOS_VALIDOS.includes(p.productType)) {
      let tipo = null;
      if (RX_INGERIBLE.test(nTitulo)) tipo = TIPOS.supl;
      else if (tieneTech || RX_TECH.test(nTitulo)) tipo = TIPOS.tech;
      else if (cols.includes('capilar')) tipo = TIPOS.capilar;
      else if (cols.includes('skincare')) tipo = TIPOS.piel;
      else if (cols.includes('fitness-en-casa')) tipo = TIPOS.fitness;
      else if (cols.includes('recuperacion-muscular')) tipo = TIPOS.dolor;
      else if (cols.includes('sueno-y-descanso')) tipo = TIPOS.sueno;
      else if (cols.includes('control-de-peso')) tipo = TIPOS.supl;
      if (tipo) fixes.update.productType = tipo;
      else issues.push(`tipo de producto sin normalizar ('${p.productType || 'vacío'}') y sin categoría para deducirlo`);
    }

    const enCats = cols.filter((h) => catHandles.has(h));
    const enSubs = cols.filter((h) => subHandles.has(h));
    if (enCats.length === 0) issues.push('no está en ninguna categoría');
    if (enSubs.length === 0) issues.push('no está en ninguna subcategoría');
    if (esKit) {
      for (const c of enCats) {
        if (c !== 'capilar' && !cols.includes(kitsHandleDeCat(c))) {
          issues.push(`kit fuera de la colección kits-${c}`);
        }
      }
    }

    // ── contenido ──
    if (!p.seo || !p.seo.title || !p.seo.title.trim()) fixes.update.seo = { title: seoDesdeTitulo(p.title) };
    if (!p.description || p.description.trim().length < 40) issues.push('descripción vacía o muy corta');
    if (!p.featuredMedia) issues.push('sin imagen');
    if (!p.onlineStoreUrl) issues.push('no publicado en la tienda online');
    // El asesor con IA lee por Storefront API del canal "Anatomicq Headless":
    // un producto fuera de ese canal existe en la tienda pero es INVISIBLE
    // para el chat, así que nunca lo puede ofrecer.
    const canales = (p.resourcePublicationsV2?.edges || [])
      .filter((e) => e.node.isPublished)
      .map((e) => e.node.publication.name);
    // Guard: sin el scope read_publications no consultamos canales; omitimos el chequeo.
    const faltaHeadless = p.resourcePublicationsV2 && !canales.some((c) => /headless/i.test(c));
    if (faltaHeadless) {
      if (AUTOFIX && pubHeadless) {
        try {
          await gql(t, M_PUBLICAR, { id: p.id, p: [{ publicationId: pubHeadless }] });
          publicados++;
          log(`  📡 ${p.title.slice(0, 58)} -> publicado en el canal del asesor`);
          await sleep(150);
        } catch (e) {
          issues.push('no se pudo publicar en el canal del asesor: ' + e.message.slice(0, 60));
        }
      } else {
        issues.push('no publicado en el canal del asesor (Anatomicq Headless): el chat no puede ofrecerlo');
      }
    }
    for (const v of vars) {
      if (!(parseFloat(v.price) > 0)) { issues.push('precio en 0'); break; }
      if (v.compareAtPrice && parseFloat(v.compareAtPrice) <= parseFloat(v.price)) { issues.push('precio "antes" menor o igual al precio actual (descuento falso)'); break; }
      if (v.inventoryItem && v.inventoryItem.tracked === false) { issues.push('inventario sin rastrear'); break; }
    }

    // ── margen sobre el costo de Dropi (lo carga el monitor 5x/día) ──
    for (const v of vars) {
      const costo = v.inventoryItem?.unitCost ? Number(v.inventoryItem.unitCost.amount) : null;
      const precio = parseFloat(v.price);
      if (!costo || !(costo > 0) || !(precio > 0)) continue;
      const margen = ((precio - costo) / precio) * 100;
      const fmt = (n) => '$' + Math.round(n).toLocaleString('es-CO');
      if (precio <= costo) {
        issues.push(`VENDE A PÉRDIDA o sin ganancia: precio ${fmt(precio)} vs costo ${fmt(costo)}`);
        break;
      }
      if (margen < MARGEN_MINIMO) {
        issues.push(`margen bajo: ${margen.toFixed(0)}% (precio ${fmt(precio)}, costo ${fmt(costo)}) — mínimo esperado ${MARGEN_MINIMO}%`);
        break;
      }
    }

    // ── colores ──
    for (const o of p.options || []) {
      if (/^(color|colores|colour)$/i.test(o.name)) {
        for (const v of o.values) {
          if (!COLORES_MAPA.includes(norm(v))) issues.push(`color '${v}' no está en el mapa de swatches del tema`);
        }
      }
    }

    // ── aplicar auto-arreglos ──
    const hayFix = fixes.tagsAdd.length || fixes.tagsDel.length || Object.keys(fixes.update).length;
    if (AUTOFIX && hayFix) {
      try {
        if (fixes.tagsDel.length) await gql(t, M_TAG_DEL, { id: p.id, t: fixes.tagsDel });
        if (fixes.tagsAdd.length) await gql(t, M_TAG_ADD, { id: p.id, t: fixes.tagsAdd });
        if (Object.keys(fixes.update).length) await gql(t, M_UPD, { in: { id: p.id, ...fixes.update } });
        arreglados++;
        log(`  🔧 ${p.title.slice(0, 60)} -> ${[...fixes.tagsAdd.map(x=>'+'+x), ...fixes.tagsDel.map(x=>'-'+x), ...Object.keys(fixes.update)].join(', ')}`);
        await sleep(150);
      } catch (e) { issues.push('fallo el auto-arreglo: ' + e.message.slice(0, 80)); }
    } else if (!AUTOFIX && hayFix) {
      if (fixes.tagsAdd.length || fixes.tagsDel.length) issues.push('falta etiqueta tecnologico/aplicable correcta');
      if (fixes.update.seo) issues.push('sin título SEO');
      if (fixes.update.productType) issues.push('tipo de producto sin normalizar');
    }

    // ── marcar / desmarcar 'revisar' ──
    const marcado = tags.includes('revisar');
    if (issues.length) {
      fallan++;
      detalles.push({ producto: p.title, handle: p.handle, problemas: issues });
      log(`  ❌ ${p.title.slice(0, 64)}`);
      for (const i of issues) log(`       - ${i}`);
      if (!marcado) { try { await gql(t, M_TAG_ADD, { id: p.id, t: ['revisar'] }); marcados++; await sleep(120); } catch {} }
    } else if (marcado) {
      try { await gql(t, M_TAG_DEL, { id: p.id, t: ['revisar'] }); desmarcados++; await sleep(120); } catch {}
    }
  }

  log('');
  log('════════ RESUMEN ════════');
  log(`Auditados     : ${activos.length}`);
  log(`Con problemas : ${fallan}  (etiquetados 'revisar': +${marcados} nuevos)`);
  log(`Auto-arreglos : ${arreglados}`);
  log(`Publicados al canal del asesor: ${publicados}`);
  log(`Recuperados   : ${desmarcados} (pasaron y se les quitó 'revisar')`);
  // ── duplicados: mismo código de barras o título casi idéntico ──
  const porBarcode = new Map();
  const porTitulo = new Map();
  const normTit = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const p of prods) {
    if (p.status === 'ARCHIVED') continue;
    for (const e of p.variants.edges) {
      const bc = (e.node.barcode || '').trim();
      if (!bc) continue;
      if (!porBarcode.has(bc)) porBarcode.set(bc, new Set());
      porBarcode.get(bc).add(p.title);
    }
    const k = normTit(p.title);
    if (!k) continue;
    if (!porTitulo.has(k)) porTitulo.set(k, []);
    porTitulo.get(k).push(`[${p.status}] ${p.title}`);
  }
  const dupBar = [...porBarcode.entries()].filter(([, s]) => s.size > 1);
  const dupTit = [...porTitulo.entries()].filter(([, a]) => a.length > 1);
  if (dupBar.length || dupTit.length) {
    log('');
    log(`Duplicados detectados: ${dupBar.length} por código de barras, ${dupTit.length} por título`);
    for (const [bc, set] of dupBar) {
      const lista = [...set];
      log(`  ❌ código de barras ${bc} en ${lista.length} productos distintos`);
      for (const t2 of lista) log(`       - ${t2.slice(0, 66)}`);
      detalles.push({
        producto: `[duplicado] código de barras ${bc}`,
        problemas: [`el mismo ID de Dropi está en ${lista.length} productos: ${lista.map((x) => x.slice(0, 44)).join(' | ')}. El stock se escribirá en uno solo.`],
      });
      fallan++;
    }
    for (const [, arr] of dupTit) {
      log(`  ❌ título repetido: ${arr[0].slice(0, 60)}`);
      detalles.push({
        producto: `[duplicado] ${arr[0].slice(0, 60)}`,
        problemas: [`hay ${arr.length} productos con el mismo título: ${arr.map((x) => x.slice(0, 40)).join(' | ')}`],
      });
      fallan++;
    }
  }

  // ── borradores olvidados ──
  const ahora = Date.now();
  const borradores = prods.filter((p) => p.status === 'DRAFT' && p.createdAt &&
    (ahora - new Date(p.createdAt).getTime()) / 86400000 > DIAS_BORRADOR);
  if (borradores.length) {
    log('');
    log(`Borradores olvidados (más de ${DIAS_BORRADOR} días sin publicar): ${borradores.length}`);
    for (const p of borradores) {
      const dias = Math.round((ahora - new Date(p.createdAt).getTime()) / 86400000);
      log(`  ⏳ ${p.title.slice(0, 60)} (${dias} días)`);
      detalles.push({
        producto: `[borrador] ${p.title}`,
        problemas: [`lleva ${dias} días en borrador: no se vende ni aparece en la tienda. Publícalo o elimínalo.`],
      });
      fallan++;
    }
  }

  // ── colecciones: canal del asesor + imagen para la tarjeta "Entra Aqui" ──
  const problemasColecciones = [];
  try {
    const QC = `query($c:String){ collections(first:100, after:$c){ pageInfo{hasNextPage endCursor}
      edges{ node{ id title handle image{ url } productsCount{ count } } } } }`;
    let curC = null, pgC = 0;
    do {
      const dc = await gql(t, QC, { c: curC });
      for (const e of dc.collections.edges) {
        const c = e.node;
        if (c.productsCount && c.productsCount.count === 0) continue; // vacías: no molestan
        const cans = (c.resourcePublicationsV2?.edges || [])
          .filter((x) => x.node.isPublished)
          .map((x) => x.node.publication.name);
        const problemas = [];
        if (c.resourcePublicationsV2 && !cans.some((x) => /headless/i.test(x))) {
          if (AUTOFIX && pubHeadless) {
            try {
              await gql(t, M_PUBLICAR, { id: c.id, p: [{ publicationId: pubHeadless }] });
              publicados++;
              log(`  📡 colección ${c.title} -> publicada en el canal del asesor`);
              await sleep(150);
            } catch (err) { problemas.push('no se pudo publicar en el canal del asesor'); }
          } else {
            problemas.push('no publicada en el canal del asesor (el chat no la puede sugerir)');
          }
        }
        // La imagen solo se exige a las SUBCATEGORÍAS del menú: son las que el
        // asesor ofrece como tarjeta "Entra Aquí". Las categorías madre, las
        // colecciones de kits y las sueltas no llevan foto por decisión del negocio.
        if (!c.image && subHandles.has(c.handle)) {
          problemas.push('sin imagen: la tarjeta "Entra Aquí" del asesor saldría sin foto');
        }
        if (problemas.length) problemasColecciones.push({ producto: `[colección] ${c.title}`, handle: c.handle, problemas });
      }
      curC = dc.collections.pageInfo.hasNextPage ? dc.collections.pageInfo.endCursor : null;
      pgC++;
    } while (curC && pgC < 10);
  } catch (e) { log('⚠️ No se pudieron auditar las colecciones: ' + e.message); }

  if (problemasColecciones.length) {
    log('');
    log(`Colecciones con problemas: ${problemasColecciones.length}`);
    for (const c of problemasColecciones) {
      log(`  ❌ ${c.producto}`);
      for (const i of c.problemas) log(`       - ${i}`);
    }
    detalles.push(...problemasColecciones);
    fallan += problemasColecciones.length;
  }

  log('');
  log("En el panel: Productos -> filtrar por etiqueta 'revisar' para ver los pendientes.");

  // ── correo de aviso: SOLO si hay problemas ──
  //
  // ⚠️ SEGURIDAD: el doPost del Apps Script despacha por body.tipo y CUALQUIER
  // payload que no reconozca cae al manejador por defecto, que hace sh.clear()
  // sobre la pestaña "Inventario Dropi" ANTES de mirar si vienen filas. Es decir:
  // mandar este aviso a una versión del script que aún no tenga el manejador
  // `body.auditoria` BORRARÍA el inventario de la hoja.
  // Por eso el envío exige AUDIT_EMAIL=1, que solo debe activarse en el workflow
  // DESPUÉS de desplegar la versión del Apps Script que maneja body.auditoria.
  const correoHabilitado = process.env.AUDIT_EMAIL === '1';
  if (fallan > 0 && WEBAPP_URL && !correoHabilitado) {
    log('');
    log('📧 Aviso por correo DESACTIVADO (AUDIT_EMAIL != 1).');
    log('   Se activa cuando el Apps Script tenga desplegado el manejador body.auditoria;');
    log('   enviarlo antes borraría la pestaña "Inventario Dropi".');
  }
  if (fallan > 0 && WEBAPP_URL && correoHabilitado) {
    const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    try {
      const r = await fetch(WEBAPP_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'follow',
        body: JSON.stringify({
          secret: SECRET,
          // 'tipo' explícito: el doPost del Apps Script despacha por este campo.
          tipo: 'auditoria-correo',
          auditoria: {
            fecha,
            auditados: activos.length,
            conProblemas: fallan,
            autoArreglos: arreglados,
            detalles: detalles.slice(0, 60),
          },
        }),
      });
      const txt = await r.text();
      let ok = false; try { ok = JSON.parse(txt).ok; } catch {}
      log(ok ? '📧 Aviso de auditoría enviado al correo.' : '⚠️ El relay no confirmó el correo: ' + txt.slice(0, 120));
    } catch (e) { log('⚠️ No se pudo enviar el aviso: ' + e.message); }
  } else if (fallan === 0) {
    log('✅ Sin problemas: no se envía correo.');
  }
}

main().catch((e) => { console.error('❌ ERROR:', e.message); process.exit(1); });
