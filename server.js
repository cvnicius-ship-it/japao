require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const app = express();
const dataFile = path.join(__dirname, 'data', 'members.json');
const initialMembers = [
 {id:1,name:'Rafaella',role:'Líder',tag:'001',avatar:'R',status:'Offline'},
 {id:2,name:'Robson',role:'Sublíder',tag:'002',avatar:'R',status:'Offline'},
 {id:3,name:'Romana',role:'Gerente',tag:'003',avatar:'R',status:'Offline'}
];
fs.mkdirSync(path.dirname(dataFile),{recursive:true});
if(!fs.existsSync(dataFile)) fs.writeFileSync(dataFile,JSON.stringify(initialMembers,null,2));
function readMembers(){return JSON.parse(fs.readFileSync(dataFile,'utf8'));}
function writeMembers(members){const temp=dataFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(members,null,2));fs.renameSync(temp,dataFile);}
const streamsFile=path.join(__dirname,'data','streams.json');
if(!fs.existsSync(streamsFile))fs.writeFileSync(streamsFile,'[]');
function readStreams(){try{return JSON.parse(fs.readFileSync(streamsFile,'utf8'))}catch{return []}}
const gallery = [
  {title:'Encontro da tropa',type:'Eventos'},
  {title:'Garagem da facção',type:'Veículos'},
  {title:'Noite na cidade',type:'Roleplay'}
];
app.disable('x-powered-by');
app.use(express.json({limit:'20kb'}));
app.use(express.urlencoded({extended:false}));
app.set('trust proxy', 1);
app.use(session({secret:process.env.SESSION_SECRET || 'dev-only-change-me',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:1000*60*60*8}}));
app.use(express.static(path.join(__dirname,'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
const authorized = (req,res,next)=>req.session.admin?next():res.status(401).json({error:'Faça login para continuar.'});
function safeEqual(a,b){const x=crypto.createHash('sha256').update(String(a)).digest();const y=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(x,y);}
// Upstash Redis REST mantém os canais após reinicializações do Render.
const STREAMS_KEY = 'tropa-japao:streams:v1';
const redisReady = () => Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
async function redis(...args) {
  if (!redisReady()) throw new Error('Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN no Render');
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, ''), {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Redis HTTP ' + response.status);
  const payload = await response.json();
  if (payload.error) throw new Error('Redis: ' + payload.error);
  return payload.result;
}
async function getStreams() {
  if (!redisReady()) return readStreams(); // Somente para desenvolvimento local.
  const pairs = await redis('HGETALL', STREAMS_KEY);
  const result = [];
  for (let n = 0; n < (pairs || []).length; n += 2) {
    try { result.push(JSON.parse(pairs[n + 1])); } catch { /* ignora registro inválido */ }
  }
  return result;
}
function botAuthorized(req, res, next) {
  const secret = process.env.BOT_SYNC_SECRET;
  const supplied = /^Bearer (.+)$/.exec(req.get('authorization') || '')?.[1];
  if (!secret || !supplied || !safeEqual(secret, supplied)) return res.status(401).json({ error: 'Acesso negado' });
  next();
}
function validStream(input) {
  if (!input || typeof input !== 'object') return false;
  const { discordId, name, platform, channel, channelName } = input;
  if (channelName !== undefined && (typeof channelName !== 'string' || !channelName.trim() || channelName.length > 80)) return false;
  if (!/^\d{15,22}$/.test(String(discordId || '')) || typeof name !== 'string' || !name.trim() || name.length > 80) return false;
  const hosts = { Twitch: ['twitch.tv','www.twitch.tv'], YouTube: ['youtube.com','www.youtube.com','m.youtube.com','youtu.be'], TikTok: ['tiktok.com','www.tiktok.com','m.tiktok.com'] };
  if (!hosts[platform] || typeof channel !== 'string' || channel.length > 500) return false;
  try { const u = new URL(channel); return u.protocol === 'https:' && !u.username && !u.password && !u.port && hosts[platform].includes(u.hostname.toLowerCase()) && u.pathname.length > 1; } catch { return false; }
}
const streamField = (id, platform) => `${id}:${platform}`;
app.post('/api/bot/streams', botAuthorized, async (req, res) => {
  if (!validStream(req.body)) return res.status(400).json({ error: 'Dados de canal inválidos' });
  try {
    const { discordId, name, platform, channel, channelName } = req.body;
    const field = streamField(discordId, platform);
    const previous = await redis('HGET', STREAMS_KEY, field);
    const old = previous ? JSON.parse(previous) : {};
    const item = { discordId, name: name.trim(), channelName: (channelName || name).trim(), platform, channel, live: old.channel === channel && old.live === true, lastAnnounced: old.channel === channel ? (old.lastAnnounced || '') : '' };
    await redis('HSET', STREAMS_KEY, field, JSON.stringify(item));
    res.json({ ok: true });
  } catch (err) { console.error('Falha salvando canal:', err.message); res.status(503).json({ error: 'Banco de canais indisponível' }); }
});
app.delete('/api/bot/streams', botAuthorized, async (req, res) => {
  const { discordId, platform } = req.body || {};
  if (!/^\d{15,22}$/.test(String(discordId || '')) || !['Twitch','YouTube','TikTok'].includes(platform)) return res.status(400).json({ error: 'Dados inválidos' });
  try { await redis('HDEL', STREAMS_KEY, streamField(discordId, platform)); res.json({ ok: true }); }
  catch (err) { console.error('Falha removendo canal:', err.message); res.status(503).json({ error: 'Banco de canais indisponível' }); }
});
app.patch('/api/bot/streams/status', botAuthorized, async (req, res) => {
  const { discordId, platform, live, lastAnnounced } = req.body || {};
  if (!/^\d{15,22}$/.test(String(discordId || '')) || !['Twitch','YouTube','TikTok'].includes(platform) || typeof live !== 'boolean') return res.status(400).json({ error: 'Dados inválidos' });
  try {
    const field = streamField(discordId, platform);
    const old = await redis('HGET', STREAMS_KEY, field);
    if (!old) return res.status(404).json({ error: 'Canal não cadastrado' });
    const item = JSON.parse(old);
    item.live = live;
    if (typeof lastAnnounced === 'string') item.lastAnnounced = lastAnnounced.slice(0, 120);
    await redis('HSET', STREAMS_KEY, field, JSON.stringify(item));
    res.json({ ok: true });
  } catch (err) { console.error('Falha atualizando status:', err.message); res.status(503).json({ error: 'Banco indisponível' }); }
});
app.get('/api/public', async (req, res) => {
  try { res.set('Cache-Control', 'no-store'); res.json({ members: readMembers(), streams: await getStreams(), gallery, discord: process.env.DISCORD_INVITE || 'https://discord.gg/qy6EaS2pQ' }); }
  catch (err) { console.error('Falha lendo canais:', err.message); res.status(503).json({ error: 'Não foi possível carregar canais' }); }
});
app.get('/api/session',(req,res)=>res.json({authenticated:!!req.session.admin}));
app.post('/api/login',(req,res)=>{
  if(!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) return res.status(503).json({error:'Configure o arquivo .env antes de usar o painel.'});
  if(!safeEqual(req.body.user||'',process.env.ADMIN_USER||'lider') || !safeEqual(req.body.password||'',process.env.ADMIN_PASSWORD)) return res.status(401).json({error:'Usuário ou senha inválidos.'});
  req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Erro na sessão.'});req.session.admin=true;res.json({ok:true});});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin', authorized, async (req,res) => { try { res.json({members:readMembers(),streams:await getStreams(),gallery,notice:'Canais sincronizados com o bot do Discord.'}); } catch(e) { res.status(503).json({error:'Banco de canais indisponível'}); } });
const allowedRoles = ['Líder','Sublíder','Gerente','Membro'];
function parseMember(body){
 const name=String(body.name||'').trim();const tag=String(body.tag||'').trim();
 const role=String(body.role||'Membro');const status=String(body.status||'Offline');
 if(name.length<2||name.length>50||!/^\d{1,8}$/.test(tag)||!allowedRoles.includes(role)||!['Online','Offline'].includes(status)) return null;
 return {name,tag,role,status,avatar:name[0].toUpperCase()};
}
app.post('/api/admin/members',authorized,(req,res)=>{
 const member=parseMember(req.body);if(!member)return res.status(400).json({error:'Preencha nome, ID numérico, cargo e status válidos.'});
 const members=readMembers();if(members.some(m=>m.tag===member.tag))return res.status(409).json({error:'Esse ID já está cadastrado.'});
 member.id=members.reduce((max,m)=>Math.max(max,m.id),0)+1;members.push(member);writeMembers(members);res.status(201).json(member);
});
app.put('/api/admin/members/:id',authorized,(req,res)=>{
 const member=parseMember(req.body);if(!member)return res.status(400).json({error:'Dados inválidos.'});
 const members=readMembers();const id=Number(req.params.id);const index=members.findIndex(m=>m.id===id);
 if(index<0)return res.status(404).json({error:'Membro não encontrado.'});
 if(members.some(m=>m.tag===member.tag&&m.id!==id))return res.status(409).json({error:'Esse ID já está cadastrado.'});
 members[index]={...member,id};writeMembers(members);res.json(members[index]);
});
app.delete('/api/admin/members/:id',authorized,(req,res)=>{
 const members=readMembers();const index=members.findIndex(m=>m.id===Number(req.params.id));
 if(index<0)return res.status(404).json({error:'Membro não encontrado.'});
 members.splice(index,1);writeMembers(members);res.json({ok:true});
});
app.listen(process.env.PORT||3000,()=>console.log(`Portal em http://localhost:${process.env.PORT||3000}`));
