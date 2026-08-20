AUTOMAÇÃO — CONTROLE DE NOTAS FISCAIS
Box Fish · Michelle Aguiar — Documento mestre do projeto
Preparado por Claude a pedido de Claudio Carvalho de Oliveira · 17/08/2026

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
| 2. Recebimento e validação | Monitora respostas com NF anexada, extrai dados, atualiza planilha, salva a nota | n8n + IA (extração de PDF) |
| 3. Remessa para o Danilo + 4. Arquivamento | Agrupa recebidas (até 30/remessa), formata cópia da planilha, sobe no Drive, monta e-mail, arquiva a nota na pasta por função — tudo em paralelo, na mesma execução | n8n + IA (formatação) |

As Fases 3 e 4 acontecem juntas, não uma depois da outra — confirmado por Claudio: no momento em que o e-mail do Danilo é preparado, a nota já é arquivada na pasta correta.

## 3. Fase 1 — Solicitação de nota ao colaborador

### 3.1 Passo a passo
- 1º Verificar Status do Contrato (coluna N da aba Notas). Se vazio ou "N/A", buscar em outra planilha (o arquivo de Controle de Contratos, por projeto — seção 6), cruzando por Razão Social ou nome do colaborador. A comparação ignora diferença de maiúsculas/minúsculas e espaços a mais ou a menos.
- 2º Filtrar Status Box = "PROGRAMAR ATÉ [data]" (texto exato). Regra pelo Status do Contrato:
- — "Pendente" (já checado na outra planilha) → não dispara.
- — vazio/"N/A" (já checado na outra planilha) → não dispara.
- — "OK - Assinado" → monta e programa o e-mail de pedido, informando prazo de envio até data+5 dias, e deixa em RASCUNHO no Gmail. Ao criar esse rascunho pela 1ª vez: Status Box = "SOLICITADA MI".
- 3º Filtrar Status Box = "SOLICITAR" → monta e-mail para envio imediato, mas por enquanto também fica em RASCUNHO. Mesma regra: Status Box = "SOLICITADA MI" ao criar o rascunho.
- Quando o colaborador enviar a NF (pela thread original ou por e-mail avulso identificado — seção 4): Status Box = "RECEBIDA MI" + preenchimento das demais colunas correspondentes.

### 3.1.1 Monitoramento e cobrança (a partir do dia "PROGRAMAR ATÉ")
- No próprio dia do prazo, monitorar e-mails o dia todo: a thread original E qualquer e-mail avulso com NF em anexo (ver seção 4 — identificação fora da thread).
- Se identificar a nota correspondente: segue fluxo normal (Status Box = "RECEBIDA MI").
- Se não identificar até o fim do dia: agendar e-mail de cobrança pela MESMA thread para o dia seguinte.
- Repetir a cobrança a cada 5 dias, até aproximadamente 5 dias antes do vencimento da NF (tolerância de alguns dias para mais ou menos é aceitável — não precisa ser exato). Isso funciona porque o ciclo do mês seguinte já abre uma thread nova.
- Exemplo: Status Box = "PROGRAMAR ATÉ 20/08" e vencimento da NF em 10/09 → monitorar/cobrar a cada 5 dias entre 20/08 e ~05/09.
- Se chegar ao fim desse ciclo sem resposta: alertar a Michelle via Telegram e ENCERRAR o fluxo automático para aquela nota — nenhuma cobrança adicional é enviada. Ação manual fica a critério da Michelle (é comum o colaborador mandar a NF com valor duplicado no ciclo do mês seguinte).

### 3.2 Dados de origem e tipos de emissão
Usar apenas as colunas: G (Vencimento), J (Descrição), K (Valor a pagar), L (Status Box), R (E-mail do colaborador).
A coluna J se separa em 3 partes: [CARGO] - [NOME DO COLABORADOR] - [DE "DATA" A "DATA"]. O nome vem daqui; se não achar, cai para a coluna H (Fornecedor).
| Tipo | Quando usar | Assunto |
|---|---|---|
| NF normal | Cachê mensal | REF. [MÊS ABREV. 3 LETRAS] |
| JOB | Período pontual de job | REF. JOB (com parcela "P.X/Y" se houver) |
| DIÁRIA | Diária avulsa | REF. DIÁRIA |
| PACOTE | Caso raro e específico do AREP (diárias agrupadas em pacote fechado); não deve se repetir fora do AREP | REF. PACOTE (sem mês) |
| REC + NF | Locação (equipamento, estúdio, mesas etc.) faturada em parte recibo/fatura + parte nota — mais comum com fornecedores do que colaboradores | EMISSÃO DE NF E REC | REF. [MÊS] |

