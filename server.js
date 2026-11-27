require('dotenv').config();

const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// CONFIGURACOES
// ========================================

const MEMBERS_KEY = 'tropa-japao:members:v1';
const STREAMS_KEY = 'tropa-japao:streams:v1';
const PRESENCE_KEY = 'tropa-japao:presence:v1';
const HEARTBEAT_KEY = 'tropa-japao:presence:heartbeat:v1';

const dataFile = path.join(__dirname, 'data', 'members.json');
const streamsFile = path.join(__dirname, 'data', 'streams.json');

const roles = [
  'Líder',
  'Sub Líder',
  'Gerente Geral',
  'Gerente de Vendas',
  'Gerente de Recrutamento',
  'Gerente de Farm',
  'Gerente Elite',
  'Elite',
  'Membro'
];

const initialMembers = [
  {
    id: 1,
    name: 'Rafaella',
    role: 'Líder',
    tag: '001',
    discordId: '',
    avatar: 'R',
    status: 'Offline'
  },
  {
    id: 2,
    name: 'Robson',
    role: 'Sub Líder',
    tag: '002',
    discordId: '',
    avatar: 'R',
    status: 'Offline'
  },
  {
    id: 3,
    name: 'Romana',
    role: 'Gerente Geral',
    tag: '003',
    discordId: '',
    avatar: 'R',
    status: 'Offline'
  }
];

const gallery = [
  { title: 'Momentos do Japão X Tiro', type: 'Eventos' },
  { title: 'Garagem da facção', type: 'Veículos' },
  { title: 'Noite na cidade', type: 'Roleplay' }
];

// ========================================
// EXPRESS
// ========================================

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'index.html')
  );
});

// ========================================
// ARQUIVOS LOCAIS
// ========================================

fs.mkdirSync(path.dirname(dataFile), {
  recursive: true
});

if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(
    dataFile,
    JSON.stringify(initialMembers, null, 2)
  );
}

if (!fs.existsSync(streamsFile)) {
  fs.writeFileSync(streamsFile, '[]');
}

