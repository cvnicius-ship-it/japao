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
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Erro lendo streams.json:', error.message);
    return [];
  }
}

function write(items) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
  fs.renameSync(tmp, file);
}

async function siteSync(method, endpoint, payload) {
  if (!SITE_URL || !process.env.BOT_SYNC_SECRET) {
    throw new Error('Configure SITE_URL e BOT_SYNC_SECRET no .env');
  }

  const response = await fetch(
    SITE_URL + '/api/bot/streams' + endpoint,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.BOT_SYNC_SECRET
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    throw new Error(
      'Erro ao sincronizar com site (HTTP ' +
      response.status + '): ' + detail.slice(0, 180)
    );
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const platforms = [
  { name: 'Twitch', value: 'Twitch' },
  { name: 'YouTube', value: 'YouTube' },
  { name: 'TikTok', value: 'TikTok' }
];

const command = new SlashCommandBuilder()
  .setName('live')
  .setDescription('Gerencie sua live da Tropa do Japão')

  .addSubcommand(s =>
    s.setName('cadastrar')
      .setDescription('Cadastre seu canal')
      .addStringOption(o =>
        o.setName('plataforma')
          .setDescription('Plataforma')
          .setRequired(true)
          .addChoices(...platforms)
      )
      .addStringOption(o =>
        o.setName('url')
          .setDescription('Link do canal')
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName('nome')
          .setDescription('Nome exibido no site')
          .setMaxLength(80)
      )
  )

  .addSubcommand(s =>
    s.setName('remover')
      .setDescription('Remova seu canal')
      .addStringOption(o =>
        o.setName('plataforma')
          .setDescription('Plataforma')
          .setRequired(true)
          .addChoices(...platforms)
      )
  )

  .addSubcommand(s =>
    s.setName('listar')
      .setDescription('Veja seus canais')
  )

  .addSubcommand(s =>
    s.setName('anunciar')
      .setDescription('Marque sua transmissão como AO VIVO')
      .addStringOption(o =>
        o.setName('plataforma')
          .setDescription('Plataforma')
          .setRequired(true)
          .addChoices(...platforms)
      )
  )

  .addSubcommand(s =>
    s.setName('encerrar')
      .setDescription('Marque sua transmissão como OFFLINE')
      .addStringOption(o =>
        o.setName('plataforma')
          .setDescription('Plataforma')
          .setRequired(true)
          .addChoices(...platforms)
      )
  );

function channelHandle(platform, url) {
  try {
    const parts = new URL(url).pathname
      .split('/')
      .filter(Boolean);

    if (platform === 'TikTok') {
      return parts.find(x => x.startsWith('@')) ||
        parts[0] || '';
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

    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port
    ) {
      return false;
    }

    const allowed = {
      Twitch: ['twitch.tv', 'www.twitch.tv'],
      YouTube: [
        'youtube.com',
        'www.youtube.com',
        'youtu.be',
        'm.youtube.com'
      ],
      TikTok: [
        'tiktok.com',
        'www.tiktok.com',
        'm.tiktok.com'
      ]
    };

    return (allowed[platform] || [])
      .includes(u.hostname.toLowerCase()) &&
      u.pathname.length > 1;
  } catch {
    return false;
  }
}

async function announce(item) {
  const channel = await client.channels.fetch(CHANNEL);

  if (
    !channel ||
    !channel.isTextBased() ||
    typeof channel.send !== 'function'
  ) {
    throw new Error(
      'Canal de lives não encontrado ou sem permissão'
    );
  }

  const embed = new EmbedBuilder()
    .setColor(0xd92032)
    .setTitle('🔴 MEMBRO AO VIVO — TROPA DO JAPÃO 🇯🇵')
    .setDescription(
      `**${displayName(item)}** está transmitindo na ` +
      `**${item.platform}**!\n\n` +
      `[🔴 ASSISTIR LIVE](${item.channel})`
    )
    .addFields(
      {
        name: 'Cidade',
        value: 'Lado Leste RP',
        inline: true
      },
      {
        name: 'Plataforma',
        value: item.platform,
        inline: true
      }
    )
    .setTimestamp();

  await channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] }
  });
}