Regra crítica: em casos de locação, o e-mail NUNCA pode usar a expressão "serviço prestado" — sempre "locação" (questão fiscal). Colaboradores normalmente são só JOB ou mensal; a distinção PACOTE/REC+NF é mais comum entre fornecedores.

### 3.3 Exemplo real — e-mail de pedido de nota (Reunion)
Réplica linha a linha do modelo enviado pela Michelle — mesmo espaçamento (linha em branco entre cada campo, mas sem espaço extra dentro do bloco do Tomador e dentro do aviso de dados bancários), mesmo negrito, grifo amarelo, cor do aviso e emoji.
| Assunto: SMTC - S01 | REUNION | EMISSÃO DE NF | REF. JOB (ENVIAR ATÉ 10.08) | GUILHERME HENRIQUE PORTES SIQUEIRA |
|---|
| Olá GUILHERME! Tudo bem? Seguem as instruções para a emissão da sua nota fiscal que deverá ser enviada até o dia 10/08 com vencimento em 10/09/2026. Tomador BOXFISH PRODUTORA DE PROGRAMAS TELEVISIVOS, INTERNET E FILMES PUBLICITÁRIOS LTDA. Endereço: Rua Butantã, 194, sala 24, Pinheiros. CEP 05.424-000 - São Paulo, SP CNPJ: 14.788.649/0001-23 IM: 4.436.095-9 IE: ISENTA 1- Emitir nota fiscal no valor de R$ 3.000,00 com os dados abaixo no corpo da nota: Ref. "SMTC - REUNION" Serviço Prestado como: PRODUTOR DE CONTEÚDO Colaborador: GUILHERME HENRIQUE PORTES SIQUEIRA Período de 25/08 A 27/08 (JOB) Dados bancários: Chave pix: --------------------------------------------------------------------- Importante: Peço a gentileza de enviar a sua nota nestes e-mails: financeiro@novorealitybox.com financeiro1@novorealitybox.com "Os dados bancários considerados para pagamento são os que estão cadastrados. O cadastro é feito baseado nas informações cedidas pelo contratado através do preenchimento de ficha cadastral da Box. Qualquer alteração bancária ou mudança na forma de pagamento deve ser notificada por e-mail pelo contratado e se faz necessário atualização da ficha cadastral e envio prévio ao responsável financeiro do projeto." Muito obrigada! Beijo 🌷 |


### 3.4 Exemplo real — e-mail de pedido de nota (Soft Pré)
Mesma estrutura, só troca "REUNION" por "SOFT PRE" no assunto e no "Ref." — todo o resto (Tomador, negrito, grifo, aviso, disclaimer, assinatura) é idêntico.
| Assunto: SMTC - S02 | SOFT PRE | EMISSÃO DE NF | REF. JUL (ENVIAR ATÉ 27.07) | BRUNA BORTOLAZO |
|---|
| Olá BRU! Tudo bem? Seguem as instruções para a emissão da sua nota fiscal que deverá ser enviada até o dia 27/07 com vencimento em 10/08/2026. Tomador BOXFISH PRODUTORA DE PROGRAMAS TELEVISIVOS, INTERNET E FILMES PUBLICITÁRIOS LTDA. Endereço: Rua Butantã, 194, sala 24, Pinheiros. CEP 05.424-000 - São Paulo, SP CNPJ: 14.788.649/0001-23 IM: 4.436.095-9 IE: ISENTA 1- Emitir nota fiscal no valor de R$ 5.100,00 com os dados abaixo no corpo da nota: Ref. "SMTC - SOFT PRE" Serviço Prestado como: ASS. PRODUÇÃO EXECUTIVA Colaborador: BRUNA BORTOLAZO Período de 15/07 A 31/07 Dados bancários: Chave pix: --------------------------------------------------------------------- Importante: Peço a gentileza de enviar a sua nota nestes e-mails: financeiro@novorealitybox.com financeiro1@novorealitybox.com "Os dados bancários considerados para pagamento são os que estão cadastrados. O cadastro é feito baseado nas informações cedidas pelo contratado através do preenchimento de ficha cadastral da Box. Qualquer alteração bancária ou mudança na forma de pagamento deve ser notificada por e-mail pelo contratado e se faz necessário atualização da ficha cadastral e envio prévio ao responsável financeiro do projeto." Muito obrigada! Beijo 🌷 |

