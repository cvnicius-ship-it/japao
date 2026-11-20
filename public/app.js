const $ = id => document.getElementById(id);

const el = (tag, className = '', text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

// Menu
$('menuBtn')?.addEventListener('click', () => {
  $('navLinks')?.classList.toggle('open');
});

document.querySelectorAll('#navLinks a').forEach(a => {
  a.addEventListener('click', () => {
    $('navLinks')?.classList.remove('open');
  });
});

// Carregar membros, lives e galeria
async function load() {
  try {
    const response = await fetch('/api/public', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error('Erro ao carregar dados do site');
    }

    const data = await response.json();
    const members = data.members || [];
    const streams = data.streams || [];
    const gallery = data.gallery || [];

    $('membersGrid').replaceChildren();
    $('streamsGrid').replaceChildren();
    $('galleryGrid').replaceChildren();

    $('memberCount').textContent = String(members.length).padStart(2, '0');
    $('onlineCount').textContent = String(
      members.filter(m => m.status === 'Online').length
    ).padStart(2, '0');
    $('liveCount').textContent = String(
      streams.filter(s => s.live).length
    ).padStart(2, '0');

    // Link do Discord
    if (data.discord && data.discord !== '#') {
      for (const id of ['discordLink', 'discordBottom']) {
        const link = $(id);
        if (!link) continue;
        link.href = data.discord;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    }

    // Membros
    for (const m of members) {
      const card = el('article', 'member-card');
      const portrait = el('div', 'portrait');

      portrait.append(
        el('span', '', m.avatar || m.name?.[0] || '?'),
        el('div', 'role-tag', (m.role || 'Membro').toUpperCase())
      );

      const body = el('div', 'member-body');

      body.append(
        el('h3', '', m.name),
        el('p', '', 'ID ' + m.tag)
      );

      const bottom = el('div', 'member-bottom');

      bottom.append(
        el('span', '', m.role),
        el(
          'span',
          m.status === 'Online' ? 'status' : 'status off',
          '● ' + m.status
        )
      );

      body.append(bottom);
      card.append(portrait, body);
      $('membersGrid').append(card);
    }

    // Lives
    for (const s of streams) {
      const card = el('article', 'stream-card');
      const preview = el('div', 'stream-preview', s.platform.toUpperCase());

      preview.append(
        el(
          'span',
          s.live ? 'live-badge active' : 'live-badge',
          s.live ? '● AO VIVO' : 'OFFLINE'
        )
      );

      const info = el('div', 'stream-info');
      const details = el('div');

      let handle = '';

      try {
        const url = new URL(s.channel);
        const parts = url.pathname.split('/').filter(Boolean);

        if (s.platform === 'TikTok') {
          handle = parts.find(part => part.startsWith('@')) || parts[0] || '';
        } else {
          handle = parts[0] || '';
        }
      } catch (error) {
        handle = '';
      }

      // Prioriza o nome do canal, não o apelido do Discord
      const channelTitle = s.channelName || handle || s.name || 'Canal';

      details.append(
        el('h3', '', channelTitle),
        el(
          'p',
          '',
          s.platform + (handle ? ' • ' + handle : ' • Canal do membro')
        )
      );

      info.append(details);

      // Link para assistir
      let validChannel = false;

      try {
        const url = new URL(s.channel);
        const allowedHosts = [
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

        validChannel =
          url.protocol === 'https:' &&
          allowedHosts.includes(url.hostname.toLowerCase());
      } catch (error) {
        validChannel = false;
      }

      if (validChannel) {
        const link = el('a', '', 'Assistir ↗');
        link.href = s.channel;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        info.append(link);
      } else {
        info.append(el('span', 'hint', 'Canal em breve'));
      }

      card.append(preview, info);
      $('streamsGrid').append(card);
    }

    // Galeria
    for (const g of gallery) {
      const card = el('article', 'gallery-item');

      card.append(
        el('span', '', (g.type || '').toUpperCase()),
        el('h3', '', g.title || '')
      );

      $('galleryGrid').append(card);
    }
  } catch (error) {
    console.error('Erro ao carregar site:', error);

    if ($('membersGrid')) {
      $('membersGrid').textContent = 'Não foi possível carregar os membros.';
    }
  }
}

// Verificar sessão do administrador
async function sessionCheck() {
  try {
    const response = await fetch('/api/session');
    const data = await response.json();

    if (data.authenticated) {
      await showAdmin();
    }
  } catch (error) {
    console.error('Erro ao verificar sessão:', error);
  }
}

// Mostrar painel administrativo
async function showAdmin() {
  const response = await fetch('/api/admin');

  if (!response.ok) {
    throw new Error('Não foi possível carregar o painel');
  }

  const data = await response.json();

  $('loginForm').classList.add('hidden');
  $('adminCard').classList.remove('hidden');
  $('adminStats').replaceChildren();

  const stats = [
    ['Membros', data.members.length],
    ['Lives cadastradas', data.streams.length],
    ['Galeria', data.gallery.length]
  ];

  for (const [label, count] of stats) {
    const item = el('div', '');

    item.append(
      el('strong', '', String(count)),
      document.createTextNode(label)
    );

    $('adminStats').append(item);
  }

  renderAdminMembers(data.members);
}

// Login
$('loginForm')?.addEventListener('submit', async e => {
  e.preventDefault();

  $('loginMsg').textContent = 'Entrando...';

  const formElement = e.currentTarget;
  const form = new FormData(formElement);

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: form.get('user'),
        password: form.get('password')
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Falha no login');
    }

    $('loginMsg').textContent = '';
    formElement.reset();

    await showAdmin();
  } catch (error) {
    $('loginMsg').textContent = error.message;
  }
});

// Sair do painel
$('logoutBtn')?.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });

  $('adminCard').classList.add('hidden');
  $('loginForm').classList.remove('hidden');
});

