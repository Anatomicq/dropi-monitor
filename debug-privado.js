/** DEBUG: vuelca los campos de producto PRIVADO / stock privado de Dropi. */
const IDS = (process.env.IDS ? process.env.IDS.split(',') : []).map(s=>s.trim()).filter(Boolean);
const EMAIL = process.env.DROPI_EMAIL, PASSWORD = process.env.DROPI_PASSWORD;
function apiHeaders(t){return{'Authorization':'Bearer '+t,'Accept':'application/json','Origin':'https://app.dropi.co','Referer':'https://app.dropi.co/','Accept-Language':'es-419','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36','sec-ch-ua':'"Chromium";v="127", "Not)A;Brand";v="99"','sec-ch-ua-mobile':'?0','sec-ch-ua-platform':'"Windows"','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-site','Sec-Fetch-Dest':'empty'};}
async function login(){const r=await fetch('https://api-v2.dropi.co/bff/auth/core/login',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({email:EMAIL,password:PASSWORD,white_brand_id:1,brand:'',ipAddress:'',otp:null,with_cdc:false})});const j=await r.json().catch(()=>({}));const t=j&&j.data&&j.data.token;if(!t)throw new Error('login fallo');return t;}
(async()=>{
  const t=await login();
  for(const id of IDS){
    const r=await fetch(`https://api.dropi.co/api/products/productlist/v1/show/?id=${id}`,{headers:apiHeaders(t)});
    const d=await r.json().catch(()=>({}));
    if(!d.isSuccess||!d.objects){ console.log(`${id}: NO`); continue; }
    const o=d.objects;
    const vars=o.variations||[];
    console.log(`\n=== ${id}: ${(o.name||'').slice(0,40)} ===`);
    console.log(`  privated_product=${JSON.stringify(o.privated_product)} | type=${o.type} | stock=${o.stock}`);
    console.log(`  private_product_inventories=${JSON.stringify(o.private_product_inventories)}`);
    console.log(`  private_product_inventories_rest=${JSON.stringify(o.private_product_inventories_rest)}`);
    // claves que contengan 'priv'
    const kp = Object.keys(o).filter(k=>/priv/i.test(k));
    console.log(`  claves con 'priv' en producto: ${kp.join(', ')}`);
    if(vars.length){
      const v=vars[0];
      const kv = Object.keys(v).filter(k=>/priv/i.test(k));
      console.log(`  variacion[0]: claves priv = ${kv.join(', ')}`);
      for(const k of kv) console.log(`     ${k} = ${JSON.stringify(v[k])}`);
      const sumRest = vars.reduce((s,x)=>s+(Number(x.private_product_inventories_rest)||0),0);
      console.log(`  suma private_product_inventories_rest de ${vars.length} variaciones = ${sumRest}`);
    }
    await new Promise(r=>setTimeout(r,400));
  }
})().catch(e=>{console.log('ERROR '+e.message);process.exitCode=1;});
