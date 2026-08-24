/**
 * DEBUG puntual: imprime los campos completos de las variaciones de los 9
 * productos variables (¿tienen sku/barcode/referencia propios?) para decidir
 * el esquema de emparejamiento con la integracion de Dropi.
 * Se ejecuta a mano (workflow_dispatch en debug-variaciones.yml). No toca nada.
 */
// Por defecto: los 9 variables. Se puede sobreescribir con la env IDS (coma-separada).
const IDS = (process.env.IDS
  ? process.env.IDS.split(',').map((s) => s.trim()).filter(Boolean)
  : ['2131722', '1732654', '2002145', '1774055', '256314', '656702', '1178596', '1587864', '1584324']);

const EMAIL = process.env.DROPI_EMAIL;
const PASSWORD = process.env.DROPI_PASSWORD;

// Dropi rechaza peticiones sin cabeceras de navegador (mismas de precios.js).
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

async function main() {
  const token = await login();
  for (const id of IDS) {
    const res = await fetch(`https://api.dropi.co/api/products/productlist/v1/show/?id=${id}`, {
      headers: apiHeaders(token),
    });
    const d = await res.json().catch(() => ({}));
    if (!d.isSuccess || !d.objects) { console.log(`\n=== ${id}: NO ENCONTRADO ===`); continue; }
    const o = d.objects;
    const vars = o.variations || [];
    const stockTotal = vars.length ? vars.reduce((s, v) => s + (Number(v.stock) || 0), 0) : (Number(o.stock) || 0);
    console.log(`\n=== ${id}: ${(o.name || '').slice(0, 55)} ===`);
    console.log(`  TYPE=${o.type} | stock_total=${stockTotal} | nVars=${vars.length} | sku=${JSON.stringify(o.sku)}`);
    console.log(`variaciones: ${vars.length}`);
    for (const v of vars.slice(0, 6)) {
      const attrs = (v.attribute_values || []).map((a) => `${a.attribute_name || a.attribute || '?'}=${a.value}`).join(';');
      console.log(`  - id=${v.id} sku=${JSON.stringify(v.sku)} barcode=${JSON.stringify(v.barcode)} reference=${JSON.stringify(v.reference)} attrs=[${attrs}] stock=${v.stock}`);
    }
    if (vars.length) console.log(`  campos de una variacion: ${Object.keys(vars[0]).join(', ')}`);
    if (vars.length && vars[0].attribute_values && vars[0].attribute_values.length) {
      console.log(`  campos de attribute_values[0]: ${Object.keys(vars[0].attribute_values[0]).join(', ')}`);
      console.log(`  attribute_values[0] completo: ${JSON.stringify(vars[0].attribute_values[0])}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

main().catch((e) => { console.log('ERROR: ' + e.message); process.exitCode = 1; });
