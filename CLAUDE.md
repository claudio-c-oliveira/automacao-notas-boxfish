# Contexto do projeto — automação de notas fiscais Box Fish

Arquivo lido automaticamente a cada sessão. Serve para uma sessão nova (ou depois de um
reboot) retomar sem precisar reconstruir o contexto pelo histórico da conversa.

## A fonte da verdade é o spec, em `docs/spec/`

O spec foi dividido em 24/10/2026. `docs/spec.md` é só a porta de entrada.
**Leitura obrigatória em qualquer tarefa: `docs/spec/00-comum.md`.** Ele traz:
- o escopo e as 4 fases;
- os perfis e os nomes vigentes dos Cost (seção 6);
- ambiente × modo de execução (7.4);
- o backup obrigatório (13.4);
- a coluna Q (13.5);
- os IDs dos Cost (13.6).

Depois, leia só o arquivo da tarefa (tabela no início do `00-comum.md`):
- `fase-1.md`, `fase-2.md` e `fase-3-4.md`;
- `01-arquitetura-infra.md`;
- `90-decisoes-e-proximos-passos.md`.

O usuário costuma pedir "releia o spec atualizado" no início da rodada.

Para a estrutura do código (scripts, workflows, config e quem chama quem), veja
`docs/CODEBASE_MAP.md`. Ele foi feito em parte por ferramenta e em parte por leitura:
**confira contra os arquivos antes de confiar**.

**Nunca invente regra que não esteja no spec.** Em caso de dúvida ou ambiguidade, pare e
pergunte, em vez de decidir sozinho. Se o CLAUDE.md ou o mapa contradisserem o spec, vale o spec;
registre a contradição.

**NÃO edite `docs/spec.md` nem `docs/spec/*`.** Para propor mudança, escreva a sugestão em
`_saidas/sugestoes-para-spec-AAAA-MM-DD.md`. O usuário leva ao Claude (chat), aplica no spec
oficial e devolve o arquivo para commit. Isso evita conflito entre edições suas e as dele.

## Arquitetura: fonte única gera os dois ambientes

```
workflows/_fonte/<nome>.fonte.json                     ← o ÚNICO arquivo editável à mão
        │  node scripts/gerar_workflows.js
        ├─→ workflows/<nome>.homolog.json                   (gerado — não editar)
        └─→ workflows/<nome>.producao.json                  (gerado — não editar)
```

Marcadores entendidos pela fonte:
- `credentials.<tipo>.__porAmbiente = { homolog, producao }` — resolve a credencial do ambiente.
- `node.__ifAmbiente = { saida0: 'homolog', saida1: 'producao' }` — o IF é removido e só o
  ramo do ambiente alvo sobrevive.
- `__SUFIXO_AMBIENTE__` em caminhos de arquivo — vira `_hml` em homolog e some em produção.
- `@@incluir scripts/lib/<arquivo>.js` dentro de um `jsCode` — o gerador embute a biblioteca
  (sem o `'use strict'` e sem o `module.exports`). Arquivo inexistente para a geração, e o
  validador dá ERRO para marcador sem resolver.

O gerador remove nodes inalcançáveis por **arestas puras**. Não preserve node por ele ser
citado em `$('...')`: sem aresta de entrada ele nunca executa, e preservá-lo já causou dois
bugs reais (vazamento de credencial do Box para o arquivo de homolog, e cadeia inteira do
Drive sobrevivendo em produção).

## Ciclo de trabalho de toda rodada

```bash
node scripts/gerar_workflows.js                                        # fonte → homolog + produção
node scripts/validar_workflows.js                                      # valida todos
npm test                                                               # bibliotecas + ciclo do Cost no simulador
node scripts/deploy_n8n.js workflows/fase1_solicitacao_nota.homolog.json
node scripts/validar_workflows.js --remoto workflows/fase1_solicitacao_nota.homolog.json
```

- `npm test` roda `tests/xlsx_conferencia.teste.js` e `tests/fase1_ciclo_cost.teste.js`. O
  segundo executa os nodes do `.homolog.json` GERADO no simulador (`tests/simulador/motor_q.js`)
  contra um Box falso (`tests/simulador/box_falso.js`). Rerodar a cada mudança na fonte.
