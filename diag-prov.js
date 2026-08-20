/** Diagnóstico: qué campos de PROVEEDOR trae un resultado de búsqueda del catálogo Dropi. */
const EMAIL = process.env.DROPI_EMAIL, PASSWORD = process.env.DROPI_PASSWORD;
function H(t){return {'Authorization':'Bearer '+t,'Accept':'application/json','Content-Type':'application/json','Origin':'https://app.dropi.co','Referer':'https://app.dropi.co/','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36'};}
(async()=>{
 const lg=await (await fetch('https://api-v2.dropi.co/bff/auth/core/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:EMAIL,password:PASSWORD,white_brand_id:1,brand:'',ipAddress:'',otp:null,with_cdc:false})})).json();
 const t=lg.data.token;
 const j=await (await fetch('https://api.dropi.co/api/products/index',{method:'POST',headers:H(t),body:JSON.stringify({pageSize:3,startData:0,keywords:'faja'})})).json();
 const objs=j.objects||[];
 objs.forEach((o,i)=>{
   console.log(`\n=== resultado ${i+1}: ${String(o.name).slice(0,35)} ===`);
   console.log('  campos de nivel producto con "shop/store/supplier/brand":', Object.keys(o).filter(k=>/shop|store|supplier|brand|proveedor|user/i.test(k)).join(', '));
   console.log('  shop_name:', o.shop_name, '| user_id:', o.user_id);
   if(o.user){ console.log('  USER keys:', Object.keys(o.user).join(', ')); console.log('  user.name:', o.user.name, '| surname:', o.user.surname, '| store_name:', o.user.store_name, '| company:', o.user.company, '| business_name:', o.user.business_name); }
 });
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
