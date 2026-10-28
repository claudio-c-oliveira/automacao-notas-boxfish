AUTOMAÇÃO — CONTROLE DE NOTAS FISCAIS · Box Fish · Michelle Aguiar

> **Mapa dos arquivos do spec (`docs/spec/`)**: `00-comum.md` (leitura obrigatória em qualquer tarefa) · `01-arquitetura-infra.md` · `fase-1.md` · `fase-2.md` · `fase-3-4.md` · `90-decisoes-e-proximos-passos.md`. Os números das seções são os do documento original e não mudaram. O Claude Code lê estes arquivos e **nunca os edita**.

## 0. Mapa de leitura — atualizado em 24/10/2026
O spec foi dividido em arquivos por assunto, sem mudar nenhuma regra (o texto foi copiado como estava; só houve duas correções, listadas no fim deste mapa). Os números das seções são os do documento original. O documento não tem as seções 9 e 12.

**Leia SEMPRE, em qualquer tarefa:** este arquivo (`00-comum.md`), que traz o escopo (1), as 4 fases e os dois arquivamentos diferentes (2), os perfis de projeto e os nomes vigentes dos Cost (6), ambiente × modo de execução (7.4), o backup obrigatório (13.4), as regras da coluna Q (13.5) e os IDs vigentes dos Cost (13.6).

**Depois, só o que a tarefa pede:**
| Arquivo | Seções | Quando ler |
|---|---|---|
| `fase-1.md` | 3 (3.1 a 3.5) | Solicitação de nota: filtro da planilha, contrato, e-mail de pedido em rascunho, cobrança, marcadores do Gmail, To/CC, PROGRAMAR ATÉ, confirmação pós-escrita |
| `fase-2.md` | 4 (4.1 a 4.4) | Recebimento e validação: retranca, os dois salvamentos (Drive da Michelle e arquivamento por função), credenciais, estrutura do Drive |
| `fase-3-4.md` | 5 (5.0 a 5.3) | Remessa ao Danilo (lotes, e-mail, planilha recortada) e arquivamento da remessa em Contas a Pagar (pasta com sufixo `_MI`) |
| `01-arquitetura-infra.md` | 7 (menos 7.4), 8, 13.1 a 13.3 | n8n, trava do Box, Telegram, custo da API, VM, acessos validados, Git, execução isolada por fase e rollback |
| `90-decisoes-e-proximos-passos.md` | 10, 11 | Regras já resolvidas e checklist |

**As 4 fases:** 1. Solicitação · 2. Recebimento e validação (inclui o arquivamento por função e a marcação `OK` na coluna Q) · 3. Remessa para o Danilo · 4. Arquivamento da remessa (Contas a Pagar, `_MI`; roda junto com a Fase 3).

**Por tipo de tarefa:**
| Tarefa | Leia |
|---|---|
| Migrar ou alterar a Fase 1 / qualquer escrita no Cost | `00-comum.md` + `fase-1.md` (3.1.5) + `01-arquitetura-infra.md` (7.2) |
| Arquivamento por função e coluna Q | `00-comum.md` (13.5, 13.6) + `fase-2.md` (4.2, 4.4) |
| Backup e restauração de planilha | `00-comum.md` (13.4) |
| Infra do n8n, VM e credenciais | `01-arquitetura-infra.md` (7.6, 8) + `fase-2.md` (4.3) |
| Telegram e rollback | `01-arquitetura-infra.md` (7.3, 13.3) |

**Correções feitas na divisão (24/10/2026, decididas por Claudio):**
1. Seção 5.3 (`fase-3-4.md`): a Fase 3+4 deixou de marcar a coluna Q; o `OK` é dado na Fase 2, junto do arquivamento por função.
2. Seção 4.2 (`fase-2.md`) e 13.5: passam a dizer que o `OK` é marcado na Fase 2, logo após o arquivamento por função.

