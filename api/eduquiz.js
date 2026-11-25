// Vercel Node.js Serverless API. Set GAS_WEB_APP_URL, EDUQUIZ_ADMIN_TOKEN,
// EDUQUIZ_DOSEN_PASSWORD and EDUQUIZ_SESSION_SECRET in Vercel Environment Variables.
const crypto=require('node:crypto');
const actionsAdmin=new Set(['admin_snapshot','save_quiz_package','save_exam_package','approve_exam','delete_quiz_package','delete_exam_package','delete_quiz_result','delete_exam_result']);
const actionsStudent=new Set(['submit_quiz','submit_exam','check_attempt']);
function json(res,status,obj){res.status(status).setHeader('Cache-Control','no-store').json(obj);}
function config(){return ['GAS_WEB_APP_URL','EDUQUIZ_ADMIN_TOKEN','EDUQUIZ_DOSEN_PASSWORD','EDUQUIZ_SESSION_SECRET'].every(k=>process.env[k]);}
function sign(v){return crypto.createHmac('sha256',process.env.EDUQUIZ_SESSION_SECRET).update(v).digest('hex');}
function authorized(req){const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('eduquiz_auth='));if(!cookie)return false;const [ts,mac]=(decodeURIComponent(cookie.slice('eduquiz_auth='.length))).split('.');if(!/^\d+$/.test(ts)||Math.abs(Date.now()-Number(ts))>8*3600e3||!mac||mac.length!==64)return false;const wanted=sign(ts);return crypto.timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(wanted,'hex'));}
async function gas(payload){const r=await fetch(process.env.GAS_WEB_APP_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),redirect:'follow',signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Apps Script HTTP '+r.status);const data=await r.json();if(data.status!=='success')throw Error(data.message||'Backend menolak permintaan');return data;}
module.exports=async(req,res)=>{
 try{
  if(!config())return json(res,503,{status:'error',message:'Environment Variables belum lengkap di Vercel.'});
  if(req.method==='GET'){
   if(req.query.action==='session')return json(res,200,{status:'success',admin:authorized(req)});
   if(req.query.action!=='public_packages')return json(res,400,{status:'error',message:'Aksi GET tidak dikenal'});
   const u=new URL(process.env.GAS_WEB_APP_URL);u.searchParams.set('action','public_packages');const response=await fetch(u,{redirect:'follow',signal:AbortSignal.timeout(25000)});const data=await response.json();return json(res,200,data);
  }
  if(req.method!=='POST')return json(res,405,{status:'error',message:'Method tidak didukung'});
  const data=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  if(JSON.stringify(data).length>900000)return json(res,413,{status:'error',message:'Permintaan terlalu besar'});
  if(data.action==='login'){
   const a=Buffer.from(String(data.password||'')),b=Buffer.from(process.env.EDUQUIZ_DOSEN_PASSWORD);
   if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return json(res,401,{status:'error',message:'Password dosen salah'});
   const ts=String(Date.now());res.setHeader('Set-Cookie',`eduquiz_auth=${encodeURIComponent(ts+'.'+sign(ts))}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=28800`);return json(res,200,{status:'success'});
  }
  if(data.action==='logout'){res.setHeader('Set-Cookie','eduquiz_auth=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0');return json(res,200,{status:'success'});}
  if(!actionsAdmin.has(data.action)&&!actionsStudent.has(data.action))return json(res,400,{status:'error',message:'Aksi tidak dikenal'});
  if(actionsAdmin.has(data.action)){
   if(!authorized(req))return json(res,401,{status:'error',message:'Login dosen diperlukan'});
   return json(res,200,await gas({...data,adminToken:process.env.EDUQUIZ_ADMIN_TOKEN}));
  }
  return json(res,200,await gas(data));
 }catch(e){return json(res,500,{status:'error',message:e.message});}
};
