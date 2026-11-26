
// ==========================================
// TROPA DO JAPAO - APP.JS
// PARTE 1 - SITE PUBLICO
// ==========================================

// Selecionar elemento pelo ID
const $ = id => document.getElementById(id);

// Criar elementos HTML com seguranca
const el = (tag, className = '', text) => {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text !== undefined) {
    element.textContent = String(text);
  }

  return element;
};

// ==========================================
// CONFIGURACOES
// ==========================================

const UPDATE_INTERVAL = 15000;

let publicData = {
  members: [],
  streams: [],
  gallery: []
};

let currentMembers = [];
let publicLoading = false;

// ==========================================
// MENU DO SITE
// ==========================================

const menuBtn = $('menuBtn');
const navLinks = $('navLinks');

if (menuBtn && navLinks) {
  menuBtn.addEventListener('click', () => {
    navLinks.classList.toggle('open');
  });

  document
    .querySelectorAll('#navLinks a')
    .forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
      });
    });
}

// ==========================================
// FUNCOES AUXILIARES
// ==========================================

function isOnline(member) {
  return String(member.status || '')
    .toLowerCase() === 'online';
}

function safeText(value, fallback = '') {
  const result = String(value ?? '').trim();

  return result || fallback;
}

function setText(id, value) {
  const element = $(id);

  if (element) {
    element.textContent = String(value);
  }
}

// ==========================================
// RENDERIZAR MEMBROS
// ==========================================

const memberRanks = [
  ['Líder', '👑', '#ffd36b'],
  ['Sub Líder', '♛', '#e6ae50'],
  ['Gerente Geral', '🛡', '#ff4757'],
  ['Gerente Elite', '⚔', '#ff7755'],
  ['Gerente de Farm', '📦', '#62d99b'],
  ['Gerente de Recrutamento', '👥', '#60a5fa'],
  ['Gerente de Vendas', '💰', '#36d6cf'],
  ['Elite', '⚔', '#b18aff'],
  ['Membro', '侍', '#b0b0bd']
];
const roleKey = value => safeText(value, 'Membro').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
function rankIndex(member) {
  const index = memberRanks.findIndex(rank => roleKey(rank[0]) === roleKey(member.role));
  return index < 0 ? memberRanks.length : index;
}
function sortMembers(members) {
  return [...members].sort((a,b) => rankIndex(a)-rankIndex(b) || safeText(a.tag).localeCompare(safeText(b.tag), 'pt-BR', {numeric:true}) || safeText(a.name).localeCompare(safeText(b.name), 'pt-BR'));
}
function renderMembers(members) {
  const grid = $('membersGrid');
  if (!grid) return;
  grid.replaceChildren();
  grid.classList.add('hierarchy-grid');
  const ordered = sortMembers(members);
  const ranks = [...memberRanks];
  if (ordered.some(m => rankIndex(m) === memberRanks.length)) ranks.push(['Outros cargos', '侍', '#b0b0bd']);
  ranks.forEach(([label, symbol, color], index) => {
    const group = ordered.filter(m => rankIndex(m) === index);
    const section = el('section', 'rank-section');
    section.style.setProperty('--rank-color', color);
    const heading = el('div', 'rank-heading');
    const icon = el('span', 'rank-icon', symbol);
    icon.setAttribute('aria-hidden', 'true');
    heading.append(icon, el('h3', '', label), el('span', 'rank-count', `${group.length} integrante(s) · ${group.filter(isOnline).length} online`));
    section.append(heading);
    const cards = el('div', 'rank-cards');
    if (!group.length) cards.append(el('p', 'rank-empty', 'Nenhum integrante neste cargo.'));
    for (const member of group) {
      const online = isOnline(member);
      const card = el('article', 'member-card');
      card.dataset.status = online ? 'online' : 'offline';
      const portrait = el('div', 'portrait');
      const avatar = el('span', 'rank-avatar', safeText(member.avatar, safeText(member.name, '?')[0]).toUpperCase());
      portrait.append(avatar, el('div', 'role-tag', safeText(member.role, 'Membro').toUpperCase()), el('div', 'rank-emblem', symbol));
      const body = el('div', 'member-body');
      const bottom = el('div', 'member-bottom');
      bottom.append(el('span', 'rank-role', safeText(member.role, 'Membro')), el('span', online ? 'status' : 'status off', online ? '● Online' : '● Offline'));
      body.append(el('h3', '', safeText(member.name, 'Sem nome')), el('p', '', 'ID ' + safeText(member.tag, '---')), bottom);
      card.append(portrait, body);
      cards.append(card);
    }
    section.append(cards);
    grid.append(section);
  });
}

