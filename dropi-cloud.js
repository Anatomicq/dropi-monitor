/**
 * Agente Dropi para la NUBE (GitHub Actions / VPS). 100% HTTP, sin navegador.
 * Login → consulta los productos con headers de navegador → envía a la hoja
 * de Google mediante un Apps Script "web app" (doPost) que solo escribe.
 *
 * Configuración por variables de entorno (GitHub Secrets):
 *   DROPI_EMAIL, DROPI_PASSWORD, SHEETS_WEBAPP_URL, SHEETS_SECRET
 * Los productos se leen de productos.json (incluido en el repo).
 */
const fs = require('fs');
const path = require('path');
const { actualizarStockShopify } = require('./actualizar-shopify');
const { obtenerProductosShopify } = require('./obtener-productos-shopify');

const EMAIL      = process.env.DROPI_EMAIL;
const PASSWORD   = process.env.DROPI_PASSWORD;
const WEBAPP_URL = process.env.SHEETS_WEBAPP_URL;
const SECRET     = process.env.SHEETS_SECRET || '';
// Dropi bloquea si se le consulta muy rápido. Vamos SECUENCIAL y pausado,
// igual que la versión con navegador que logró 303/307.
const PAUSA_MS   = 350;    // pausa entre cada producto
// Enfriamiento adaptativo ante bloqueo por rate-limit de Dropi:
const BLOQUEO_UMBRAL   = 4;      // fallos seguidos para declarar bloqueo (antes 6: detectamos antes)
const COOLDOWN_INICIAL = 60000;  // primera espera de enfriamiento (antes fijo 90s)
const COOLDOWN_MAX     = 120000; // tope de espera si hay que escalar
const MAX_RONDAS = 4;      // rondas de reintento para recuperar los bloqueados

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Headers que exige el filtro de api.dropi.co (User-Agent de navegador + client-hints).
function apiHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/json',
    'Origin': 'https://app.dropi.co',
    'Referer': 'https://app.dropi.co/',
    'Accept-Language': 'es-419',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Dest': 'empty',
  };
}

async function login() {
  const res = await fetch('https://api-v2.dropi.co/bff/auth/core/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, white_brand_id: 1, brand: '', ipAddress: '', otp: null, with_cdc: false }),
  });
  const j = await res.json().catch(() => ({}));
  const token = j && j.data && j.data.token;
  if (!token) throw new Error('Login falló (' + res.status + '): ' + JSON.stringify(j).slice(0, 200));
  return token;
}

async function consultar(id, token) {
  try {
    const res = await fetch(`https://api.dropi.co/api/products/productlist/v1/show/?id=${id}`, { headers: apiHeaders(token) });
    if (!res.ok) {
      const ra = Number(res.headers.get('retry-after'));
      return { existe: false, error: 'HTTP ' + res.status, status: res.status, retryAfter: (ra > 0 ? ra : null) };
    }
    const data = await res.json();
    if (!data.isSuccess || !data.objects) return { existe: false, error: 'Respuesta inválida' };
    const o = data.objects;
    const esVariable = Array.isArray(o.variations) && o.variations.length > 0;

    let stock, precioBase, precioSug, wh, nVariaciones = 0;
    if (esVariable) {
      // Producto con tallas/colores: el stock vive en cada variante → sumarlas.
      nVariaciones = o.variations.length;
      stock = o.variations.reduce((s, v) => s + (Number(v.stock) || 0), 0);
      const v0 = o.variations[0] || {};
      precioBase = parseFloat(v0.sale_price || o.sale_price || 0);
      precioSug  = parseFloat(v0.suggested_price || o.suggested_price || 0);
      const wpv = (v0.warehouse_product_variation && v0.warehouse_product_variation[0]) || {};
      wh = wpv.warehouse || {};
    } else {
      stock = o.stock == null ? 0 : o.stock;
      precioBase = parseFloat(o.sale_price || 0);
      precioSug  = parseFloat(o.suggested_price || 0);
      const bod = (o.warehouse_product && o.warehouse_product[0]) || {};
      wh = bod.warehouse || {};
    }

    // Proveedor (supplier): vive en objects.user → name + surname, y su teléfono/WhatsApp en user.phone.
    const u = o.user || {};
    const proveedor = ((u.name || '') + ' ' + (u.surname || '')).trim() || (u.email || 'Sin proveedor');
    const telefono = u.phone ? String(u.phone) : '';

    return {
      existe: true, nombre: o.name, stock,
      activo: !!o.active, archivado: !!o.archived, aceptaPedidos: !!o.orders, eliminado: o.deleted_at != null,
      precioBase, precioSug,
      proveedor, telefono,
      bodega: wh.name || 'Sin bodega', ciudad: (wh.city && wh.city.name) || '',
      esVariable, nVariaciones,
    };
  } catch (e) {
    return { existe: false, error: e.message };
  }
}

