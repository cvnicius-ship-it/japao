
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();

// ======================================
// CONFIGURACOES
// ======================================

const PORT = process.env.PORT || 3000;

const dataFile = path.join(
  __dirname,
  'data',
  'members.json'
);

const streamsFile = path.join(
  __dirname,
  'data',
  'streams.json'
);

// Chaves do Upstash Redis
const STREAMS_KEY = 'tropa-japao:streams:v1';
const PRESENCE_KEY = 'tropa-japao:presence:v1';
const PRESENCE_HEARTBEAT_KEY =
  'tropa-japao:presence:heartbeat:v1';

// Status expira se o bot parar de sincronizar
const PRESENCE_MAX_AGE_MS = 150000;

// ======================================
// MEMBROS INICIAIS
// ======================================

const initialMembers = [
  {
    id: 1,
    name: 'Rafaella',
    role: 'Líder',
    tag: '001',
    avatar: 'R',
    status: 'Offline',
    discordId: ''
  },
  {
    id: 2,
    name: 'Robson',
    role: 'Sub Líder',
    tag: '002',
    avatar: 'R',
    status: 'Offline',
    discordId: ''
  },
  {
    id: 3,
    name: 'Romana',
    role: 'Gerente Geral',
    tag: '003',
    avatar: 'R',
    status: 'Offline',
    discordId: ''
  }
];

// ======================================
// ARQUIVOS LOCAIS
// ======================================

fs.mkdirSync(
  path.dirname(dataFile),
  { recursive: true }
);

if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(
    dataFile,
    JSON.stringify(initialMembers, null, 2)
  );
}

if (!fs.existsSync(streamsFile)) {
  fs.writeFileSync(streamsFile, '[]');
}

function readMembers() {
  try {
    const data = JSON.parse(
      fs.readFileSync(dataFile, 'utf8')
    );

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(
      'Erro lendo membros:',
      error.message
    );

    return [];
  }
}

function writeMembers(members) {
  const temp = dataFile + '.tmp';

  fs.writeFileSync(
    temp,
    JSON.stringify(members, null, 2)
  );

  fs.renameSync(temp, dataFile);
}