No AREP, o "Ref." fica só "SMTC", sem sufixo — o restante da estrutura é o mesmo.
Confirmado: o link no e-mail do Danilo também leva o mesmo grifo azul-claro usado na data de vencimento do e-mail de pedido — comparei com os prints ampliados enviados por Claudio.

## 4. Fase 2 — Recebimento e validação da nota
- Monitorar e-mails recebidos com nota fiscal (ou recibo) anexada.
- Todo e-mail recebido com NF em anexo deve ser checado: pertence a uma thread já em andamento (resposta ao pedido original), ou é um caso avulso (assunto diferente, não é resposta)?
- Caso seja avulso / o remetente não seja obviamente o colaborador: abrir a nota fiscal em anexo, extrair dela o nome do colaborador, a razão social e o projeto (Ref.), e usar essas informações para localizar a linha correspondente na aba Notas.
- Essa busca de correspondência deve ser feita via IA (API da Claude) — não por comparação exata de string nem por algoritmo fonético tradicional (tipo Soundex, que não funciona bem com nomes em português). A IA compara o nome/razão social extraído contra a lista de nomes/razões sociais da planilha e aponta a linha correspondente (ou indica que não há correspondência confiável), já lidando naturalmente com acentuação, maiúsculas/minúsculas e pequenas variações de escrita.
- Se a IA encontrar correspondência confiável: segue o fluxo normal (para as cobranças e atualiza a planilha).
- Se a IA NÃO encontrar nenhuma correspondência confiável: enviar mensagem via Telegram para a Michelle, informando os dados de referência que constam na nota (nome, razão social, valor, competência) e perguntando qual linha/colaborador ela associa a essa nota.
  - Se ela responder dentro de 8h: executar a ação que ela indicou.
  - Se não responder em 8h: reenviar o lembrete pelo Telegram.
  - Se não responder em mais 18h (26h no total, desde a 1ª pergunta): encerrar o ciclo para aquela nota, sem ação automática — fica pendente.
- Atualizar a planilha do Box: coluna D = tipo de documento, coluna E = número da nota (6 dígitos), coluna F = data de emissão.
- Atualizar Status Box → "RECEBIDA MI".
- Salvar a nota no Drive particular da Michelle (substitui o salvamento local), na pasta do projeto, com a retranca abaixo.

### 4.1 Regra de retranca (nome do arquivo da nota)
Formato: [dia.mês do vencimento]_BR_SMTC_[IDENTIFICADOR DO PROJETO]_[RAZÃO SOCIAL]_#[nº da nota, 6 dígitos]
| Projeto | Identificador | Exemplo real |
|---|---|---|
| AREP (antigo) | S01 | 10.08_BR_SMTC_S01_BARLAVENTO FILMES LTDA_#000000 |
| Reunion | REUNION_S01 | 10.09_BR_SMTC_REUNION_S01_BARLAVENTO FILMES LTDA_#000000 |
| Soft Pré | SOFT PRE_S02 (sem underline) | 10.08_BR_SMTC_SOFT PRE_S02_BARLAVENTO FILMES LTDA_#000000 |


## 4.2 Os dois salvamentos de nota fiscal (não confundir)

Existem dois destinos de salvamento distintos e separados no tempo — não devem ser misturados:

**Salvamento 1 — ao receber a nota (Fase 2, pouso de trabalho):**
Salvar a nota com a retranca certa no **Drive particular da Michelle**. Importante: essa é uma conta Google **separada** da conta de trabalho (financeiro1@novorealitybox.com) — tem Drive próprio, e-mail e credencial OAuth independentes. Substitui o antigo salvamento em pasta local (Downloads).

