
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  Events
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// ======================================
// CONFIGURACOES
// ======================================

const file = path.join(__dirname, 'data', 'streams.json');
const CHANNEL = process.env.DISCORD_LIVES_CHANNEL_ID ||
  '1494303769796808884';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');

fs.mkdirSync(path.dirname(file), { recursive: true });

if (!fs.existsSync(file)) {
  fs.writeFileSync(file, '[]');
}

function read() {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.error('Erro lendo streams.json:', error.message);
    return [];
  }
}

function write(items) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(items, null, 2));
  fs.renameSync(temp, file);
}

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

function sameChannel(platform, a, b) {
  try {
    return normalizeChannel(platform, a) ===
      normalizeChannel(platform, b);
  } catch {
    return false;
  }
}

function findItem(items, discordId, platform, channel) {
  return items.find(x =>
    x.discordId === discordId &&
    x.platform === platform &&
    sameChannel(platform, x.channel, channel)
  );
}

// ======================================
// SINCRONIZACAO COM O SITE
// ======================================

async function siteSync(method, endpoint, payload) {
  if (!SITE_URL || !process.env.BOT_SYNC_SECRET) {
    throw new Error('Configure SITE_URL e BOT_SYNC_SECRET no .env');
  }

  const url = SITE_URL + '/api/bot/streams' + endpoint;

  // Segunda tentativa ajuda quando o Render demora a responder.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + process.env.BOT_SYNC_SECRET
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          'Site HTTP ' + response.status + ': ' +
          detail.slice(0, 200)
        );
      }

      return;
    } catch (error) {
      if (attempt === 2 ||
          !['TimeoutError', 'TypeError'].includes(error.name)) {
        throw error;
      }

      console.log('Render demorou. Tentando novamente...');
    }
  }
}

// ======================================
// DISCORD
// ======================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const platforms = [
  { name: 'TikTok', value: 'TikTok' },
  { name: 'Twitch', value: 'Twitch' },
  { name: 'YouTube', value: 'YouTube' }
];

function platformOption(s) {
  return s.addStringOption(o =>
    o.setName('plataforma')
      .setDescription('Escolha a plataforma')
      .setRequired(true)
      .addChoices(...platforms)
  );
}

function channelOption(s) {
  return s.addStringOption(o =>
    o.setName('url')
      .setDescription('Link do canal que deseja gerenciar')
      .setRequired(true)
  );
}

const command = new SlashCommandBuilder()
  .setName('live')
  .setDescription('Gerenciar lives da Tropa do Japao')

  .addSubcommand(s =>
    platformOption(
      s.setName('cadastrar')
        .setDescription('Cadastrar um novo canal')
    )
      .addStringOption(o =>
        o.setName('url')
          .setDescription('Link do TikTok, Twitch ou YouTube')
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName('nome')
          .setDescription('Nome da pessoa no site')
          .setMaxLength(80)
      )
  )

  .addSubcommand(s =>
    channelOption(
      platformOption(
        s.setName('remover')
          .setDescription('Remover um canal especifico')
      )
    )
  )

  .addSubcommand(s =>
    s.setName('listar')
      .setDescription('Listar todos os seus canais')
  )

  .addSubcommand(s =>
    channelOption(
      platformOption(
        s.setName('anunciar')
          .setDescription('Marcar canal como AO VIVO')
      )
    )
  )

  .addSubcommand(s =>
    channelOption(
      platformOption(
        s.setName('encerrar')
          .setDescription('Marcar canal como OFFLINE')
      )
    )
  );

// ======================================
// FUNCOES AUXILIARES
// ======================================

function channelHandle(platform, url) {
  try {
    const parts = new URL(url).pathname
      .split('/').filter(Boolean);

    if (platform === 'TikTok') {
      return parts.find(x => x.startsWith('@')) || parts[0] || '';
    }

    return parts[0] || '';
  } catch {
    return '';
  }
}

function displayName(item) {
  return item.channelName ||
    channelHandle(item.platform, item.channel) ||
    item.name;
}