function readStreams() {
  try {
    const data = JSON.parse(
      fs.readFileSync(streamsFile, 'utf8')
    );

    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ======================================
// GALERIA
// ======================================

const gallery = [
  {
    title: 'Momentos do Japão X Tiro',
    type: 'Eventos'
  },
  {
    title: 'Garagem da facção',
    type: 'Veículos'
  },
  {
    title: 'Noite na cidade',
    type: 'Roleplay'
  }
];

// ======================================
// EXPRESS
// ======================================

app.disable('x-powered-by');

app.set('trust proxy', 1);

app.use(express.json({
  limit: '100kb'
}));

app.use(express.urlencoded({
  extended: false
}));

app.use(session({
  secret:
    process.env.SESSION_SECRET ||
    'dev-only-change-me',

  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

// ======================================
// ARQUIVOS PUBLICOS
// ======================================

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

app.get('/', (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      'public',
      'index.html'
    )
  );
});

// ======================================
// SEGURANCA
// ======================================

const authorized = (req, res, next) => {
  if (req.session.admin) {
    return next();
  }

  return res.status(401).json({
    error: 'Faça login para continuar.'
  });
};

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

// ======================================
// UPSTASH REDIS
// ======================================

const redisReady = () => Boolean(
  process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN
);

async function redis(...args) {
  if (!redisReady()) {
    throw new Error(
      'Configure UPSTASH_REDIS_REST_URL ' +
      'e UPSTASH_REDIS_REST_TOKEN no Render'
    );
  }

  const response = await fetch(
    process.env.UPSTASH_REDIS_REST_URL
      .replace(/\/$/, ''),
    {
      method: 'POST',
      headers: {
        Authorization:
          'Bearer ' +
          process.env.UPSTASH_REDIS_REST_TOKEN,

        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000)
    }
  );

  if (!response.ok) {
    throw new Error(
      'Redis HTTP ' + response.status
    );
  }

  const payload = await response.json();

  if (payload.error) {
    throw new Error(
      'Redis: ' + payload.error
    );
  }

  return payload.result;
}

// ======================================
// CONSULTAR LIVES
// ======================================

async function getStreams() {
  if (!redisReady()) {
    return readStreams();
  }

  const pairs = await redis(
    'HGETALL',
    STREAMS_KEY
  );

  const result = [];

  for (
    let n = 0;
    n < (pairs || []).length;
    n += 2
  ) {
    try {
      result.push(
        JSON.parse(pairs[n + 1])
      );
    } catch {}
  }

  return result;
}

// ======================================
// STATUS DOS MEMBROS DO DISCORD
// ======================================

function validDiscordId(id) {
  return /^\d{15,22}$/.test(
    String(id || '')
  );
}

// Consultar presencas salvas no Redis
async function getPresenceMap() {
  if (!redisReady()) {
    return new Map();
  }

  const heartbeat = await redis(
    'GET',
    PRESENCE_HEARTBEAT_KEY
  );

  const lastSync = Number(heartbeat || 0);

  if (
    !lastSync ||
    Date.now() - lastSync > PRESENCE_MAX_AGE_MS
  ) {
    return new Map();
  }

  const pairs = await redis(
    'HGETALL',
    PRESENCE_KEY
  );

  const result = new Map();

  for (
    let n = 0;
    n < (pairs || []).length;
    n += 2
  ) {
    result.set(
      String(pairs[n]),
      String(pairs[n + 1]) === '1'
    );
  }

  return result;
}

// Aplicar status automatico aos membros
async function getMembersWithPresence() {
  const members = readMembers();
  const presence = await getPresenceMap();

  return members.map(member => {
    const discordId = String(
      member.discordId || ''
    );

    if (!validDiscordId(discordId)) {
      return {
        ...member,
        status: 'Offline'
      };
    }

    return {
      ...member,
      status: presence.get(discordId)
        ? 'Online'
        : 'Offline'
    };
  });
}

// ======================================
// BOT DIV - PRESENCA DO DISCORD
// ======================================

// Receber mudanca individual de status
app.post('/api/bot/presence', botAuthorized, async (req, res) => {
  const { discordId, online } = req.body || {};

  if (
    !validDiscordId(discordId) ||
    typeof online !== 'boolean'
  ) {
    return res.status(400).json({
      error: 'Dados de presenca invalidos'
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
      PRESENCE_HEARTBEAT_KEY,
      String(Date.now()),
      'EX',
      180
    );

    res.json({
      ok: true,
      discordId,
      status: online ? 'Online' : 'Offline'
    });
  } catch (error) {
    console.error(
      'Erro atualizando presenca:',
      error.message
    );

    res.status(503).json({
      error: 'Nao foi possivel atualizar a presenca'
    });
  }
});

// ======================================
// BOT DIV - SINCRONIZACAO COMPLETA
// ======================================

// Receber lista completa de membros online
app.post('/api/bot/presence/snapshot', botAuthorized, async (req, res) => {
  const { onlineIds } = req.body || {};

  if (
    !Array.isArray(onlineIds) ||
    onlineIds.length > 10000 ||
    !onlineIds.every(validDiscordId)
  ) {
    return res.status(400).json({
      error: 'Lista de presencas invalida'
    });
  }

  try {
    // Somente membros cadastrados no site
    const members = readMembers();

    const registeredIds = [
      ...new Set(
        members
          .map(m => String(m.discordId || ''))
          .filter(validDiscordId)
      )
    ];

    const onlineSet = new Set(
      onlineIds.map(String)
    );

    // Atualizar todos os membros cadastrados
    const pipeline = registeredIds.map(id => [
      'HSET',
      PRESENCE_KEY,
      id,
      onlineSet.has(id) ? '1' : '0'
    ]);

    // Executar atualizacoes
    for (const command of pipeline) {
      await redis(...command);
    }

    await redis(
      'SET',
      PRESENCE_HEARTBEAT_KEY,
      String(Date.now()),
      'EX',
      180
    );

    res.json({
      ok: true,
      total: registeredIds.length,
      online: registeredIds.filter(
        id => onlineSet.has(id)
      ).length
    });
  } catch (error) {
    console.error(
      'Erro sincronizando presencas:',
      error.message
    );

    res.status(503).json({
      error: 'Falha na sincronizacao'
    });
  }
});

// ======================================
// VALIDACAO DOS CANAIS DE LIVE
// ======================================

function validStream(input) {
  if (!input || typeof input !== 'object') {
    return false;
  }

  const {
    discordId,
    name,
    platform,
    channel,
    channelName
  } = input;

  if (!validDiscordId(discordId)) {
    return false;
  }

  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 80
  ) {
    return false;
  }

  if (
    channelName !== undefined &&
    (
      typeof channelName !== 'string' ||
      !channelName.trim() ||
      channelName.length > 80
    )
  ) {
    return false;
  }

  const hosts = {
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
    !hosts[platform] ||
    typeof channel !== 'string' ||
    channel.length > 500
  ) {
    return false;
  }

  try {
    const url = new URL(channel);

    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      hosts[platform].includes(
        url.hostname.toLowerCase()
      ) &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

const streamField = (id, platform) =>
  `${id}:${platform}`;

// ======================================
// BOT - CADASTRAR LIVE
// ======================================

app.post('/api/bot/streams', botAuthorized, async (req, res) => {
  if (!validStream(req.body)) {
    return res.status(400).json({
      error: 'Dados de canal invalidos'
    });
  }

  try {
    const {
      discordId,
      name,
      platform,
      channel,
      channelName
    } = req.body;

    const field = streamField(
      discordId,
      platform
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
      discordId,
      name: name.trim(),
      channelName: (
        channelName || name
      ).trim(),
      platform,
      channel,
      live:
        old.channel === channel &&
        old.live === true,
      lastAnnounced:
        old.channel === channel
          ? (old.lastAnnounced || '')
          : ''
    };

    await redis(
      'HSET',
      STREAMS_KEY,
      field,
      JSON.stringify(item)
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(
      'Erro cadastrando live:',
      error.message
    );

    res.status(503).json({
      error: 'Banco de canais indisponivel'
    });
  }
});

// ======================================
// BOT - REMOVER LIVE
// ======================================

app.delete('/api/bot/streams', botAuthorized, async (req, res) => {
  const { discordId, platform } = req.body || {};

  if (
    !validDiscordId(discordId) ||
    !['Twitch', 'YouTube', 'TikTok'].includes(platform)
  ) {
    return res.status(400).json({
      error: 'Dados invalidos'
    });
  }

  try {
    await redis(
      'HDEL',
      STREAMS_KEY,
      streamField(discordId, platform)
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(
      'Erro removendo live:',
      error.message
    );

    res.status(503).json({
      error: 'Nao foi possivel remover canal'
    });
  }
});

// ======================================
// BOT - ATUALIZAR STATUS DA LIVE
// ======================================

app.patch('/api/bot/streams/status', botAuthorized, async (req, res) => {
  const {
    discordId,
    platform,
    live,
    lastAnnounced
  } = req.body || {};

  if (
    !validDiscordId(discordId) ||
    !['Twitch', 'YouTube', 'TikTok'].includes(platform) ||
    typeof live !== 'boolean'
  ) {
    return res.status(400).json({
      error: 'Dados invalidos'
    });
  }

  try {
    const field = streamField(
      discordId,
      platform
    );

    const previous = await redis(
      'HGET',
      STREAMS_KEY,
      field
    );

    if (!previous) {
      return res.status(404).json({
        error: 'Canal nao cadastrado'
      });
    }

    const item = JSON.parse(previous);

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

    res.json({ ok: true });
  } catch (error) {
    console.error(
      'Erro atualizando live:',
      error.message
    );

    res.status(503).json({
      error: 'Banco indisponivel'
    });
  }
});

// ======================================
// GALERIA - FOTOS, VIDEOS E YOUTUBE
// ======================================

// Mantem as rotas da galeria ja existentes.
// O arquivo gallery-routes.js deve continuar
// na mesma pasta do server.js.

require('./gallery-routes')(app, {
  authorized,
  redis
});

// ======================================
// DADOS PUBLICOS DO SITE
// ======================================

app.get('/api/public', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    const members = await getMembersWithPresence();
    const streams = await getStreams();

    res.json({
      members,
      streams,
      gallery,
      discord:
        process.env.DISCORD_INVITE ||
        'https://discord.gg/qy6EaS2pQ'
    });

  } catch (error) {
    console.error(
      'Erro carregando dados publicos:',
      error.message
    );

    res.status(503).json({
      error: 'Nao foi possivel carregar o site'
    });
  }
});

// ======================================
// VERIFICAR SESSAO DO ADMINISTRADOR
// ======================================

app.get('/api/session', (req, res) => {
  res.json({
    authenticated: !!req.session.admin
  });
});

// ======================================
// LOGIN ADMINISTRATIVO
// ======================================

app.post('/api/login', (req, res) => {
  if (
    !process.env.ADMIN_PASSWORD ||
    !process.env.SESSION_SECRET
  ) {
    return res.status(503).json({
      error:
        'Configure ADMIN_PASSWORD e SESSION_SECRET ' +
        'nas variaveis de ambiente.'
    });
  }

  const user = String(
    req.body?.user || ''
  );

  const password = String(
    req.body?.password || ''
  );

  const expectedUser =
    process.env.ADMIN_USER || 'lider';

  const expectedPassword =
    process.env.ADMIN_PASSWORD;

  if (
    !safeEqual(user, expectedUser) ||
    !safeEqual(password, expectedPassword)
  ) {
    return res.status(401).json({
      error: 'Usuario ou senha invalidos.'
    });
  }

  req.session.regenerate(error => {
    if (error) {
      console.error(
        'Erro criando sessao:',
        error.message
      );

      return res.status(500).json({
        error: 'Erro ao iniciar sessao.'
      });
    }

    req.session.admin = true;

    res.json({
      ok: true
    });
  });
});

// ======================================
// SAIR DO PAINEL
// ======================================

app.post('/api/logout', (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        error: 'Erro ao encerrar sessao.'
      });
    }

    res.clearCookie('connect.sid');

    res.json({
      ok: true
    });
  });
});