function readLocalMembers() {
  try {
    const data = JSON.parse(
      fs.readFileSync(dataFile, 'utf8')
    );

    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function readLocalStreams() {
  try {
    const data = JSON.parse(
      fs.readFileSync(streamsFile, 'utf8')
    );

    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ========================================
// UPSTASH REDIS
// ========================================

function redisReady() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

async function redis(...args) {
  if (!redisReady()) {
    throw new Error('Upstash Redis não configurado');
  }

  const response = await fetch(
    process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, ''),
    {
      method: 'POST',
      headers: {
        Authorization:
          'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000)
    }
  );

  if (!response.ok) {
    throw new Error('Redis HTTP ' + response.status);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error('Redis: ' + data.error);
  }

  return data.result;
}

// ========================================
// MEMBROS PERMANENTES
// ========================================

async function readMembers() {
  if (!redisReady()) {
    throw new Error(
      'Configure o Redis para salvar membros'
    );
  }

  let stored = await redis('GET', MEMBERS_KEY);

  if (stored === null || stored === undefined) {
    await redis(
      'SET',
      MEMBERS_KEY,
      JSON.stringify(readLocalMembers()),
      'NX'
    );

    stored = await redis('GET', MEMBERS_KEY);
  }

  const members = JSON.parse(stored);

  if (!Array.isArray(members)) {
    throw new Error(
      'Dados de membros inválidos no Redis'
    );
  }

  return members;
}

async function writeMembers(members) {
  await redis(
    'SET',
    MEMBERS_KEY,
    JSON.stringify(members)
  );
}

// ========================================
// SEGURANCA
// ========================================

function safeEqual(a, b) {
  const x = crypto
    .createHash('sha256')
    .update(String(a))
    .digest();

  const y = crypto
    .createHash('sha256')
    .update(String(b))
    .digest();

  return crypto.timingSafeEqual(x, y);
}

function authorized(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: 'Faça login para continuar.'
    });
  }

  next();
}

function botAuthorized(req, res, next) {
  const secret = process.env.BOT_SYNC_SECRET;

  const supplied = /^Bearer (.+)$/.exec(
    req.get('authorization') || ''
  )?.[1];

  if (
    !secret ||
    !supplied ||
    !safeEqual(secret, supplied)
  ) {
    return res.status(401).json({
      error: 'Acesso negado'
    });
  }

  next();
}

function validDiscordId(id) {
  return /^\d{15,22}$/.test(String(id || ''));
}

// ========================================
// PRESENCA DISCORD
// ========================================

async function getPresenceMap() {
  if (!redisReady()) return new Map();

  const heartbeat = await redis(
    'GET',
    HEARTBEAT_KEY
  );

  if (
    !heartbeat ||
    Date.now() - Number(heartbeat) > 150000
  ) {
    return new Map();
  }

  const result = await redis(
    'HGETALL',
    PRESENCE_KEY
  );

  const presence = new Map();

  if (Array.isArray(result)) {
    for (let i = 0; i < result.length; i += 2) {
      presence.set(
        String(result[i]),
        String(result[i + 1]) === '1'
      );
    }
  } else if (result && typeof result === 'object') {
    for (const [id, value] of Object.entries(result)) {
      presence.set(
        String(id),
        String(value) === '1'
      );
    }
  }

  return presence;
}

async function getMembersWithPresence() {
  const members = await readMembers();
  const presence = await getPresenceMap();

  return members.map(member => {
    const discordId = String(
      member.discordId || ''
    );

    return {
      ...member,
      status:
        validDiscordId(discordId) &&
        presence.get(discordId)
          ? 'Online'
          : 'Offline'
    };
  });
}

// ========================================
// BOT - PRESENCA INDIVIDUAL
// ========================================

app.post(
  '/api/bot/presence',
  botAuthorized,
  async (req, res) => {
    const { discordId, online } = req.body || {};

    if (
      !validDiscordId(discordId) ||
      typeof online !== 'boolean'
    ) {
      return res.status(400).json({
        error: 'Presença inválida'
      });
    }

    try {
      await redis(
        'HSET',
        PRESENCE_KEY,
        String(discordId),
        online ? '1' : '0'
      );

      await redis(
        'SET',
        HEARTBEAT_KEY,
        String(Date.now()),
        'EX',
        180
      );

      res.json({ ok: true });
    } catch (error) {
      console.error(
        'Erro de presença:',
        error.message
      );

      res.status(503).json({
        error: 'Erro de sincronização'
      });
    }
  }
);

// ========================================
// BOT - SNAPSHOT DE PRESENCA
// ========================================

app.post(
  '/api/bot/presence/snapshot',
  botAuthorized,
  async (req, res) => {
    const onlineIds = req.body?.onlineIds;

    if (
      !Array.isArray(onlineIds) ||
      onlineIds.length > 10000 ||
      !onlineIds.every(validDiscordId)
    ) {
      return res.status(400).json({
        error: 'Lista inválida'
      });
    }

    try {
      const members = await readMembers();

      const ids = [
        ...new Set(
          members
            .map(m => String(m.discordId || ''))
            .filter(validDiscordId)
        )
      ];

      const onlineSet = new Set(
        onlineIds.map(String)
      );

      for (const id of ids) {
        await redis(
          'HSET',
          PRESENCE_KEY,
          id,
          onlineSet.has(id) ? '1' : '0'
        );
      }

      await redis(
        'SET',
        HEARTBEAT_KEY,
        String(Date.now()),
        'EX',
        180
      );

      res.json({
        ok: true,
        total: ids.length,
        online: ids.filter(
          id => onlineSet.has(id)
        ).length
      });
    } catch (error) {
      console.error(
        'Erro snapshot:',
        error.message
      );

      res.status(503).json({
        error: 'Falha na sincronização'
      });
    }
  }
);

// ========================================
// LIVES - IDENTIFICACAO CORRIGIDA
// ========================================

// Remove /live, parametros e diferencas
// entre www.tiktok.com e tiktok.com.

function normalizeStreamChannel(platform, channel) {
  const url = new URL(channel);

  const parts = url.pathname
    .split('/')
    .filter(Boolean);

  if (platform === 'TikTok') {
    const handle = parts.find(
      part => part.startsWith('@')
    );

    if (!handle) {
      throw new Error('TikTok sem usuário');
    }

    return (
      'tiktok:' +
      handle.slice(1).toLowerCase()
    );
  }

  if (platform === 'Kick') {
    if (!parts[0]) throw new Error('Kick sem canal');
    return 'kick:' + parts[0].toLowerCase();
  }

  if (platform === 'Twitch') {
    if (!parts[0]) {
      throw new Error('Twitch sem canal');
    }

    return (
      'twitch:' +
      parts[0].toLowerCase()
    );
  }

  return (
    'youtube:' +
    url.hostname.toLowerCase().replace(/^www\./, '') +
    ':' +
    url.pathname.replace(/\/+$/, '').toLowerCase()
  );
}

function sameStreamChannel(platform, a, b) {
  try {
    return (
      normalizeStreamChannel(platform, a) ===
      normalizeStreamChannel(platform, b)
    );
  } catch {
    return false;
  }
}

// Cada canal tem sua propria chave no Redis.
// Mesmo Discord ID pode cadastrar varios TikToks.

function streamField(discordId, platform, channel) {
  return (
    String(discordId) +
    ':' +
    platform +
    ':' +
    normalizeStreamChannel(platform, channel)
  );
}

function legacyStreamField(discordId, platform) {
  return String(discordId) + ':' + platform;
}

function streamValues(result) {
  if (Array.isArray(result)) {
    const entries = [];

    for (let i = 0; i < result.length; i += 2) {
      entries.push([
        String(result[i]),
        result[i + 1]
      ]);
    }

    return entries;
  }

  return Object.entries(result || {});
}

// Importa chaves antigas sem apagar os canais.
// A migracao acontece automaticamente.

let migrationPromise = null;

async function migrateStreams() {
  if (!redisReady()) return;

  if (migrationPromise) {
    return migrationPromise;
  }

  migrationPromise = (async () => {
    const raw = await redis(
      'HGETALL',
      STREAMS_KEY
    );

    for (const [field, value] of streamValues(raw)) {
      let item;

      try {
        item = JSON.parse(value);
      } catch {
        continue;
      }

      if (
        !item ||
        !validDiscordId(item.discordId) ||
        !item.platform ||
        !item.channel
      ) continue;

      let correctField;

      try {
        correctField = streamField(
          item.discordId,
          item.platform,
          item.channel
        );
      } catch {
        continue;
      }

      if (field === correctField) continue;

      // Não sobrescreve uma chave nova.
      await redis(
        'HSETNX',
        STREAMS_KEY,
        correctField,
        JSON.stringify(item)
      );

      await redis(
        'HDEL',
        STREAMS_KEY,
        field
      );
    }
  })();

  try {
    await migrationPromise;
  } finally {
    migrationPromise = null;
  }
}

async function getStreams() {
  if (!redisReady()) {
    return readLocalStreams();
  }

  await migrateStreams();

  const result = await redis(
    'HGETALL',
    STREAMS_KEY
  );

  const streams = [];

  for (const [, value] of streamValues(result)) {
    try {
      const item = JSON.parse(value);

      if (item && item.channel) {
        streams.push(item);
      }
    } catch {}
  }

  return streams;
}

// ========================================
// VALIDAR CANAL
// ========================================

function validStream(item) {
  if (
    !item ||
    !validDiscordId(item.discordId)
  ) return false;

  if (
    typeof item.name !== 'string' ||
    !item.name.trim() ||
    item.name.length > 80
  ) return false;

  if (
    item.channelName !== undefined &&
    (
      typeof item.channelName !== 'string' ||
      !item.channelName.trim() ||
      item.channelName.length > 80
    )
  ) return false;

  const hosts = {
    Kick: ['kick.com', 'www.kick.com'],
    Twitch: [
      'twitch.tv',
      'www.twitch.tv'
    ],
    YouTube: [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'youtu.be'
    ],
    TikTok: [
      'tiktok.com',
      'www.tiktok.com',
      'm.tiktok.com'
    ]
  };

  if (
    !hosts[item.platform] ||
    typeof item.channel !== 'string' ||
    item.channel.length > 500
  ) return false;

  try {
    const url = new URL(item.channel);

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !hosts[item.platform].includes(
        url.hostname.toLowerCase()
      )
    ) return false;

    normalizeStreamChannel(
      item.platform,
      item.channel
    );

    return true;
  } catch {
    return false;
  }
}