- `deploy_n8n.js` tem trava: só publica `.homolog.json`. Produção exige
  `--producao --confirmo-producao` e o OK explícito do Claudio. Ele atualiza por id (achado pelo
  nome), não ativa nada e não mexe em credencial. **Antes de publicar por cima, guarde em
  `_saidas/` uma cópia (GET) do publicado, com o sha1, para voltar atrás.** O n8n acrescenta
  sozinho `settings.binaryMode = "separate"`; isso não é divergência.
- `validar_workflows.js` compara cada parâmetro contra as definições oficiais em
  `scripts/n8n_node_defs.json` (extraídas do `n8n-nodes-base`), porque **o n8n descarta
  silenciosamente parâmetro que não reconhece**. Também checa referências `$('...')` (node
  inexistente e node que só roda depois são ERRO) e dá ERRO para `writeBuffer` do exceljs em
  workflow migrado (AVISO nos outros).

## Regras de trabalho com o usuário (Claudio)

- **Ele não consegue copiar texto do terminal.**
  - Toda resposta vai também em `_saidas/resumo-ultima-entrega.md`, com o texto do chat na
    íntegra, **sobrescrevendo** o arquivo a cada vez.
  - Perguntas de decisão vão em `_saidas/decisao-pendente-AAAA-MM-DD-<assunto>.txt`.
- **Numeração:** "passo" é **sempre** a numeração do C.8 do plano
  (`_saidas/plano-fase1-migracao-2026-10-28.md`); "rodada" é a contagem dos prompts do Claudio
  (1ª, 2ª, …). Nunca chamar uma parte de rodada de "passo".
- **Não rode o Manual Trigger nem execute workflow** sem confirmação explícita dele. Ele roda e
  reporta o resultado.
- **Testes de verdade, não análise estática.** Use workflows descartáveis
  (`ZZ-TEMP … (apagar)`), inativos, só com Manual Trigger, sem webhook e sem `errorWorkflow`.
  Crie-os via API, só com o OK dele, e mostre antes a lista exata de chamadas (qual escreve e qual
  só lê). Depois de executados: ler o resultado, gravar em `_saidas/`, apagar a execução e o
  workflow, e conferir o 404. Vários bugs só apareceram assim.
- **Só pode existir 1 workflow ZZ-TEMP por vez na instância.** O script recusa criar outro.
- **Commit e push quem faz é o Claudio.**
- **Nada de e-mail ou Telegram de teste** sem pedido.
- **Na VM, ele entra como `claudio_desenvolvedor`**, que não é dono dos arquivos de
  `/opt/box-fish-config/`. Comando que escreve nesses arquivos usa `sudo` sobre o arquivo
  existente, sem trocar o dono: `printf '{}\n' | sudo tee <arquivo> > /dev/null` para esvaziar,
  `sudo cp <cópia> <arquivo>` para restaurar. Nunca `>` direto nem `sudo cp -p` sobre arquivo do
  n8n.

## Estado atual (atualize quando mudar)

- **Fase 1:** DOIS workflows desde 10/09 (spec 3.1.5, processamento sequencial por fonte).
  - `fase1_despachante`: Manual Trigger + Schedule Trigger. Emite uma fonte por item
    (S01, depois S02) e chama a Fase 1 com `mode: each`, uma execução por fonte, em série.
    **É AQUI que se dispara o Manual Trigger.**
  - `fase1_solicitacao_nota`: sub-workflow, só com `executeWorkflowTrigger` (recebe
    `fonteId`). O node `Filtrar pela fonte desta passada` corta as linhas que não são daquela
    fonte, logo depois do parsing.

  **O que está publicado no n8n (todos inativos, agendamento desligado; ids também no
  `.n8n-deploy-state.json`):**

  | Workflow | id | Versão publicada |
  |---|---|---|
  | Fase 1 — Solicitação de nota (Homolog) | `wChwOegL6fooohxz` | **migrada**, republicada em 31/10/2026 (216 nodes, ciclo cirúrgico do Cost) |
  | Fase 1 — Despachante por fonte (Homolog) | `Um24Adj3mZK2n5rM` | 11/09 (não precisou mudar) |
  | Fase 1 — Solicitação de nota (Produção) | `cNspHK45vaYDsFmb` | **antiga, de 11/09** |
  | Fase 1 — Despachante por fonte (Produção) | `ox5wWLBcW8J5pmBB` | 11/09 |
  | Error Handler — Notas Fiscais Box Fish | `deEtoV7P9xYBbWDZ` | 11/09, **ativo** |

  Produção já rodou de ponta a ponta em 11/09 (execuções 276–278, registradas no spec 8).

  **A Fase 1 de produção publicada (a de 11/09) não pode ser disparada.** Ela ainda aponta para
  os IDs antigos dos Cost, grava com exceljs, não faz backup, e a reversão dela usa a API de
  versões do Box, que responde 403. O `.producao.json` do repositório já é a versão migrada, mas
  só é publicado no passo 10 do C.8, com OK explícito do Claudio.
