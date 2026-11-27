
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  Events
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// =====================================
// CONFIGURAÇÕES
// =====================================

const file = path.join(__dirname, 'data', 'streams.json');

const CHANNEL =
  process.env.DISCORD_LIVES_CHANNEL_ID ||
  '1494303769796808884';

const SITE_URL = (process.env.SITE_URL || '')
  .replace(/\/+$/, '');

const PORTAL =
  SITE_URL || 'https://japao-e4oy.onrender.com';

const LOGO = PORTAL + '/tropa-do-japao.png';

const COLORS = {
  Kick: 0x53fc18,
  Twitch: 0x9146ff,
  YouTube: 0xff0000,
  TikTok: 0x25f4ee
};

fs.mkdirSync(path.dirname(file), {
  recursive: true
});

if (!fs.existsSync(file)) {
  fs.writeFileSync(file, '[]');
}

// =====================================
// BANCO DE DADOS LOCAL
// =====================================

function read() {
  try {
    const data = JSON.parse(
      fs.readFileSync(file, 'utf8')
    );

    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function write(items) {
  const temp = file + '.tmp';

  fs.writeFileSync(
    temp,
    JSON.stringify(items, null, 2)
  );

  fs.renameSync(temp, file);
}

// =====================================
// IDENTIFICAR CANAIS
// =====================================

function normalizeChannel(platform, channel) {
  const url = new URL(channel);

  let pathname = url.pathname
    .replace(/\/+$/, '')
    .toLowerCase();

  if (platform === 'TikTok') {
    const username = pathname
      .split('/')
      .filter(Boolean)
      .find(x => x.startsWith('@'));

    if (username) {
      pathname = '/' + username;
    }
  }

  if (platform === 'Kick') {
    return 'Kick:' +
      (pathname.split('/').filter(Boolean)[0] || '');
  }

  if (platform === 'Twitch') {
    pathname = '/' +
      (pathname.split('/').filter(Boolean)[0] || '');
  }

  return (
    platform + ':' +
    url.hostname.toLowerCase() + ':' +
    pathname
  );
}

function sameChannel(platform, a, b) {
  try {
    return (
      normalizeChannel(platform, a) ===
      normalizeChannel(platform, b)
    );
  } catch {
    return false;
  }
}

function findItem(items, discordId, platform, channel) {
  return items.find(item =>
    String(item.discordId) === String(discordId) &&
    item.platform === platform &&
    sameChannel(platform, item.channel, channel)
  );
}

function channelHandle(platform, url) {
  try {
    const parts = new URL(url)
      .pathname
      .split('/')
      .filter(Boolean);

    if (platform === 'TikTok') {
      return (
        parts.find(x => x.startsWith('@')) ||
        parts[0] ||
        ''
      );
    }

    return parts[0] || '';
  } catch {
    return '';
  }
}

function displayName(item) {
  return (
    item.channelName ||
    channelHandle(item.platform, item.channel) ||
    item.name ||
    'Membro'
  );
}

// =====================================
// VALIDAR LINKS
// =====================================

function validUrl(platform, value) {
  try {
    const url = new URL(value);

    const hosts = {
      Kick: [
        'kick.com',
        'www.kick.com'
      ],

      TikTok: [
        'tiktok.com',
        'www.tiktok.com',
        'm.tiktok.com'
      ],

      Twitch: [
        'twitch.tv',
        'www.twitch.tv'
      ],

      YouTube: [
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'youtu.be'
      ]
    };

    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (hosts[platform] || []).includes(
        url.hostname.toLowerCase()
      ) &&
      url.pathname.length > 1
    );

  } catch {
    return false;
  }
}

// =====================================
// COMUNICAÇÃO COM O SITE
// =====================================

async function siteSync(method, endpoint, payload) {
  if (!SITE_URL || !process.env.BOT_SYNC_SECRET) {
    throw new Error(
      'Configure SITE_URL e BOT_SYNC_SECRET'
    );
  }

  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(
        SITE_URL + '/api/bot/streams' + endpoint,
        {
          method,

          headers: {
            'Content-Type': 'application/json',
            Authorization:
              'Bearer ' + process.env.BOT_SYNC_SECRET
          },

          body: JSON.stringify(payload),

          signal: AbortSignal.timeout(30000)
        }
      );

      if (!response.ok) {
        const detail = await response.text()
          .catch(() => '');

        throw new Error(
          'Site HTTP ' + response.status +
          ' ' + detail.slice(0, 150)
        );
      }

      return await response.json()
        .catch(() => ({ ok: true }));

    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

// =====================================
// CLIENTE DISCORD
// =====================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ]
});