// ======================================
// PAINEL ADMINISTRATIVO
// ======================================

app.get('/api/admin', authorized, async (req, res) => {
  try {
    const members = await getMembersWithPresence();
    const streams = await getStreams();

    res.set('Cache-Control', 'no-store');

    res.json({
      members,
      streams,
      gallery,
      notice:
        'Status dos membros sincronizados ' +
        'automaticamente com o BOT DIV.'
    });

  } catch (error) {
    console.error(
      'Erro carregando painel:',
      error.message
    );

    res.status(503).json({
      error: 'Nao foi possivel carregar o painel'
    });
  }
});

// ======================================
// CARGOS DISPONIVEIS NO SITE
// ======================================

const allowedRoles = [
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

// ======================================
// COMPATIBILIDADE COM CARGOS ANTIGOS
// ======================================

const legacyRoles = {
  'Sublíder': 'Sub Líder',
  'Gerente': 'Gerente Geral'
};

// ======================================
// VALIDAR CADASTRO DE MEMBROS
// ======================================

function parseMember(body) {
  if (
    !body ||
    typeof body !== 'object'
  ) {
    return null;
  }

  const name = String(
    body.name || ''
  ).trim();

  const tag = String(
    body.tag || ''
  ).trim();

  const requestedRole = String(
    body.role || 'Membro'
  );

  const role =
    legacyRoles[requestedRole] ||
    requestedRole;

  // Status sera controlado pelo Discord.
  // O campo continua existindo para
  // compatibilidade com o site antigo.
  const status = 'Offline';

  const discordId = String(
    body.discordId || ''
  ).trim();

  if (
    name.length < 2 ||
    name.length > 50 ||
    !/^\d{1,8}$/.test(tag) ||
    !allowedRoles.includes(role) ||
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
    status,
    discordId,
    avatar: name[0].toUpperCase()
  };
}

// ======================================
// CADASTRAR MEMBRO
// ======================================

app.post('/api/members', authorized, (req, res) => {
  try {
    const member = parseMember(req.body);

    if (!member) {
      return res.status(400).json({
        error: 'Dados do membro invalidos.'
      });
    }

    const members = readMembers();

    // Nao permitir TAG repetida
    const tagExists = members.some(
      m => String(m.tag) === member.tag
    );

    if (tagExists) {
      return res.status(409).json({
        error: 'Esta TAG ja esta cadastrada.'
      });
    }

    // Nao permitir ID Discord repetido
    if (member.discordId) {
      const discordExists = members.some(
        m => String(m.discordId || '') === member.discordId
      );

      if (discordExists) {
        return res.status(409).json({
          error: 'Este Discord ja pertence a outro membro.'
        });
      }
    }

    const nextId = members.reduce(
      (max, m) => Math.max(max, Number(m.id) || 0),
      0
    ) + 1;

    const newMember = {
      id: nextId,
      ...member
    };

    members.push(newMember);

    writeMembers(members);

    return res.status(201).json({
      ok: true,
      member: newMember
    });

  } catch (error) {
    console.error(
      'Erro cadastrando membro:',
      error.message
    );

    return res.status(500).json({
      error: 'Erro ao cadastrar membro.'
    });
  }
});

// ======================================
// EDITAR MEMBRO
// ======================================

app.put('/api/members/:id', authorized, (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: 'ID do membro invalido.'
      });
    }

    const member = parseMember(req.body);

    if (!member) {
      return res.status(400).json({
        error: 'Dados do membro invalidos.'
      });
    }

    const members = readMembers();

    const index = members.findIndex(
      m => Number(m.id) === id
    );

    if (index === -1) {
      return res.status(404).json({
        error: 'Membro nao encontrado.'
      });
    }

    // Verificar TAG de outros membros
    const tagExists = members.some(
      m =>
        Number(m.id) !== id &&
        String(m.tag) === member.tag
    );

    if (tagExists) {
      return res.status(409).json({
        error: 'Esta TAG ja pertence a outro membro.'
      });
    }

    // Verificar Discord de outros membros
    if (member.discordId) {
      const discordExists = members.some(
        m =>
          Number(m.id) !== id &&
          String(m.discordId || '') === member.discordId
      );

      if (discordExists) {
        return res.status(409).json({
          error: 'Este Discord ja pertence a outro membro.'
        });
      }
    }

    members[index] = {
      ...members[index],
      ...member,
      id
    };

    writeMembers(members);

    return res.json({
      ok: true,
      member: members[index]
    });

  } catch (error) {
    console.error(
      'Erro editando membro:',
      error.message
    );

    return res.status(500).json({
      error: 'Erro ao editar membro.'
    });
  }
});

