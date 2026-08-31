# PJJ Portal

Produto digital da PJJ Produções para site institucional, administração, portal privado, entrega B2B/B2B2C e visualizadores técnicos.

## Princípios fixos

- Google Drive privado é o armazenamento persistente e fonte de verdade.
- Cloudflare controla aplicação, D1, autenticação, autorização, processamento, cache e entrega.
- Não existe integração com computador, agente Windows ou WebODM local.
- Nenhum asset privado depende de link público do Drive.
- Staging é validado antes de produção.
- A logo original não é redesenhada.

Segredos ficam apenas em bindings secretos da Cloudflare e nunca no repositório.

## Componentes

- `src/`: Worker modular, site, admin, portal, autenticação, MFA, uploads, autorização, embeds e viewers.
- `migrations/`: esquema D1 versionado.
- `processor/`: imagem do container com GDAL, PDAL, Assimp e glTF Transform.
- `processing/`: orquestrador de Containers/Workflows, mantido separado até a ativação do plano compatível.
- `test/`: testes automatizados de criptografia, senha e TOTP.

## Fluxos implementados

- sessão `HttpOnly`, CSRF, expiração absoluta e por inatividade, vínculo ao navegador e revogação;
- senha PBKDF2, bloqueio progressivo, MFA TOTP e códigos de recuperação;
- clientes → projetos → captações com pastas identificadas por ID no Drive;
- upload resumível em chunks de 8 MiB, checksum, detecção de duplicidade, progresso e retry;
- estados persistidos de asset e processamento, publicação explícita e reprocessamento;
- acesso por usuário/projeto e streaming privado com `Range`;
- embed com token, expiração, revogação, domínio permitido e `frame-ancestors`;
- viewer autorizado para COG, GLB, imagens, vídeos e documentos;
- exclusão recuperável no banco e na lixeira do Drive;
- trilha de auditoria para operações sensíveis.

## Verificação local

```sh
npm ci
npm run check
```

O deploy ativo de desenvolvimento é o Worker `pjj-portal-staging`, ligado ao D1 `pjj-portal-staging`. O arquivo `wrangler.processing.example.jsonc` documenta os bindings de processamento que só podem ser ativados quando Containers estiver disponível na conta.