// ==========================================
// CONTADORES DO SITE
// ==========================================

function updateCounters(members, streams) {
  const totalMembers = members.length;

  const totalOnline = members.filter(
    member => isOnline(member)
  ).length;

  const totalLives = streams.filter(
    stream => stream.live === true
  ).length;

  setText(
    'memberCount',
    String(totalMembers).padStart(2, '0')
  );

  setText(
    'onlineCount',
    String(totalOnline).padStart(2, '0')
  );

  setText(
    'liveCount',
    String(totalLives).padStart(2, '0')
  );
}

// ==========================================
// VALIDAR LINKS DAS LIVES
// ==========================================

function validStreamUrl(value) {
  try {
    const url = new URL(value);

    const allowedHosts = [
      'kick.com',
      'www.kick.com',
      'twitch.tv',
      'www.twitch.tv',
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'youtu.be',
      'tiktok.com',
      'www.tiktok.com',
      'm.tiktok.com'
    ];

    return (
      url.protocol === 'https:' &&
      allowedHosts.includes(
        url.hostname.toLowerCase()
      )
    );
  } catch {
    return false;
  }
}

// ==========================================
// RENDERIZAR LIVES
// ==========================================

let streamFilter = 'Todos';
document.querySelectorAll('[data-live-filter]').forEach(button => {
  button.addEventListener('click', () => {
    streamFilter = button.dataset.liveFilter;
    document.querySelectorAll('[data-live-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    renderStreams(publicData.streams);
  });
});
function renderStreams(streams) {
  const liveTotal = streams.filter(s => s.live === true).length;
  setText('streamsOnline', liveTotal);
  setText('streamsOffline', streams.length - liveTotal);
  setText('streamsTotal', streams.length);
  streams = streams.filter(s => streamFilter === 'Todos' || (streamFilter === 'Ao vivo' && s.live === true) || (streamFilter === 'Offline' && s.live !== true) || s.platform === streamFilter);
  const grid = $('streamsGrid');

  if (!grid) return;

  grid.replaceChildren();

  if (!streams.length) {
    grid.append(
      el(
        'p',
        'hint',
        'Nenhum canal encontrado neste filtro.'
      )
    );

    return;
  }

  // Mostrar primeiro quem esta AO VIVO
  const orderedStreams = [...streams].sort(
    (a, b) => Number(b.live) - Number(a.live)
  );

  for (const stream of orderedStreams) {
    const live = stream.live === true;

    const card = el('article', 'stream-card');
    card.dataset.platform = safeText(stream.platform).toLowerCase();
    card.dataset.live = String(live);

    const preview = el(
      'div',
      'stream-preview',
      safeText(
        stream.platform,
        'LIVE'
      ).toUpperCase()
    );

    const badge = el(
      'span',
      live
        ? 'live-badge active'
        : 'live-badge',
      live ? '● AO VIVO' : 'OFFLINE'
    );

    preview.append(badge);

    const info = el('div', 'stream-info');

    const details = el('div');

    const title = el(
      'h3',
      '',
      safeText(
        stream.channelName || stream.name,
        'Canal sem nome'
      )
    );

    const description = el(
      'p',
      '',
      safeText(stream.platform, 'Plataforma') +
      ' • Canal do membro'
    );

    details.append(title, description);

    info.append(details);

    if (
      stream.channel &&
      validStreamUrl(stream.channel)
    ) {
      const link = el(
        'a',
        '',
        live ? 'Assistir agora ↗' : 'Ver canal ↗'
      );

      link.href = stream.channel;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      info.append(link);
    } else {
      info.append(
        el('span', 'hint', 'Canal indisponível')
      );
    }

    card.append(preview, info);

    grid.append(card);
  }
}

// ==========================================
// RENDERIZAR GALERIA
// ==========================================

function renderGallery(gallery) {
  const grid = $('galleryGrid');

  if (!grid) return;

  grid.replaceChildren();

  for (const item of gallery) {
    const card = el('article', 'gallery-item');

    const type = el(
      'span',
      '',
      safeText(item.type, 'Galeria').toUpperCase()
    );

    const title = el(
      'h3',
      '',
      safeText(item.title, 'Sem título')
    );

    card.append(type, title);

    grid.append(card);
  }
}

// ==========================================
// LINK DO DISCORD
// ==========================================

function updateDiscordLinks(invite) {
  const ids = [
    'discordLink',
    'discordBottom'
  ];

  for (const id of ids) {
    const link = $(id);

    if (!link) continue;

    if (
      typeof invite === 'string' &&
      /^https:\/\/discord\.(gg|com)\//i.test(invite)
    ) {
      link.href = invite;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      link.href = '#sobre';
      link.removeAttribute('target');
    }
  }
}

// ==========================================
// BUSCAR DADOS DO SITE
// ==========================================

async function load() {
  if (publicLoading) return;

  publicLoading = true;

  try {
    const response = await fetch('/api/public', {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(
        'Erro ao consultar servidor: ' +
        response.status
      );
    }

    const data = await response.json();

    const members = Array.isArray(data.members)
      ? data.members
      : [];

    const streams = Array.isArray(data.streams)
      ? data.streams
      : [];

    const gallery = Array.isArray(data.gallery)
      ? data.gallery
      : [];

    publicData = {
      members,
      streams,
      gallery
    };

    renderMembers(members);
    renderStreams(streams);
    renderGallery(gallery);

    updateCounters(members, streams);
    updateDiscordLinks(data.discord);

  } catch (error) {
    console.error(
      'Erro carregando site:',
      error.message
    );

    // Nao apaga os cards em uma falha temporaria
    if (!publicData.members.length) {
      const grid = $('membersGrid');

      if (grid) {
        grid.textContent =
          'Não foi possível carregar os membros.';
      }
    }
  } finally {
    publicLoading = false;
  }
}

// ==========================================
// ATUALIZACAO AUTOMATICA
// ==========================================

// Carregar imediatamente
load();

// Atualizar os dados a cada 15 segundos
setInterval(() => {
  if (!document.hidden) {
    load();
  }
}, UPDATE_INTERVAL);

// Atualizar ao voltar para a aba
document.addEventListener(
  'visibilitychange',
  () => {
    if (!document.hidden) {
      load();
    }
  }
);

// ==========================================
// FIM DA PARTE 1
// COLE A PARTE 2 ABAIXO
// ==========================================

// ==========================================
// TROPA DO JAPAO - APP.JS
// PARTE 2 - PAINEL ADMINISTRATIVO
// ==========================================

// ==========================================
// ADICIONAR CAMPO ID DO DISCORD
// ==========================================

function setupDiscordField() {
  const form = $('memberForm');

  if (!form || $('memberDiscordId')) {
    return;
  }

  const label = el('label', '');

  label.textContent = 'ID do Discord';

  const input = el('input', '');

  input.id = 'memberDiscordId';
  input.name = 'discordId';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.maxLength = 22;
  input.placeholder = 'Ex.: 123456789012345678';
  input.autocomplete = 'off';

  input.pattern = '[0-9]{15,22}';

  label.append(input);

  const statusField = $('memberStatus');

  if (statusField) {
    const statusLabel = statusField.closest('label');

    if (statusLabel) {
      statusLabel.insertAdjacentElement(
        'beforebegin',
        label
      );
    } else {
      form.prepend(label);
    }

    // Status agora vem automaticamente do Discord
    statusField.disabled = true;

    const statusHint = el(
      'small',
      'hint',
      'O status será atualizado pelo BOT DIV.'
    );

    statusField.insertAdjacentElement(
      'afterend',
      statusHint
    );
  } else {
    const actions = form.querySelector('.form-actions');

    if (actions) {
      actions.insertAdjacentElement(
        'beforebegin',
        label
      );
    } else {
      form.append(label);
    }
  }
}

// ==========================================
// VERIFICAR LOGIN ADMINISTRATIVO
// ==========================================

async function sessionCheck() {
  try {
    const response = await fetch('/api/session', {
      cache: 'no-store'
    });

    if (!response.ok) return;

    const session = await response.json();

    if (session.authenticated) {
      await showAdmin();
    }
  } catch (error) {
    console.error(
      'Erro verificando sessao:',
      error.message
    );
  }
}

// ==========================================
// CARREGAR PAINEL ADMINISTRATIVO
// ==========================================

async function showAdmin() {
  try {
    const response = await fetch('/api/admin', {
      cache: 'no-store'
    });

    if (!response.ok) {
      if (response.status === 401) {
        $('adminCard')?.classList.add('hidden');
        $('loginForm')?.classList.remove('hidden');
      }

      return;
    }

    const data = await response.json();

    const members = Array.isArray(data.members)
      ? data.members
      : [];

    const streams = Array.isArray(data.streams)
      ? data.streams
      : [];

    const gallery = Array.isArray(data.gallery)
      ? data.gallery
      : [];

    $('loginForm')?.classList.add('hidden');
    $('adminCard')?.classList.remove('hidden');

    // Atualizar estatisticas
    const stats = $('adminStats');

    if (stats) {
      stats.replaceChildren();

      const items = [
        ['Membros', members.length],
        [
          'Online',
          members.filter(isOnline).length
        ],
        ['Lives cadastradas', streams.length],
        ['Galeria', gallery.length]
      ];

      for (const [label, count] of items) {
        const item = el('div', '');

        item.append(
          el('strong', '', String(count)),
          document.createTextNode(label)
        );

        stats.append(item);
      }
    }

    renderAdminMembers(members);

  } catch (error) {
    console.error(
      'Erro carregando painel:',
      error.message
    );
  }
}

// ==========================================
// RENDERIZAR MEMBROS DO PAINEL
// ==========================================

function renderAdminMembers(members) {
  currentMembers = sortMembers(members);

  const container = $('adminMembers');

  if (!container) return;

  container.replaceChildren();

  if (!members.length) {
    container.append(
      el('p', 'hint', 'Nenhum membro cadastrado.')
    );

    return;
  }

  for (const member of currentMembers) {
    const online = isOnline(member);

    const row = el('div', 'admin-member-row');

    const info = el('div', '');

    const name = el(
      'strong',
      '',
      safeText(member.name, 'Sem nome')
    );

    const details = el(
      'small',
      '',
      'ID ' +
      safeText(member.tag, '---') +
      ' · ' +
      safeText(member.role, 'Membro')
    );

    const status = el(
      'small',
      online ? 'status' : 'status off',
      online ? '● Online' : '● Offline'
    );

    const discord = el(
      'small',
      'hint',
      member.discordId
        ? 'Discord: ' + member.discordId
        : 'Discord não vinculado'
    );

    info.append(
      name,
      details,
      status,
      discord
    );

    // Botoes
    const actions = el('div', 'form-actions');

    const edit = el(
      'button',
      'btn ghost',
      'Editar'
    );

    edit.type = 'button';

    edit.addEventListener('click', () => {
      editMember(member.id);
    });

    const remove = el(
      'button',
      'btn ghost',
      'Remover'
    );

    remove.type = 'button';

    remove.addEventListener('click', () => {
      removeMember(member.id);
    });

    actions.append(edit, remove);

    row.append(info, actions);

    container.append(row);
  }
}

// ==========================================
// EDITAR MEMBRO
// ==========================================

function editMember(id) {
  const member = currentMembers.find(
    item => Number(item.id) === Number(id)
  );

  if (!member) return;

  $('editId').value = member.id;
  $('memberName').value = member.name;
  $('memberTag').value = member.tag;
  $('memberRole').value = member.role;

  if ($('memberDiscordId')) {
    $('memberDiscordId').value =
      member.discordId || '';
  }

  if ($('memberStatus')) {
    $('memberStatus').value =
      isOnline(member) ? 'Online' : 'Offline';
  }

  $('saveMember').textContent =
    'Salvar alterações';

  $('cancelEdit').classList.remove('hidden');

  $('memberName').focus();

  $('memberForm').scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });
}

