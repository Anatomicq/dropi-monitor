/** DEBUG: ficha completa de productos Dropi (para comparar proveedores). */
const IDS = (process.env.IDS ? process.env.IDS.split(',') : []).map(s=>s.trim()).filter(Boolean);
const EMAIL = process.env.DROPI_EMAIL, PASSWORD = process.env.DROPI_PASSWORD;
function apiHeaders(t){return{'Authorization':'Bearer '+t,'Accept':'application/json','Origin':'https://app.dropi.co','Referer':'https://app.dropi.co/','Accept-Language':'es-419','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36','sec-ch-ua':'"Chromium";v="127", "Not)A;Brand";v="99"','sec-ch-ua-mobile':'?0','sec-ch-ua-platform':'"Windows"','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-site','Sec-Fetch-Dest':'empty'};}
async function login(){const r=await fetch('https://api-v2.dropi.co/bff/auth/core/login',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({email:EMAIL,password:PASSWORD,white_brand_id:1,brand:'',ipAddress:'',otp:null,with_cdc:false})});const j=await r.json().catch(()=>({}));const t=j&&j.data&&j.data.token;if(!t)throw new Error('login fallo');return t;}
(async()=>{
  const t=await login();
  for(const id of IDS){
    const r=await fetch(`https://api.dropi.co/api/products/productlist/v1/show/?id=${id}`,{headers:apiHeaders(t)});
    const d=await r.json().catch(()=>({}));
    if(!d.isSuccess||!d.objects){ console.log(`\n=== ${id}: NO ENCONTRADO ===`); continue; }
    const o=d.objects, u=o.user||{}, vars=o.variations||[];
    const wh=((o.warehouse_product&&o.warehouse_product[0])||{}).warehouse||{};
    console.log(`\n=== ${id} ===`);
    console.log(`  nombre: ${o.name}`);
    console.log(`  tipo=${o.type} | stock=${o.stock} | nVars=${vars.length}`);
    console.log(`  precio_proveedor=${o.sale_price} | sugerido=${o.suggested_price}`);
    console.log(`  activo=${!!o.active} | archivado=${!!o.archived} | acepta_pedidos=${!!o.orders} | eliminado=${o.deleted_at!=null}`);
    console.log(`  privado=${!!o.privated_product} | stock_privado=${o.private_product_inventories_rest}`);
    console.log(`  proveedor: ${(u.name||'')} ${(u.surname||'')} | tel=${u.phone||''} | tienda=${u.store_name||''}`);
    console.log(`  bodega: ${wh.name||''} | ciudad: ${(wh.city&&wh.city.name)||''}`);
    console.log(`  sku=${JSON.stringify(o.sku)}`);
    await new Promise(r=>setTimeout(r,400));
  }
})().catch(e=>{console.log('ERROR '+e.message);process.exitCode=1;});
