AUTOMAÇÃO — CONTROLE DE NOTAS FISCAIS · Box Fish · Michelle Aguiar

> **Mapa dos arquivos do spec (`docs/spec/`)**: `00-comum.md` (leitura obrigatória em qualquer tarefa) · `01-arquitetura-infra.md` · `fase-1.md` · `fase-2.md` · `fase-3-4.md` · `90-decisoes-e-proximos-passos.md`. Os números das seções são os do documento original e não mudaram. O Claude Code lê estes arquivos e **nunca os edita**.

> *Leia antes o `00-comum.md`.*

## 5. Fase 3 + 4 — Remessa para o Danilo e Arquivamento (em paralelo)
Confirmado por Claudio: essas duas fases acontecem juntas, na mesma execução — não uma depois da outra.
- Filtrar recebidas por Vencimento (coluna G).
- Importante: dentro da mesma planilha/aba Notas do S01, AREP e Reunion convivem juntos, diferenciados pela cor de preenchimento da linha (Reunion = roxo/cinza-arroxeado; AREP = sem preenchimento). Depois de filtrar por vencimento, é preciso também "Filtrar por cor" para não misturar notas dos dois projetos que caem no mesmo vencimento. Decisão técnica: o node nativo de planilha do n8n só lê valor de célula, não estilo/cor — a leitura de cor exige um node de Code usando a lib `exceljs`, o que só funciona com `NODE_FUNCTION_ALLOW_EXTERNAL=exceljs` configurado na VM do n8n (variável de ambiente + reinício do serviço + pacote `exceljs` instalado no ambiente). Confirmado configurar isso na VM (não só para o caso AREP/Reunion, mas porque outra planilha do projeto também usa cor de preenchimento e vai precisar da mesma distinção).
- Regra de agrupamento no e-mail: mesmo Fornecedor + mesmo Vencimento = agrupa no mesmo e-mail, sem limite de quantidade.
- Nunca usar "Classificar" — sempre "Filtrar" (Classificar quebra a estrutura da planilha).
- Fazer uma cópia da planilha antes de mexer (nunca editar a original), remover as colunas que não vão para o Danilo, formatar "Valor a Pagar" como número com 2 casas decimais mantendo a cor vermelha, mudar Status Box da cópia para "ENTREGUE".
- Colar o recorte formatado no e-mail do Danilo (RASCUNHO); essa mesma imagem da planilha formatada também deve ser salva na pasta de arquivamento (seção 5.3), junto com a nota fiscal.
- Solicitar aprovação via Drive (Danielle + Vanessa).

### 5.0 Regra de lotes/remessas por janela de tempo (não é mais contagem fixa de 30)
A contagem de remessas NÃO é mais "a cada 30 notas recebidas" — a planilha Cost é dinâmica (entra colaborador novo quase todo dia) e nem sempre há 30+ notas para uma data de vencimento. A separação agora é por JANELA DE TEMPO em relação ao vencimento da NF, aplicada por pasta de vencimento (cada data de vencimento tem sua própria contagem de lotes/R, independente das outras):
- **Lote 1**: notas recebidas desde o início do ciclo (data "PROGRAMAR ATÉ") até ~12 dias antes do vencimento. Se ≤30 notas → só R1. Se >30 → quebra em R1, R2... Alertar a Michelle via Telegram quando esse lote for criado.
- **Lote 2**: notas recebidas entre ~12 dias antes e 5 dias antes do vencimento. A numeração de R continua de onde o lote 1 parou (ex.: lote 1 = só R1 → lote 2 começa em R2; lote 1 = R1+R2 → lote 2 começa em R3, podendo virar R3+R4 se passar de 30 notas). Alertar a Michelle via Telegram quando esse lote for criado.
- **A partir de 5 dias (ou menos) antes do vencimento**: não criar mais lote automaticamente — alertar a Michelle via Telegram para ação manual.
- Exemplo: Status Box = "PROGRAMAR ATÉ 20/08", vencimento em 10/09 → Lote 1 cobre recebimentos de 20/08 a ~29/08 (12 dias antes); Lote 2 cobre de ~29/08 a ~05/09 (5 dias antes); a partir de ~05/09 sem lote novo, só alerta manual.

### 5.1 Exemplo real — e-mail de remessa para o Danilo
| Assunto: SMTC - S01 | REUNION | NOTAS À PAGAR | VENC_20.08.26 | REMESSA_1 |
|---|
| Oi Danilo, tudo bem?😊 Atualizei a pasta de contas a pagar no Drive ==> 11. CONTAS A PAGAR - REUNION ==> Pasta nº 1. AGOSTO ==> VENC. 20.08.26 ==> REMESSA_1 Segue o link para vencimento em 20/08/26 🔗 20.08_BR_SMTC_REUNION_S01_CONTROLE_NF_REMESSA_1 Obs.: Van e Dani, o pedido de aprovação foi direto pelo Drive! [ver planilha formatada abaixo, seção 5.2] Bjs, 🌷 |