// ========================================
// CADASTRAR LIVE
// ========================================

app.post(
  '/api/bot/streams',
  botAuthorized,
  async (req, res) => {
    if (!validStream(req.body)) {
      return res.status(400).json({
        error: 'Canal inválido'
      });
    }

    try {
      await migrateStreams();

      const {
        discordId,
        name,
        platform,
        channel,
        channelName
      } = req.body;

      const field = streamField(
        discordId,
        platform,
        channel
      );

      const previous = await redis(
        'HGET',
        STREAMS_KEY,
        field
      );

      const old = previous
        ? JSON.parse(previous)
        : {};

      const item = {
        discordId: String(discordId),
        name: name.trim(),
        channelName: (
          channelName || name
        ).trim(),
        platform,
        channel,
        live: old.live === true,
        lastAnnounced:
          old.lastAnnounced || ''
      };

      await redis(
        'HSET',
        STREAMS_KEY,
        field,
        JSON.stringify(item)
      );

      res.json({
        ok: true,
        channel: item.channel,
        live: item.live
      });
    } catch (error) {
      console.error(
        'Erro cadastrando live:',
        error.message
      );

      res.status(503).json({
        error: 'Erro cadastrando live'
      });
    }
  }
);

// ========================================
// REMOVER LIVE ESPECIFICA
// ========================================

