/** DEBUG: estructura COMPLETA de stock privado (para columnas F/G: nuestro vs no-nuestro). */
const IDS = (process.env.IDS ? process.env.IDS.split(',') : []).map(s=>s.trim()).filter(Boolean);
const EMAIL = process.env.DROPI_EMAIL, PASSWORD = process.env.DROPI_PASSWORD;
function apiHeaders(t){return{'Authorization':'Bearer '+t,'Accept':'application/json','Origin':'https://app.dropi.co','Referer':'https://app.dropi.co/','Accept-Language':'es-419','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36','sec-ch-ua':'"Chromium";v="127", "Not)A;Brand";v="99"','sec-ch-ua-mobile':'?0','sec-ch-ua-platform':'"Windows"','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-site','Sec-Fetch-Dest':'empty'};}
async function login(){const r=await fetch('https://api-v2.dropi.co/bff/auth/core/login',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({email:EMAIL,password:PASSWORD,white_brand_id:1,brand:'',ipAddress:'',otp:null,with_cdc:false})});const j=await r.json().catch(()=>({}));const t=j&&j.data&&j.data.token;if(!t)throw new Error('login fallo');return t;}
(async()=>{
  const t=await login();
  for(const id of IDS){
    const r=await fetch(`https://api.dropi.co/api/products/productlist/v1/show/?id=${id}`,{headers:apiHeaders(t)});
    const d=await r.json().catch(()=>({}));
    if(!d.isSuccess||!d.objects){ console.log(`\n=== ${id}: NO ===`); continue; }
    const o=d.objects;
    console.log(`\n=== ${id}: ${(o.name||'').slice(0,40)} | tipo=${o.type} ===`);
    console.log(`  TODAS las claves con 'priv','stock','invent','warehouse','store': ${Object.keys(o).filter(k=>/priv|stock|invent|warehouse|store/i.test(k)).join(', ')}`);
    console.log(`  stock=${o.stock} | privated_product=${o.privated_product}`);
    console.log(`  private_product_inventories=${JSON.stringify(o.private_product_inventories)}`);
    console.log(`  private_product_inventories_rest=${JSON.stringify(o.private_product_inventories_rest)}`);
    const wp=o.warehouse_product||[];
    console.log(`  warehouse_product (${wp.length}):`);
    for(const w of wp.slice(0,3)){ console.log(`     ${JSON.stringify(w).slice(0,300)}`); }
    const vars=o.variations||[];
    if(vars.length){
      console.log(`  variacion[0] claves priv/stock: ${Object.keys(vars[0]).filter(k=>/priv|stock|invent|warehouse/i.test(k)).join(', ')}`);
      console.log(`     ${JSON.stringify(vars[0]).slice(0,400)}`);
    }
    await new Promise(r=>setTimeout(r,400));
  }
})().catch(e=>{console.log('ERROR '+e.message);process.exitCode=1;});