const platforms = [
  { name: 'TikTok', value: 'TikTok' },
  { name: 'Twitch', value: 'Twitch' },
  { name: 'YouTube', value: 'YouTube' },
  { name: 'Kick', value: 'Kick' }
];

function platformOption(command) {
  return command.addStringOption(option =>
    option
      .setName('plataforma')
      .setDescription('Escolha a plataforma')
      .setRequired(true)
      .addChoices(...platforms)
  );
}

function channelOption(command) {
  return command.addStringOption(option =>
    option
      .setName('url')
      .setDescription('Link completo do canal')
      .setRequired(true)
  );
}

// =====================================
// COMANDOS /LIVE
// =====================================

const command = new SlashCommandBuilder()

  .setName('live')
  .setDescription('Central de lives da Tropa do Japao')

  .addSubcommand(sub =>
    platformOption(
      sub
        .setName('cadastrar')
        .setDescription('Cadastrar seu canal')
    )

    .addStringOption(option =>
      option
        .setName('url')
        .setDescription('Link do canal')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('nome')
        .setDescription('Nome exibido no site')
        .setMaxLength(80)
    )
  )

  .addSubcommand(sub =>
    channelOption(
      platformOption(
        sub
          .setName('remover')
          .setDescription('Remover canal')
      )
    )
  )

  .addSubcommand(sub =>
    sub
      .setName('listar')
      .setDescription('Listar seus canais')
  )

  .addSubcommand(sub =>
    channelOption(
      platformOption(
        sub
          .setName('anunciar')
          .setDescription('Marcar canal AO VIVO')
      )
    )
  )

  .addSubcommand(sub =>
    channelOption(
      platformOption(
        sub
          .setName('encerrar')
          .setDescription('Marcar canal OFFLINE')
      )
    )
  );

// =====================================
// NOVO VISUAL DOS ANÚNCIOS
// =====================================

async function announce(item) {

  const channel = await client.channels.fetch(CHANNEL);

  if (
    !channel ||
    !channel.isTextBased() ||
    typeof channel.send !== 'function'
  ) {
    throw new Error(
      'Canal de anúncios não encontrado'
    );
  }

  if (!validUrl(item.platform, item.channel)) {
    throw new Error('Link do canal inválido');
  }

  const name = String(
    displayName(item)
  ).slice(0, 100);

  let avatar = LOGO;

  try {
    if (channel.guild && item.discordId) {
      const member = await channel.guild.members.fetch(
        String(item.discordId)
      );

      avatar = member.displayAvatarURL({
        size: 256
      });
    }
  } catch {
    avatar = LOGO;
  }

  const embed = new EmbedBuilder()

    .setColor(
      COLORS[item.platform] || 0xd92032
    )

    .setAuthor({
      name: '🇯🇵 TROPA DO JAPÃO | CENTRAL DE LIVES',
      iconURL: LOGO
    })

    .setTitle(
      '🔴 ' + name.toUpperCase() + ' ESTÁ AO VIVO!'
    )

    .setURL(item.channel)

    .setDescription(
      '**UMA NOVA TRANSMISSÃO COMEÇOU!**\n\n' +
      'Chega junto, fortalece nossa tropa e ' +
      'acompanhe mais uma transmissão ao vivo.\n\n' +
      '🇯🇵 União, respeito e presença.'
    )

    .addFields(
      {
        name: '👤 Streamer',
        value: name,
        inline: true
      },
      {
        name: '📺 Plataforma',
        value: item.platform,
        inline: true
      },
      {
        name: '🟢 Status',
        value: 'AO VIVO',
        inline: true
      },
      {
        name: '📍 Cidade',
        value: 'Lado Leste RP',
        inline: true
      },
      {
        name: '⏰ Anunciada',
        value: '<t:' +
          Math.floor(Date.now() / 1000) +
          ':R>',
        inline: true
      }
    )

    .setThumbnail(avatar)

    .setImage(
      process.env.LIVE_BANNER_URL || LOGO
    )

    .setFooter({
      text: 'Tropa do Japão • Sistema de divulgação',
      iconURL: LOGO
    })

    .setTimestamp();

  const buttons = new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setLabel('Assistir live')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Link)
        .setURL(item.channel),

      new ButtonBuilder()
        .setLabel('Portal oficial')
        .setEmoji('🌐')
        .setStyle(ButtonStyle.Link)
        .setURL(PORTAL + '/#lives')

    );

  await channel.send({
    embeds: [embed],
    components: [buttons],
    allowedMentions: {
      parse: []
    }
  });

  console.log(
    '📢 Anúncio enviado:',
    name,
    item.platform
  );
}