// ======================================
// EXCLUIR MEMBRO
// ======================================

app.delete('/api/members/:id', authorized, (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: 'ID do membro invalido.'
      });
    }

    const members = readMembers();

    const exists = members.some(
      m => Number(m.id) === id
    );

    if (!exists) {
      return res.status(404).json({
        error: 'Membro nao encontrado.'
      });
    }

    const updated = members.filter(
      m => Number(m.id) !== id
    );

    writeMembers(updated);

    return res.json({
      ok: true,
      message: 'Membro removido com sucesso.'
    });

  } catch (error) {
    console.error(
      'Erro removendo membro:',
      error.message
    );

    return res.status(500).json({
      error: 'Erro ao remover membro.'
    });
  }
});

// ======================================
// LISTAR MEMBROS COM STATUS AUTOMATICO
// ======================================

app.get('/api/members', async (req, res) => {
  try {
    const members = await getMembersWithPresence();

    res.set('Cache-Control', 'no-store');

    return res.json(members);

  } catch (error) {
    console.error(
      'Erro listando membros:',
      error.message
    );

    return res.status(503).json({
      error: 'Nao foi possivel carregar membros.'
    });
  }
});

// ======================================
// LISTAR LIVES
// ======================================

app.get('/api/streams', async (req, res) => {
  try {
    const streams = await getStreams();

    res.set('Cache-Control', 'no-store');

    return res.json(streams);

  } catch (error) {
    console.error(
      'Erro listando lives:',
      error.message
    );

    return res.status(503).json({
      error: 'Nao foi possivel carregar lives.'
    });
  }
});

// ======================================
// VERIFICAR SE O SERVIDOR ESTA FUNCIONANDO
// ======================================

app.get('/api/health', (req, res) => {
  return res.json({
    ok: true,
    site: 'Tropa do Japao',
    bot: 'BOT DIV',
    timestamp: new Date().toISOString()
  });
});

// ======================================
// TRATAMENTO DE ERROS
// ======================================

app.use((err, req, res, next) => {
  console.error(
    'Erro interno:',
    err.message
  );

  return res.status(500).json({
    error: 'Erro interno do servidor.'
  });
});

// ======================================
// INICIAR SERVIDOR
// ======================================

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