function validUrl(platform, value) {
  try {
    const u = new URL(value);

    const allowed = {
      TikTok: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'],
      Twitch: ['twitch.tv', 'www.twitch.tv'],
      YouTube: [
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'youtu.be'
      ]
    };

    return u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      (allowed[platform] || []).includes(u.hostname.toLowerCase()) &&
      u.pathname.length > 1;
  } catch {
    return false;
  }
}

async function announce(item) {
  const channel = await client.channels.fetch(CHANNEL);

  if (!channel || !channel.isTextBased() ||
      typeof channel.send !== 'function') {
    throw new Error('Canal de anuncios nao encontrado');
  }

  const embed = new EmbedBuilder()
    .setColor(0xd92032)
    .setTitle('🔴 MEMBRO AO VIVO — TROPA DO JAPÃO 🇯🇵')
    .setDescription(
      `**${displayName(item)}** está transmitindo na ` +
      `**${item.platform}**!\n\n` +
      `[🔴 ASSISTIR AGORA](${item.channel})`
    )
    .addFields(
      { name: 'Cidade', value: 'Lado Leste RP', inline: true },
      { name: 'Plataforma', value: item.platform, inline: true }
    )
    .setTimestamp();

  await channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] }
  });
}

// ======================================
// COMANDOS /LIVE
// ======================================

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() ||
      interaction.commandName !== 'live') return;

  try {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    const sub = interaction.options.getSubcommand();
    const platform = interaction.options.getString('plataforma');
    const url = (interaction.options.getString('url') || '').trim();
    const uid = interaction.user.id;
    const items = read();

    // LISTAR
    if (sub === 'listar') {
      const own = items.filter(x => x.discordId === uid);

      if (!own.length) {
        return interaction.editReply('Nenhum canal cadastrado.');
      }

      const message = own.map((x, i) =>
        `${i + 1}. ${displayName(x)} — ${x.platform}\n` +
        `${x.channel}\n` +
        `${x.live ? '🔴 AO VIVO' : '⚫ OFFLINE'}`
      ).join('\n\n');

      return interaction.editReply(message.slice(0, 1900));
    }

    // CADASTRAR
    if (sub === 'cadastrar') {
      if (!validUrl(platform, url)) {
        return interaction.editReply(
          'Link invalido. Envie a URL completa do canal.'
        );
      }

      const name =
        interaction.member?.displayName ||
        interaction.user.globalName ||
        interaction.user.username;

      const channelName =
        (interaction.options.getString('nome') || '').trim() ||
        channelHandle(platform, url) ||
        name;

      const old = findItem(items, uid, platform, url);

      // Nao altera outros canais da mesma plataforma.
      await siteSync('POST', '', {
        discordId: uid,
        name,
        channelName,
        platform,
        channel: url
      });

      if (old) {
        old.name = name;
        old.channelName = channelName;
      } else {
        items.push({
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

      write(items);

      return interaction.editReply(
        `✅ Canal cadastrado!\n` +
        `👤 ${channelName}\n` +
        `📺 ${platform}\n${url}\n\n` +
        `Os outros canais foram mantidos.`
      );
    }

    // OUTROS COMANDOS EXIGEM CANAL CADASTRADO
    const item = findItem(items, uid, platform, url);

    if (!item) {
      return interaction.editReply(
        'Canal nao encontrado no seu cadastro.\n' +
        'Use /live listar para conferir os links.'
      );
    }

    // REMOVER
    if (sub === 'remover') {
      await siteSync('DELETE', '', {
        discordId: uid,
        platform,
        channel: item.channel
      });

      write(items.filter(x => x !== item));

      return interaction.editReply(
        `🗑️ Canal removido: ${displayName(item)}\n` +
        'Os demais canais continuam cadastrados.'
      );
    }

    // ANUNCIAR
    if (sub === 'anunciar') {
      const now = Date.now();

      if (item.live && item.lastManual &&
          now - item.lastManual < 3600000) {
        return interaction.editReply(
          'Este canal ja esta marcado AO VIVO.'
        );
      }

      await siteSync('PATCH', '/status', {
        discordId: uid,
        platform,
        channel: item.channel,
        live: true,
        lastAnnounced: String(now)
      });

      item.live = true;
      item.lastManual = now;
      item.lastAnnounced = String(now);
      write(items);

      try {
        await announce(item);
        return interaction.editReply(
          `🔴 ${displayName(item)} AO VIVO no site e Discord!`
        );
      } catch (error) {
        console.error('Erro anuncio:', error.message);
        return interaction.editReply(
          '🔴 Site atualizado, mas anuncio no Discord falhou.'
        );
      }
    }

    // ENCERRAR
    if (sub === 'encerrar') {
      await siteSync('PATCH', '/status', {
        discordId: uid,
        platform,
        channel: item.channel,
        live: false,
        lastAnnounced: ''
      });

      item.live = false;
      item.lastAnnounced = '';
      item.lastManual = 0;
      write(items);

      return interaction.editReply(
        `⚫ ${displayName(item)} marcado OFFLINE no site.`
      );
    }

  } catch (error) {
    console.error('Erro no comando /live:', error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(
          '❌ Erro ao executar comando: ' +
          String(error.message).slice(0, 250)
        );
      } else {
        await interaction.reply({
          content: 'Erro ao executar comando.',
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (replyError) {
      console.error('Erro respondendo Discord:', replyError.message);
    }
  }
});

// ======================================
// TWITCH AUTOMATICO
// ======================================

let twitchToken = '';
let twitchExpiry = 0;
let pollingTwitch = false;

async function twitchAuth() {
  if (twitchToken && Date.now() < twitchExpiry) {
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
        'Content-Type': 'application/x-www-form-urlencoded'
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
    throw new Error('Credenciais Twitch invalidas');
  }

  const data = await response.json();

  twitchToken = data.access_token;
  twitchExpiry = Date.now() +
    Math.max(0, data.expires_in - 120) * 1000;

  return twitchToken;
}

async function pollTwitch() {
  if (pollingTwitch ||
      !process.env.TWITCH_CLIENT_ID ||
      !process.env.TWITCH_CLIENT_SECRET) return;

  pollingTwitch = true;

  try {
    const targets = read().filter(x => x.platform === 'Twitch');

    if (!targets.length) return;

    const token = await twitchAuth();

    for (const item of targets) {
      try {
        const login = channelHandle('Twitch', item.channel);
        if (!login) continue;

        const response = await fetch(
          'https://api.twitch.tv/helix/streams?user_login=' +
          encodeURIComponent(login),
          {
            headers: {
              'Client-ID': process.env.TWITCH_CLIENT_ID,
              Authorization: 'Bearer ' + token
            },
            signal: AbortSignal.timeout(15000)
          }
        );

        if (!response.ok) {
          throw new Error('Twitch API ' + response.status);
        }

        const data = await response.json();
        const stream = data.data?.[0];
        const isLive = Boolean(stream);

        const current = findItem(
          read(), item.discordId, 'Twitch', item.channel
        );

        if (!current || current.live === isLive) continue;

        const announcementId = isLive ? String(stream.id) : '';

        await siteSync('PATCH', '/status', {
          discordId: current.discordId,
          platform: 'Twitch',
          channel: current.channel,
          live: isLive,
          lastAnnounced: announcementId
        });

        const latest = read();
        const target = findItem(
          latest, item.discordId, 'Twitch', item.channel
        );

        if (!target) continue;

        target.live = isLive;
        target.lastAnnounced = announcementId;
        target.lastManual = 0;
        write(latest);

        console.log(
          'Twitch:', login, isLive ? 'AO VIVO' : 'OFFLINE'
        );

        if (isLive) {
          try {
            await announce(target);
          } catch (error) {
            console.error('Anuncio Twitch:', error.message);
          }
        }
      } catch (error) {
        console.error('Erro Twitch:', error.message);
      }
    }
  } catch (error) {
    console.error('Monitoramento Twitch:', error.message);
  } finally {
    pollingTwitch = false;
  }
}

// ======================================
// TIKTOK AUTOMATICO
// ======================================

let checkingTikTok = false;
const tiktokObservations = new Map();

async function pollTikTok() {
  if (checkingTikTok) return;

  checkingTikTok = true;

  try {
    let TikTokLiveConnection;

    try {
      ({ TikTokLiveConnection } = require('tiktok-live-connector'));
    } catch {
      console.error('Instale: npm install tiktok-live-connector');
      return;
    }

    const targets = read().filter(x => x.platform === 'TikTok');

    for (const item of targets) {
      const key = item.discordId + ':TikTok:' +
        normalizeChannel('TikTok', item.channel);

      try {
        const username = channelHandle(
          'TikTok', item.channel
        ).replace(/^@/, '');

        if (!/^[a-zA-Z0-9._]{2,24}$/.test(username)) {
          console.log('TikTok invalido:', username);
          continue;
        }

        const connection = new TikTokLiveConnection(
          username,
          { enableExtendedGiftInfo: false }
        );

        const result = await Promise.race([
          connection.fetchIsLive(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Tempo esgotado TikTok')),
              12000
            )
          )
        ]);

        if (typeof result !== 'boolean') {
          console.log('TikTok inconclusivo:', username);
          tiktokObservations.delete(key);
          continue;
        }

        const isLive = result;
        const previous = tiktokObservations.get(key);

        const count = previous?.value === isLive
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
          'Confirmacoes:', count
        );

        // Exige duas verificacoes iguais.
        if (count < 2) continue;

        const current = findItem(
          read(), item.discordId, 'TikTok', item.channel
        );

        if (!current || current.live === isLive) continue;

        const announcementId = isLive
          ? String(Date.now())
          : '';

        await siteSync('PATCH', '/status', {
          discordId: current.discordId,
          platform: 'TikTok',
          channel: current.channel,
          live: isLive,
          lastAnnounced: announcementId
        });

        const latest = read();
        const target = findItem(
          latest, item.discordId, 'TikTok', item.channel
        );

        if (!target) continue;

        target.live = isLive;
        target.lastAnnounced = announcementId;
        target.lastManual = 0;
        write(latest);

        console.log(
          'TikTok atualizado:',
          username,
          isLive ? 'AO VIVO' : 'OFFLINE'
        );

        if (isLive) {
          try {
            await announce(target);
          } catch (error) {
            console.error('Anuncio TikTok:', error.message);
          }
        }
      } catch (error) {
        console.error(
          'Erro TikTok:',
          channelHandle('TikTok', item.channel),
          error.message
        );

        tiktokObservations.delete(key);
      }
    }
  } finally {
    checkingTikTok = false;
  }
}

// ======================================
// INICIAR BOT
// ======================================

client.once(Events.ClientReady, async () => {
  console.log('🇯🇵 Bot conectado:', client.user.tag);

  try {
    const rest = new REST({ version: '10' })
      .setToken(process.env.DISCORD_BOT_TOKEN);

    const route = process.env.DISCORD_GUILD_ID
      ? Routes.applicationGuildCommands(
          client.user.id,
          process.env.DISCORD_GUILD_ID
        )
      : Routes.applicationCommands(client.user.id);

    await rest.put(route, {
      body: [command.toJSON()]
    });

    console.log('Comando /live atualizado!');
  } catch (error) {
    console.error('Erro registrando /live:', error.message);
  }

  pollTwitch().catch(console.error);
  pollTikTok().catch(console.error);

  setInterval(() => {
    pollTwitch().catch(console.error);
  }, 120000);

  setInterval(() => {
    pollTikTok().catch(console.error);
  }, 60000);
});

client.on('error', error => {
  console.error('Erro Discord:', error);
});

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('Configure DISCORD_BOT_TOKEN no .env');
  process.exit(1);
}

client.login(process.env.DISCORD_BOT_TOKEN)
  .catch(error => {
    console.error('Falha ao conectar bot:', error.message);
    process.exitCode = 1;
  });
