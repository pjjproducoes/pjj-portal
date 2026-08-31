# PJJ Portal — mapa do produto

Este documento transforma o briefing do produto em um mapa verificável de implementação.

## Decisões já consolidadas

- Google Drive privado é o armazenamento persistente e a fonte de verdade. O R2 não faz parte da arquitetura atual.
- O envio é manual pelo administrativo; não existe agente Windows, heartbeat, WebODM local ou dependência do computador.
- A aplicação roda em Cloudflare Workers/D1. O processamento pesado atual usa o executor real do GitHub Actions com GDAL, PDAL, Assimp, FFmpeg e glTF Transform.
- A publicação é deliberada: processamento concluído vai para revisão e só depois fica visível ao cliente.
- O OAuth do proprietário é usado para gravar no Drive pessoal; a conta de serviço autentica o executor interno.
- Staging e produção usam Workers, D1 e pastas Drive separadas.

## O que já está implementado

- Clientes, projetos, captações e assets relacionados por IDs no D1.
- Pastas do Drive criadas por entidade, sem depender do nome do arquivo como identidade.
- Upload resumível em chunks, checksum, retry e prevenção de duplicidade.
- Detecção de GeoTIFF, modelos, nuvens de pontos, fotos, vídeos e PDFs.
- Derivação real de COG/preview, hillshade, GLB otimizado e COPC quando as ferramentas estão disponíveis.
- Sessões HttpOnly, CSRF, expiração, vínculo de navegador, PBKDF2, bloqueio progressivo, MFA TOTP e recuperação.
- Permissões por projeto, links/embeds com domínio, validade e revogação.
- Streaming privado, downloads autorizados, lixeira e trilha de auditoria.
- Backup diário do D1 para o Google Drive.

## Lacunas prioritárias

1. Reorganizar a interface do site, administrativo e portal para uma experiência de produto consistente e responsiva.
2. Exibir no administrativo a fila, revisão, falhas, retry, publicação e auditoria de forma operacional.
3. Permitir revisar derivados antes da publicação, sem exigir que o asset já esteja público para o cliente.
4. Evoluir viewers e comparação temporal com controles de touch, metadata, escala e estados de erro claros.
5. Completar branding por cliente, white-label e gestão visual de embeds.
6. Acrescentar versionamento/rollback explícito para substituição de assets.
7. Criar testes E2E e negativos para autorização, downloads, uploads, embeds, expiração e revogação.
8. Documentar deploy, secrets, bindings, backup, restauração e operação do processador.

## Critério de conclusão

Uma funcionalidade só será marcada como concluída quando o fluxo inteiro estiver validado: interface, persistência, autorização, Drive, processamento, derivados, revisão/publicação, erro, retry, auditoria e teste.