// =====================================
// EXECUTAR COMANDOS
// =====================================

client.on(Events.InteractionCreate, async interaction => {

  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'live'
  ) {
    return;
  }

  try {

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    const sub = interaction.options.getSubcommand();

    const platform =
      interaction.options.getString('plataforma');

    const url = (
      interaction.options.getString('url') || ''
    ).trim();

    const uid = interaction.user.id;
    const items = read();

    // =====================================
    // LISTAR CANAIS
    // =====================================

    if (sub === 'listar') {

      const own = items.filter(
        item => String(item.discordId) === uid
      );

      if (!own.length) {
        return interaction.editReply(
          '❌ Nenhum canal cadastrado.'
        );
      }

      const message = own.map((item, index) =>
        (index + 1) + '. ' +
        displayName(item) + ' — ' +
        item.platform + '\n' +
        item.channel + '\n' +
        (item.live ? '🔴 AO VIVO' : '⚫ OFFLINE')
      ).join('\n\n');

      return interaction.editReply(
        message.slice(0, 1900)
      );
    }

    // =====================================
    // CADASTRAR CANAL
    // =====================================

    if (sub === 'cadastrar') {

      if (!validUrl(platform, url)) {
        return interaction.editReply(
          '❌ Link inválido. Envie a URL completa.'
        );
      }

      const name =
        interaction.member?.displayName ||
        interaction.user.globalName ||
        interaction.user.username;

      const channelName = (
        interaction.options.getString('nome') || ''
      ).trim() ||
        channelHandle(platform, url) ||
        name;

      await siteSync('POST', '', {
        discordId: uid,
        name,
        channelName,
        platform,
        channel: url
      });

      const latest = read();

      const old = findItem(
        latest,
        uid,
        platform,
        url
      );

      if (old) {
        old.name = name;
        old.channelName = channelName;

      } else {

        latest.push({
          discordId: uid,
          name,
          channelName,
          platform,
          channel: url,
          live: false,
          lastAnnounced: '',
          lastManual: 0
        });
      }

      write(latest);

      return interaction.editReply(
        '✅ Canal cadastrado com sucesso!\n\n' +
        '👤 ' + channelName + '\n' +
        '📺 ' + platform + '\n' +
        '🔗 ' + url
      );
    }

    // =====================================
    // LOCALIZAR CANAL
    // =====================================

    const item = findItem(
      items,
      uid,
      platform,
      url
    );

    if (!item) {
      return interaction.editReply(
        '❌ Canal não encontrado.\n' +
        'Use /live listar para conferir.'
      );
    }

    // =====================================
    // REMOVER CANAL
    // =====================================

    if (sub === 'remover') {

      await siteSync('DELETE', '', {
        discordId: uid,
        platform,
        channel: item.channel
      });

      const latest = read();

      write(latest.filter(x =>
        !(
          String(x.discordId) === uid &&
          x.platform === platform &&
          sameChannel(platform, x.channel, item.channel)
        )
      ));

      return interaction.editReply(
        '🗑️ Canal removido: ' + displayName(item)
      );
    }

    // =====================================
    // ANUNCIAR MANUALMENTE
    // =====================================

    if (sub === 'anunciar') {

      const now = Date.now();

      if (
        item.live &&
        item.lastManual &&
        now - item.lastManual < 3600000
      ) {
        return interaction.editReply(
          'Este canal já está marcado AO VIVO.'
        );
      }

      await siteSync('PATCH', '/status', {
        discordId: uid,
        platform,
        channel: item.channel,
        live: true,
        lastAnnounced: String(now)
      });

      const latest = read();

      const target = findItem(
        latest,
        uid,
        platform,
        item.channel
      );

      if (!target) {
        return interaction.editReply(
          'Canal não encontrado.'
        );
      }

      target.live = true;
      target.lastManual = now;
      target.lastAnnounced = String(now);

      write(latest);

      try {

        await announce(target);

        return interaction.editReply(
          '🔴 ' + displayName(target) +
          ' AO VIVO no site e Discord!'
        );

      } catch (error) {

        console.error(
          'Erro no anúncio:',
          error.message
        );

        return interaction.editReply(
          'Site atualizado, mas o anúncio falhou.'
        );
      }
    }

    // =====================================
    // ENCERRAR LIVE
    // =====================================

    if (sub === 'encerrar') {

      await siteSync('PATCH', '/status', {
        discordId: uid,
        platform,
        channel: item.channel,
        live: false,
        lastAnnounced: ''
      });

      const latest = read();

      const target = findItem(
        latest,
        uid,
        platform,
        item.channel
      );

      if (target) {
        target.live = false;
        target.lastManual = 0;
        target.lastAnnounced = '';

        write(latest);
      }

      return interaction.editReply(
        '⚫ ' + displayName(item) +
        ' marcado OFFLINE no site.'
      );
    }

  } catch (error) {

    console.error(
      'Erro no comando /live:',
      error.message
    );

    try {
      await interaction.editReply(
        '❌ Erro: ' +
        String(error.message).slice(0, 250)
      );
    } catch {}
  }
});

