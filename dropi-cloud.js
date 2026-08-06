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

const EMAIL      = process.env.DROPI_EMAIL;
const PASSWORD   = process.env.DROPI_PASSWORD;
const WEBAPP_URL = process.env.SHEETS_WEBAPP_URL;
const SECRET     = process.env.SHEETS_SECRET || '';
// Dropi bloquea si se le consulta muy rápido. Vamos SECUENCIAL y pausado,
// igual que la versión con navegador que logró 303/307.
const PAUSA_MS   = 350;    // pausa entre cada producto
const PAUSA_BLOQUEO = 90000; // si detecta bloqueo (varios fallos seguidos), espera 90s
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
    if (!res.ok) return { existe: false, error: 'HTTP ' + res.status };
    const data = await res.json();
    if (!data.isSuccess || !data.objects) return { existe: false, error: 'Respuesta inválida' };
    const o = data.objects;
    const bod = (o.warehouse_product && o.warehouse_product[0]) || {};
    const wh = bod.warehouse || {};
    return {
      existe: true, nombre: o.name, stock: o.stock == null ? 0 : o.stock,
      activo: !!o.active, archivado: !!o.archived, aceptaPedidos: !!o.orders, eliminado: o.deleted_at != null,
      precioBase: parseFloat(o.sale_price || 0), precioSug: parseFloat(o.suggested_price || 0),
      bodega: wh.name || 'Sin bodega', ciudad: (wh.city && wh.city.name) || '',
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
  return [
    prod.dropiId, prod.sku, prod.titulo, d.existe ? d.nombre : '—', d.existe ? d.stock : '—',
    d.existe ? (d.activo ? 'Sí' : 'No') : '—', d.existe ? (d.aceptaPedidos ? 'Sí' : 'No') : '—',
    d.existe ? (d.archivado ? 'Sí' : 'No') : '—', d.existe ? (d.eliminado ? 'Sí' : 'No') : '—',
    prod.shopifyStatus, d.existe ? d.bodega : '—', d.existe ? d.ciudad : '—',
    d.existe ? d.precioBase : 0, d.existe ? d.precioSug : 0, estado, notas,
  ];
}

async function main() {
  if (!EMAIL || !PASSWORD || !WEBAPP_URL) throw new Error('Faltan variables de entorno (DROPI_EMAIL, DROPI_PASSWORD, SHEETS_WEBAPP_URL).');
  const productos = JSON.parse(fs.readFileSync(path.join(__dirname, 'productos.json'), 'utf8'));
  log(`Productos: ${productos.length}. Iniciando login...`);
  const token = await login();
  log('Login OK. Consultando productos...');

  const encabezados = ['ID Dropi','SKU Shopify','Producto Shopify','Nombre en Dropi','Stock','Activo',
    'Acepta Pedidos','Archivado','Eliminado','Estado Shopify','Bodega','Ciudad',
    'Precio Base','Precio Sugerido','Estado General','Notas'];

  // "Respuesta inválida" = el producto de verdad no existe en la cuenta (no reintentar).
  // Cualquier otro fallo (HTTP 4xx, error de red) = bloqueo temporal → reintentar.
  const esReintentable = (d) => !d.existe && d.error && !/inválida/i.test(d.error);

  const datos = new Array(productos.length).fill(null);
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
        if (seguidosFallo >= 6) {
          log(`⏸️ Bloqueo temporal detectado. Esperando 90s para el enfriamiento...`);
          await sleep(PAUSA_BLOQUEO);
          seguidosFallo = 0;
          d = await consultar(productos[i].dropiId, token);
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
  const conStock = datos.filter(d => d.existe);
  const resumen = {
    total: productos.length,
    sinStock: conStock.filter(d => d.stock === 0).length,
    stockBajo: conStock.filter(d => d.stock > 0 && d.stock <= 10).length,
    noEncontrados: datos.filter(d => !d.existe).length,
  };
  log(`Resultado → sin stock: ${resumen.sinStock} | bajo: ${resumen.stockBajo} | no encontrados: ${resumen.noEncontrados}`);

  const timestamp = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  const r = await fetch(WEBAPP_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: SECRET, timestamp, resumen, rows: filas }),
    redirect: 'follow',
  });
  const txt = await r.text();
  let ok = false; try { ok = JSON.parse(txt).ok; } catch {}
  if (ok) log('✅ Hoja de Google actualizada.');
  else { log('⚠️ Respuesta inesperada de la hoja: ' + txt.slice(0, 200)); process.exitCode = 1; }
}

main().catch(e => { console.error('❌ ERROR:', e.message); process.exit(1); });