- **O que mudou na Fase 1 com a migração (passos 1 a 8 do C.8, 28 a 31/10):**
  - **O Cost é lido e escrito pelo Box**, nos dois ambientes. Homolog não usa mais o Drive da
    Michelle para o Cost: ele lê e escreve as cópias `ZZ-HML_…` (abaixo).
  - **Configuração dos Cost versionada:** `config/cost_reports.json` e `cost_reports_hml.json`
    (ids, nome e dono esperados, pastas de backup, retenção, janela de silêncio, cabeçalho da
    NOTAS, regra da coluna Q e `ids_proibidos`). **O mesmo arquivo tem de estar na VM**, em
    `/opt/box-fish-config/`: nenhum script copia; quem copia é o Claudio, por SSH. A fonte confere
    a `versao` (hoje `2026-10-29.2`) e para se divergir.
  - **`ids_proibidos`:** os IDs antigos dos Cost (`2028817453680`, `2366859928452`) em qualquer
    ambiente, e no homolog também os Cost reais. Nenhum desses ids pode aparecer nos arquivos da
    Fase 1.
  - **Ciclo de cada escrita (C.3 do plano), cadeias `Escrita N — 01…36` e `Escrita L — 01…36`:**
    config → conta do Box → portão (id, nome, dono, situação, id proibido) e janela de silêncio →
    download integral conferido → Passo 0 → backup por upload, baixado de volta e conferido →
    checar lock → LOCK → escrita cirúrgica → upload com `If-Match` → UNLOCK sempre → comparação
    completa → retenção → recibo e novo estado. Se a comparação falhar: restauração `R01…R19` e
    alerta `RF`. Paradas são por `throw`.
  - **`estado_cost.json` / `estado_cost_hml.json`** (só na VM, fora do Git): a impressão digital
    do último arquivo conhecido, usada pelo Passo 0 e regravada depois de cada escrita conferida.
    A primeira de cada ambiente é gravada por um ZZ-TEMP só de leitura (homolog: exec 658, 30/10;
    produção: só antes do passo 11, com OK explícito). Sem estado, a fonte para.
  - **Arquivos que a Fase 1 GRAVA na VM:** `cobrancas`, `log_diario` e `estado_cost` (com
    `_hml` em homolog). O n8n é uid 1000: esses arquivos têm de ter dono `ubuntu:ubuntu`; com
    `root:root` a gravação falha.
  - **Pendente:** D17 (a cobrança "em rascunho" ainda ENVIA; corrigir antes do passo 11). Até lá,
    o `cobrancas_hml.json` da VM fica vazio (`{}`) nos testes (D32).
- **Error Handler:** publicado e **ativo**. Alerta no Telegram em qualquer falha.
- **Fase 2** (3 workflows): migrados para fonte única em 08/09 e **não publicados**. Ainda têm
  bloqueadores conhecidos (spec, seção 8 de `01-arquitetura-infra.md`):
  - `boxFileId` nunca definido;
  - 4 IDs de pasta `REPLACE_WITH_…`;
  - perda de contexto depois do `Gmail — Baixar anexo`;
  - Cost Report sem ramo por ambiente: o homolog lê o Box de produção;
  - os IDs antigos dos Cost em 4 pontos (2 em cada workflow de leitura).

  Pela regra de 24/10, a Fase 2 é que marca `OK` na coluna Q, logo depois do arquivamento por
  função. **resumo_diario** continua no formato antigo e não publicado.
- **Fase 3+4:** não iniciadas.
- **Rollback via Telegram (spec 13.3):** não existe. A Fase 1 migrada já manda o recibo de cada
  escrita no Telegram (backup, sha1 antes e depois, células e como restaurar).
- **Comandos `/modo` e `/apelido` do Telegram:** não existem. O `/resumo` existe em arquivo e não
  está publicado. Para trocar o modo, edite `/opt/box-fish-config/config_execucao.json` na VM.

## Cost Report (spec 13.4 a 13.6) — regras fixas

