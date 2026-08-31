const { armarFilasKits } = require('./reporte-kits');
(async () => {
  try {
    const { rows, stats } = await armarFilasKits({ STORE: process.env.SHOPIFY_STORE, CID: process.env.SHOPIFY_CLIENT_ID, CS: process.env.SHOPIFY_CLIENT_SECRET });
    console.log('OK. filas:', rows.length, '| stats:', JSON.stringify(stats));
    console.log('encabezados:', JSON.stringify(rows[0]));
    console.log('fila datos ejemplo:', JSON.stringify(rows[1]));
  } catch (e) { console.error('ERROR armarFilasKits:', e.message); console.error(e.stack); process.exit(1); }
})();
