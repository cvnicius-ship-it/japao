# Portal Facção FiveM RP

Site responsivo preto/vermelho com início, membros, lives, galeria e painel privado básico.

## Executar

1. Instale Node.js 18+.
2. Abra a pasta no VS Code e rode `npm install`.
3. Copie `.env.example` para `.env` e defina uma senha forte e SESSION_SECRET aleatória (ex.: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
4. Rode `npm start` e abra `http://localhost:3000`.

## Personalizar

- Nome, frases e links: `public/index.html`.
- Cores e layout: `public/style.css` (variável `--red`).
- Membros, canais e galeria: arrays em `server.js`.
- Link do Discord: `DISCORD_INVITE` no `.env`.
- Canais de live: preencha `channel` com URL Twitch/YouTube válida.

## Importante

- Os dados de membros e lives são **exemplos fictícios**. O campo `live` não é atualizado automaticamente.
- As imagens da galeria são placeholders de CSS. Para fotos reais, acrescente arquivos e atualize a interface.
- O login do painel funciona para **um administrador** e protege `/api/admin`, mas ainda não existe edição dos dados pelo painel.
- Não há OAuth Discord nem bot conectado nesta versão. Para isso, crie aplicação no Discord Developer Portal, configure OAuth2 no backend e permissões por cargo; nunca exponha tokens no frontend.
- Antes de publicar: use HTTPS, SESSION_SECRET seguro, armazenamento persistente de sessões (ex.: Redis), rate limiting para login, proteção CSRF para ações autenticadas, banco de dados e autenticação por Discord com autorização por cargo. O MemoryStore padrão do express-session não é adequado para produção.
- A integração de live pode usar Twitch Helix/EventSub e YouTube Data API com chaves armazenadas no servidor.

## Gerenciar membros
Entre no painel com as credenciais do `.env`. Você pode cadastrar, editar e remover membros. Os registros ficam em `data/members.json`; faça backup desse arquivo. Os cargos iniciais são Rafaella (Líder), Robson (Sublíder) e Romana (Gerente). A integração com Discord e a detecção de lives ainda não estão implementadas. Em produção, configure HTTPS, segredo forte, armazenamento persistente de sessões e proteção contra tentativas repetidas de login.