| Cost | Nome vigente desde 19/10/2026 | Box id | Cópia de teste (homolog) |
|---|---|---|---|
| S01 (AREP + Reunion) | `BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_22.09` | `2482160269668` | `ZZ-HML_BR_SMTC_S01__…_22.09` (`2558564203065`) |
| S02 (Soft Pré) | `BR_SMTC_S02_SOFTPRE_PROVISÓRIO_22.09` | `2482145718537` | `ZZ-HML_BR_SMTC_S02_…_22.09` (`2558533556606`) |

- **Os ids, nomes e pastas valem pelo `config/cost_reports*.json`**, nunca por constante no
  código. Nunca assumir outro arquivo nem usar fallback.
- **Ninguém renomeia pastas nem arquivos no Drive ou no Box:** a automação depende dos nomes.
- **Gravar só com `scripts/lib/xlsx_cirurgico.js`**, que reescreve só o XML da aba NOTAS e copia
  o resto byte a byte. **Nunca gravar com exceljs**: ele reconstrói o pacote e destrói a
  formatação condicional x14 e os dxfs, como no estrago de setembro. O exceljs só serve para
  ler. A conferência usa `scripts/lib/xlsx_conferencia.js`.
- **Backup obrigatório antes de qualquer escrita, um por escrita:**
  - download integral do arquivo, upload como cópia e download de volta, com sha1 e tamanho
    iguais aos do original;
  - produção: `ZZ-BACKUP-COST` (`429803889593`), subpastas `S01` (`432114143613`) e `S02`
    (`432117772745`); homolog: `ZZ-HOMOLOG-COST` (`432491185803`) > `BACKUP` > `S01` e `S02`;
  - o nome é o original + `_copia_AAAA-MM-DD_HHMMSS`;
  - ficam as **30** últimas por planilha; a limpeza só roda depois de escrita conferida, só na
    subpasta do projeto, apaga no máximo 1 por escrita e só conta como apagado com releitura 404;
  - sem backup verificado, não escreve.
- **Passo 0 (antes de escrever):** compara a impressão digital do arquivo atual com a do
  `estado_cost*.json`. Para com qualquer mudança de formatação (partes do pacote, abas,
  formatação condicional legada e x14, `cols`, `autoFilter`, mesclagens como conjunto, dxfs).
  Só relata: valores de célula, `styles.xml` (o Excel Online renumera), as faixas (`sqref`) e a
  faixa dos `_xlnm._FilterDatabase` da NOTAS (D15, D20, D24).
- **Janela de silêncio:** se o Cost foi modificado há menos de 10 minutos, a fonte não escreve
  nessa execução. Na coluna L, ela só é dispensada quando o arquivo atual é exatamente o que a
  escrita da coluna N acabou de gravar na mesma execução (D28).
- **Escrita segura no Box:**
  - antes do lock, conferir que o arquivo não está travado; se estiver, adiar;
  - lock com `expires_at`, conferindo que o lock é nosso;
  - upload com `If-Match`;
  - **unlock sempre**, mesmo em erro;
  - depois, comparação completa do pacote: só a aba NOTAS e só as colunas previstas podem mudar.
  - Prefere-se perder uma marcação a perder a formatação: na dúvida, abortar e restaurar do
    backup.
- **Coluna Q (`CHECK ARQUIVO DRIVE`, aba NOTAS), regra de 28/10 (está no `coluna_q` da config):**

  | Valor atual | O que fazer |
  |---|---|
  | vazio, `PENDENTE` ou `N/A` | pode gravar `OK` |
  | `OK` | já arquivada; não regrava |
  | `ARQUIVO INTERNO`, `ARQUIVO DIRETORIA`, `PREVISÃO`, `ARQUIVO INERNO` | nunca tocar |
  | qualquer outro | não grava; relata "valor desconhecido" |

  - O `OK` vai no estilo do "OK" já usado na planilha (370 no S01, 410 no S02).
  - Arquivar por função e marcar `OK` andam juntos, na Fase 2.
  - A coluna N (contrato) não entra no arquivamento.

## Infraestrutura (detalhes no `01-arquitetura-infra.md`, 7.6)

- n8n em `https://n8n.carvalhodeoliveira.com`, Docker puro na VM `n8n-boxfish` (GCP).
- Chave da API do n8n no `.env` (gitignored). `scripts/lib/n8n_api.js` a carrega.
- Config de execução: `/home/node/.n8n-files/box-fish-config/` no container ←
  `/opt/box-fish-config/` no host (bind mount). **Não use `/home/node/.n8n/`**: o n8n bloqueia
  acesso de arquivo ali (CVE-2025-68697).
