require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, MessageFlags, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'data', 'streams.json');
const CHANNEL = process.env.DISCORD_LIVES_CHANNEL_ID || '1494303769796808884';
fs.mkdirSync(path.dirname(file), { recursive: true });
if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
const read = () => { try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(data) ? data : []; } catch (e) { console.error('Erro lendo streams.json:', e); return []; } };
function write(items) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(items, null, 2)); fs.renameSync(tmp, file); }
// Integração com o site hospedado no Render.
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
async function siteSync(method, endpoint, payload) {
  if (!SITE_URL || !process.env.BOT_SYNC_SECRET) throw new Error('Configure SITE_URL e BOT_SYNC_SECRET no .env do bot');
  const response = await fetch(SITE_URL + '/api/bot/streams' + endpoint, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.BOT_SYNC_SECRET },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error('Sincronização com site falhou (HTTP ' + response.status + '): ' + detail.slice(0, 180));
  }
}
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const platforms = [{ name: 'Twitch', value: 'Twitch' }, { name: 'YouTube', value: 'YouTube' }, { name: 'TikTok', value: 'TikTok' }];
const command = new SlashCommandBuilder().setName('live').setDescription('Gerencie sua live da Tropa do Japão')
  .addSubcommand(s => s.setName('cadastrar').setDescription('Cadastre seu canal')
    .addStringOption(o => o.setName('plataforma').setDescription('Plataforma').setRequired(true).addChoices(...platforms))
    .addStringOption(o => o.setName('url').setDescription('Link do seu canal').setRequired(true))
    .addStringOption(o => o.setName('nome').setDescription('Nome exibido no site (ex.: Rafaella Black)').setMaxLength(80)))
  .addSubcommand(s => s.setName('remover').setDescription('Remova seu canal')
    .addStringOption(o => o.setName('plataforma').setDescription('Plataforma').setRequired(true).addChoices(...platforms)))
  .addSubcommand(s => s.setName('listar').setDescription('Veja seus canais'))
  .addSubcommand(s => s.setName('encerrar').setDescription('Marque seu canal como offline no site')
    .addStringOption(o => o.setName('plataforma').setDescription('Plataforma').setRequired(true).addChoices(...platforms)))
  .addSubcommand(s => s.setName('anunciar').setDescription('Anuncie uma transmissão iniciada')
    .addStringOption(o => o.setName('plataforma').setDescription('Plataforma').setRequired(true).addChoices(...platforms)));
