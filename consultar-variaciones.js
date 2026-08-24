/**
 * DEBUG puntual: imprime los campos completos de las variaciones de los 9
 * productos variables (¿tienen sku/barcode/referencia propios?) para decidir
 * el esquema de emparejamiento con la integracion de Dropi.
 * Se ejecuta a mano (workflow_dispatch en debug-variaciones.yml). No toca nada.
 */
const IDS = ['2131722', '1732654', '2002145', '1774055', '256314', '656702', '1178596', '1587864', '1584324'];

const EMAIL = process.env.DROPI_EMAIL;
const PASSWORD = process.env.DROPI_PASSWORD;

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
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
    });
    const d = await res.json().catch(() => ({}));
    if (!d.isSuccess || !d.objects) { console.log(`\n=== ${id}: NO ENCONTRADO ===`); continue; }
    const o = d.objects;
    console.log(`\n=== ${id}: ${(o.name || '').slice(0, 60)} ===`);
    console.log(`producto: sku=${JSON.stringify(o.sku)} barcode=${JSON.stringify(o.barcode)} reference=${JSON.stringify(o.reference)} type=${JSON.stringify(o.type)}`);
    const vars = o.variations || [];
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
