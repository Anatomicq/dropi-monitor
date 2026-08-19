/** EXPLORADOR v2 (solo lectura): usa el endpoint POST products/index y vuelca la estructura completa
 *  de un resultado para encontrar stock, proveedor e imagen. Cuenta total de resultados. */
const EMAIL = process.env.DROPI_EMAIL, PASSWORD = process.env.DROPI_PASSWORD;
function apiHeaders(token) {
  return { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'Content-Type': 'application/json',
    'Origin': 'https://app.dropi.co', 'Referer': 'https://app.dropi.co/', 'Accept-Language': 'es-419',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Dest': 'empty' };
}
async function login() {
  const res = await fetch('https://api-v2.dropi.co/bff/auth/core/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, white_brand_id: 1, brand: '', ipAddress: '', otp: null, with_cdc: false }) });
  const j = await res.json().catch(() => ({}));
  return j.data.token;
}
async function search(t, body) {
  const r = await fetch('https://api.dropi.co/api/products/index', { method: 'POST', headers: apiHeaders(t), body: JSON.stringify(body) });
  return r.json();
}
(async () => {
  const t = await login(); console.log('Login OK.\n');
  // 1) Buscar un término común y ver cuántos hay + estructura
  const term = 'kinoki';
  let j = await search(t, { pageSize: 5, startData: 0, textToSearch: term });
  const objs = j.objects || [];
  console.log(`Búsqueda "${term}": count=${j.count} | traídos=${objs.length}`);
  console.log('\n=== TODAS las llaves del primer resultado ===');
  if (objs[0]) console.log(Object.keys(objs[0]).join(', '));
  console.log('\n=== Primer resultado (campos clave) ===');
  if (objs[0]) {
    const o = objs[0];
    console.log('name:', o.name);
    console.log('sku:', o.sku, '| type:', o.type, '| active:', o.active);
    console.log('sale_price:', o.sale_price, '| suggested_price:', o.suggested_price);
    console.log('user_id:', o.user_id);
    console.log('user (proveedor):', o.user ? JSON.stringify({ id: o.user.id, name: o.user.name, surname: o.user.surname, store: o.user.store_name }) : '(no viene user)');
    console.log('stock (raíz):', o.stock);
    console.log('warehouse_product:', o.warehouse_product ? JSON.stringify(o.warehouse_product).slice(0, 300) : '(no)');
    console.log('variations:', Array.isArray(o.variations) ? o.variations.length + ' variaciones' : '(no)');
    console.log('gallery:', o.gallery ? JSON.stringify(o.gallery).slice(0, 250) : '(no)');
    console.log('description (primeros 120):', String(o.description || '').replace(/<[^>]+>/g, ' ').slice(0, 120));
    console.log('categories:', o.categories ? JSON.stringify(o.categories) : '(no)');
  }
  // 2) Ver los 5 resultados resumidos (para ver proveedores distintos y stock)
  console.log('\n=== 5 resultados (resumen) ===');
  objs.forEach((o, i) => {
    const stock = o.stock != null ? o.stock : (o.warehouse_product && o.warehouse_product[0] ? o.warehouse_product[0].stock : '?');
    const prov = o.user ? (o.user.store_name || (o.user.name + ' ' + (o.user.surname || ''))) : ('user_id ' + o.user_id);
    console.log(`  ${i + 1}. id:${o.id} | ${String(o.name).slice(0, 40)} | prov:${prov} | stock:${stock} | $${o.sale_price}`);
  });
  console.log('\n=== FIN ===');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