function channelHandle(platform, url) {
  try { const p = new URL(url).pathname.split('/').filter(Boolean); return platform === 'TikTok' ? (p.find(x => x.startsWith('@')) || p[0] || '') : (p[0] || ''); } catch { return ''; }
}
function displayName(item) { return item.channelName || channelHandle(item.platform, item.channel) || item.name; }
function validUrl(platform, value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    const allowed = { Twitch: ['twitch.tv', 'www.twitch.tv'], YouTube: ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'], TikTok: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'] };
    return (allowed[platform] || []).includes(u.hostname.toLowerCase()) && u.pathname.length > 1;
  } catch { return false; }
}
async function announce(item) {
  const ch = await client.channels.fetch(CHANNEL);
  if (!ch || !ch.isTextBased() || typeof ch.send !== 'function') throw new Error('Canal de lives não encontrado ou sem permissão');
  const embed = new EmbedBuilder().setColor(0xd92032)
    .setTitle('🔴 MEMBRO AO VIVO — TROPA DO JAPÃO 🇯🇵')
    .setDescription(`**${displayName(item)}** está transmitindo na **${item.platform}**!\n[LIVE — ASSISTIR AGORA](${item.channel})`)
    .addFields({ name: 'Cidade', value: 'Lado Leste RP', inline: true }, { name: 'Plataforma', value: item.platform, inline: true })
    .setTimestamp();
  await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
}
client.on(Events.InteractionCreate, async i => {
  if (!i.isChatInputCommand() || i.commandName !== 'live') return;
  try {
    // Confirma a interação imediatamente, antes de acessar arquivos ou API.
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = i.options.getSubcommand();
    const platform = i.options.getString('plataforma');
    const items = read();
    const uid = i.user.id;
    if (sub === 'listar') {
      const own = items.filter(x => x.discordId === uid);
      return await i.editReply(own.length ? own.map(x => `${x.platform}: ${x.channel}`).join('\n') : 'Você ainda não cadastrou canais.');
    }
    if (sub === 'cadastrar') {
      const url = (i.options.getString('url') || '').trim();
      if (!validUrl(platform, url)) return await i.editReply('Use um link HTTPS válido da plataforma escolhida.');
      const name = i.member?.displayName || i.user.globalName || i.user.username;
      const channelName = (i.options.getString('nome') || '').trim() || channelHandle(platform, url) || name;
      const old = items.find(x => x.discordId === uid && x.platform === platform);
      if (old) { const changed = old.channel !== url; old.channel = url; old.name = name; old.channelName = channelName; if (changed) { old.live = false; old.lastAnnounced = ''; } }
      else items.push({ discordId: uid, name, channelName, platform, channel: url, live: false, lastAnnounced: '' });
      await siteSync('POST', '', { discordId: uid, name, channelName, platform, channel: url });
      write(items);
      return await i.editReply(`Canal ${platform} cadastrado no Discord e no site! ${url}`);
    }
    if (sub === 'remover') {
      await siteSync('DELETE', '', { discordId: uid, platform });
      write(items.filter(x => !(x.discordId === uid && x.platform === platform)));
      return await i.editReply('Canal removido, se estava cadastrado.');
    }
    if (sub === 'anunciar') {
      const item = items.find(x => x.discordId === uid && x.platform === platform);
      if (!item) return await i.editReply('Cadastre seu canal primeiro com /live cadastrar.');
      const now = Date.now();
      if (item.lastManual && now - item.lastManual < 60 * 60 * 1000) return await i.editReply('Você já anunciou esta plataforma na última hora.');
      await announce(item);
      item.lastManual = now;
      // Marcacao manual: usuario declara que esta ao vivo; TikTok nao e verificado automaticamente.
      item.live = true;
      write(items);
      try {
        await siteSync('PATCH', '/status', { discordId: uid, platform, live: true });
        return await i.editReply('Anuncio enviado! Seu canal foi marcado AO VIVO no site. Use /live encerrar ao terminar.');
      } catch (err) {
        console.error('Falha sincronizando anuncio:', err);
        return await i.editReply('Anuncio enviado no Discord, mas o site nao atualizou: ' + err.message.slice(0, 150));
      }
    }
    if (sub === 'encerrar') {
      const item = items.find(x => x.discordId === uid && x.platform === platform);
      if (!item) return await i.editReply('Cadastre seu canal primeiro com /live cadastrar.');
      await siteSync('PATCH', '/status', { discordId: uid, platform, live: false });
      item.live = false; item.lastAnnounced = '';
      write(items);
      return await i.editReply('Canal marcado OFFLINE no site. O cadastro continua visivel.');
    }
    return await i.editReply('Subcomando não reconhecido.');
  } catch (e) {
    console.error('Erro no comando /live:', e);
    try {
      if (i.deferred || i.replied) await i.editReply('Não consegui executar. Confira o terminal do bot para ver o erro.');
      else await i.reply({ content: 'Não consegui executar. Confira o terminal do bot.', flags: MessageFlags.Ephemeral });
    } catch (replyError) { console.error('Não foi possível responder à interação:', replyError.message); }
  }
});
let twitchToken = '', twitchExpiry = 0;
async function twitchAuth() {
  if (twitchToken && Date.now() < twitchExpiry) return twitchToken;
  const id = process.env.TWITCH_CLIENT_ID, secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) return null;
  const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }) });
  if (!r.ok) throw Error('Credenciais Twitch inválidas');
  const d = await r.json(); twitchToken = d.access_token; twitchExpiry = Date.now() + Math.max(0, d.expires_in - 120) * 1000;
  return twitchToken;
}
let polling = false;
async function pollTwitch() {
  if (polling || !process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) return;
  polling = true;
  try {
    const items = read();
    const targets = items.filter(x => x.platform === 'Twitch');
    if (!targets.length) return;
    const token = await twitchAuth();
    let changed = false;
    for (const item of targets) {
      try {
        const login = new URL(item.channel).pathname.split('/')[1];
        if (!login) continue;
        const r = await fetch('https://api.twitch.tv/helix/streams?user_login=' + encodeURIComponent(login), { headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID, Authorization: 'Bearer ' + token } });
        if (!r.ok) throw Error('Twitch API ' + r.status);
        const d = await r.json(), stream = d.data?.[0];
        const wasLive = item.live;
        item.live = !!stream;
        if (stream && item.lastAnnounced !== stream.id) { await announce(item); item.lastAnnounced = stream.id; }
        if (!stream) item.lastAnnounced = '';
        if (wasLive !== item.live || stream) changed = true;
      } catch (e) { console.error('Verificação Twitch:', e.message); }
    }
    if (changed) {
      for (const item of targets) {
        try { await siteSync('PATCH', '/status', { discordId: item.discordId, platform: item.platform, live: item.live, lastAnnounced: item.lastAnnounced }); }
        catch (err) { console.error('Sincronização do status Twitch:', err.message); }
      }
      // Releitura preserva cadastros/remocoes realizados enquanto as APIs respondiam.
      const latest = read();
      for (const item of targets) {
        const current = latest.find(x => x.discordId === item.discordId && x.platform === item.platform && x.channel === item.channel);
        if (current) { current.live = item.live; current.lastAnnounced = item.lastAnnounced; }
      }
      write(latest);
    }
  } finally { polling = false; }
}
client.once(Events.ClientReady, async () => {
  console.log('Bot conectado:', client.user.tag);
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    const route = process.env.DISCORD_GUILD_ID ? Routes.applicationGuildCommands(client.user.id, process.env.DISCORD_GUILD_ID) : Routes.applicationCommands(client.user.id);
    await rest.put(route, { body: [command.toJSON()] });
    console.log('Comando /live registrado');
  } catch (e) { console.error('Erro ao registrar comandos:', e); }
  pollTwitch().catch(console.error);
  setInterval(() => pollTwitch().catch(console.error), 120000);
});
client.on('error', e => console.error('Erro do Discord:', e));
if (!process.env.DISCORD_BOT_TOKEN) { console.error('Configure DISCORD_BOT_TOKEN no .env'); process.exit(1); }
client.login(process.env.DISCORD_BOT_TOKEN).catch(e => { console.error('Falha ao conectar bot:', e.message); process.exitCode = 1; });
