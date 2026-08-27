/** VALIDACION (no escribe en la hoja): arma las filas consolidadas de un SUBCONJUNTO
 *  de productos y las imprime, para revisar columnas/colores/categorias antes de cablear. */
const { obtenerProductosShopify } = require('./obtener-productos-shopify');
const { consultar, login } = require('./dropi-cloud');
const { construirConsolidado, ENCABEZADOS } = require('./consolidado');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cfg = { STORE: process.env.SHOPIFY_STORE, CID: process.env.SHOPIFY_CLIENT_ID, CS: process.env.SHOPIFY_CLIENT_SECRET };
  const { productos, sinDropi, sinSku } = await obtenerProductosShopify(cfg);
  console.log(`Shopify: ${productos.length} productos con Dropi (sin Dropi: ${sinDropi}, sin sku: ${sinSku})`);

  const wanted = ['2200263','2131722','2020534','1892231','2168890','1929828','2184575'];
  const porId = new Map(productos.map((p) => [p.dropiId, p]));
  const subset = [];
  for (const id of wanted) if (porId.has(id)) subset.push(porId.get(id));
  // + primeros que tengan categoria, para ver T/U con dato real
  for (const p of productos) { if (subset.length >= 14) break; if (!p.esComponente && !subset.includes(p)) subset.push(p); }
  console.log(`Subconjunto de prueba: ${subset.length} productos\n`);

  const token = await login();
  const datos = [];
  for (const p of subset) { datos.push(await consultar(p.dropiId, token)); await sleep(400); }

  const cons = construirConsolidado(subset, datos);
  const H = ENCABEZADOS;
  for (let i = 0; i < cons.filas.length; i++) {
    const f = cons.filas[i];
    console.log('--- ' + f[2].slice(0, 50));
    console.log(`  A_id=${f[0]} B_sku=${f[1]} D_nombreDropi=${String(f[3]).slice(0,28)}`);
    console.log(`  E_stock=${f[4]} F_privNuestro=${f[5]} G_privOtros=${f[6]} H_activo=${f[7]} I_arch=${f[8]} J_estado=${f[9]}`);
    console.log(`  K_prov=${String(f[10]).slice(0,20)} L_bodega=${String(f[11]).slice(0,18)} N_ciudad=${f[13]}`);
    console.log(`  O_costo=${f[14]} P_utilidad=${f[15]} Q_enKit=${f[16]} R_invCmp=${f[17]} S_varSimple=${f[18]}`);
    console.log(`  T_cat=${f[19]} U_sub=${String(f[20]).slice(0,40)}`);
    console.log(`  COLOR=${cons.colors[i] || '(ninguno)'} | catRed=${cons.catRed[i]} subRed=${cons.subRed[i]} invRed=${cons.invRed[i]} | M_wa=${f[12] ? 'link' : 'vacio'}`);
  }
  console.log('\n=== TOTALES ===');
  console.log(JSON.stringify(cons.totales, null, 0));
})().catch((e) => { console.error('ERROR:', e.message); console.error(e.stack); process.exit(1); });