app.delete(
  '/api/bot/streams',
  botAuthorized,
  async (req, res) => {
    const {
      discordId,
      platform,
      channel
    } = req.body || {};

    if (
      !validDiscordId(discordId) ||
      !['Twitch', 'YouTube', 'TikTok', 'Kick'].includes(platform) ||
      typeof channel !== 'string'
    ) {
      return res.status(400).json({
        error: 'Dados inválidos'
      });
    }

    try {
      await migrateStreams();

      const field = streamField(
        discordId,
        platform,
        channel
      );

      const removed = await redis(
        'HDEL',
        STREAMS_KEY,
        field
      );

      res.json({
        ok: true,
        removed: Number(removed) > 0
      });
    } catch (error) {
      console.error(
        'Erro removendo live:',
        error.message
      );

      res.status(503).json({
        error: 'Erro removendo live'
      });
    }
  }
);

// ========================================
// ATUALIZAR STATUS DA LIVE
// ========================================

app.patch(
  '/api/bot/streams/status',
  botAuthorized,
  async (req, res) => {
    const {
      discordId,
      platform,
      channel,
      live,
      lastAnnounced
    } = req.body || {};

    if (
      !validDiscordId(discordId) ||
      !['Twitch', 'YouTube', 'TikTok', 'Kick'].includes(platform) ||
      typeof channel !== 'string' ||
      typeof live !== 'boolean'
    ) {
      return res.status(400).json({
        error: 'Dados inválidos'
      });
    }

    try {
      await migrateStreams();

      const field = streamField(
        discordId,
        platform,
        channel
      );

      let previous = await redis(
        'HGET',
        STREAMS_KEY,
        field
      );

      // Se o canal ainda não estiver no Redis,
      // procura no arquivo local do bot.
      // Assim preservamos o nome cadastrado.

      if (!previous) {
        const local = readLocalStreams();

        const matching = local.find(item =>
          String(item.discordId) ===
            String(discordId) &&
          item.platform === platform &&
          sameStreamChannel(
            platform,
            item.channel,
            channel
          )
        );

        if (!matching || !validStream(matching)) {
          return res.status(404).json({
            error:
              'Canal não cadastrado no servidor. ' +
              'Cadastre novamente com /live cadastrar.'
          });
        }

        const initial = {
          discordId: String(discordId),
          name: matching.name,
          channelName:
            matching.channelName || matching.name,
          platform,
          channel: matching.channel,
          live: false,
          lastAnnounced: ''
        };

        await redis(
          'HSETNX',
          STREAMS_KEY,
          field,
          JSON.stringify(initial)
        );

        previous = await redis(
          'HGET',
          STREAMS_KEY,
          field
        );
      }

      if (!previous) {
        return res.status(404).json({
          error: 'Canal não encontrado'
        });
      }

      const item = JSON.parse(previous);

      // Confere o canal antes de atualizar.
      if (
        !sameStreamChannel(
          platform,
          item.channel,
          channel
        )
      ) {
        return res.status(409).json({
          error: 'Canal diferente do cadastro'
        });
      }

      item.live = live;

      if (typeof lastAnnounced === 'string') {
        item.lastAnnounced =
          lastAnnounced.slice(0, 120);
      }

      await redis(
        'HSET',
        STREAMS_KEY,
        field,
        JSON.stringify(item)
      );

      console.log(
        '🇯🇵 LIVE ATUALIZADA:',
        item.channelName,
        item.channel,
        live ? 'AO VIVO' : 'OFFLINE'
      );

      res.json({
        ok: true,
        channelName: item.channelName,
        channel: item.channel,
        live: item.live
      });

    } catch (error) {
      console.error(
        'Erro atualizando live:',
        error.message
      );

      res.status(503).json({
        error: 'Erro atualizando live'
      });
    }
  }
);

