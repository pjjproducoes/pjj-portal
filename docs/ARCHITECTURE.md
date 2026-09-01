# Arquitetura operacional

## Decisão de armazenamento

O Google Drive privado da PJJ é a fonte de verdade dos arquivos. O D1 guarda
metadados, IDs e estados; nunca é usado como armazenamento de mídia. O portal
faz streaming autenticado pelo Worker — os links do Drive não são expostos nem
dependem de compartilhamento público.

## Fluxo de entrega

1. O administrador cria cliente, projeto e captação.
2. O browser envia o original ao Drive por sessão resumível, em blocos de 8 MiB.
3. A sessão persiste 23 horas. Reabrir o mesmo arquivo retoma o byte confirmado,
   sem criar outro asset.
4. Um job é registrado no D1 e o workflow **Processar arquivos PJJ** o busca a
   cada cinco minutos.
5. O executor gera derivados reais: COG e preview/hillshade, GLB otimizado,
   COPC, previews de foto/vídeo/PDF, conforme o tipo detectado.
6. O Worker recebe as variantes, valida o resultado e deixa o asset em revisão.
7. A aprovação administrativa publica asset, captação e projeto juntos. Só então
   o cliente autorizado pode vê-los.

## Adaptações deliberadas do briefing

| Diretriz do briefing | Implementação atual |
| --- | --- |
| Drive como armazenamento definitivo | Implementado. OAuth do proprietário fornece cota de gravação; conta de serviço é usada pelo executor. |
| Sem dependência do computador | Implementado. Não há agente, heartbeat local, WebODM ou comunicação PC ↔ portal. |
| Processamento Cloudflare/Containers | A fase atual usa GitHub Actions com ferramentas reais (GDAL, PDAL, Assimp, FFmpeg e glTF Transform). Containers permanece como caminho de migração quando o volume justificar o plano/infraestrutura. |
| Upload manual, restante automático | Implementado com sessão resumível, retomada, retry, fila e revisão antes de publicar. |
| Segurança de arquivos | Implementada por sessão, autorização por projeto, streaming privado, downloads autorizados, expiração/revogação e auditoria. |
| Staging separado | Implementado com Worker, D1 e pasta Drive próprios. |

## Operação e recuperação

- O backup diário exporta o D1 para o Drive da PJJ.
- A lixeira administrativa move a entidade e o respectivo arquivo/pasta do Drive
  para a lixeira recuperável; restaurar mantém os IDs da plataforma.
- Migrations são a fonte de versionamento do schema. Segredos permanecem apenas
  nos bindings da Cloudflare/GitHub Actions.

## Limites conhecidos

O executor mede espaço temporário antes de processar e recusa com mensagem útil
um original que não caiba com segurança no runner. Produtos muito grandes exigem
o executor/Container adequado: o portal não simula uma conversão que não ocorreu.