// ==========================================
// LIMPAR FORMULARIO
// ==========================================

function resetMemberForm() {
  const form = $('memberForm');

  if (!form) return;

  form.reset();

  $('editId').value = '';

  $('saveMember').textContent =
    'Cadastrar membro';

  $('cancelEdit').classList.add('hidden');

  if ($('memberStatus')) {
    $('memberStatus').value = 'Offline';
  }
}

// ==========================================
// ENVIAR REQUISICOES DE MEMBROS
// ==========================================

async function memberRequest(url, method, body) {
  const message = $('memberMsg');

  try {
    if (message) {
      message.textContent = 'Aguarde...';
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      ...(body
        ? { body: JSON.stringify(body) }
        : {})
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || 'Erro ao salvar membro.'
      );
    }

    if (message) {
      message.textContent =
        'Alteração realizada com sucesso!';
    }

    resetMemberForm();

    await showAdmin();
    await load();

    return true;

  } catch (error) {
    console.error(
      'Erro ao salvar membro:',
      error.message
    );

    if (message) {
      message.textContent = error.message;
    }

    return false;
  }
}

// ==========================================
// EXCLUIR MEMBRO
// ==========================================

async function removeMember(id) {
  const member = currentMembers.find(
    item => Number(item.id) === Number(id)
  );

  if (!member) return;

  const confirmed = confirm(
    'Deseja realmente remover ' +
    member.name +
    ' da Tropa do Japão?'
  );

  if (!confirmed) return;

  await memberRequest(
    '/api/members/' + encodeURIComponent(id),
    'DELETE'
  );
}