// ========================================
// GALERIA
// ========================================

require('./gallery-routes')(app, {
  authorized,
  redis
});

// ========================================
// DADOS PUBLICOS
// ========================================

app.get('/api/public', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    res.json({
      members: await getMembersWithPresence(),
      streams: await getStreams(),
      gallery,
      discord:
        process.env.DISCORD_INVITE ||
        'https://discord.gg/qy6EaS2pQ'
    });
  } catch (error) {
    console.error(
      'Erro público:',
      error.message
    );

    res.status(503).json({
      error: 'Erro carregando site'
    });
  }
});

// ========================================
// LOGIN
// ========================================

app.get('/api/session', (req, res) => {
  res.json({
    authenticated: !!req.session.admin
  });
});

app.post('/api/login', (req, res) => {
  if (
    !process.env.ADMIN_PASSWORD ||
    !process.env.SESSION_SECRET
  ) {
    return res.status(503).json({
      error:
        'Configure ADMIN_PASSWORD e SESSION_SECRET'
    });
  }

  const user = process.env.ADMIN_USER || 'lider';

  if (
    !safeEqual(req.body?.user || '', user) ||
    !safeEqual(
      req.body?.password || '',
      process.env.ADMIN_PASSWORD
    )
  ) {
    return res.status(401).json({
      error: 'Usuário ou senha inválidos'
    });
  }

  req.session.regenerate(error => {
    if (error) {
      return res.status(500).json({
        error: 'Erro na sessão'
      });
    }

    req.session.admin = true;

    res.json({ ok: true });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        error: 'Erro no logout'
      });
    }

    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ========================================
// PAINEL ADMIN
// ========================================

app.get(
  '/api/admin',
  authorized,
  async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');

      res.json({
        members: await getMembersWithPresence(),
        streams: await getStreams(),
        gallery,
        notice:
          'Dados sincronizados com o BOT DIV'
      });
    } catch (error) {
      res.status(503).json({
        error: 'Erro carregando painel'
      });
    }
  }
);

// ========================================
// VALIDAR MEMBRO
// ========================================

function parseMember(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const name = String(body.name || '').trim();
  const tag = String(body.tag || '').trim();
  const discordId = String(
    body.discordId || ''
  ).trim();

  const legacyRoles = {
    'Sublíder': 'Sub Líder',
    'Gerente': 'Gerente Geral'
  };

  const requestedRole = String(
    body.role || 'Membro'
  );

  const role =
    legacyRoles[requestedRole] ||
    requestedRole;

  if (
    name.length < 2 ||
    name.length > 50 ||
    !/^\d{1,8}$/.test(tag) ||
    !roles.includes(role) ||
    (
      discordId !== '' &&
      !validDiscordId(discordId)
    )
  ) {
    return null;
  }

  return {
    name,
    tag,
    role,
    discordId,
    avatar: name[0].toUpperCase(),
    status: 'Offline'
  };
}

function duplicateMember(
  members,
  member,
  excludedId = null
) {
  return members.find(m =>
    Number(m.id) !== excludedId &&
    (
      String(m.tag) === member.tag ||
      (
        member.discordId &&
        String(m.discordId || '') ===
          member.discordId
      )
    )
  );
}

// ========================================
// CADASTRAR MEMBRO
// ========================================

