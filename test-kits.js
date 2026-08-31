const { reportarKits } = require('./reporte-kits');
(async () => {
  await reportarKits(
    { STORE: process.env.SHOPIFY_STORE, CID: process.env.SHOPIFY_CLIENT_ID, CS: process.env.SHOPIFY_CLIENT_SECRET },
    process.env.SHEETS_WEBAPP_URL, process.env.SHEETS_SECRET
  );
})();
