
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const dataDir = path.join(__dirname, 'data');
const membersFile = path.join(dataDir, 'members.json');
const streamsFile = path.join(dataDir, 'streams.json');

fs.mkdirSync(dataDir, { recursive: true });

const initialMembers = [
  { id: 1, name: 'Rafaella', role: 'Líder', tag: '001', avatar: 'R', status: 'Offline' },
  { id: 2, name: 'Robson', role: 'Sublíder', tag: '002', avatar: 'R', status: 'Offline' },
  { id: 3, name: 'Romana', role: 'Gerente', tag: '003', avatar: 'R', status: 'Offline' }
];

if (!fs.existsSync(membersFile)) {
  fs.writeFileSync(membersFile, JSON.stringify(initialMembers, null, 2));
}

if (!fs.existsSync(streamsFile)) {
  fs.writeFileSync(streamsFile, '[]');
}

function readMembers() {
  return JSON.parse(fs.readFileSync(membersFile, 'utf8'));
}

function writeMembers(members) {
  const temp = membersFile + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(members, null, 2));
  fs.renameSync(temp, membersFile);
}

function readStreams() {
  try {
    const value = JSON.parse(fs.readFileSync(streamsFile, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const gallery = [
  { title: 'Encontro da tropa', type: 'Eventos' },
  { title: 'Garagem da facção', type: 'Veículos' },
  { title: 'Noite na cidade', type: 'Roleplay' }
];

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false }));
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const authorized = (req, res, next) =>
  req.session.admin
    ? next()
    : res.status(401).json({ error: 'Faça login para continuar.' });

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// ======================================
// UPSTASH REDIS
// ======================================

const STREAMS_KEY = 'tropa-japao:streams:v1';

const redisReady = () => Boolean(
  process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN
);

async function redis(...args) {
  if (!redisReady()) {
    throw new Error('Configure as variaveis UPSTASH do Redis');
  }

  const response = await fetch(
    process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, ''),
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(20000)
    }
  );

  if (!response.ok) {
    throw new Error('Redis HTTP ' + response.status);
  }

  const payload = await response.json();

  if (payload.error) {
    throw new Error('Redis: ' + payload.error);
  }

  return payload.result;
}

// Cada canal tem uma chave propria.
// A chave antiga id:plataforma continua reconhecida.

function normalizeChannel(platform, channel) {
  const u = new URL(channel);
  let pathname = u.pathname.replace(/\/+$/, '').toLowerCase();

  if (platform === 'TikTok') {
    const username = pathname.split('/').filter(Boolean)
      .find(x => x.startsWith('@'));
    if (username) pathname = '/' + username;
  }

  if (platform === 'Twitch') {
    pathname = '/' + (pathname.split('/').filter(Boolean)[0] || '');
  }

  return `${platform}:${u.hostname.toLowerCase()}:${pathname}`;
}

function streamField(discordId, platform, channel) {
  const hash = crypto.createHash('sha256')
    .update(normalizeChannel(platform, channel))
    .digest('hex')
    .slice(0, 32);

  return `${discordId}:${platform}:${hash}`;
}

function legacyField(discordId, platform) {
  return `${discordId}:${platform}`;
}

function sameChannel(platform, a, b) {
  try {
    return normalizeChannel(platform, a) ===
      normalizeChannel(platform, b);
  } catch {
    return false;
  }
}

async function getStreams() {
  if (!redisReady()) return readStreams();

  const pairs = await redis('HGETALL', STREAMS_KEY);
  const result = [];

  for (let n = 0; n < (pairs || []).length; n += 2) {
    try {
      result.push(JSON.parse(pairs[n + 1]));
    } catch {
      // Ignora registro invalido.
    }
  }

  return result;
}

async function findStream(discordId, platform, channel) {
  const field = streamField(discordId, platform, channel);
  const value = await redis('HGET', STREAMS_KEY, field);

  if (value) {
    return { field, item: JSON.parse(value) };
  }

  // Compatibilidade com registros anteriores.
  const oldField = legacyField(discordId, platform);
  const oldValue = await redis('HGET', STREAMS_KEY, oldField);

  if (oldValue) {
    const item = JSON.parse(oldValue);

    if (sameChannel(platform, item.channel, channel)) {
      return { field: oldField, item };
    }
  }

  return null;
}

