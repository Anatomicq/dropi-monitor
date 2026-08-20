/** Compara: nombre de PERSONA (del buscador) vs nombre de TIENDA/proveedor (del detalle show). */
const EMAIL = process.env.DROPI_EMAIL, PASSWORD = process.env.DROPI_PASSWORD;
function H(t){return {'Authorization':'Bearer '+t,'Accept':'application/json','Content-Type':'application/json','Origin':'https://app.dropi.co','Referer':'https://app.dropi.co/','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36'};}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const lg=await (await fetch('https://api-v2.dropi.co/bff/auth/core/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:EMAIL,password:PASSWORD,white_brand_id:1,brand:'',ipAddress:'',otp:null,with_cdc:false})})).json();
 const t=lg.data.token;
 const j=await (await fetch('https://api.dropi.co/api/products/index',{method:'POST',headers:H(t),body:JSON.stringify({pageSize:4,startData:0,keywords:'faja'})})).json();
 const objs=(j.objects||[]).slice(0,4);
 for(const o of objs){
   const s=await (await fetch('https://api.dropi.co/api/products/productlist/v1/show/?id='+o.id,{headers:H(t)})).json();
   await sleep(400);
   const u=s.objects&&s.objects.user||{};
   console.log('PROD:',String(o.name).slice(0,30),
     '| PERSONA(buscador):', ((o.user&&o.user.name)||'')+' '+((o.user&&o.user.surname)||''),
     '| TIENDA(show.store_name):', u.store_name||'(vacio)',
     '| show.name+surname:', (u.name||'')+' '+(u.surname||''));
 }
})().catch(e=>{console.error('ERR:',e.message)});
