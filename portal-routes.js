
const crypto = require('crypto');

module.exports = function(app, readMembers, getPresenceMap) {

  // CONFIGURACOES DO DISCORD
  const config = () => ({
    id: (process.env.DISCORD_CLIENT_ID || '').trim(),
    secret: (process.env.DISCORD_CLIENT_SECRET || '').trim(),
    redirect: (process.env.DISCORD_REDIRECT_URI || '').trim()
  });

  const fail = (res, reason) => {
    return res.redirect('/portal.html?erro=' + reason);
  };

  // LOCALIZAR MEMBRO CADASTRADO
  const find = async id => {
    const members = await readMembers();

    const matches = members.filter(
      m => String(m.discordId || '') === id
    );

    return matches.length === 1 ? matches[0] : null;
  };

  // INICIAR LOGIN COM DISCORD
  app.get('/auth/discord', (req, res) => {

    const c = config();

    if (!c.id || !c.secret || !c.redirect ||
        !process.env.SESSION_SECRET) {

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

  // RETORNO DA AUTORIZACAO DO DISCORD
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

    try {

      const c = config();

      // SOLICITAR TOKEN DE ACESSO
      const token = await fetch(
        'https://discord.com/api/v10/oauth2/token',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded'
          },

          body: new URLSearchParams({
            client_id: c.id,
            client_secret: c.secret,
            grant_type: 'authorization_code',
            code: req.query.code,
            redirect_uri: c.redirect
          }),

          signal: AbortSignal.timeout(10000)
        }
      );

      // MOSTRAR ERRO REAL NOS LOGS
      if (!token.ok) {

        const detail = await token.json()
          .catch(() => ({}));

        const known = [
          'invalid_client',
          'invalid_grant',
          'invalid_request',
          'unauthorized_client',
          'unsupported_grant_type',
          'invalid_scope',
          'access_denied',
          'redirect_uri_mismatch'
        ];

        const reason = known.includes(detail.error)
          ? detail.error
          : 'unknown_error';

        console.error(
          'Portal OAuth: token HTTP ' +
          token.status + ' | ' + reason
        );

        return fail(res, 'login');
      }

      const t = await token.json();

      if (
        typeof t.access_token !== 'string' ||
        !t.access_token
      ) {
        throw Error('token_missing');
      }

      // BUSCAR PERFIL DO DISCORD
      const response = await fetch(
        'https://discord.com/api/v10/users/@me',
        {
          headers: {
            Authorization: 'Bearer ' + t.access_token
          },

          signal: AbortSignal.timeout(10000)
        }
      );

      if (!response.ok) {
        throw Error('identity');
      }

      const u = await response.json();

      // VERIFICAR SE PERTENCE A TROPA
      if (
        !/^\d{15,22}$/.test(u.id) ||
        !await find(u.id)
      ) {
        console.log(
          'Portal OAuth: membro nao cadastrado ou duplicado'
        );

        return fail(res, 'membro');
      }

      // CRIAR SESSAO DO INTEGRANTE
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

      console.error('Portal OAuth:', e.message);

      return fail(res, 'login');
    }
  });

  // DADOS DO INTEGRANTE
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

    } catch (e) {

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
