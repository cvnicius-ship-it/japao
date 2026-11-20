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
app.use(session({secret:process.env.SESSION_SECRET || 'dev-only-change-me',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:1000*60*60*8}}));
app.use(express.static(path.join(__dirname,'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
const authorized = (req,res,next)=>req.session.admin?next():res.status(401).json({error:'Faça login para continuar.'});
function safeEqual(a,b){const x=crypto.createHash('sha256').update(String(a)).digest();const y=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(x,y);}
app.get('/api/public',(req,res)=>res.json({members:readMembers(),streams:readStreams(),gallery,discord:process.env.DISCORD_INVITE||'https://discord.gg/qy6EaS2pQ'}));
app.get('/api/session',(req,res)=>res.json({authenticated:!!req.session.admin}));
app.post('/api/login',(req,res)=>{
  if(!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) return res.status(503).json({error:'Configure o arquivo .env antes de usar o painel.'});
  if(!safeEqual(req.body.user||'',process.env.ADMIN_USER||'lider') || !safeEqual(req.body.password||'',process.env.ADMIN_PASSWORD)) return res.status(401).json({error:'Usuário ou senha inválidos.'});
  req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Erro na sessão.'});req.session.admin=true;res.json({ok:true});});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin',authorized,(req,res)=>res.json({members:readMembers(),streams:readStreams(),gallery,notice:'Painel inicial: integrações e gestão de membros são próximas etapas.'}));
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