// =====================================
// SINCRONIZAR STATUS DAS LIVES
// =====================================

async function syncLive(item, isLive, streamId) {

  const current = findItem(
    read(),
    item.discordId,
    item.platform,
    item.channel
  );

  if (!current) return;

  const changed = current.live !== isLive;

  const lastAnnounced = isLive
    ? (
        changed
          ? String(streamId || Date.now())
          : current.lastAnnounced || ''
      )
    : '';

  await siteSync('PATCH', '/status', {
    discordId: current.discordId,
    platform: current.platform,
    channel: current.channel,
    live: isLive,
    lastAnnounced
  });

  const latest = read();

  const target = findItem(
    latest,
    item.discordId,
    item.platform,
    item.channel
  );

  if (!target) return;

  target.live = isLive;
  target.lastAnnounced = lastAnnounced;
  target.lastManual = 0;

  write(latest);

  if (changed || item.platform === 'TikTok') {
    console.log(
      '🇯🇵 ' + item.platform + ' sincronizado:',
      displayName(target),
      isLive ? '🔴 AO VIVO' : '⚫ OFFLINE'
    );
  }

  if (changed && isLive) {
    try {
      await announce(target);
    } catch (error) {
      console.error(
        'Erro no anúncio ' + item.platform + ':',
        error.message
      );
    }
  }
}

// =====================================
// TWITCH AUTOMÁTICO
// =====================================

let twitchToken = '';
let twitchExpiry = 0;
let pollingTwitch = false;

async function twitchAuth() {

  if (
    twitchToken &&
    Date.now() < twitchExpiry
  ) {
    return twitchToken;
  }

  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;

  if (!id || !secret) return null;

  const response = await fetch(
    'https://id.twitch.tv/oauth2/token',
    {
      method: 'POST',

      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded'
      },

      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        grant_type: 'client_credentials'
      }),

      signal: AbortSignal.timeout(15000)
    }
  );

  if (!response.ok) {
    throw new Error(
      'Erro autenticando Twitch: ' +
      response.status
    );
  }

  const data = await response.json();

  twitchToken = data.access_token;

  twitchExpiry =
    Date.now() +
    Math.max(0, data.expires_in - 120) * 1000;

  return twitchToken;
}

async function pollTwitch() {

  if (
    pollingTwitch ||
    !process.env.TWITCH_CLIENT_ID ||
    !process.env.TWITCH_CLIENT_SECRET
  ) return;

  pollingTwitch = true;

  try {

    const targets = read().filter(
      item => item.platform === 'Twitch'
    );

    if (!targets.length) return;

    const token = await twitchAuth();

    for (const item of targets) {

      try {

        const login = channelHandle(
          'Twitch',
          item.channel
        );

        if (!login) continue;

        const response = await fetch(
          'https://api.twitch.tv/helix/streams?user_login=' +
          encodeURIComponent(login),
          {
            headers: {
              'Client-ID':
                process.env.TWITCH_CLIENT_ID,

              Authorization:
                'Bearer ' + token
            },

            signal: AbortSignal.timeout(15000)
          }
        );

        if (!response.ok) {

          if (response.status === 401) {
            twitchToken = '';
          }

          throw new Error(
            'Twitch HTTP ' + response.status
          );
        }

        const data = await response.json();

        if (!Array.isArray(data.data)) {
          continue;
        }

        const stream = data.data[0];

        await syncLive(
          item,
          Boolean(stream),
          stream?.id
        );

      } catch (error) {

        console.error(
          'Erro Twitch:',
          error.message
        );
      }
    }

  } catch (error) {

    console.error(
      'Monitoramento Twitch:',
      error.message
    );

  } finally {
    pollingTwitch = false;
  }
}

