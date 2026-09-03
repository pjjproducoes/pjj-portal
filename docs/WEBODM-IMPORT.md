# Importação inteligente de exportações WebODM

A Central PJJ possui uma entrada específica em **Arquivos → Importar pasta WebODM**. O operador escolhe a pasta inteira exportada; o navegador identifica os entregáveis úteis e os envia para a captação selecionada.

## Reconhecimento automático

- `odm_orthophoto/*.tif` → **Ortofoto**
- `odm_dem/*dsm*.tif` → **DSM**
- `odm_dem/*dtm*.tif` → **DTM**
- `odm_georeferencing/*.laz|*.las` → **Nuvem de pontos**
- `report.pdf` / `odm_report/*.pdf` → **Relatório PDF**
- `odm_texturing/*.glb|*.gltf|*.obj` → **Modelo 3D**
- materiais/texturas do `odm_texturing` → **arquivos auxiliares**, enviados antes do OBJ para permitir conversão texturizada no processador.
- vetores auxiliares reconhecidos (`geojson`, `gpkg`, `shp`, `csv` etc.) são preservados como `source`.

Arquivos intermediários pesados que não são entregáveis nem dependências do modelo são ignorados de propósito. A intenção é permitir selecionar a exportação bruta inteira sem obrigar o operador a descobrir quais arquivos precisam ser entregues.

## Processamento e aprovação

Cada original é salvo de forma privada no Google Drive e recebe um job. O workflow de GitHub Actions agora drena até 20 jobs em uma execução, evitando que uma importação com vários produtos precise esperar um agendamento de 5 minutos por arquivo.

Após a geração dos derivados web, o asset passa para `review` e aparece em **Aprovações**. A publicação continua deliberada: nada chega ao cliente antes da conferência humana.

## Modelos OBJ

Quando a exportação contém OBJ, os arquivos `.mtl` e texturas da mesma pasta são enviados antes. O processador consulta a pasta `Original` no Drive, baixa esses companheiros e os disponibiliza ao Assimp antes de gerar o GLB otimizado.