Confirmado: o link no e-mail do Danilo sempre leva o identificador completo do projeto, igual à retranca (SMTC_S01 para o AREP, SMTC_REUNION_S01 para o Reunion, SMTC_SOFT PRE_S02 para o Soft Pré). Um exemplo anterior que aparecia sem "REUNION" estava errado — foi um esquecimento pontual, não a regra.

### 5.2 Planilha recortada — cores e formatação
Colunas (nesta ordem, SOMENTE estas): Tipo Doc Fiscal, Nº Doc Fiscal, Emissão, Venc., Fornecedor, Descrição, Valor a Pagar, Status Box, Dados Bancários, E-mail.
NUNCA incluir Status Cost nem Status Contrato neste recorte, em nenhum projeto.
| TIPO DOC FISCAL | Nº DOC FISCAL | VENC. | VALOR A PAGAR | STATUS BOX |
|---|---|---|---|---|
| NF | 000792 | 20-ago-26 | 20647,29 | ENTREGUE |
|  |  | TOTAL | R$ 20.647,29 |  |

Fonte Verdana em todo o e-mail. Cabeçalho: fundo preto/texto branco negrito. Valor a Pagar: número com 2 casas decimais (sem "R$"), vermelho, linha a linha — só a linha de total (fundo preto) leva "R$". Status Box: destaque verde, texto exatamente "ENTREGUE" (só nesta cópia — ver variações na planilha interna, seção 5.3).

### 5.3 Arquivamento da remessa (Contas a Pagar / Danilo — em paralelo à entrega)
**Este é o arquivamento da REMESSA/entrega, diferente do arquivamento por função (que já acontece na Fase 2 — seção 4.2). Não confundir os dois.**
- Caminho: pasta de Contas a Pagar por projeto (`09. CONTAS À PAGAR` / `11. CONTAS À PAGAR - [PROJETO]` — ver seção 5.1), organizada por mês e data de vencimento/remessa. **Atenção na navegação por nome**: confirmado por teste real que a grafia varia entre projetos — S01 usa "09. CONTAS À PAGAR" (com acento), S02 usa "09. CONTAS A PAGAR" (sem acento). Não confiar em correspondência exata de string; normalizar (ignorar acento) ao localizar essa pasta por nome.

**Estrutura de homologação validada (22/08)**: a estrutura de teste em `HOMOLOG_BOX-FISH` (Drive pessoal do Claudio) foi conferida via conector do Google Drive e bate 1:1 com a estrutura de produção documentada nesta seção e na 4.2 — `FINANCEIRO` (S01) e `FINANCEIRO S02` replicam corretamente `08. NOTAS ARQUIVADAS` (com as pastas de função já existentes pro Reunion) e `09. CONTAS À/A PAGAR` (com um mês e vencimento de exemplo). Sem inconsistências relevantes encontradas.
- Subir a imagem da planilha recortada e formatada (seção 5.2) e o link de aprovação nessa pasta de remessa, conforme o e-mail modelo do Danilo (seção 5.1).
- **Corrigido em 24/10/2026:** a Fase 3+4 NÃO marca mais a coluna "Check arquivo drive" (coluna Q). O `OK` é dado na Fase 2, junto do arquivamento por função (seções 4.2 e 13.5).
- Atualizar Status Box da planilha interna com "ENTREGUE MI R{n}", onde `n` é o número do lote/remessa calculado pela regra de janela de tempo (seção 5.0) — não mais por contagem fixa de 30. A cópia enviada ao Danilo usa sempre só "ENTREGUE", nunca "MI" nem número de remessa.
Vencimentos no dia 10 costumam ser os que mais acumulam notas (podendo passar de 30 num único lote e precisar de R1, R2 dentro do mesmo lote); as demais datas dificilmente ultrapassam 30 por lote.
- Nomenclatura de pasta de remessa (a partir de agora): todas as pastas de remessa criadas no último nível levam o sufixo "_MI". Exemplo: "10.08_BR_SMTC_S01_ARQUIVO_NF_REMESSA_1" vira "10.08_BR_SMTC_S01_ARQUIVO_NF_REMESSA_1_MI". Vale para REUNION e SOFT PRE (e qualquer novo projeto daqui pra frente).