app.post(
  '/api/members',
  authorized,
  async (req, res) => {
    try {
      const member = parseMember(req.body);

      if (!member) {
        return res.status(400).json({
          error:
            'Nome, ID, cargo ou Discord ID inválido'
        });
      }

      const members = await readMembers();

      if (duplicateMember(members, member)) {
        return res.status(409).json({
          error:
            'ID do RP ou Discord já cadastrado'
        });
      }

      const nextId = members.reduce(
        (max, m) =>
          Math.max(max, Number(m.id) || 0),
        0
      ) + 1;

      const newMember = {
        id: nextId,
        ...member
      };

      members.push(newMember);

      await writeMembers(members);

      res.status(201).json({
        ok: true,
        member: newMember
      });
    } catch (error) {
      console.error(
        'Erro cadastrando membro:',
        error.message
      );

      res.status(503).json({
        error: 'Erro salvando membro no Redis'
      });
    }
  }
);

// ========================================
// EDITAR MEMBRO
// ========================================

app.put(
  '/api/members/:id',
  authorized,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const member = parseMember(req.body);

      if (
        !Number.isSafeInteger(id) ||
        id < 1 ||
        !member
      ) {
        return res.status(400).json({
          error: 'Dados inválidos'
        });
      }

      const members = await readMembers();

      const index = members.findIndex(
        m => Number(m.id) === id
      );

      if (index < 0) {
        return res.status(404).json({
          error: 'Membro não encontrado'
        });
      }

      if (
        duplicateMember(members, member, id)
      ) {
        return res.status(409).json({
          error:
            'ID do RP ou Discord já cadastrado'
        });
      }

      members[index] = {
        ...members[index],
        ...member,
        id
      };

      await writeMembers(members);

      res.json({
        ok: true,
        member: members[index]
      });
    } catch (error) {
      console.error(
        'Erro editando membro:',
        error.message
      );

      res.status(503).json({
        error: 'Erro salvando edição'
      });
    }
  }
);

// ========================================
// EXCLUIR MEMBRO
// ========================================

app.delete(
  '/api/members/:id',
  authorized,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (
        !Number.isSafeInteger(id) ||
        id < 1
      ) {
        return res.status(400).json({
          error: 'ID inválido'
        });
      }

      const members = await readMembers();

      if (
        !members.some(
          m => Number(m.id) === id
        )
      ) {
        return res.status(404).json({
          error: 'Membro não encontrado'
        });
      }

      const updated = members.filter(
        m => Number(m.id) !== id
      );

      await writeMembers(updated);

      res.json({
        ok: true,
        message: 'Membro removido'
      });
    } catch (error) {
      console.error(
        'Erro excluindo membro:',
        error.message
      );

      res.status(503).json({
        error: 'Erro removendo membro'
      });
    }
  }
);

// ========================================
// LISTAR MEMBROS
// ========================================

app.get('/api/members', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    res.json(
      await getMembersWithPresence()
    );
  } catch (error) {
    res.status(503).json({
      error: 'Erro listando membros'
    });
  }
});

// ========================================
// LISTAR LIVES
// ========================================

app.get('/api/streams', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    res.json(await getStreams());
  } catch (error) {
    res.status(503).json({
      error: 'Erro listando lives'
    });
  }
});

// ========================================
// SAUDE DO SERVIDOR
// ========================================

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    site: 'Tropa do Japao',
    bot: 'BOT DIV',
    redisConfigured: redisReady(),
    timestamp: new Date().toISOString()
  });
});

// ========================================
// ERROS
// ========================================

require('./portal-routes')(app, readMembers, getPresenceMap);
require('./farm-routes')(app, {redis, readMembers, getPresenceMap, botAuthorized});

app.use((error, req, res, next) => {
  console.error(
    'Erro interno:',
    error.message
  );

  res.status(500).json({
    error: 'Erro interno do servidor'
  });
});

// ========================================
// INICIAR SERVIDOR
// ========================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('===================================');
  console.log('🇯🇵 TROPA DO JAPAO');
  console.log('===================================');
  console.log('Servidor iniciado na porta:', PORT);
  console.log('BOT DIV: integracao configurada');
  console.log(
    'Redis:',
    redisReady() ? 'Configurado' : 'Nao configurado'
  );
  console.log('===================================');
});