// ==========================================
// FORMULARIO DE LOGIN
// ==========================================

const loginForm = $('loginForm');

if (loginForm) {
  loginForm.addEventListener(
    'submit',
    async event => {
      event.preventDefault();

      const message = $('loginMsg');

      if (message) {
        message.textContent = 'Entrando...';
      }

      const formData = new FormData(loginForm);

      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user: formData.get('user'),
            password: formData.get('password')
          })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || 'Falha no login.'
          );
        }

        if (message) {
          message.textContent = '';
        }

        loginForm.reset();

        await showAdmin();

      } catch (error) {
        if (message) {
          message.textContent = error.message;
        }
      }
    }
  );
}

// ==========================================
// SAIR DO PAINEL
// ==========================================

const logoutBtn = $('logoutBtn');

if (logoutBtn) {
  logoutBtn.addEventListener(
    'click',
    async () => {
      try {
        const response = await fetch(
          '/api/logout',
          { method: 'POST' }
        );

        if (!response.ok) {
          throw new Error('Erro ao sair.');
        }

        $('adminCard')?.classList.add('hidden');
        $('loginForm')?.classList.remove('hidden');

        resetMemberForm();

      } catch (error) {
        console.error(
          'Erro no logout:',
          error.message
        );
      }
    }
  );
}

