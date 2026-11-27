
const crypto = require('crypto');

module.exports = function(app, readMembers, getPresenceMap) {

  let blockedUntil = 0;
  let tokenInProgress = false;

  const config = () => ({
    id: (process.env.DISCORD_CLIENT_ID || '').trim(),
    secret: (process.env.DISCORD_CLIENT_SECRET || '').trim(),
    redirect: (process.env.DISCORD_REDIRECT_URI || '').trim()
  });

  const fail = (res, reason) => {
    return res.redirect('/portal.html?erro=' + reason);
  };

  const find = async id => {
    const members = await readMembers();

    const matches = members.filter(
      m => String(m.discordId || '') === id
    );

    return matches.length === 1 ? matches[0] : null;
  };

  // INICIAR LOGIN
  app.get('/auth/discord', (req, res) => {

    if (Date.now() < blockedUntil) {

      const remaining = Math.ceil(
        (blockedUntil - Date.now()) / 1000
      );

      console.log(
        'Portal OAuth: aguarde ' + remaining + ' segundos'
      );

      return fail(res, 'login');
    }

    const c = config();

    if (
      !c.id ||
      !c.secret ||
      !c.redirect ||
      !process.env.SESSION_SECRET
    ) {
      console.error('Portal OAuth: configuracao incompleta');
      return fail(res, 'config');
    }

    const state = crypto.randomBytes(32).toString('hex');

    req.session.portalState = {
      state,
      expires: Date.now() + 600000
    };

    const q = new URLSearchParams({
      client_id: c.id,
      redirect_uri: c.redirect,
      response_type: 'code',
      scope: 'identify',
      state
    });

    req.session.save(err => {

      if (err) return fail(res, 'login');

      res.redirect(
        'https://discord.com/oauth2/authorize?' + q
      );
    });
  });

  // CALLBACK DO DISCORD
  app.get('/auth/discord/callback', async (req, res) => {

    const pending = req.session.portalState;

    delete req.session.portalState;

    if (
      !pending ||
      pending.expires < Date.now() ||
      req.query.state !== pending.state ||
      typeof req.query.code !== 'string'
    ) {
      console.error('Portal OAuth: sessao invalida');
      return fail(res, 'login');
    }

    if (Date.now() < blockedUntil || tokenInProgress) {
      console.log('Portal OAuth: solicitacao temporariamente bloqueada');
      return fail(res, 'login');
    }

    tokenInProgress = true;

    try {

      const c = config();

      const token = await fetch(
        'https://discord.com/api/v10/oauth2/token',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },

          body: new URLSearchParams({
            client_id: c.id,
            client_secret: c.secret,
            grant_type: 'authorization_code',
            code: req.query.code,
            redirect_uri: c.redirect
          }),

          signal: AbortSignal.timeout(15000)
        }
      );

      // DIAGNOSTICO DO DISCORD
      if (!token.ok) {

        const raw = await token.text();

        let detail = {};

        try {
          detail = JSON.parse(raw);
        } catch {}

        const retryAfter = token.headers.get('retry-after');
        const globalLimit = token.headers.get('x-ratelimit-global');
        const rateScope = token.headers.get('x-ratelimit-scope');
        const server = token.headers.get('server');
        const cfRay = token.headers.get('cf-ray');
        const contentType = token.headers.get('content-type');

        const knownErrors = [
          'invalid_client',
          'invalid_grant',
          'invalid_request',
          'unauthorized_client',
          'invalid_scope',
          'access_denied',
          'unsupported_grant_type'
        ];

        console.error('========== PORTAL OAUTH ==========');
        console.error('HTTP:', token.status);
        console.error('Retry-After:', retryAfter);
        console.error('Global Limit:', globalLimit);
        console.error('Rate Scope:', rateScope);
        console.error('Server:', server);
        console.error('Cloudflare Ray:', cfRay);
        console.error('Content-Type:', contentType);

        console.error(
          'OAuth Error:',
          knownErrors.includes(detail.error)
            ? detail.error
            : 'unknown_error'
        );

        console.error(
          'Cloudflare 1015:',
          /error\s*(code\s*)?1015/i.test(raw)
        );

        console.error(
          'Cloudflare 1020:',
          /error\s*(code\s*)?1020/i.test(raw)
        );

        if (token.status === 429) {

          const waits = [60];

          if (retryAfter) {
            const seconds = Number(retryAfter);

            if (Number.isFinite(seconds)) {
              waits.push(seconds);
            } else {
              const date = Date.parse(retryAfter);

              if (Number.isFinite(date)) {
                waits.push((date - Date.now()) / 1000);
              }
            }
          }

          if (
            typeof detail.retry_after === 'number' &&
            Number.isFinite(detail.retry_after)
          ) {
            waits.push(detail.retry_after);
          }

          const seconds = Math.ceil(Math.max(...waits));

          blockedUntil = Date.now() + seconds * 1000;

          console.error(
            'Tempo de espera:', seconds, 'segundos'
          );
        }

        console.error('==================================');

        return fail(res, 'login');
      }

      const t = await token.json();

      if (
        typeof t.access_token !== 'string' ||
        !t.access_token
      ) {
        throw Error('token_missing');
      }

      // BUSCAR CONTA DO DISCORD
      const response = await fetch(
        'https://discord.com/api/v10/users/@me',
        {
          headers: {
            Authorization: 'Bearer ' + t.access_token
          },

          signal: AbortSignal.timeout(15000)
        }
      );

      if (!response.ok) {

        console.error(
          'Portal OAuth: identity HTTP',
          response.status
        );

        if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const seconds = Number(retry);
          const date = Date.parse(retry || '');

          const wait = Math.max(
            60,
            Number.isFinite(seconds) ? seconds : 0,
            Number.isFinite(date)
              ? (date - Date.now()) / 1000
              : 0
          );

          blockedUntil = Date.now() + wait * 1000;
        }

        return fail(res, 'login');
      }

      const u = await response.json();

      // VERIFICAR CADASTRO
      if (
        !/^\d{15,22}$/.test(u.id) ||
        !await find(u.id)
      ) {

        console.log(
          'Portal OAuth: membro nao cadastrado ou duplicado'
        );

        return fail(res, 'membro');
      }

      // CRIAR SESSAO
      req.session.regenerate(err => {

        if (err) return fail(res, 'login');

        req.session.portalUser = {
          id: u.id,
          username: u.username,
          avatar: u.avatar
        };

        req.session.save(e => {

          if (e) return fail(res, 'login');

          console.log('Portal OAuth: login realizado');

          res.redirect('/portal.html');
        });
      });

    } catch (e) {

      console.error(
        'Portal OAuth: falha de comunicacao',
        e.name
      );

      return fail(res, 'login');

    } finally {

      tokenInProgress = false;
    }
  });

  // PERFIL DO INTEGRANTE
  app.get('/api/portal/me', async (req, res) => {

    res.set('Cache-Control', 'no-store');

    const u = req.session.portalUser;

    if (!u) {

      return res.status(401).json({
        error: 'Entre pelo Discord.'
      });
    }

    try {

      const m = await find(u.id);

      if (!m) {

        delete req.session.portalUser;

        return res.status(403).json({
          error: 'Cadastro não autorizado.'
        });
      }

      const presence = await getPresenceMap();

      res.json({

        name: m.name,
        tag: m.tag,
        role: m.role,

        status: presence.get(u.id)
          ? 'Online'
          : 'Offline',

        username: u.username,

        avatar: u.avatar && /^[\w]+$/.test(u.avatar)
          ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
          : null,

        leadership: [
          'Líder',
          'Sub Líder'
        ].includes(m.role)

      });

    } catch {

      res.status(503).json({
        error: 'Não foi possível consultar seu cadastro.'
      });
    }
  });

  // SAIR DO PORTAL
  app.post('/api/portal/logout', (req, res) => {

    delete req.session.portalUser;

    req.session.save(err => {

      res.status(err ? 500 : 200).json({
        ok: !err
      });
    });
  });

};