## 1. Objetivo e escopo
Este documento consolida tudo o que foi mapeado, validado e decidido sobre o processo de trabalho da Michelle na Box Fish (controle e solicitação de notas fiscais de colaboradores/fornecedores), servindo tanto de referência técnica de implementação quanto de material para a Michelle conferir se o comportamento descrito bate com o que ela faz hoje.
O processo cobre 3 projetos, com regras idênticas mas dados/nomenclaturas próprios de cada um:
- AREP / SMTC-S01 (antigo) — projeto quase encerrado, poucos casos restantes.
- SMTC-S01 Reunion — projeto atual em andamento.
- SMTC-S02 Soft Pré — segunda temporada, Box/Drive separados.
Fora de escopo por enquanto: processo de Recibos de Reembolso (RDP'S) — reembolso de despesas do colaborador (passagem, atendimento médico em set, alimentação em viagem). Existe, é real, mas será especificado numa etapa futura separada.

## 2. Visão geral das 4 fases
| Fase | O que faz | Onde processa |
|---|---|---|
| 1. Solicitação de nota | Filtra planilha, valida contrato, monta e programa e-mail de pedido em rascunho | n8n (nuvem) |
| 2. Recebimento e validação | Monitora respostas com NF anexada, extrai dados, atualiza planilha, salva a nota no pouso pessoal da Michelle E no arquivamento por função — os dois salvamentos acontecem aqui, em paralelo (seção 4.2) | n8n + IA (extração de PDF) |
| 3. Remessa para o Danilo + 4. Arquivamento da remessa | Agrupa recebidas em lotes por janela de tempo (seção 5.0), formata cópia da planilha, sobe no Drive na pasta de Contas a Pagar, monta e-mail — tudo em paralelo, na mesma execução. O arquivamento POR FUNÇÃO (08. NOTAS ARQUIVADAS) NÃO está mais aqui — foi antecipado pra Fase 2 (seção 4.2), pois a Michelle confirmou que pode ser feito assim que a nota é recebida/validada, sem esperar a remessa ao Danilo. | n8n + IA (formatação) |

As Fases 3 e 4 acontecem juntas, não uma depois da outra — confirmado por Claudio: no momento em que o e-mail do Danilo é preparado, a nota já foi arquivada (na Fase 2, por função) e a pasta de remessa/Contas a Pagar é montada em paralelo à entrega.

**IMPORTANTE — dois arquivamentos DIFERENTES, não confundir (detalhado na seção 4.2):**
- **Arquivamento por função** (`FINANCEIRO > 08. NOTAS ARQUIVADAS > ARQUIVO DE NOTAS [PROJETO] > [código] - [CARGO]`): roda na Fase 2, assim que a nota é baixada e validada. **Nomenclatura real de `[PROJETO]`, confirmada por Claudio (não é um padrão único — cada projeto usa a própria convenção)**: AREP = `ARQUIVO DE NOTAS S01` (por código); Reunion = `ARQUIVO DE NOTAS REUNION` (por nome); Soft Pré = `ARQUIVO DE NOTAS SOFT PRE` (decidido em 08/09, por nome — segue o padrão do Reunion, não o do AREP). Não inferir um padrão genérico a partir de um projeto só.
- **Arquivamento da remessa/Danilo** (`09. CONTAS À PAGAR` / `11. CONTAS À PAGAR - [PROJETO]`, pasta de remessa com sufixo "_MI"): continua na Fase 3+4, só no momento da entrega.

## 6. Perfis de projeto (parametrização)

Cada projeto vira um "perfil" de configuração — o motor (as 4 fases) é o mesmo para todos, só troca o perfil. Isso permite adicionar um projeto futuro sem reescrever a automação.

**Nota de formatação**: os valores de assunto abaixo contêm o caractere `|` como parte do próprio texto (não é separador de coluna extra) — os `|` de conteúdo estão escapados como `\|`.

| Campo | AREP (S01 antigo) | Reunion (S01) | Soft Pré (S02) |
|---|---|---|---|
| Prefixo assunto (pedido) | AREP \| EMISSÃO DE NF... | SMTC - S01 \| REUNION \| EMISSÃO DE NF... | SMTC - S02 \| SOFT PRE \| EMISSÃO DE NF... |
| Prefixo assunto (entrega) | AREP \| NOTAS À PAGAR... | SMTC - S01 \| REUNION \| NOTAS À PAGAR... | SMTC - S02 \| SOFT PRE \| NOTAS À PAGAR... |
| Texto "Ref." | "SMTC" | "SMTC - REUNION" | "SMTC - SOFT PRE" |
| Retranca | S01 | REUNION_S01 | SOFT PRE_S02 |
| Planilha Cost Report (Box) | Mesmo arquivo do Reunion — linhas sem preenchimento de cor | BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_1201.xlsx — linhas com preenchimento roxo/cinza (**desde 19/10/2026 o nome em produção é `BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_22.09`**; verificar se o ID do Box continua vigente) | BR_SMTC_S02_SOFTPRE_PROVISÓRIO.xlsx (**desde 19/10/2026: `BR_SMTC_S02_SOFTPRE_PROVISÓRIO_22.09`**; o nome muda, então a automação localiza por ID e, se o ID não responder, por nome parecido na pasta pai — nunca assume) |
| Planilha de Contratos | BR_AREP_S01_CONTROLE_DE_CONTRATOS.xlsb | BR_AREP_S01_REUNION_CONTROLE_DE_CONTRATOS.xlsb | BR_SMTC_S02_CONTROLE_DE_CONTRATOS.xlsb |

**Localização real e regra de acesso (confirmado com prints)**: essas 3 planilhas NÃO ficam no Box — ficam no **Google Drive**, dentro de pastas compartilhadas pela Danielle Barcelos / Bruna Bortolazo (visíveis em "Compartilhados comigo"), com a credencial "Google Drive - Produção (financeiro1@novorealitybox.com)" (financeiro1@novorealitybox.com) já com acesso:
- AREP + Reunion (S01): pasta `JURIDICO` (raiz), contendo `BR_AREP_S01_CONTROLE DE CONTRATOS.xlsb` e `BR_AREP_S01_REUNION_CONTROLE DE CONTRATOS.xlsb` direto.
- Soft Pré (S02): pasta `SMTC_S02_EXECUTIVA > JURIDICO S02`, contendo `BR_SMTC_S02_CONTROLE DE CONTRATOS.xlsb`.

O formato `.xlsb` não abre em pré-visualização direta no Google Drive (sempre força download) — mas isso não impede o n8n de processar: o workflow baixa o arquivo via `download_file_content` do Google Drive (mesma lógica de leitura já usada pro Cost Report), processa localmente, e descarta — sem nenhum ciclo de lock/upload (é só leitura, nunca escreve nessa planilha). **Detalhe técnico**: o `exceljs` (usado pra ler cor de preenchimento do Cost Report — seção 7.6) NÃO lê `.xlsb` — abre o arquivo sem erro, mas retorna zero abas, silenciosamente. Por isso a leitura das planilhas de Contratos usa uma biblioteca diferente, **SheetJS**, instalada à parte na imagem da VM (mesmo padrão do exceljs — seção 7.6).

### 6.1 Apelidos de projeto (array configurável via Telegram)
O identificador/assunto de um projeto pode mudar durante a execução do projeto (ex.: em 19/08/2026 o Soft Pré mudou de "SMTC_S02 \| SOFT PRE" para "PNS \| SOFT PRE" por pedido da Danielle, para não vazar o nome do projeto — e e-mails antigos e novos convivem, pois a Michelle já tinha enviado pedidos com o assunto antigo antes da mudança). Por isso, os apelidos de cada projeto NÃO ficam fixos no workflow (diferente do resto do perfil, que é copiado direto para dentro do workflow — seção 6) e NÃO ficam na planilha (planilha é editada por terceiros, seria frágil como fonte de configuração). Ficam num arquivo `apelidos.json` no disco da VM do n8n (mesmo mecanismo do `cobrancas.json`, seção 3.1.1), lido/escrito pelos nodes nativos de arquivo do n8n. Um workflow separado no n8n recebe um comando via Telegram (ex.: `/apelido SOFT_PRE PNS | SOFT PRE`) e adiciona o novo apelido nesse arquivo, sem precisar mexer no código do workflow principal. O motor de identificação de projeto deve considerar TODOS os apelidos cadastrados para aquele `projeto_id` (antigos e novos) como equivalentes — um e-mail pode chegar com o assunto antigo ou o novo, e ambos devem ser reconhecidos.

Valores iniciais de `apelidos.json` (seed da primeira entrega, seção 3.1.1):
- AREP: `["AREP"]`
- Reunion: `["SMTC - S01 | REUNION"]`
- Soft Pré: `["SMTC_S02 | SOFT PRE", "PNS | SOFT PRE"]` (os dois, pois convivem hoje)

**Mapeamento de papéis para homologação** — cobre os 4 papéis que recebem e-mail automatizado, usando só 2 caixas reais (com endereçamento "+" do Gmail para os dois que só recebem cópia/aprovação):

| Papel | Produção | Homologação |
|---|---|---|
| Colaborador (Fase 1, pedido de nota) | e-mail pessoal do colaborador | `grandesnegocioseoportunidades+colaborador@gmail.com` |
| Danilo (Fase 3+4, entrega/pagamento) | e-mail real do Danilo | `imperialdiamondlead+danilo@gmail.com` |
| Vanessa (aprovação, cc) | executiva@novorealitybox.com | `imperialdiamondlead+van@gmail.com` (mesma caixa do Danilo, distinguível pela tag) |
| Danielle (aprovação, cc) | financeiro@novorealitybox.com | `imperialdiamondlead+danielle@gmail.com` (mesma caixa, distinguível pela tag) |

**Credencial de Gmail em homolog (decisão desta rodada)**: a credencial "Gmail account" hoje conectada é a conta REAL de produção (financeiro1@novorealitybox.com) — usá-la também para enviar/rascunhar e-mails de teste poluiria a caixa real (rascunhos, enviados, marcadores). Por isso, criar uma credencial nova — **"Gmail - Homolog (Claudio Pessoal)"** — conectada a um e-mail pessoal do Claudio, usada SOMENTE quando `ambiente = homolog`, no lugar de "Gmail account" (mesmo padrão já adotado para o Drive de arquivamento por função — seção 4.2).

> *Seção 7 (Arquitetura técnica): neste arquivo só a 7.4. O restante da seção 7 está em `01-arquitetura-infra.md`.*

### 7.4 Ambiente vs. modo de execução (dois eixos independentes)
São duas variáveis SEPARADAS, que não devem ser confundidas nem amarradas uma à outra:

**Eixo 1 — AMBIENTE (`homolog` / `produção`)**: define PRA QUEM vai o e-mail e QUAL credencial de API é usada.
- `homolog`: destinatários trocados pelos e-mails de teste do Claudio (mapeamento completo na seção 6.1), usa a credencial "Claude account (dev)" pra IA e "Gmail - Homolog (Claudio Pessoal)" pra envio/rascunho de e-mail (em vez de "Gmail account", que é a conta real de produção).
- `produção`: destinatários reais (Danielle, Vanessa, colaboradores de verdade), usa a credencial "Claude account (produção)".

**Eixo 2 — `MODO_EXECUCAO` (`rascunho` / `automatico`)** (seção 3.1.3): define COMO a automação age, independente de pra quem está mandando.
- `rascunho`: e-mail fica em RASCUNHO no Gmail; Status Box (coluna L) fica manual (Michelle muda à mão).
- `automatico`: e-mail é enviado direto (ou a data de disparo é programada); Status Box fica 100% automático.

Por serem independentes, existem 4 combinações possíveis:
| | rascunho | automático |
|---|---|---|
| **homolog** | testar o fluxo com segurança, nada real envolvido | testar o ciclo completo de envio automático, mas só com destinatários fake |
| **produção** | dados reais, mas ainda em rascunho/manual, para a Michelle acompanhar de perto | fluxo 100% real e automatizado (objetivo final, só depois de validar tudo) |

**Ordem de inicialização definida por Claudio**: a primeira execução, e toda a validação inicial da Fase 1, deve rodar em **`homolog` + `rascunho`** — nenhuma execução em `produção` (mesmo em modo rascunho) antes de validar completamente em homologação. A progressão esperada é: `homolog`+`rascunho` → (opcional: `homolog`+`automatico`, pra validar o ciclo completo com segurança) → `produção`+`rascunho` (estado atual do MVP, uma vez liberado) → `produção`+`automatico` (só depois de aprovado rodar 100% automatizado).

**Terceiro controle, independente dos dois eixos acima — limite de execução ("modo assistido")**: para acompanhar a validação em produção com mais controle, Claudio pode limitar quantas linhas são processadas numa única execução, em qualquer fase. Ex.: se o filtro "PROGRAMAR ATÉ" bater 20 linhas, mas o limite estiver setado em 5, o workflow processa só as 5 primeiras linhas dentro da ordem de prioridade abaixo (não simplesmente a ordem em que aparecem na planilha) e ignora o restante naquela execução — as demais entram na próxima.
- Implementação: campo `limite_linhas_execucao` no `config_execucao.json` (número inteiro; `null` ou `0` = sem limite, processa tudo que bateu no filtro).
- **Esclarecido em 09/09**: o limite é um TETO (máximo), não uma cota fixa/exata — se um projeto tiver menos linhas elegíveis do que o limite, processa todas as que existirem, sem forçar chegar no número. E o teto é aplicado **por PROJETO** (AREP, Reunion, Soft Pré cada um com seu próprio teto independente), não por arquivo — importante porque AREP e Reunion compartilham o mesmo arquivo físico (Cost Report S01, diferenciados por cor de linha, seção 6): um teto "por arquivo" faria os dois disputarem a mesma cota; o teto "por projeto" garante que cada um seja avaliado separadamente. Exemplo: com limite=20, se AREP tiver 2 linhas elegíveis e Reunion tiver 15, as duas rodam por inteiro (2 e 15, respectivamente) mesmo estando no mesmo arquivo — nenhum disputa vaga com o outro.
- **Ordem de prioridade dentro do limite (Fase 1 — vale para homolog E produção)**: quando o limite corta o total de linhas, a seleção segue esta ordem, preenchendo o limite nesta sequência:
  1. **SOLICITAR** (e variantes) — e-mails urgentes, disparo imediato (exceto escala 5 — ver abaixo). Nem sempre existem linhas nessa categoria. Internamente, segue a escala de urgência da seção 3.1.4: escala 0 (`SOLICITAR URG`) primeiro, depois escala 1 (demais variantes de `SOLICITAR`), depois escala 5 (`SOLICITAR / AGUARDAR DOCS`, que sempre fica em rascunho).
  2. **PROGRAMAR ATÉ [data]** — e-mails programados pra disparar na data.
  3. **Monitoramento** (linhas já em `SOLICITADA MI`, checando se é hora de cobrar) — só entra na seleção se sobrar espaço no limite depois das categorias 1 e 2. Isso evita que, num teste com limite baixo, uma vaga seja "gasta" numa linha de monitoramento sem nenhuma ação real (ex.: linha marcada manualmente, sem entrada em `cobrancas.json` ainda), sobrando menos vagas pra testar a criação de pedidos novos de verdade.
  Dentro de uma mesma prioridade, vale a ordem em que as linhas aparecem na planilha (ordenação estável).
  Exemplo real (execução de validação #75): entrada `223(monitoramento), 240(PROGRAMAR), 293(SOLICITAR), 310(SOLICITAR), 350(monitoramento), 400(PROGRAMAR)` → com `limite=2`: `293(SOLICITAR), 310(SOLICITAR)`; com `limite=4`: `293, 310, 240(PROGRAMAR), 400(PROGRAMAR)`; sem limite: `293, 310, 240, 400, 223(monitoramento), 350(monitoramento)`. Antes dessa regra, a linha 223 (sem ação real a executar) consumia uma das 2 vagas do limite, sobrando só 1 vaga pra testar pedido novo de verdade.
  **A ordenação por prioridade roda mesmo quando não há limite** (`null`/`0`) — não muda quais linhas são processadas, só a ordem, mantendo o comportamento previsível entre execução limitada e sem limite.
- Funciona em conjunto com o **disparo manual** (o n8n já tem um "Manual Trigger" em cada workflow, além do agendado — seção 7.1): durante a fase de testes em produção, Claudio dispara manualmente quando quiser, em vez de esperar o horário agendado, combinando isso com o limite de linhas pra validar aos poucos junto com a Michelle.
- Esse limite vale igualmente para as 3 fases (não é exclusivo da Fase 1) — cada workflow lê o mesmo `config_execucao.json` e aplica o corte antes de processar. A ordem de prioridade acima é específica da Fase 1 (que mistura pedido novo e monitoramento no mesmo filtro); as demais fases aplicam o corte na ordem natural de suas próprias linhas.

Estrutura de `config_execucao.json`:
```json
{
  "ambiente": "homolog" | "producao",
  "modo": "rascunho" | "automatico",
  "limite_linhas_execucao": null,
  "homolog": {
    "drive_michelle_pasta_raiz": "1hgUYWVPNFOi2BWTKVlWENQ8nomIBCWtz",
    "credencial_drive_arquivamento_funcao": "Google Drive - HML (claudioco70@gmail.com)",
    "drive_financeiro_pasta_raiz": "16KAGjffE-ZibN3doOosQH9U-TH0q95_F"
  }
}
```

**Decisão de arquitetura — pasta-raiz-por-ambiente em vez de credencial-por-ambiente, no caso do Drive particular (Salvamento 1)**: diferente do que se imaginava inicialmente, o Drive de homologação da Michelle (`HOMOLOG_BOX-FISH`) está dentro da MESMA conta Google (michelle.mimiaguia@gmail.com) já conectada como credencial "Google Drive - Michelle (michelle.mimiaguia@gmail.com)". Por isso, o `AMBIENTE` não troca de credencial nesse caso — troca só o **ID da pasta raiz** que o workflow usa (`drive_michelle_pasta_raiz` acima), lida do `config_execucao.json`. Em produção, usa a pasta raiz real (`SMTC`, seção 4.2); em homolog, usa `HOMOLOG_BOX-FISH`.

**Arquivamento por função (Salvamento 2) em homolog usa credencial NOVA**: como o Drive de trabalho de produção (financeiro1@novorealitybox.com) não pode ser tocado nos testes, foi criada uma pasta de teste na conta PESSOAL do Claudio (`16KAGjffE-ZibN3doOosQH9U-TH0q95_F`), simulando a estrutura `FINANCEIRO` (S01 — AREP+Reunion) e `FINANCEIRO S02` (Soft Pré). Isso exigiu uma credencial nova no n8n — **"Google Drive - HML (claudioco70@gmail.com)"** — usada SOMENTE quando `ambiente = homolog`, no lugar da credencial "Google Drive - Produção (financeiro1@novorealitybox.com)" (financeiro1) usada em produção. O workflow deve navegar dentro dessa pasta raiz procurando as subpastas pelo NOME ("FINANCEIRO" ou "FINANCEIRO S02", conforme o projeto), em vez de depender de IDs de subpasta fixos — mais robusto a mudanças de estrutura.

**Cópia de teste do Cost Report**: as cópias das planilhas de teste (`BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_1201.xlsx` e `BR_SMTC_S02_SOFTPRE_PROVISÓRIO.xlsx`) ficam na raiz de `HOMOLOG_BOX-FISH` (Drive da Michelle) — não dentro do Box de produção.

> *Seção 13 (Rollback e controle de versão): neste arquivo só 13.4 a 13.6. A 13.1 a 13.3 está em `01-arquitetura-infra.md`.*

### 13.4 BACKUP OBRIGATÓRIO antes de qualquer escrita em planilha real (premissa permanente, decidida em 19/10/2026)
Motivo: o versionamento do Box não basta. A conta Box do projeto (plano gratuito) não permite listar/restaurar versão por API (`GET /files/{id}/versions` → 403), e a restauração manual de versão anterior já bagunçou largura de colunas e formatação. Por isso, vale para o Claude Code, para a automação n8n e para qualquer script:
1. **Antes de QUALQUER escrita** em planilha real (Cost S01, Cost S02 ou qualquer outra), fazer uma CÓPIA datada do arquivo exatamente como está naquele instante (download byte a byte do Box), guardada no Box, na pasta `ZZ-BACKUP-COST` (id 429803889593), em subpasta por projeto (`ZZ-BACKUP-COST/S01` para o Reunion e `ZZ-BACKUP-COST/S02` para o Soft Pré; as subpastas ainda serão criadas na migração da Fase 1, e os backups atuais, hoje soltos na raiz da pasta, serão movidos para elas), FORA das pastas oficiais, fora da pasta de trabalho dos testes e não compartilhada. Nome: nome original + `_copia_AAAA-MM-DD_HHMMSS` antes do `.xlsx` (ex.: `BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_22.09_copia_2026-10-21_204900.xlsx`). Não há cópia local: o backup fica só no Box.
2. A cópia só vale se verificada: conferir sha1 e tamanho da cópia contra o arquivo baixado e registrar `version id`/sha1 do arquivo no Box. Sem backup verificado, NÃO escreve.
3. A cópia é o arquivo inteiro (inclui estilos, larguras de coluna, formatação condicional `x14`/legada, filtros) — restaurar = subir esse arquivo de volta como nova versão (lock → upload → unlock), nunca recriar a partir de dados. Antes de restaurar, fazer outro backup do estado atual.
4. Retenção: ficam as 10 últimas cópias de cada planilha, cada uma na sua subpasta (S01 ou S02). Começa em 10 e pode ser revisto: só se cria cópia quando vai haver escrita, então 10 cobrem poucos dias se o agendamento voltar a rodar todo dia. A limpeza das mais antigas só roda depois de uma escrita bem-sucedida, só apaga itens com nome começando pelo da planilha e terminando em `_copia_<data>`, só dentro da subpasta do próprio projeto em `ZZ-BACKUP-COST`, e nunca apaga a única cópia verificada. Se o Box responder ao DELETE com corpo vazio, vale como sucesso desde que a releitura dê 404. Qualquer outra limpeza exige autorização do Claudio.
5. Vale também quando a escrita é cirúrgica (`scripts/lib/xlsx_cirurgico.js`): o módulo reduz o risco, não substitui o backup.
6. O relatório de toda escrita informa: caminho do backup, sha1 antes/depois e como restaurar.
7. **Passo 0 (antes de escrever):** baixar o arquivo atual e comparar com o último estado conhecido. Se houver diferença, parar e investigar. Diferença só de renumeração de `styles.xml` e de mesclagens (o Excel Online reescreve isso a cada salvamento da Michelle, sem mudar o visual) é aceita; qualquer outra diferença para a execução.
8. **Prioridade:** na dúvida entre marcar uma célula e arriscar a formatação, não marca. Prefere-se perder uma marcação a perder a formatação; se algo sair do esperado, abortar e restaurar o backup.
9. **Escrita segura no Box:** ciclo lock (com `expires_at`) → upload com `If-Match` → unlock sempre, mesmo em erro. Depois da escrita, comparar o pacote inteiro: só a aba NOTAS e só a coluna Q podem mudar; todas as outras partes do .xlsx ficam byte a byte idênticas. O lock do Box nem sempre mostra quem está editando, e cada salvamento no Excel Online gera uma versão nova.

### 13.5 Coluna Q (CHECK ARQUIVO DRIVE) do Cost Report — regras (decididas em 21/10/2026)
- Aba `NOTAS`, coluna Q. Valores: `OK` = nota arquivada (pela Michelle ou pela automação); `ARQUIVO INTERNO` = nunca tocar; vazio e `PENDENTE` = a mesma coisa (ainda não arquivada).
- Arquivar a nota na pasta da função e marcar `OK` andam juntos. A automação só escreve `OK` em célula vazia ou `PENDENTE`; nunca sobrescreve outro valor.
- O estilo da célula `OK` é copiado do estilo já usado por `OK` na própria planilha (hoje, estilo 370 no S01).
- A escrita usa só `scripts/lib/xlsx_cirurgico.js` (nunca exceljs, que causou o estrago de formatação de setembro). A verificação conta formatação condicional legada (`<conditionalFormatting`) e x14 (`<x14:cfRule`) separadamente, além de extLst, dxfs, cols, autoFilter, mesclagens e `styles.xml`.
- A coluna N (status de contrato) não entra no arquivamento.
- **Significado e momento da marcação (decidido por Claudio em 24/10/2026):** a coluna Q serve só para dizer se a nota já foi arquivada por função. `OK` = foi arquivada; `PENDENTE` ou vazio = não foi. Toda vez que o n8n arquiva uma nota por função (Fase 2), ele marca `OK` na coluna Q da linha correspondente logo em seguida, na própria Fase 2, para que a Michelle e a Danielle possam confiar na coluna sem divergência. A Fase 3+4 não marca a coluna Q.
- Resultado da rodada de 19–22/10/2026 (Reunion e Soft Pré, setembro e outubro; AREP fora): 151 notas arquivadas e marcadas `OK` (114 no S01, 37 no S02). 115 notas ficaram fora da rodada, por motivo (fora do padrão 43, colisão 26, sem fornecedor 18, rateio 12, nº diverge 9, vencimento 3, ambígua 3, linha não mapeada 1); a lista vai para a Michelle decidir.
- Casamento da nota com a linha do Cost: nome do fornecedor com tolerância (acento, sufixo societário, ±1 caractere); desempate por vencimento (col. G) e depois por nº da nota (col. E, normalizando zeros e hífen); CPF/CNPJ no início ou fim da col. H é ignorado. Pasta de função = `<código da col. B> - <FUNÇÃO>`; se o código já tem pasta, usa a existente.

### 13.6 IDs e nomes vigentes dos Cost (desde 19/10/2026)
- S01 (Reunion): `BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_22.09` — Box id `2482160269668`.
- S02 (Soft Pré): `BR_SMTC_S02_SOFTPRE_PROVISÓRIO_22.09` — Box id `2482145718537`.
- Os dois pertencem a financeiro@novorealitybox.com; a conta da Michelle é Editor (não pode apagar o arquivo).
- Os workflows da Fase 1 e da Fase 2 ainda apontam para os IDs antigos (8 pontos fixos). Trocar é tarefa pendente: o ID deve vir de um arquivo de configuração versionado, com checagem de nome antes de qualquer leitura ou escrita.
- Ninguém renomeia pastas ou arquivos: a automação depende dos nomes.
- Pastas de trabalho: `ZZ-BACKUP-COST` (backups, subpastas S01 e S02, retenção de 10 por planilha). A `ZZ-TESTE-ESCRITA` foi apagada em 22/10/2026.