- **Bibliotecas de planilha na imagem:**

  | Biblioteca | Para quê |
  |---|---|
  | `exceljs` | ler `.xlsx` e a cor de célula |
  | `xlsx`/SheetJS | ler os `.xlsb` dos contratos |
  | `jszip` | escrita cirúrgica e conferência do Cost |

  Todas exigem estar em `NODE_FUNCTION_ALLOW_EXTERNAL`. O `infra/Dockerfile` já instala as três,
  e o `require('jszip')` funcionou na VM (exec 658, 30/10). O 7.6 do spec ainda lista só
  `exceljs,xlsx`.

## Armadilhas já encontradas — não repetir

- **Binário no Code node**: esta instância guarda binário em disco (`filesystem-v2`), então
  `item.binary.data.data` é o *rótulo do modo*, não o conteúdo. Use
  `helpers.getBinaryDataBuffer(indice, prop)`, que só lê do **input direto**.
- **Aba da planilha**: `getWorksheet('Notas')` é sensível a maiúsculas e a aba é `NOTAS`. O
  fallback `|| worksheets[0]` já mandou leitura e escrita para `DETALHADO MÃE`. Sem fallback,
  e sem nenhum outro fallback silencioso de arquivo ou projeto (ex.: `|| BOX_FILE_ID.AREP`).
- **Node de Drive nativo**: manda `spaces: 'appDataFolder, drive'` e falha por escopo. As
  buscas usam HTTP Request com `spaces=drive`.
- **Editar `jsCode` por recorte de texto** ("da marca X até a marca Y") já engoliu funções
  vizinhas três vezes. Recorte por **bloco de função**.
- **`$('Node').item`** depende de pareamento de itens e quebra quando um node no meio agrega
  ou reemite sem `pairedItem`. Para correlacionar após um Switch, use
  `$('Switch — ação').all(N)`, que devolve só os itens daquela saída, em ordem.
- **DELETE do Box pelo HTTP Request do n8n**: devolve um item vazio ou sem `json`, então o
  status do DELETE não prova nada. **A confirmação é a releitura (GET) dar 404.** No node do
  DELETE, use `alwaysOutputData` + `continueRegularOutput`, para a releitura sempre rodar. Sem
  404, conta como não apagado e a limpeza para.
- **Excel Online e versões**: cada salvamento da Michelle no Excel Online gera uma versão nova
  no Box e reescreve `styles.xml` (renumera índices de estilo) e a ordem das mesclagens, sem
  mudar o visual. Compare estilo **resolvido** e mesclagens **como conjunto**, nunca índice
  nem ordem.
- **API de versões do Box**: nesta conta (plano gratuito) responde 403
  (`GET /files/{id}/versions`). Não dá para restaurar versão por API; restaurar = subir o
  backup como nova versão (lock → upload com If-Match → unlock).
- **Code node sem `crypto`**: sha1 em JS puro (a função `sha1` de `scripts/lib/xlsx_conferencia.js`).
- **Modo `rascunho` não protege a planilha:** a coluna N é gravada em qualquer modo, e a
  cobrança "em rascunho" ainda envia (D17).

## Onde escrever arquivos

- Relatórios, resumos, decisões pendentes (`decisao-pendente-*.txt`), sugestões para o spec,
  estados, planos, exportações e qualquer arquivo de trabalho do Claude Code vão em `_saidas/`.
  O resumo da última entrega é `_saidas/resumo-ultima-entrega.md`. **Nunca na raiz do projeto.**
- Scripts temporários (`zz-temp-*`) e rascunhos descartáveis vão em `_lixo/`. Não apague o
  `_lixo/`.
- Só entram na raiz e nas pastas de projeto o código, a configuração e a documentação que o
  Claudio pedir para versionar.
- Planilhas de negócio (`notas-fora-da-rodada-*`, `conferencia-arquivadas-*`) ficam fora do Git
  (já estão no `.gitignore`).
- `scripts/referencia/` guarda os geradores ZZ-TEMP provados em 19–22/10, **só para leitura**.
  Eles não rodam do lugar novo, porque os caminhos são relativos à raiz.
- A pasta da Michelle (`/home/claudio/Documentos/0.3 - MICHELLE_BOXFISH`) é **só leitura**.
