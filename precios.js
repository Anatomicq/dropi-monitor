/**
 * Analisis de precios: consulta el precio del PROVEEDOR en Dropi para cada
 * producto de productos.json y lo envia a la pestaña "Análisis de precios"
 * del Sheet (matriz: fila = producto, columna = fecha). El Apps Script pinta
 * en rojo el precio que cambio respecto a la columna anterior.
 * Corre 1 vez al dia (12:00 Colombia) desde .github/workflows/dropi.yml.
 * Variables de entorno: DROPI_EMAIL, DROPI_PASSWORD, SHEETS_WEBAPP_URL, SHEETS_SECRET
 */
const fs = require('fs');
const { consultarLote } = require('./reintentos');

const EMAIL = process.env.DROPI_EMAIL;
const PASSWORD = process.env.DROPI_PASSWORD;
const WEBAPP = process.env.SHEETS_WEBAPP_URL;
const SECRET = process.env.SHEETS_SECRET || '';

const log = (m) => console.log(`[precios] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (!token) throw new Error('Login fallo (' + res.status + ')');
  return token;
}

async function precioDe(id, token) {
  try {
    const res = await fetch(`https://api.dropi.co/api/products/productlist/v1/show/?id=${id}`, { headers: apiHeaders(token) });
    if (!res.ok) {
      const ra = Number(res.headers.get('retry-after'));
      return { ok: false, status: res.status, retryAfter: ra > 0 ? ra : null };
    }
    const data = await res.json();
    if (!data.isSuccess || !data.objects) return { ok: false, permanente: true };
    const o = data.objects;
    if (Array.isArray(o.variations) && o.variations.length) {
      const precios = o.variations.map((v) => parseFloat(v.sale_price || 0)).filter((p) => p > 0);
      return { ok: true, dato: precios.length ? Math.min(...precios) : null };
    }
    const p = parseFloat(o.sale_price || 0);
    return { ok: true, dato: p > 0 ? p : null };
  } catch { return { ok: false }; }
}

async function main() {
  if (!EMAIL || !PASSWORD || !WEBAPP) throw new Error('Faltan variables de entorno.');
  const productos = JSON.parse(fs.readFileSync(__dirname + '/productos.json', 'utf8'));
  log(`Consultando precio de proveedor de ${productos.length} productos...`);
  const token = await login();

  const lista = productos.filter((p) => String(p.dropiId || '').trim());
  const ids = lista.map((p) => String(p.dropiId).trim());
  const resultados = await consultarLote(ids, (id) => precioDe(id, token), log);

  const filas = [];
  let sinPrecio = 0;
  for (let i = 0; i < lista.length; i++) {
    const r = resultados[i];
    const precio = r && r.ok ? r.dato : null;
    if (precio === null) sinPrecio++;
    filas.push({ id: ids[i], nombre: (lista[i].titulo || '').slice(0, 60), precio: precio === null ? '' : Math.round(precio) });
  }
  log(`Listo: ${filas.length} filas (${sinPrecio} sin precio).`);

  const fecha = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' });
  const r = await fetch(WEBAPP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: SECRET, tipo: 'precios', fecha, precios: filas }),
    redirect: 'follow',
  });
  const txt = await r.text();
  let ok = false; try { ok = JSON.parse(txt).ok; } catch {}
  if (ok) log('✅ Pestaña "Análisis de precios" actualizada.');
  else { log('⚠️ Respuesta del Sheet: ' + txt.slice(0, 200)); process.exitCode = 1; }
}

main().catch((e) => { log('❌ ' + e.message); process.exitCode = 1; });