// ==========================================
// CANCELAR EDICAO
// ==========================================

const cancelEdit = $('cancelEdit');

if (cancelEdit) {
  cancelEdit.addEventListener(
    'click',
    resetMemberForm
  );
}

// ==========================================
// CADASTRAR OU ATUALIZAR MEMBRO
// ==========================================

const memberForm = $('memberForm');

if (memberForm) {
  memberForm.addEventListener(
    'submit',
    async event => {
      event.preventDefault();

      const id = $('editId').value.trim();

      const name = $('memberName').value.trim();

      const tag = $('memberTag').value.trim();

      const role = $('memberRole').value;

      const discordId = $('memberDiscordId')
        ? $('memberDiscordId').value.trim()
        : '';

      // Validar ID do Discord
      if (
        discordId &&
        !/^\d{15,22}$/.test(discordId)
      ) {
        $('memberMsg').textContent =
          'Informe um ID do Discord válido.';

        return;
      }

      const payload = {
        name,
        tag,
        role,
        discordId
      };

      const url = id
        ? '/api/members/' + encodeURIComponent(id)
        : '/api/members';

      const method = id ? 'PUT' : 'POST';

      await memberRequest(
        url,
        method,
        payload
      );
    }
  );
}

// ==========================================
// INICIAR PAINEL
// ==========================================

setupDiscordField();

sessionCheck();

// ==========================================
// ATUALIZAR PAINEL AUTOMATICAMENTE
// ==========================================

// Atualiza o painel a cada 30 segundos,
// mas nao interrompe quem estiver editando.

setInterval(() => {
  const adminCard = $('adminCard');

  const editing = Boolean(
    $('editId')?.value
  );

  const formFocused = Boolean(
    $('memberForm')?.contains(
      document.activeElement
    )
  );

  if (
    adminCard &&
    !adminCard.classList.contains('hidden') &&
    !editing &&
    !formFocused &&
    !document.hidden
  ) {
    showAdmin();
  }
}, 30000);

// ==========================================
// FIM DO APP.JS
// TROPA DO JAPAO - BOT DIV
// ==========================================