function fila(prod, d) {
  let estado = '✅ OK', notas = '';
  if (!d.existe)              { estado = '❌ No encontrado'; notas = d.error; }
  else if (d.eliminado)      { estado = '❌ Eliminado';   notas = 'Eliminado en Dropi'; }
  else if (d.archivado)      { estado = '❌ Archivado';   notas = 'Archivado en Dropi'; }
  else if (!d.activo)        { estado = '❌ Inactivo';    notas = 'Inactivo en Dropi'; }
  else if (!d.aceptaPedidos) { estado = '❌ Sin pedidos'; notas = 'No acepta pedidos'; }
  else if (d.stock === 0)    { estado = '🔴 Sin stock';   notas = 'Stock en 0'; }
  else if (d.stock <= 10)    { estado = '⚠️ Stock bajo';  notas = 'Solo ' + d.stock + ' unidades'; }
  if (d.esVariable) notas = (notas ? notas + ' | ' : '') + 'Variable: ' + d.nVariaciones + ' variantes (stock sumado)';
  return [
    prod.dropiId, prod.sku, prod.titulo, d.existe ? d.nombre : '—', d.existe ? d.stock : '—',
    d.existe ? (d.activo ? 'Sí' : 'No') : '—',
    d.existe ? (d.archivado ? 'Sí' : 'No') : '—',
    prod.shopifyStatus,
    d.existe ? d.proveedor : '—', d.existe ? d.telefono : '—',
    d.existe ? d.bodega : '—', d.existe ? d.ciudad : '—',
    d.existe ? d.precioBase : 0, d.existe ? d.precioSug : 0, estado, notas,
  ];
}