// =====================================
// TIKTOK AUTOMÁTICO
// =====================================

let checkingTikTok = false;

const tiktokObservations = new Map();

async function pollTikTok() {

  if (checkingTikTok) return;

  checkingTikTok = true;

  try {

    let TikTokLiveConnection;

    try {

      ({ TikTokLiveConnection } =
        require('tiktok-live-connector'));

    } catch {

      console.error(
        'Instale: npm install tiktok-live-connector'
      );

      return;
    }

    const targets = read().filter(
      item => item.platform === 'TikTok'
    );

    for (const item of targets) {

      let key;

      try {

        key =
          item.discordId + ':TikTok:' +
          normalizeChannel('TikTok', item.channel);

        const username = channelHandle(
          'TikTok',
          item.channel
        ).replace(/^@/, '');

        if (!/^[a-zA-Z0-9._]{2,24}$/.test(username)) {
          continue;
        }

        const connection = new TikTokLiveConnection(
          username,
          {
            enableExtendedGiftInfo: false
          }
        );

        let timeout;

        let result;

        try {

          result = await Promise.race([
            connection.fetchIsLive(),

            new Promise((_, reject) => {
              timeout = setTimeout(() => {
                reject(
                  new Error('Tempo esgotado TikTok')
                );
              }, 12000);
            })
          ]);

        } finally {
          clearTimeout(timeout);
        }

        if (typeof result !== 'boolean') {

          tiktokObservations.delete(key);

          continue;
        }

        const isLive = result;

        const previous =
          tiktokObservations.get(key);

        const count =
          previous?.value === isLive
            ? previous.count + 1
            : 1;

        tiktokObservations.set(key, {
          value: isLive,
          count
        });

        console.log(
          'TikTok verificado:',
          username,
          isLive ? 'AO VIVO' : 'OFFLINE',
          'Confirmações:',
          count
        );

        // Duas confirmações consecutivas
        if (count < 2) continue;

        await syncLive(
          item,
          isLive,
          Date.now()
        );

      } catch (error) {

        console.error(
          'Erro TikTok:',
          channelHandle('TikTok', item.channel),
          error.message
        );

        if (key) {
          tiktokObservations.delete(key);
        }
      }
    }

  } catch (error) {

    console.error(
      'Erro geral TikTok:',
      error.message
    );

  } finally {
    checkingTikTok = false;
  }
}

// =====================================
// KICK AUTOMÁTICO
// =====================================

let kickToken = '';
let kickExpiry = 0;
let pollingKick = false;

