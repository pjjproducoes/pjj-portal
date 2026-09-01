# Operação segura

## Ambientes

| Ambiente | Worker | D1 | Pasta Drive |
| --- | --- | --- | --- |
| Staging | `pjj-portal-staging` | `pjj-portal-staging` | exclusiva de staging |
| Produção | `pjj-portal` | `pjj-portal-production` | raiz oficial da PJJ |

Nunca copie IDs, tokens, arquivos ou links entre os ambientes. Staging é a
validação obrigatória antes de produção.

## Bindings e segredos

O Worker recebe `DB`, `ENVIRONMENT`, `DRIVE_ROOT_FOLDER_ID` e
`PUBLIC_ORIGIN` pelo `wrangler.jsonc`. Os valores abaixo são segredos e só
podem existir na Cloudflare ou no GitHub Actions:

- `DRIVE_SERVICE_ACCOUNT_JSON`
- `DRIVE_OAUTH_CLIENT_ID`
- `DRIVE_OAUTH_CLIENT_SECRET`
- `DRIVE_OAUTH_REFRESH_TOKEN`
- `SESSION_HMAC_KEY`
- `DATA_ENCRYPTION_KEY`
- `ADMIN_BOOTSTRAP_HASH`

O processador recebe somente a conta de serviço e a origem do portal por
secrets/variables do repositório. Nenhum segredo é exibido pelo admin, salvo
em logs ou gravado no D1.

## Publicação

1. Execute `npm ci` e `npm run check`.
2. Aplique as migrations em staging e valide login, MFA, criação de cliente,
   upload, revisão, acesso do cliente e embed no domínio permitido.
3. Inspecione logs de erros do Worker e a fila de processamento.
4. Publique o mesmo commit em produção; só então aplique migrations de
   produção que não sejam retrocompatíveis.
5. Faça smoke test de `/api/health`, login administrativo, streaming de um
   asset autorizado e negação de acesso sem sessão.

Migrations devem ser aplicadas em ordem e registradas em `schema_migrations`.
Uma mudança incompatível exige duas publicações: primeiro código compatível,
depois schema, e só então a limpeza do código antigo.

## Backup e recuperação

O workflow **Backup diário do PJJ Portal** exporta dados estruturados do D1
para o Drive privado. O Git mantém migrations e histórico de código; o Drive
mantém originais, derivados e a lixeira recuperável.

Para recuperar um item, use a Lixeira do administrativo: ela restaura o mesmo
ID e solicita a restauração correspondente ao Drive. Para recuperar o banco,
importe somente um backup validado no ambiente correto e confirme que os IDs
de Drive ainda existem antes de reabrir acessos. Nunca restaure um backup de
staging em produção.

## Diagnóstico

- Upload: verifique sessão resumível, bytes confirmados e erro no asset.
- Processamento: revise `processing_jobs`, erro detalhado, tentativa e retry.
- Drive: confirme que o Worker tem OAuth ativo e que a pasta do ambiente está
  acessível; não torne o arquivo público como paliativo.
- Acesso: confira sessão, expiração, revogação e associação ao projeto.
- Embed: confira origem/referer, domínio permitido, validade, token e CSP.

Os logs de auditoria são a fonte para ações administrativas, acessos e
downloads. Dados de autenticação e arquivos nunca devem ser copiados para
chamados ou mensagens de suporte.
