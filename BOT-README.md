# Bot da Tropa do Japão 🇯🇵

## Instalação
1. Instale Node.js 20+ e execute `npm install`.
2. Copie `.env.example` para `.env`, preencha `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `SESSION_SECRET` e `ADMIN_PASSWORD`. **Nunca compartilhe o token.**
3. No Discord Developer Portal, crie uma Application, depois um Bot. Convide-o para seu servidor com os escopos `bot` e `applications.commands` e permissões **View Channels**, **Send Messages** e **Embed Links**.
4. Rode `npm run all` para iniciar site + bot, ou `npm start` e `npm run bot` em terminais separados.
5. Canal de avisos: `1494303769796808884`. O bot deve ter acesso a ele.

## Comandos
- `/live cadastrar plataforma url`: cada membro cadastra seu canal Twitch, YouTube ou TikTok.
- `/live remover plataforma`: exclui seu próprio canal.
- `/live listar`: mostra seus canais.
- `/live anunciar plataforma`: envia aviso manual no canal de lives, com limite de 1 aviso por hora por plataforma por usuário.

## Automação e limitações
- **Twitch:** detecção automática a cada 2 minutos, quando `TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET` estão configurados. Um aviso por ID de transmissão.
- **YouTube e TikTok:** cadastro e anúncio manual disponíveis. Detecção automática não implementada; depende de integrações adicionais e das restrições de cada plataforma.
- O site lista canais de `data/streams.json`. O botão Assistir abre o canal; player embutido ainda não implementado.
- O comando de anúncio marca a live como ativa até que outro estado seja atualizado; não comprova que está realmente online.
- Este é um ponto de partida: em produção use banco de dados, hospedagem persistente, armazenamento de sessões seguro, rate limiting e controle de permissões.
- **Não publique o arquivo `.env` nem o token do bot.**