// COMANDOS DO DISCORD

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
    const platform = interaction.options.getString('plataforma');
    const uid = interaction.user.id;
    const items = read();

    if (sub === 'listar') {
      const own = items.filter(x => x.discordId === uid);

      return await interaction.editReply(
        own.length
          ? own.map(x =>
              `${x.platform}: ${x.channel} — ` +
              (x.live ? 'AO VIVO' : 'OFFLINE')
            ).join('\n')
          : 'Você ainda não cadastrou canais.'
      );
    }

    if (sub === 'cadastrar') {
      const url = (
        interaction.options.getString('url') || ''
      ).trim();

      if (!validUrl(platform, url)) {
        return await interaction.editReply(
          'Use um link HTTPS válido da plataforma.'
        );
      }

      const name =
        interaction.member?.displayName ||
        interaction.user.globalName ||
        interaction.user.username;

      const channelName = (
        interaction.options.getString('nome') || ''
      ).trim() || channelHandle(platform, url) || name;

      const old = items.find(x =>
        x.discordId === uid &&
        x.platform === platform
      );

      if (old) {
        const changed = old.channel !== url;

        old.channel = url;
        old.name = name;
        old.channelName = channelName;

        if (changed) {
          old.live = false;
          old.lastAnnounced = '';
          old.lastManual = 0;
        }
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

      await siteSync('POST', '', {
        discordId: uid,
        name,
        channelName,
        platform,
        channel: url
      });

      write(items);

      return await interaction.editReply(
        `Canal ${platform} cadastrado no site!\n${url}`
      );
    }

    if (sub === 'remover') {
      await siteSync('DELETE', '', {
        discordId: uid,
        platform
      });

      write(items.filter(x =>
        !(x.discordId === uid && x.platform === platform)
      ));

      return await interaction.editReply(
        'Canal removido com sucesso!'
      );
    }

    if (sub === 'anunciar') {
      const item = items.find(x =>
        x.discordId === uid &&
        x.platform === platform
      );

      if (!item) {
        return await interaction.editReply(
          'Cadastre seu canal primeiro com /live cadastrar.'
        );
      }

      const now = Date.now();

      if (
        item.live &&
        item.lastManual &&
        now - item.lastManual < 60 * 60 * 1000
      ) {
        return await interaction.editReply(
          'Seu canal já está marcado AO VIVO.'
        );
      }

      await siteSync('PATCH', '/status', {
        discordId: uid,
        platform,
        live: true,
        lastAnnounced: String(now)
      });

      item.live = true;
      item.lastManual = now;
      item.lastAnnounced = String(now);

      write(items);

      try {
        await announce(item);

        return await interaction.editReply(
          '🔴 Live anunciada no Discord e marcada AO VIVO no site!'
        );
      } catch (error) {
        console.error(
          'Erro ao anunciar no Discord:',
          error.message
        );

        return await interaction.editReply(
          '🔴 Site atualizado para AO VIVO, mas o anúncio ' +
          'no Discord falhou.'
        );
      }
    }

    if (sub === 'encerrar') {
      const item = items.find(x =>
        x.discordId === uid &&
        x.platform === platform
      );

      if (!item) {
        return await interaction.editReply(
          'Cadastre seu canal primeiro com /live cadastrar.'
        );
      }

      await siteSync('PATCH', '/status', {
        discordId: uid,
        platform,
        live: false,
        lastAnnounced: ''
      });

      item.live = false;
      item.lastAnnounced = '';
      item.lastManual = 0;

      write(items);

      return await interaction.editReply(
        '⚫ Canal marcado OFFLINE no site.'
      );
    }

    return await interaction.editReply(
      'Comando não reconhecido.'
    );
  } catch (error) {
    console.error('Erro no comando /live:', error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(
          'Não consegui executar. Confira o terminal do bot.'
        );
      } else {
        await interaction.reply({
          content: 'Erro ao executar comando.',
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (replyError) {
      console.error(
        'Erro ao responder:',
        replyError.message
      );
    }
  }
});

// MONITORAMENTO AUTOMATICO TWITCH

let twitchToken = '';
let twitchExpiry = 0;

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
      })
    }
  );

  if (!response.ok) {
    throw new Error('Credenciais Twitch inválidas');
  }

  const data = await response.json();

  twitchToken = data.access_token;

  twitchExpiry = Date.now() +
    Math.max(0, data.expires_in - 120) * 1000;

  return twitchToken;
}

let pollingTwitch = false;

async function pollTwitch() {
  if (
    pollingTwitch ||
    !process.env.TWITCH_CLIENT_ID ||
    !process.env.TWITCH_CLIENT_SECRET
  ) {
    return;
  }

  pollingTwitch = true;

  try {
    const targets = read().filter(x =>
      x.platform === 'Twitch'
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
              'Client-ID': process.env.TWITCH_CLIENT_ID,
              Authorization: 'Bearer ' + token
            }
          }
        );

        if (!response.ok) {
          throw new Error(
            'Erro na API Twitch: ' + response.status
          );
        }

        const data = await response.json();
        const stream = data.data?.[0];
        const isLive = Boolean(stream);

        const current = read().find(x =>
          x.discordId === item.discordId &&
          x.platform === 'Twitch' &&
          x.channel === item.channel
        );

        if (!current) continue;

        if (current.live === isLive) continue;

        const announcementId = isLive
          ? String(stream.id)
          : '';

        await siteSync('PATCH', '/status', {
          discordId: current.discordId,
          platform: 'Twitch',
          live: isLive,
          lastAnnounced: announcementId
        });

        const latest = read();

        const target = latest.find(x =>
          x.discordId === current.discordId &&
          x.platform === 'Twitch' &&
          x.channel === current.channel
        );

        if (!target) continue;

        target.live = isLive;
        target.lastAnnounced = announcementId;
        target.lastManual = 0;

        write(latest);

        console.log(
          'Twitch',
          login,
          isLive ? 'AO VIVO' : 'OFFLINE'
        );

        if (isLive) {
          try {
            await announce(target);
          } catch (error) {
            console.error(
              'Erro anunciando Twitch:',
              error.message
            );
          }
        }
      } catch (error) {
        console.error(
          'Erro verificando Twitch:',
          error.message
        );
      }
    }
  } finally {
    pollingTwitch = false;
  }
}

