const crypto = require('crypto');
module.exports = function(app, readMembers, getPresenceMap) {
  const config = () => ({id:process.env.DISCORD_CLIENT_ID, secret:process.env.DISCORD_CLIENT_SECRET, redirect:process.env.DISCORD_REDIRECT_URI});
  const fail = (res, reason) => res.redirect('/portal.html?erro='+reason);
  const find = async id => { const matches=(await readMembers()).filter(m=>String(m.discordId||'')===id); return matches.length===1?matches[0]:null; };
  app.get('/auth/discord', (req,res)=>{
    const c=config(); if(!c.id||!c.secret||!c.redirect||!process.env.SESSION_SECRET) return fail(res,'config');
    const state=crypto.randomBytes(32).toString('hex'); req.session.portalState={state,expires:Date.now()+600000};
    const q=new URLSearchParams({client_id:c.id,redirect_uri:c.redirect,response_type:'code',scope:'identify',state});
    req.session.save(err=>err?fail(res,'login'):res.redirect('https://discord.com/oauth2/authorize?'+q));
  });
  app.get('/auth/discord/callback',async(req,res)=>{
    const pending=req.session.portalState; delete req.session.portalState;
    if(!pending||pending.expires<Date.now()||req.query.state!==pending.state||typeof req.query.code!=='string') return fail(res,'login');
    try {
      const c=config(); const token=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.id,client_secret:c.secret,grant_type:'authorization_code',code:req.query.code,redirect_uri:c.redirect}),signal:AbortSignal.timeout(10000)});
      if(!token.ok) throw Error('token'); const t=await token.json();
      const response=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+t.access_token},signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw Error('identity'); const u=await response.json();
      if(!/^\d{15,22}$/.test(u.id)||!await find(u.id)) return fail(res,'membro');
      req.session.regenerate(err=>{if(err)return fail(res,'login');req.session.portalUser={id:u.id,username:u.username,avatar:u.avatar};req.session.save(e=>e?fail(res,'login'):res.redirect('/portal.html'));});
    } catch(e){console.error('Portal OAuth:',e.message);return fail(res,'login');}
  });
  app.get('/api/portal/me',async(req,res)=>{
    res.set('Cache-Control','no-store'); const u=req.session.portalUser; if(!u)return res.status(401).json({error:'Entre pelo Discord.'});
    try {const m=await find(u.id);if(!m){delete req.session.portalUser;return res.status(403).json({error:'Cadastro não autorizado.'});} const presence=await getPresenceMap();res.json({name:m.name,tag:m.tag,role:m.role,status:presence.get(u.id)?'Online':'Offline',username:u.username,avatar:u.avatar&&/^[\w]+$/.test(u.avatar)?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`:null,leadership:['Líder','Sub Líder'].includes(m.role)});}catch(e){res.status(503).json({error:'Não foi possível consultar seu cadastro.'});}
  });
  app.post('/api/portal/logout',(req,res)=>{delete req.session.portalUser;req.session.save(err=>res.status(err?500:200).json({ok:!err}));});
};