async function pollKick() {

  if (
    pollingKick ||
    !process.env.KICK_CLIENT_ID ||
    !process.env.KICK_CLIENT_SECRET
  ) return;

  pollingKick = true;

  try {

    const targets = read().filter(
      item => item.platform === 'Kick'
    );

    if (!targets.length) return;

    if (!kickToken || Date.now() >= kickExpiry) {

      const response = await fetch(
        'https://id.kick.com/oauth/token',
        {
          method: 'POST',

          body: new URLSearchParams({
            client_id:
              process.env.KICK_CLIENT_ID,

            client_secret:
              process.env.KICK_CLIENT_SECRET,

            grant_type:
              'client_credentials'
          }),

          signal: AbortSignal.timeout(15000)
        }
      );

      if (!response.ok) {
        throw new Error(
          'Kick OAuth HTTP ' + response.status
        );
      }

      const auth = await response.json();

      kickToken = auth.access_token;

      kickExpiry =
        Date.now() +
        Math.max(0, auth.expires_in - 60) * 1000;
    }

    for (const item of targets) {

      try {

        const slug = channelHandle(
          'Kick',
          item.channel
        ).toLowerCase();

        if (!slug) continue;

        const response = await fetch(
          'https://api.kick.com/public/v1/channels?slug=' +
          encodeURIComponent(slug),
          {
            headers: {
              Authorization:
                'Bearer ' + kickToken
            },

            signal: AbortSignal.timeout(15000)
          }
        );

        if (!response.ok) {

          if (response.status === 401) {
            kickToken = '';
          }

          throw new Error(
            'Kick HTTP ' + response.status
          );
        }

        const data = await response.json();

        const channel = data.data?.find(
          x => String(x.slug).toLowerCase() === slug
        );

        if (
          typeof channel?.stream?.is_live !== 'boolean'
        ) {
          continue;
        }

        const live = channel.stream.is_live;

        console.log(
          '🟢 Kick verificado:',
          slug,
          live ? 'AO VIVO' : 'OFFLINE'
        );

        await syncLive(
          item,
          live,
          Date.now()
        );

      } catch (error) {

        console.error(
          'Erro Kick:',
          error.message
        );
      }
    }

  } catch (error) {

    console.error(
      'Monitoramento Kick:',
      error.message
    );

  } finally {
    pollingKick = false;
  }
}

// =====================================
// ONLINE E OFFLINE DO DISCORD
// =====================================

const onlineStatuses = new Set([
  'online',
  'idle',
  'dnd'
]);

const pendingPresence = new Map();

let syncingPresence = false;
let flushingPresence = false;

async function sendPresence(endpoint, payload) {

  if (!SITE_URL || !process.env.BOT_SYNC_SECRET) {
    throw new Error(
      'Configure SITE_URL e BOT_SYNC_SECRET'
    );
  }

  const response = await fetch(
    SITE_URL + '/api/bot/presence' + endpoint,
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',

        Authorization:
          'Bearer ' + process.env.BOT_SYNC_SECRET
      },

      body: JSON.stringify(payload),

      signal: AbortSignal.timeout(30000)
    }
  );

  if (!response.ok) {

    const detail = await response.text()
      .catch(() => '');

    throw new Error(
      'Erro HTTP ' + response.status +
      ': ' + detail.slice(0, 150)
    );
  }
}

// =====================================
// DETECTAR MUDANÇAS NO DISCORD
// =====================================

client.on(
  Events.PresenceUpdate,
  (oldPresence, newPresence) => {

    if (!newPresence) return;

    const guildId = process.env.DISCORD_GUILD_ID;

    if (
      guildId &&
      newPresence.guild?.id !== guildId
    ) return;

    const discordId = newPresence.userId;

    if (!discordId) return;

    const online = onlineStatuses.has(
      newPresence.status
    );

    pendingPresence.set(
      discordId,
      online
    );
  }
);

// =====================================
// ENVIAR ALTERAÇÕES DE STATUS
// =====================================

async function flushPresence() {

  if (
    flushingPresence ||
    pendingPresence.size === 0
  ) return;

  flushingPresence = true;

  try {

    const changes = [
      ...pendingPresence.entries()
    ];

    for (const [discordId, online] of changes) {

      try {

        await sendPresence('', {
          discordId,
          online
        });

        if (
          pendingPresence.get(discordId) === online
        ) {
          pendingPresence.delete(discordId);
        }

      } catch (error) {

        console.error(
          'Erro sincronizando presença:',
          discordId,
          error.message
        );
      }
    }

  } finally {
    flushingPresence = false;
  }
}

// =====================================
// SINCRONIZAR TODOS OS MEMBROS
// =====================================

async function syncAllPresences() {

  if (syncingPresence) return;

  syncingPresence = true;

  try {

    const guildId = process.env.DISCORD_GUILD_ID;

    if (!guildId) {

      console.error(
        'Configure DISCORD_GUILD_ID no .env'
      );

      return;
    }

    const guild = await client.guilds.fetch(
      guildId
    );

    await guild.members.fetch({
      withPresences: true
    });

    const onlineIds = new Set();

    for (
      const presence of
      guild.presences.cache.values()
    ) {

      if (onlineStatuses.has(presence.status)) {

        onlineIds.add(
          presence.userId
        );
      }
    }

    await sendPresence('/snapshot', {
      onlineIds: [...onlineIds]
    });

    console.log(
      '🇯🇵 Presenças sincronizadas:',
      onlineIds.size,
      'membros online'
    );

  } catch (error) {

    console.error(
      'Erro sincronizando Discord:',
      error.message
    );

  } finally {
    syncingPresence = false;
  }
}