function botAuthorized(req, res, next) {
  const secret = process.env.BOT_SYNC_SECRET;
  const supplied = /^Bearer (.+)$/.exec(
    req.get('authorization') || ''
  )?.[1];

  if (!secret || !supplied || !safeEqual(secret, supplied)) {
    return res.status(401).json({ error: 'Acesso negado' });
  }

  next();
}

const hosts = {
  Twitch: ['twitch.tv', 'www.twitch.tv'],
  YouTube: [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be'
  ],
  TikTok: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']
};

function validChannel(platform, channel) {
  if (!hosts[platform] || typeof channel !== 'string' ||
      channel.length > 500) return false;

  try {
    const u = new URL(channel);

    return u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      hosts[platform].includes(u.hostname.toLowerCase()) &&
      u.pathname.length > 1;
  } catch {
    return false;
  }
}

function validStream(input) {
  if (!input || typeof input !== 'object') return false;

  const { discordId, name, platform, channel, channelName } = input;

  return /^\d{15,22}$/.test(String(discordId || '')) &&
    typeof name === 'string' &&
    name.trim().length > 0 &&
    name.length <= 80 &&
    (channelName === undefined ||
      (typeof channelName === 'string' &&
       channelName.trim().length > 0 &&
       channelName.length <= 80)) &&
    validChannel(platform, channel);
}

function validTarget(body) {
  return body &&
    /^\d{15,22}$/.test(String(body.discordId || '')) &&
    validChannel(body.platform, body.channel);
}

// ======================================
// API DO BOT - CADASTRAR
// ======================================

app.post('/api/bot/streams', botAuthorized, async (req, res) => {
  if (!validStream(req.body)) {
    return res.status(400).json({ error: 'Dados de canal invalidos' });
  }

  try {
    const {
      discordId, name, platform, channel, channelName
    } = req.body;

    const field = streamField(discordId, platform, channel);
    const previous = await findStream(discordId, platform, channel);

    const item = {
      discordId: String(discordId),
      name: name.trim(),
      channelName: (channelName || name).trim(),
      platform,
      channel,
      live: previous?.item?.live === true,
      lastAnnounced: previous?.item?.lastAnnounced || ''
    };

    await redis('HSET', STREAMS_KEY, field, JSON.stringify(item));

    // Migra somente a chave antiga do mesmo canal.
    if (previous && previous.field !== field) {
      await redis('HDEL', STREAMS_KEY, previous.field);
    }

    res.json({ ok: true, channel });
  } catch (error) {
    console.error('Erro cadastrando canal:', error.message);
    res.status(503).json({ error: 'Banco de canais indisponivel' });
  }
});

// ======================================
// API DO BOT - REMOVER
// ======================================

app.delete('/api/bot/streams', botAuthorized, async (req, res) => {
  if (!validTarget(req.body)) {
    return res.status(400).json({ error: 'Dados invalidos' });
  }

  try {
    const { discordId, platform, channel } = req.body;
    const found = await findStream(discordId, platform, channel);

    if (!found) {
      return res.status(404).json({ error: 'Canal nao encontrado' });
    }

    await redis('HDEL', STREAMS_KEY, found.field);
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro removendo canal:', error.message);
    res.status(503).json({ error: 'Banco indisponivel' });
  }
});

// ======================================
// API DO BOT - STATUS
// ======================================

app.patch('/api/bot/streams/status', botAuthorized, async (req, res) => {
  if (!validTarget(req.body) ||
      typeof req.body.live !== 'boolean') {
    return res.status(400).json({ error: 'Dados invalidos' });
  }

  try {
    const {
      discordId, platform, channel, live, lastAnnounced
    } = req.body;

    const found = await findStream(discordId, platform, channel);

    if (!found) {
      return res.status(404).json({ error: 'Canal nao cadastrado' });
    }

    const item = found.item;
    item.live = live;

    if (typeof lastAnnounced === 'string') {
      item.lastAnnounced = lastAnnounced.slice(0, 120);
    }

    await redis(
      'HSET',
      STREAMS_KEY,
      found.field,
      JSON.stringify(item)
    );

    res.json({ ok: true });
  } catch (error) {
    console.error('Erro atualizando live:', error.message);
    res.status(503).json({ error: 'Banco indisponivel' });
  }
});