// Gerenciar membros
let currentMembers = [];

function renderAdminMembers(members) {
  currentMembers = members;
  $('adminMembers').replaceChildren();

  for (const m of members) {
    const row = el('div', 'admin-member-row');
    const info = el('div', '');

    info.append(
      el('strong', '', m.name),
      el('small', '', `ID ${m.tag} · ${m.role} · ${m.status}`)
    );

    const actions = el('div', 'form-actions');

    const edit = el('button', 'btn ghost', 'Editar');
    edit.type = 'button';

    edit.addEventListener('click', () => {
      $('editId').value = m.id;
      $('memberName').value = m.name;
      $('memberTag').value = m.tag;
      $('memberRole').value = m.role;
      $('memberStatus').value = m.status;

      $('saveMember').textContent = 'Salvar alterações';
      $('cancelEdit').classList.remove('hidden');
      $('memberName').focus();
    });

    const remove = el('button', 'btn ghost', 'Remover');
    remove.type = 'button';

    remove.addEventListener('click', async () => {
      if (!confirm(`Remover ${m.name} da lista?`)) return;

      await memberRequest(
        `/api/admin/members/${m.id}`,
        'DELETE'
      );
    });

    actions.append(edit, remove);
    row.append(info, actions);
    $('adminMembers').append(row);
  }
}

// Limpar formulário
function resetMemberForm() {
  $('memberForm').reset();
  $('editId').value = '';
  $('saveMember').textContent = 'Cadastrar membro';
  $('cancelEdit').classList.add('hidden');
}

// Cancelar edição
$('cancelEdit')?.addEventListener('click', resetMemberForm);

// Salvar, editar ou remover membro
async function memberRequest(url, method, body) {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao salvar');
    }

    $('memberMsg').textContent = 'Alteração salva!';

    resetMemberForm();
    await showAdmin();
    await load();
  } catch (error) {
    $('memberMsg').textContent = error.message;
  }
}

// Formulário de cadastro
$('memberForm')?.addEventListener('submit', async e => {
  e.preventDefault();

  const id = $('editId').value;

  await memberRequest(
    id ? `/api/admin/members/${id}` : '/api/admin/members',
    id ? 'PUT' : 'POST',
    {
      name: $('memberName').value,
      tag: $('memberTag').value,
      role: $('memberRole').value,
      status: $('memberStatus').value
    }
  );
});

// Inicialização
load();
sessionCheck();