- E-mail da conta: `michelle.mimiaguia@gmail.com`
- Pasta raiz: `SMTC` (link: https://drive.google.com/drive/folders/13sbk5QKW_srcopi5HMCMLbUdAbksniBo)
- Credencial já configurada no n8n: **"Google Drive - Particular Michelle"** (Google Drive OAuth2 API, conectada e autorizada)

**Salvamento 2 — arquivamento oficial (Fase 3+4, em paralelo à entrega ao Danilo):**
Mover/copiar a nota desse pouso para dentro do Drive de trabalho (financeiro1@novorealitybox.com ou compartilhado da empresa), na estrutura já documentada: `FINANCEIRO > 08. NOTAS ARQUIVADAS > ARQUIVO DE NOTAS [PROJETO] > [código] - [CARGO]`.

- Credencial já configurada no n8n: **"Google Drive account"** (Google Drive OAuth2 API, conectada como financeiro1@novorealitybox.com)

## 4.3 Credenciais já configuradas no n8n (status atual)

| Credencial | Nome exato no n8n | Conta autorizada | Status |
|---|---|---|---|
| Gmail | Gmail account | financeiro1@novorealitybox.com | ✅ Conectada |
| Google Drive (trabalho) | Google Drive account | financeiro1@novorealitybox.com | ✅ Conectada |
| Google Drive (particular) | Google Drive - Particular Michelle | michelle.mimiaguia@gmail.com | ✅ Conectada |
| Telegram | Telegram account | Bot da Michelle | ✅ Conectada |
| Box | Box account | michelle.mimiaguia@gmail.com (autorizado via app criado numa Box Developer Account separada — necessário porque contas Box comuns/gratuitas não conseguem mais salvar apps no Console do Desenvolvedor) | ✅ Conectada |
| Claude (Anthropic API) — dev/homolog | Claude account (dev) | Chave `n8n-boxfish-notas-hml`, criada na conta do Claudio (Claude Console, workspace Default), cartão do Claudio — usada em testes e no ambiente de homologação (seção 7.4) | ✅ Criada |
| Claude (Anthropic API) — produção | Claude account (produção) | Chave de API criada numa conta separada do Claude Console, com o e-mail michelle.mimiaguia@gmail.com e cartão próprio da Michelle — conta e organização totalmente independentes da conta do Claudio, sem consolidação de custo entre elas | ✅ Criada |




## 4.4 Estrutura real do Drive particular (validada em 19/08/2026)

Confirmada por acesso direto (Claude conferiu a árvore de pastas de verdade):

```
SMTC/
  SMTC - S01 - AREP/
    CONTAS A PAGAR/
      VENC_[MÊS 3 LETRAS]_[dd.mm]/
        [dd.mm]_BR_SMTC_S01_ARQUIVO_NF_REMESSA_[n]/       <- notas individuais (retranca)
        [dd.mm]_BR_SMTC_S01_CONTROLE_NF_REMESSA [n].xlsx   <- planilha de controle
  SMTC - S01 - REUNION/
    CONTAS A PAGAR/ (mesma estrutura, identificador REUNION_S01)
  SMTC - S02 - SOFT PRE/
    CONTAS A PAGAR/ (mesma estrutura, identificador SOFT PRE_S02)
```

**Regra de escopo, confirmada por Claudio**: a automação usa SOMENTE a subpasta "CONTAS A PAGAR" dentro de cada uma dessas 3 pastas de projeto. Todas as outras subpastas que existem ali (RECIBOS PREMIOS, BR_SMTC_S01_REEMBOLSOS, CONTRATAÇÃO_MICHELLE, ASSINATURAS, SMTC_PLANILHAS, BR_SMTC_S01_APÓLICE SEGURO, MANUAL, BR_SMTC_S01_DIRETORIA_BOXFISH, ML) são pastas particulares da Michelle — a automação nunca lê nem escreve nelas.

As pastas de vencimento (`VENC_MÊS_dd.mm`) já existem pré-criadas para boa parte do ano corrente — o workflow deve checar se a pasta do vencimento existe e criar automaticamente se não existir, nunca assumir que ela sempre estará lá.

**Ordem de escrita confirmada (Opção A)**: a Fase 2 (Salvamento 1) pousa a nota DIRETO dentro da pasta `VENC_[MÊS]_[dd.mm]`, sem pasta de remessa ainda — nesse momento a automação não sabe em qual remessa a nota vai cair (o número da remessa só é calculado na Fase 3+4, ao agrupar até 30 notas daquele vencimento). A subpasta `[dd.mm]_BR_SMTC_[ID]_ARQUIVO_NF_REMESSA_[n]` só é criada pela Fase 3+4, que move as notas já recebidas para dentro dela nesse momento. Os ARQUIVOS individuais dentro dessa pasta seguem o padrão de retranca da seção 4.1 (`[dd.mm]_BR_SMTC_[ID]_[RAZÃO SOCIAL]_#[nº nota]`) — só o NOME DA PASTA de remessa segue a nomenclatura de remessa, não a retranca individual.

**Fora de escopo, não implementar**: foi encontrado um exemplo real de retranca usando o tipo do documento (`APÓLICE`, `BOLETO`) no lugar do número de 6 dígitos — confirmado por Claudio que é um caso pontual manual (parcela de seguro), não faz parte do processo automatizado.
## 5. Fase 3 + 4 — Remessa para o Danilo e Arquivamento (em paralelo)
Confirmado por Claudio: essas duas fases acontecem juntas, na mesma execução — não uma depois da outra.
- Filtrar recebidas por Vencimento (coluna G).
- Importante: dentro da mesma planilha/aba Notas do S01, AREP e Reunion convivem juntos, diferenciados pela cor de preenchimento da linha (Reunion = roxo/cinza-arroxeado; AREP = sem preenchimento). Depois de filtrar por vencimento, é preciso também "Filtrar por cor" para não misturar notas dos dois projetos que caem no mesmo vencimento. Decisão técnica: o node nativo de planilha do n8n só lê valor de célula, não estilo/cor — a leitura de cor exige um node de Code usando a lib `exceljs`, o que só funciona com `NODE_FUNCTION_ALLOW_EXTERNAL=exceljs` configurado na VM do n8n (variável de ambiente + reinício do serviço + pacote `exceljs` instalado no ambiente). Confirmado configurar isso na VM (não só para o caso AREP/Reunion, mas porque outra planilha do projeto também usa cor de preenchimento e vai precisar da mesma distinção).
- Agrupar em remessas de até 30 notas (R1, R2, R3...); regra de agrupamento no e-mail: mesmo Fornecedor + mesmo Vencimento = agrupa no mesmo e-mail, sem limite de quantidade.
- Nunca usar "Classificar" — sempre "Filtrar" (Classificar quebra a estrutura da planilha).
- Fazer uma cópia da planilha antes de mexer (nunca editar a original), remover as colunas que não vão para o Danilo, formatar "Valor a Pagar" como número com 2 casas decimais mantendo a cor vermelha, mudar Status Box da cópia para "ENTREGA MI".
- Colar o recorte formatado no e-mail do Danilo (RASCUNHO); essa mesma imagem da planilha formatada também deve ser salva na pasta de arquivamento (seção 5.3), junto com a nota fiscal.
- Solicitar aprovação via Drive (Danielle + Vanessa).

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
| NF | 000792 | 20-ago-26 | 20647,29 | ENTREGA MI |
|  |  | TOTAL | R$ 20.647,29 |  |

Fonte Verdana em todo o e-mail. Cabeçalho: fundo preto/texto branco negrito. Valor a Pagar: número com 2 casas decimais (sem "R$"), vermelho, linha a linha — só a linha de total (fundo preto) leva "R$". Status Box: destaque verde, texto exatamente "ENTREGA MI" (só nesta cópia — ver variações na planilha interna, seção 5.3).

### 5.3 Arquivamento (em paralelo à entrega)
- Mover a nota fiscal individual (retranca) e a imagem da planilha formatada (seção 5.2) para a pasta correspondente à função/cargo do colaborador.
- Identificar a pasta: código da Conta Netflix vem da coluna B, nome da função/cargo vem da coluna C. Se a pasta daquele código ainda não existir, criar seguindo a mesma nomenclatura das pastas já existentes.
- Caminho: "FINANCEIRO > 08. NOTAS ARQUIVADAS > ARQUIVO DE NOTAS [PROJETO]" — pastas separadas por projeto ("ARQUIVO DE NOTAS S01" para AREP, "ARQUIVO DE NOTAS REUNION" para Reunion).
- Padrão de nome de pasta por função — confirmado com exemplos reais: AREP usa "[código] - [CARGO]" (ex.: "1301 - DIRETOR GERAL"); Reunion usa "[código].R - [CARGO]" (ex.: "1301.R- DIRETOR GERAL", "7007.R - ACESSORIA JURÍDICA"); Soft Pré vai seguir o mesmo padrão do AREP ("[código] - [CARGO]") assim que surgirem os primeiros casos.
- Atualizar a coluna "Check arquivo drive" da planilha para "OK" depois de arquivar cada nota.
- Atualizar Status Box da planilha interna, contando por pasta de vencimento/remessa (cada data de remessa é uma pasta nova e reinicia a contagem do zero): "ENTREGUE MI R1" para a 1ª a 30ª nota entregue naquela remessa; "ENTREGUE MI R2" para a 31ª a 60ª; "ENTREGUE MI R3" para a 61ª a 90ª; e assim sucessivamente a cada 30. Exemplo: se no dia 10/08 houver 50 notas entregues, as 30 primeiras ficam "ENTREGUE MI R1" e as 20 restantes "ENTREGUE MI R2"; uma nota de outra data (ex.: 15/08) pertence a outra pasta e a contagem de R recomeça em R1. A cópia enviada ao Danilo usa sempre só "ENTREGA MI", nunca com número de remessa.
Vencimentos no dia 10 costumam ser os que mais acumulam notas (podendo passar de 30 e precisar de R1, R2...); as demais datas dificilmente ultrapassam 30.

## 6. Perfis de projeto (parametrização)

Cada projeto vira um "perfil" de configuração — o motor (as 4 fases) é o mesmo para todos, só troca o perfil. Isso permite adicionar um projeto futuro sem reescrever a automação.

**Nota de formatação**: os valores de assunto abaixo contêm o caractere `|` como parte do próprio texto (não é separador de coluna extra) — os `|` de conteúdo estão escapados como `\|`.

| Campo | AREP (S01 antigo) | Reunion (S01) | Soft Pré (S02) |
|---|---|---|---|
| Prefixo assunto (pedido) | AREP \| EMISSÃO DE NF... | SMTC - S01 \| REUNION \| EMISSÃO DE NF... | SMTC - S02 \| SOFT PRE \| EMISSÃO DE NF... |
| Prefixo assunto (entrega) | AREP \| NOTAS À PAGAR... | SMTC - S01 \| REUNION \| NOTAS À PAGAR... | SMTC - S02 \| SOFT PRE \| NOTAS À PAGAR... |
| Texto "Ref." | "SMTC" | "SMTC - REUNION" | "SMTC - SOFT PRE" |
| Retranca | S01 | REUNION_S01 | SOFT PRE_S02 |
| Planilha Cost Report (Box) | Mesmo arquivo do Reunion — linhas sem preenchimento de cor | BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_1201.xlsx — linhas com preenchimento roxo/cinza | BR_SMTC_S02_SOFTPRE_PROVISÓRIO.xlsx (nome pode mudar, link permanece) |
| Planilha de Contratos | BR_AREP_S01_CONTROLE_DE_CONTRATOS.xlsb | BR_AREP_S01_REUNION_CONTROLE_DE_CONTRATOS.xlsb | BR_SMTC_S02_CONTROLE_DE_CONTRATOS.xlsb |

### 6.1 Apelidos de projeto (array configurável via Telegram)
O identificador/assunto de um projeto pode mudar durante a execução do projeto (ex.: em 19/08/2026 o Soft Pré mudou de "SMTC_S02 \| SOFT PRE" para "PNS \| SOFT PRE" por pedido da Danielle, para não vazar o nome do projeto — e e-mails antigos e novos convivem, pois a Michelle já tinha enviado pedidos com o assunto antigo antes da mudança). Por isso, os apelidos de cada projeto NÃO ficam fixos no workflow (diferente do resto do perfil, que é copiado direto para dentro do workflow — seção 6): eles ficam numa aba de configuração à parte na planilha (ex.: "Config_Apelidos", colunas `projeto_id` e `apelido`), lida a cada execução. Um workflow separado no n8n recebe um comando via Telegram (ex.: `/apelido SOFT_PRE PNS | SOFT PRE`) e adiciona a nova linha nessa aba, sem precisar mexer no código do workflow principal. O motor de identificação de projeto deve considerar TODOS os apelidos cadastrados para aquele `projeto_id` como equivalentes (e-mails com qualquer um deles são tratados como o mesmo projeto).

| Papel | Produção | Homologação |
|---|---|---|
| Danielle | financeiro@novorealitybox.com | dinhoolhosazuis@gmail.com |
| Vanessa | executiva@novorealitybox.com | grandesnegocioseoportunidades@gmail.com |

## 7. Arquitetura técnica

### 7.1 Decisão
Tudo roda em nuvem, dentro do próprio n8n — sem script separado rodando por fora (cron), e sem depender de nenhuma máquina/notebook ligado.
- Orquestração: n8n Community Edition (self-hosted, gratuito), com nodes nativos de Box, Google Drive e Gmail.
- Regras determinísticas (datas, zero-padding, contagem de 30 notas): node de Code do n8n, roda dentro da execução do workflow.
- Extração de dados do PDF/imagem da nota fiscal: node de IA do n8n chamando a API da Claude com o anexo, devolvendo os dados em JSON.
- Hospedagem: instância e2-micro do Google Cloud Free Tier (gratuita para sempre, região EUA), rodando o n8n 24/7 sem custo nem dependência de notebook.
- Erros: "Error Workflow" nativo do n8n — qualquer falha dispara aviso automático no Telegram.
- Credencial de IA: no Claude Console, o cartão de pagamento fica no nível da conta/organização (não por chave nem por workspace) — todas as chaves de uma mesma conta são cobradas no mesmo cartão. Por isso o projeto usa **duas contas Anthropic separadas**: (1) chave de dev/homologação `n8n-boxfish-notas-hml`, criada na conta pessoal do Claudio, cartão dele; (2) chave de produção, a criar numa conta nova aberta com o e-mail da Michelle (michelle.mimiaguia@gmail.com), cartão dela — contas e cobranças 100% independentes. No n8n isso vira duas credenciais separadas ("Claude account (dev)" e "Claude account (produção)"), trocadas conforme o perfil ativo (homolog/produção), do mesmo jeito que já é feito com os e-mails de teste (seção 7.4). Recomendado usar o modelo **Claude Haiku 4.5** para a extração de dados do PDF (tarefa estruturada e repetitiva, custo bem menor que Sonnet/Opus, com qualidade suficiente para esse tipo de extração).

### 7.5 Estimativa de custo mensal da API Claude
Custo pago por token (sem mensalidade fixa — só paga o que usar). Preços oficiais atuais (ago/2026): Haiku 4.5 = US$ 1/US$ 5 por milhão de tokens (entrada/saída); Sonnet 5 = US$ 2/US$ 10 por milhão (preço promocional válido até 31/08/2026, depois volta a US$ 3/US$ 15).
Estimativa para o volume deste projeto (~50 a 150 notas fiscais/mês somando os 3 projetos, 1 a 2 chamadas de IA por nota — extração + eventual formatação):
| Cenário | Modelo | Estimativa mensal |
|---|---|---|
| Volume baixo (~50 notas/mês) | Haiku 4.5 | < US$ 1 |
| Volume médio (~100 notas/mês) | Haiku 4.5 | US$ 1 a US$ 3 |
| Volume alto (~150+ notas/mês, picos no dia 10) | Haiku 4.5 | US$ 3 a US$ 6 |
| Mesmo volume, usando Sonnet 5 em vez de Haiku | Sonnet 5 | 2 a 3x o valor acima |
PENDENTE: valores são estimativa pré-implementação; confirmar custo real após o primeiro mês em produção, acompanhando pelo painel de custos do Claude Console. Recomendado configurar um limite de gasto mensal (spend limit) na chave de API como proteção extra.

### 7.2 Trava de arquivo no Box (evitar sobrescrita)
A API do Box permite consultar e travar/destravar um arquivo, impedindo que outra pessoa suba uma nova versão por cima enquanto a automação trabalha.
- Antes de editar: consultar se está travado; se estiver, adiar para a próxima execução.
- Se livre: travar → baixar → editar → subir a nova versão → destravar.
- Tratamento de erro obrigatório: destravar sempre, mesmo em falha no meio do processo.
PENDENTE: Confirmar com teste real, na implementação, se o campo "lock" da API reflete também o indicador de coautoria do Excel Online, ou só o lock manual do Box.

### 7.3 Notificações — bot do Telegram
- Pendências/bloqueios: contrato não assinado, dado bancário/Pix faltando, remetente não identificado, dado ilegível.
- Alertas de cobrança disparada automaticamente.
- Relatório ao final de cada execução: rascunhos criados/atualizados, notas processadas, itens pendentes de revisão manual.

### 7.4 Ambiente de homologação
Um perfil extra ("homolog") usa os e-mails de teste do Claudio no lugar dos destinatários reais. Enquanto o ambiente de produção mantiver os e-mails em rascunho, essa é a política padrão — nada é enviado automaticamente sem revisão humana.

## 8. Acessos validados
| Item | Status |
|---|---|
| Gmail (financeiro1@novorealitybox.com) | Validado — marcadores e modelos conferidos |
| Box — Cost Report S01 | Validado — arquivo e estrutura conferidos |
| Box — Cost Report S02 | Validado — nome "PROVISÓRIO", link permanece o mesmo |
| Google Drive S01 (Reunion) | Validado por acesso direto |
| Google Drive S02 (Soft Pré) | Validado por prints — acesso direto ainda pendente (ver seção 9) |
| Planilhas de Controle de Contratos | Validadas (AREP, Reunion e Soft Pré) |


## 9. Pendências e itens em aberto
PENDENTE: Confirmar com teste real, na implementação, se o campo "lock" da API do Box reflete também o indicador de coautoria do Excel Online, ou só o lock manual.
PENDENTE: Escopo de Recibos de Reembolso (RDP'S) — fora desta automação por enquanto, será tratado numa etapa futura separada.

## 10. Regras resolvidas nesta rodada
- Identificar de qual colaborador é uma nota quando o remetente do e-mail não é óbvio (Fase 2): abrir a nota fiscal em anexo, extrair dela o nome do colaborador, a razão social e o projeto (Ref.), e usar essas informações para localizar a linha correspondente na aba Notas.
- Cruzamento entre a aba Notas e as planilhas de Contratos (Razão Social / nome do colaborador): comparar ignorando diferença de maiúsculas/minúsculas e espaços a mais ou a menos — não precisa de comparação fonética/aproximada mais complexa.
- Acesso ao Drive S02 via conector: será testado ao vivo durante a montagem do n8n, quando a própria Michelle autenticar — não é mais tratado como bloqueio.
- Fase 4 (Arquivamento): revalidada e fundida com a Fase 3 (seção 5.3) — acontecem em paralelo, com estrutura de pastas e nomenclatura confirmadas por prints reais dos Drives S01 e S02.
- Estrutura completa de pastas por função: confirmada por prints reais (não é mais uma lista a levantar do zero — os padrões "[código] - [CARGO]" e "[código].R - [CARGO]" já estão documentados na seção 5.3).
- Detalhamento de PACOTE e REC + NF: esclarecido — PACOTE é caso raro específico do AREP; REC + NF ocorre em locação, sobretudo com fornecedores, por motivo fiscal (nunca usar "serviço prestado" nesses casos).
- Numeração de remessa no Status Box interno: confirmada — "ENTREGUE MI" (1ª a 30ª nota daquele vencimento), "ENTREGUE MI R1" (31ª a 60ª), "ENTREGUE MI R2" (61ª a 90ª), contando por pasta de vencimento.

## 11. Checklist de próximos passos
| # | Ação | Responsável |
|---|---|---|
| 1 | Criar conta no Google Cloud e provisionar a instância e2-micro (Always Free) | Claudio |
| 2 | Instalar n8n Community Edition na instância | Claudio + Claude Code |
| 3 | Criar o bot no Telegram via @BotFather e a Michelle enviar a primeira mensagem a ele — CONCLUÍDO | Michelle |
| 4 | Configurar credenciais OAuth no n8n: Gmail, Google Drive e Box (login da própria Michelle) | Michelle + Claudio |
| 4.1 | Criar chave de API de dev/homologação (`n8n-boxfish-notas-hml`) no Claude Console — CONCLUÍDO | Claudio |
| 4.2 | Criar conta separada no Claude Console com o e-mail da Michelle, cadastrar o cartão dela e gerar a chave de API de produção — CONCLUÍDO | Michelle |
| 5 | Claude Code monta os workflows completos (JSON) das 4 fases + perfis de projeto | Claude Code |
| 6 | Importar os workflows no n8n e validar em ambiente de homologação | Claudio |
| 7 | Resolver as pendências da seção 9 antes de cada fase entrar em produção | Claudio + Michelle |


## 13. Rollback e controle de versão

### 13.1 Git
Sem o recurso pago de Git integrado do n8n (Business plan). Controle de versão feito manualmente: workflows exportados como JSON e commitados no repositório Git do projeto (GitHub, privado). Estrutura do repositório:
- /workflows/  -> JSON exportado de cada workflow do n8n (um por fase + um de rollback)
- /profiles/   -> config de cada projeto (Reunion, Soft Pré, AREP) em JSON/YAML
- /docs/       -> este documento (spec.md)
- /scripts/    -> lógica mais longa usada em nós de Code
Nenhuma credencial (token do Telegram, senha, chave de API) deve ir para o Git — essas ficam só dentro do n8n (credenciais/variáveis de ambiente).

### 13.2 Execução por fase, isolada
Cada fase é um workflow separado no n8n, com gatilho manual (além do agendamento automático), para permitir testar uma fase de cada vez em produção, sem encadeamento automático até validação.

### 13.3 Rollback via Telegram
- Cada execução registra um "recibo" das ações feitas: rascunhos de e-mail criados (IDs), arquivos/pastas criados ou movidos no Drive (caminho antes/depois), e a versão da planilha do Box antes da edição.
- Workflow de Rollback, disparado por comando no Telegram (ex.: /rollback):
  1. Compara a versão atual do arquivo no Box com a versão registrada logo após a execução da automação.
  2. Se não houve alteração posterior: mostra o que será revertido, pede confirmação ("confirma"/"cancela") e só então executa o rollback completo (inclusive a planilha).
  3. Se já existe uma versão mais recente (alguém alterou depois): avisa isso claramente e oferece 3 opções:
     - Rollback total: reverte tudo, inclusive a planilha (com aviso explícito de que a alteração de quem mexeu depois será perdida).
     - Rollback parcial: reverte só o que a automação criou/moveu (rascunhos, arquivos, pastas), deixando a planilha intacta para conferência/ajuste manual depois.
     - Cancelar: não faz nada.
  4. Ao final, envia resumo pelo Telegram do que foi revertido e do que não foi.