// ======================================
// API PUBLICA
// ======================================

app.get('/api/public', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    res.json({
      members: readMembers(),
      streams: await getStreams(),
      gallery,
      discord: process.env.DISCORD_INVITE ||
        'https://discord.gg/qy6EaS2pQ'
    });
  } catch (error) {
    console.error('Erro carregando site:', error.message);
    res.status(503).json({
      error: 'Nao foi possivel carregar canais'
    });
  }
});

// ======================================
// LOGIN E PAINEL
// ======================================

app.get('/api/session', (req, res) => {
  res.json({ authenticated: !!req.session.admin });
});

app.post('/api/login', (req, res) => {
  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    return res.status(503).json({
      error: 'Configure o arquivo .env antes de usar o painel.'
    });
  }

  if (
    !safeEqual(req.body.user || '', process.env.ADMIN_USER || 'lider') ||
    !safeEqual(req.body.password || '', process.env.ADMIN_PASSWORD)
  ) {
    return res.status(401).json({
      error: 'Usuario ou senha invalidos.'
    });
  }

  req.session.regenerate(error => {
    if (error) {
      return res.status(500).json({ error: 'Erro na sessao.' });
    }

    req.session.admin = true;
    res.json({ ok: true });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin', authorized, async (req, res) => {
  try {
    res.json({
      members: readMembers(),
      streams: await getStreams(),
      gallery,
      notice: 'Canais sincronizados com o bot do Discord.'
    });
  } catch {
    res.status(503).json({
      error: 'Banco de canais indisponivel'
    });
  }
});

// ======================================
// GERENCIAMENTO DE MEMBROS
// ======================================

const allowedRoles = ['Líder', 'Sublíder', 'Gerente', 'Membro'];

function parseMember(body) {
  const name = String(body.name || '').trim();
  const tag = String(body.tag || '').trim();
  const role = String(body.role || 'Membro');
  const status = String(body.status || 'Offline');

  if (
    name.length < 2 ||
    name.length > 50 ||
    !/^\d{1,8}$/.test(tag) ||
    !allowedRoles.includes(role) ||
    !['Online', 'Offline'].includes(status)
  ) {
    return null;
  }

  return {
    name,
    tag,
    role,
    status,
    avatar: name[0].toUpperCase()
  };
}

app.post('/api/admin/members', authorized, (req, res) => {
  const member = parseMember(req.body);

  if (!member) {
    return res.status(400).json({
      error: 'Preencha nome, ID numerico, cargo e status validos.'
    });
  }

  const members = readMembers();

  if (members.some(m => m.tag === member.tag)) {
    return res.status(409).json({
      error: 'Esse ID ja esta cadastrado.'
    });
  }

  member.id = members.reduce(
    (max, m) => Math.max(max, m.id), 0
  ) + 1;

  members.push(member);
  writeMembers(members);

  res.status(201).json(member);
});

app.put('/api/admin/members/:id', authorized, (req, res) => {
  const member = parseMember(req.body);

  if (!member) {
    return res.status(400).json({ error: 'Dados invalidos.' });
  }

  const members = readMembers();
  const id = Number(req.params.id);
  const index = members.findIndex(m => m.id === id);

  if (index < 0) {
    return res.status(404).json({
      error: 'Membro nao encontrado.'
    });
  }

  if (members.some(m => m.tag === member.tag && m.id !== id)) {
    return res.status(409).json({
      error: 'Esse ID ja esta cadastrado.'
    });
  }

  members[index] = { ...member, id };
  writeMembers(members);

  res.json(members[index]);
});

app.delete('/api/admin/members/:id', authorized, (req, res) => {
  const members = readMembers();
  const index = members.findIndex(
    m => m.id === Number(req.params.id)
  );

  if (index < 0) {
    return res.status(404).json({
      error: 'Membro nao encontrado.'
    });
  }

  members.splice(index, 1);
  writeMembers(members);

  res.json({ ok: true });
});

// ======================================
// INICIAR SITE
// ======================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Portal Tropa do Japao na porta ${PORT}`);
});