// MONITORAMENTO AUTOMATICO TIKTOK

let checkingTikTok = false;
const tiktokObservations = new Map();

async function pollTikTok() {
  if (checkingTikTok) return;

  checkingTikTok = true;

  try {
    let TikTokLiveConnection;

    try {
      ({ TikTokLiveConnection } = require('tiktok-live-connector'));
    } catch (error) {
      console.error(
        'TikTok: execute npm install tiktok-live-connector'
      );
      return;
    }

    const items = read().filter(x =>
      x.platform === 'TikTok'
    );

    for (const item of items) {
      const key = item.discordId + ':TikTok';

      try {
        const username = channelHandle(
          'TikTok',
          item.channel
        ).replace(/^@/, '');

        if (!/^[a-zA-Z0-9._]{2,24}$/.test(username)) {
          console.log(
            'TikTok: nome de usuário inválido:',
            username
          );
          continue;
        }

        const connection = new TikTokLiveConnection(
          username,
          {
            enableExtendedGiftInfo: false
          }
        );

        const info = await Promise.race([
          connection.fetchRoomInfo(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Tempo esgotado')),
              12000
            )
          )
        ]);

        // A biblioteca pode retornar estruturas diferentes.
        const rawStatus =
          info?.status ??
          info?.roomInfo?.status ??
          info?.roomInfo?.room?.status ??
          info?.room?.status;

        const status = rawStatus == null
          ? NaN
          : Number(rawStatus);

        let isLive;

        if (status === 2) {
          isLive = true;
        } else if (status === 4) {
          isLive = false;
        } else {
          console.log(
            'TikTok status inconclusivo:',
            username,
            {
              status: rawStatus ?? null,
              campos: Object.keys(info || {})
            }
          );

          tiktokObservations.delete(key);
          continue;
        }

        const previous = tiktokObservations.get(key);

        const count = previous?.value === isLive
          ? previous.count + 1
          : 1;

        tiktokObservations.set(key, {
          value: isLive,
          count
        });

        // Exige duas verificações consecutivas.
        if (count < 2) continue;

        const current = read().find(x =>
          x.discordId === item.discordId &&
          x.platform === 'TikTok' &&
          x.channel === item.channel
        );

        if (!current || current.live === isLive) {
          continue;
        }

        const announcementId = isLive
          ? String(Date.now())
          : '';

        // Atualiza primeiro o site.
        await siteSync('PATCH', '/status', {
          discordId: current.discordId,
          platform: 'TikTok',
          live: isLive,
          lastAnnounced: announcementId
        });

        // Atualiza o arquivo local.
        const latest = read();

        const target = latest.find(x =>
          x.discordId === current.discordId &&
          x.platform === 'TikTok' &&
          x.channel === current.channel
        );

        if (!target) continue;

        target.live = isLive;
        target.lastAnnounced = announcementId;
        target.lastManual = 0;

        write(latest);

        console.log(
          'TikTok',
          username,
          isLive ? 'AO VIVO' : 'OFFLINE'
        );

        if (isLive) {
          try {
            await announce(target);
          } catch (error) {
            console.error(
              'Erro anunciando TikTok:',
              error.message
            );
          }
        }
      } catch (error) {
        console.error(
          'TikTok: não foi possível verificar',
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

// INICIALIZACAO

client.once(Events.ClientReady, async () => {
  console.log('Bot conectado:', client.user.tag);

  try {
    const rest = new REST({
      version: '10'
    }).setToken(process.env.DISCORD_BOT_TOKEN);

    const route = process.env.DISCORD_GUILD_ID
      ? Routes.applicationGuildCommands(
          client.user.id,
          process.env.DISCORD_GUILD_ID
        )
      : Routes.applicationCommands(client.user.id);

    await rest.put(route, {
      body: [command.toJSON()]
    });

    console.log('Comando /live registrado');
  } catch (error) {
    console.error(
      'Erro ao registrar comandos:',
      error.message
    );
  }

  pollTwitch().catch(console.error);

  setInterval(() => {
    pollTwitch().catch(console.error);
  }, 120000);

  pollTikTok().catch(console.error);

  setInterval(() => {
    pollTikTok().catch(console.error);
  }, 60000);
});

client.on('error', error => {
  console.error('Erro do Discord:', error);
});

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('Configure DISCORD_BOT_TOKEN no .env');
  process.exit(1);
}

client.login(process.env.DISCORD_BOT_TOKEN)
  .catch(error => {
    console.error(
      'Falha ao conectar bot:',
      error.message
    );

    process.exitCode = 1;
  });