async function main() {
  if (!EMAIL || !PASSWORD || !WEBAPP_URL) throw new Error('Faltan variables de entorno (DROPI_EMAIL, DROPI_PASSWORD, SHEETS_WEBAPP_URL).');

  // Lista de productos AUTOMÁTICA desde Shopify (detecta agregados/editados/quitados).
  // Si Shopify falla, se usa la lista fija productos.json como respaldo.
  let productos;
  if (process.env.SHOPIFY_STORE) {
    try {
      const r = await obtenerProductosShopify({ STORE: process.env.SHOPIFY_STORE, CID: process.env.SHOPIFY_CLIENT_ID, CS: process.env.SHOPIFY_CLIENT_SECRET });
      productos = r.productos;
      log(`Lista automática desde Shopify: ${productos.length} productos (ignorados sin Dropi: ${r.sinDropi}, sin SKU: ${r.sinSku}).`);
    } catch (e) {
      log('⚠️ No pude leer productos de Shopify (' + e.message + '). Uso la lista fija de respaldo.');
    }
  }
  if (!productos || !productos.length) {
    productos = JSON.parse(fs.readFileSync(path.join(__dirname, 'productos.json'), 'utf8'));
    log(`Lista fija (respaldo): ${productos.length} productos.`);
  }
  log(`Productos: ${productos.length}. Iniciando login...`);
  const token = await login();
  log('Login OK. Consultando productos...');

  const encabezados = ['ID Dropi','SKU Shopify','Producto Shopify','Nombre en Dropi','Stock','Activo',
    'Archivado','Estado Shopify','Proveedor','WhatsApp','Bodega','Ciudad',
    'Precio Base','Precio Sugerido','Estado General','Notas'];

  // "Respuesta inválida" = el producto de verdad no existe en la cuenta (no reintentar).
  // Cualquier otro fallo (HTTP 4xx, error de red) = bloqueo temporal → reintentar.
  const esReintentable = (d) => !d.existe && d.error && !/inválida/i.test(d.error);

  const datos = new Array(productos.length).fill(null);
  let cooldown = COOLDOWN_INICIAL; // se adapta según lo que tarde en liberarse el bloqueo
  for (let ronda = 1; ronda <= MAX_RONDAS; ronda++) {
    const pend = [];
    for (let i = 0; i < productos.length; i++) if (!datos[i] || esReintentable(datos[i])) pend.push(i);
    if (pend.length === 0) break;
    log(`Ronda ${ronda}: ${pend.length} por consultar...`);

    let seguidosFallo = 0, progreso = 0;
    for (let j = 0; j < pend.length; j++) {
      const i = pend[j];
      let d = await consultar(productos[i].dropiId, token);

      if (esReintentable(d)) {
        seguidosFallo++;
        if (seguidosFallo >= BLOQUEO_UMBRAL) {
          // Cuánto esperar: si Dropi mandó Retry-After lo respetamos; si no, cooldown adaptativo.
          let espera = cooldown;
          if (d.retryAfter) espera = Math.min(d.retryAfter * 1000 + 2000, COOLDOWN_MAX);
          log(`⏸️ Bloqueo detectado (HTTP ${d.status || '?'}${d.retryAfter ? `, retry-after=${d.retryAfter}s` : ''}). Esperando ${Math.round(espera / 1000)}s...`);
          await sleep(espera);
          seguidosFallo = 0;
          d = await consultar(productos[i].dropiId, token); // sonda: ¿ya se liberó?
          if (esReintentable(d)) {
            cooldown = Math.min(Math.round(cooldown * 1.5), COOLDOWN_MAX); // aún bloqueado: la próxima espera más
          } else {
            cooldown = COOLDOWN_INICIAL; // se liberó: volvemos a la espera base para no sobre-esperar
          }
        }
      } else {
        seguidosFallo = 0;
      }

      if (d.existe && (!datos[i] || !datos[i].existe)) progreso++;
      if (d.existe || !datos[i]) datos[i] = d;
      if ((j + 1) % 25 === 0 || j + 1 === pend.length) log(`  ${j + 1}/${pend.length}`);
      await sleep(PAUSA_MS);
    }

    const restantes = productos.filter((p, i) => esReintentable(datos[i])).length;
    log(`Fin ronda ${ronda}. Recuperados: ${progreso} | reintentables restantes: ${restantes}`);
    if (progreso === 0) { log('Sin progreso en esta ronda; me detengo.'); break; }
  }
  for (let i = 0; i < productos.length; i++) if (!datos[i]) datos[i] = { existe: false, error: 'sin dato' };

  const filas = [encabezados, ...productos.map((p, i) => fila(p, datos[i]))];

  // Pestaña Resumen: categorías por stock, cada una con la lista de productos.
  // Cada fila de detalle: [ID Dropi, Nombre del producto, Proveedor, Stock].
  // Rangos: sin stock = 0 | bajo = 1–50 | medio = 51–99 | (100+ NO se listan en Resumen).
  const filaResumen = (i, d) => [
    productos[i].dropiId,
    productos[i].titulo,
    d.existe ? d.proveedor : '—',
    d.existe ? d.stock : '—',
  ];
  const catSinStock = [], catBajo = [], catMedio = [], catNoEnc = [];
  for (let i = 0; i < productos.length; i++) {
    const d = datos[i];
    if (!d.existe) { catNoEnc.push(filaResumen(i, d)); continue; }
    const s = Number(d.stock) || 0;
    if (s === 0)       catSinStock.push(filaResumen(i, d));
    else if (s <= 50)  catBajo.push(filaResumen(i, d));
    else if (s <= 99)  catMedio.push(filaResumen(i, d));
    // 100+ unidades: no se agregan al Resumen (sí aparecen en la pestaña Inventario).
  }
  const resumen = {
    total: productos.length,
    conteos: {
      sinStock:      catSinStock.length,
      stockBajo:     catBajo.length,
      stockMedio:    catMedio.length,
      noEncontrados: catNoEnc.length,
    },
    categorias: {
      sinStock:      catSinStock,   // 0 unidades
      stockBajo:     catBajo,       // 1–50
      stockMedio:    catMedio,      // 51–99
      noEncontrados: catNoEnc,      // no existen en Dropi
    },
  };
  log(`Resultado → sin stock: ${resumen.conteos.sinStock} | bajo(1-50): ${resumen.conteos.stockBajo} | medio(51-99): ${resumen.conteos.stockMedio} | no encontrados: ${resumen.conteos.noEncontrados}`);

  const timestamp = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  const payload = JSON.stringify({ secret: SECRET, timestamp, resumen, rows: filas });

  // El web app de Apps Script a veces devuelve una página HTML (no JSON) por un hipo temporal
  // de Google, y eso tumbaba toda la corrida. Reintentamos varias veces antes de rendirnos.
  const INTENTOS_HOJA = 3;
  const PAUSA_HOJA = 5000; // 5s entre intentos
  let hojaOK = false;
  for (let intento = 1; intento <= INTENTOS_HOJA; intento++) {
    try {
      const r = await fetch(WEBAPP_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: payload, redirect: 'follow',
      });
      const txt = await r.text();
      let ok = false; try { ok = JSON.parse(txt).ok; } catch {}
      if (ok) { hojaOK = true; log('✅ Hoja de Google actualizada.'); break; }
      log(`⚠️ Intento ${intento}/${INTENTOS_HOJA}: respuesta inesperada de la hoja (HTTP ${r.status}): ` + txt.slice(0, 120).replace(/\s+/g, ' '));
    } catch (e) {
      log(`⚠️ Intento ${intento}/${INTENTOS_HOJA}: error de red al escribir la hoja: ` + e.message);
    }
    if (intento < INTENTOS_HOJA) await sleep(PAUSA_HOJA);
  }
  if (!hojaOK) { log(`❌ No se pudo actualizar la hoja tras ${INTENTOS_HOJA} intentos.`); process.exitCode = 1; }

  // Empujar el MISMO stock a Shopify (emparejando por SKU). Solo productos que existen en Dropi.
  if (process.env.SHOPIFY_STORE) {
    try {
      // La clave es el ID de Dropi, que en Shopify vive en el campo "codigo de barras"
      // (y desde la limpieza de agosto 2026, tambien en el SKU). El SKU antiguo era
      // texto libre y estaba duplicado en 10 grupos, por eso ya no se usa como clave.
      const stockPorId = new Map();
      for (let i = 0; i < productos.length; i++) {
        const d = datos[i];
        const id = productos[i].dropiId && String(productos[i].dropiId).trim();
        if (id && d && d.existe) stockPorId.set(id, d.stock);
      }
      log(`Actualizando stock en Shopify (${stockPorId.size} productos)...`);
      await actualizarStockShopify({
        STORE: process.env.SHOPIFY_STORE,
        CID: process.env.SHOPIFY_CLIENT_ID,
        CS: process.env.SHOPIFY_CLIENT_SECRET,
      }, stockPorId);
    } catch (e) {
      log('⚠️ No se pudo actualizar Shopify: ' + e.message);
    }
  } else {
    log('SHOPIFY_STORE no configurado; se omite la actualización de Shopify.');
  }
}

main().catch(e => { console.error('❌ ERROR:', e.message); process.exit(1); });