// =====================================
// INICIAR BOT DIV
// =====================================

client.once(Events.ClientReady, async () => {

  console.log(
    '====================================='
  );

  console.log(
    '🇯🇵 BOT DIV CONECTADO:',
    client.user.tag
  );

  console.log(
    '🎨 Novo sistema visual de lives ativo!'
  );

  console.log(
    '====================================='
  );

  // STATUS DO BOT

  client.user.setActivity(
    'Lives da Tropa do Japão'
  );

  // REGISTRAR COMANDOS

  try {

    const rest = new REST({
      version: '10'
    }).setToken(
      process.env.DISCORD_BOT_TOKEN
    );

    const route = process.env.DISCORD_GUILD_ID
      ? Routes.applicationGuildCommands(
          client.user.id,
          process.env.DISCORD_GUILD_ID
        )
      : Routes.applicationCommands(
          client.user.id
        );

    await rest.put(route, {
      body: [command.toJSON()]
    });

    console.log(
      '✅ Comando /live atualizado!'
    );

  } catch (error) {

    console.error(
      'Erro registrando /live:',
      error.message
    );
  }

  // INICIAR MONITORAMENTO

  pollKick().catch(console.error);

  pollTwitch().catch(console.error);

  pollTikTok().catch(console.error);

  // KICK A CADA 2 MINUTOS

  setInterval(() => {

    pollKick().catch(console.error);

  }, 120000);

  // TWITCH A CADA 2 MINUTOS

  setInterval(() => {

    pollTwitch().catch(console.error);

  }, 120000);

  // TIKTOK A CADA 1 MINUTO

  setInterval(() => {

    pollTikTok().catch(console.error);

  }, 60000);

  // PRESENÇAS DO DISCORD

  await syncAllPresences();

  setInterval(() => {

    flushPresence().catch(console.error);

  }, 3000);

  setInterval(() => {

    syncAllPresences().catch(console.error);

  }, 60000);

  console.log(
    '🟢 Sistema ONLINE/OFFLINE iniciado!'
  );

  console.log(
    '🟢 Kick, Twitch e TikTok configurados!'
  );

  console.log(
    '🔴 YouTube disponível no modo manual!'
  );
});

// =====================================
// TRATAMENTO DE ERROS
// =====================================

client.on('error', error => {

  console.error(
    'Erro Discord:',
    error.message
  );
});

// =====================================
// LOGIN DO BOT
// =====================================

if (!process.env.DISCORD_BOT_TOKEN) {

  console.error(
    'Configure DISCORD_BOT_TOKEN no .env'
  );

  process.exit(1);
}

client.login(
  process.env.DISCORD_BOT_TOKEN
).catch(error => {

  console.error(
    'Falha ao conectar bot:',
    error.message
  );

  process.exitCode = 1;
});

// FARM: lembretes em horário de Brasília
let farmBusy=false;
async function farmReminder(){
 if(farmBusy||!client.isReady()||!SITE_URL||!process.env.BOT_SYNC_SECRET)return;
 const hour=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(new Date());
 if(!['12','20'].includes(hour))return;
 farmBusy=true;
 try{
 const headers={Authorization:'Bearer '+process.env.BOT_SYNC_SECRET,'Content-Type':'application/json'};
 const r=await fetch(SITE_URL+'/api/bot/farm/pending',{headers,signal:AbortSignal.timeout(30000)});if(!r.ok)return;const d=await r.json();
 for(const m of d.members){try{const c=await fetch(SITE_URL+'/api/bot/farm/claim',{method:'POST',headers,body:JSON.stringify({id:m.id,slot:hour,day:d.day}),signal:AbortSignal.timeout(30000)});if(!c.ok||!(await c.json()).claimed)continue;const u=await client.users.fetch(m.id);await u.send('🇯🇵 FARM RP — Meta: '+d.goal+' | Entregue: '+m.total+' | Faltante: '+(d.goal-m.total)+' flores. Consulte '+PORTAL+'/farm.html');}catch(e){console.error('FARM DM não enviada:',e.name);}}
 }catch(e){console.error('FARM lembrete:',e.name);}finally{farmBusy=false;}
}
setInterval(farmReminder,60000);
