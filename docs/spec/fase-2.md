AUTOMAÇÃO — CONTROLE DE NOTAS FISCAIS · Box Fish · Michelle Aguiar

> **Mapa dos arquivos do spec (`docs/spec/`)**: `00-comum.md` (leitura obrigatória em qualquer tarefa) · `01-arquitetura-infra.md` · `fase-1.md` · `fase-2.md` · `fase-3-4.md` · `90-decisoes-e-proximos-passos.md`. Os números das seções são os do documento original e não mudaram. O Claude Code lê estes arquivos e **nunca os edita**.

> *Leia antes o `00-comum.md`.*

## 4. Fase 2 — Recebimento e validação da nota
**Decisão de rollout (29/08, pedido da Michelle; regra fechada em 07/09, PASTA AINDA NÃO CRIADA — bloqueada pelas credenciais Google expiradas, ver seção 9) — destino do arquivamento por função (Salvamento 2) em produção depende do MODO_EXECUCAO**: com `ambiente = produção`, o destino do Salvamento 2 segue o mesmo padrão já usado para e-mail (rascunho vs. envio direto, seção 3.1.3) — não é uma janela temporária avulsa, é regido pelo `MODO_EXECUCAO`:
- **`MODO_EXECUCAO = rascunho`**: escreve na pasta raiz **`BOX-FISH_ARQUIVO-POR-FUNCAO_ATIVA`** (ID `1J4aNIZ2hpnXwGYPVCPI2LVPi4T1kySXH`), dentro do Drive pessoal da Michelle (`michelle.mimiaguia@gmail.com`) — mesmas subpastas `FINANCEIRO`/`FINANCEIRO S02`, mesmo padrão de nomenclatura da estrutura oficial. Michelle confere o resultado ali antes de copiar manualmente pro Drive oficial. **Histórico de nome, corrigido em 17/09**: a pasta original `PRODUCAO_BOX-FISH_A-CONFERIR` foi criada manualmente por Claudio em 10/09. A causa real do bloqueio de acesso encontrado depois (11-12/09) NÃO foi o escopo `drive.file` bloqueando pastas criadas manualmente (essa explicação anterior estava errada — o app consegue sim acessar e criar subpastas em pastas criadas manualmente, desde que a credencial esteja na conta certa) — foi a credencial `Google Drive - Michelle` estar, naquele momento, autenticada na conta ERRADA (`financeiro1@novorealitybox.com` em vez de `michelle.mimiaguia@gmail.com`), causada por uma sessão de navegador já logada na conta errada durante a reconexão OAuth. Isso gerou confusão e uma segunda pasta (`BOX-FISH_ARQUIVO-POR-FUNCAO_ATIVA`) criada na conta errada, apagada depois. Após corrigir a credencial (17/09, confirmada via `files.get?fields=owners` = `michelle.mimiaguia@gmail.com`), a pasta **`BOX-FISH_ARQUIVO-POR-FUNCAO_ATIVA`** (ID `1zZ_8KD1UWijEAdDjKbxDxp4Pu7uyArT1`) foi recriada corretamente na conta certa — é esta a pasta ATIVA e correta a partir de agora. A pasta antiga `PRODUCAO_BOX-FISH_A-CONFERIR` foi apagada por Claudio em 17/09.
- **`MODO_EXECUCAO = automatico`**: escreve direto no Drive oficial do financeiro (`financeiro1@novorealitybox.com`), estrutura real `FINANCEIRO > 08. NOTAS ARQUIVADAS > ...` — sem passo intermediário.
Motivo do modo rascunho ir pro Drive da Michelle: com o volume de notas chegando e a automação processando rápido, um erro de arquivamento poderia passar despercebido e ser notado primeiro pela Controller (Danielle) reclamando com a Michelle — melhor ela conferir no próprio Drive antes de confiar no automático. Não confundir com a simulação de homologação já existente (pasta `HOMOLOG_BOX-FISH` no Drive pessoal do CLAUDIO, seção 7.6) — aquela é só para testes em ambiente homolog; `BOX-FISH_ARQUIVO-POR-FUNCAO_ATIVA` é para uso real em produção, no Drive da MICHELLE. **Esclarecimento: esta regra (ligada ao MODO_EXECUCAO) é EXCLUSIVA do Salvamento 2 (arquivamento por função). O Salvamento 1 (pouso de trabalho, por retranca/projeto, seção 4.2) NÃO muda — sempre vai para a pasta `SMTC` (produção) ou `HOMOLOG_BOX-FISH` (homolog) dentro do Drive da Michelle, independente do MODO_EXECUCAO, como já era.**
- Monitorar e-mails recebidos com nota fiscal (ou recibo) anexada.
- Todo e-mail recebido com NF em anexo deve ser checado: pertence a uma thread já em andamento (resposta ao pedido original), ou é um caso avulso (assunto diferente, não é resposta)?
- Caso seja avulso / o remetente não seja obviamente o colaborador: abrir a nota fiscal em anexo, extrair dela o nome do colaborador, a razão social e o projeto (Ref.), e usar essas informações para localizar a linha correspondente na aba Notas.
- Essa busca de correspondência deve ser feita via IA (API da Claude) — não por comparação exata de string nem por algoritmo fonético tradicional (tipo Soundex, que não funciona bem com nomes em português). A IA compara o nome/razão social extraído contra a lista de nomes/razões sociais da planilha e aponta a linha correspondente (ou indica que não há correspondência confiável), já lidando naturalmente com acentuação, maiúsculas/minúsculas e pequenas variações de escrita.
- Se a IA encontrar correspondência confiável: segue o fluxo normal (para as cobranças e atualiza a planilha).
- Se a IA NÃO encontrar nenhuma correspondência confiável: enviar mensagem via Telegram para a Michelle, informando os dados de referência que constam na nota (nome, razão social, valor, competência) e perguntando qual linha/colaborador ela associa a essa nota.
  - Se ela responder dentro de 8h: executar a ação que ela indicou.
  - Se não responder em 8h: reenviar o lembrete pelo Telegram.
  - Se não responder em mais 18h (26h no total, desde a 1ª pergunta): encerrar o ciclo para aquela nota, sem ação automática — fica pendente.
  - **Correlação da resposta quando há mais de uma pergunta pendente ao mesmo tempo**: usar o "responder" (reply) da mensagem do Telegram como forma de identificar a qual pergunta a resposta se refere. Se a Michelle responder SEM usar essa função (mensagem solta, sem reply a nenhuma pergunta específica) e houver mais de uma pendência aberta: **NÃO adivinhar** qual pergunta ela quis responder (nunca assumir a mais antiga por padrão) — reenviar a pergunta, pedindo explicitamente que ela use a função "responder" da mensagem correspondente àquela nota específica antes de prosseguir.
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

Existem dois destinos de salvamento distintos — **CORREÇÃO: os dois agora acontecem na Fase 2, em paralelo, assim que a nota é baixada e validada** (antes o Salvamento 2 esperava a Fase 3+4; a Michelle confirmou que pode ser antecipado, pois esse arquivamento por função independe do momento da entrega ao Danilo):

**Salvamento 1 — pouso de trabalho, no Drive particular da Michelle:**
Salvar a nota com a retranca certa no **Drive particular da Michelle**. Importante: essa é uma conta Google **separada** da conta de trabalho (financeiro1@novorealitybox.com) — tem Drive próprio, e-mail e credencial OAuth independentes. Substitui o antigo salvamento em pasta local (Downloads).

- E-mail da conta: `michelle.mimiaguia@gmail.com`
- Pasta raiz: `SMTC` (link: https://drive.google.com/drive/folders/13sbk5QKW_srcopi5HMCMLbUdAbksniBo)
- Credencial já configurada no n8n: **"Google Drive - Michelle (michelle.mimiaguia@gmail.com)"** (Google Drive OAuth2 API, conectada e autorizada)

**Salvamento 2 — arquivamento por função (oficial, definitivo):**
Mover/copiar a nota desse pouso para dentro do Drive de trabalho (financeiro1@novorealitybox.com ou compartilhado da empresa), na estrutura já documentada: `FINANCEIRO > 08. NOTAS ARQUIVADAS > ARQUIVO DE NOTAS [PROJETO] > [código] - [CARGO]`.

- Identificar a pasta: código vem da **coluna B ("CONTA NETFLIX")**, nome da função/cargo vem da **coluna C ("ÍTEM")**. O nome da coluna é literal — o código vem do próprio sistema de codificação de cargos da Netflix, usado porque os 3 projetos (AREP, Reunion, Soft Pré) são produções/reality shows da Netflix. Se a pasta daquele código ainda não existir, criar seguindo a mesma nomenclatura das pastas já existentes.
- **Desambiguação quando o mesmo fornecedor tem múltiplas linhas na planilha (decidido em 11/09)**: um fornecedor pode aparecer em várias linhas com códigos/cargos diferentes (ex.: uma agência de viagens com linhas separadas para "PASSAGEM", "HOSPEDAGEM"; uma produtora com "DIREÇÃO TÉCNICA" e "COORDENAÇÃO TÉCNICA"). Nesse caso, o nome do arquivo da nota (razão social) sozinho não basta — usar o seguinte filtro em cascata, do mais amplo ao mais específico: (1) filtrar a planilha Cost pelo fornecedor (razão social); (2) dentro desse subconjunto, filtrar pela data de vencimento (coluna G), usando a data que já vem da própria estrutura de pastas de origem (organizada por vencimento); (3) se ainda houver mais de uma linha candidata, casar pelo NÚMERO DA NOTA FISCAL (coluna E, "Documento Fiscal") — que já vem no próprio nome do arquivo da nota, depois do "#" (ex. "..._#000123.pdf" → "000123") — contra o valor da coluna E de cada linha candidata; o número da nota é um identificador exato e único, diferente de valor monetário (que pode coincidir entre notas diferentes). Esse mesmo princípio (fornecedor + vencimento + número do documento) deve ser usado pela Fase 2, no futuro, para resolver o "avulso" quando o fornecedor/colaborador tiver múltiplas linhas na planilha — não usar só correspondência de nome/razão social nesse cenário.
- **Normalização do número ao comparar com a coluna E — AUTORIZADA (11/09)**: faturas de empresa (diferente de nota de colaborador) frequentemente têm numeração própria com hífen (ex. "14-9"), diferente do padrão de 6 dígitos sem separador usado nas notas de colaborador. Ao gerar o nome do arquivo (retranca), a Michelle converte esse número pro padrão de 6 dígitos removendo o hífen e completando com zeros à esquerda (ex. "14-9" → "000149"). Por isso, ao comparar o número extraído do nome do arquivo com o valor da coluna E, remover zeros à esquerda e hífens dos dois lados antes de comparar (ex. "000149" e "14-9" → ambos viram "149", batem). Isso NÃO é uma aproximação arriscada — é reconhecer a mesma informação escrita em dois formatos diferentes por convenção conhecida, não uma tentativa de casar valores parecidos que poderiam ser documentos diferentes.
- Padrão de nome de pasta por função — confirmado com exemplos reais: AREP usa "[código] - [CARGO]" sem sufixo (ex.: "1301 - DIRETOR GERAL", "2011 - ..."); Reunion usa "[código].R - [CARGO]" (ex.: "1301.R - DIRETOR GERAL", "7007.R - ACESSORIA JURÍDICA", "2794.R - VERBA FIGURINO REUNION"); Soft Pré usa "[código].S - [CARGO]" (ex.: "3101.S - DIRETOR DE FOTOGRAFIA", "3428.S - PRODUTORA DE CASTING") — **corrigido em 11/09**: a suposição anterior de que Soft Pré seguiria o padrão do AREP sem sufixo estava errada; o dado real da coluna B da planilha Cost já vem com ".S" — usar sempre o valor literal da coluna B, não inferir o sufixo.
- Credencial já configurada no n8n: **"Google Drive - Produção (financeiro1@novorealitybox.com)"** (Google Drive OAuth2 API, conectada como financeiro1@novorealitybox.com)

- **Marcação da coluna Q (decidido em 24/10/2026):** logo depois de arquivar a nota por função, o n8n marca `OK` na coluna Q (CHECK ARQUIVO DRIVE) da linha correspondente do Cost, seguindo as regras da seção 13.5 (só escreve em célula vazia ou `PENDENTE`, nunca em `ARQUIVO INTERNO`; escrita cirúrgica com backup, seções 13.4 a 13.6).

**IMPORTANTE — este NÃO é o mesmo arquivamento da remessa/Danilo** (pasta `09. CONTAS À PAGAR` / `11. CONTAS À PAGAR - [PROJETO]`, com a pasta de remessa levando sufixo "_MI") — esse outro continua acontecendo só na Fase 3+4, no momento da entrega (seção 5.3). São dois destinos e dois momentos diferentes.

## 4.3 Credenciais já configuradas no n8n (status atual)

| Credencial | Nome exato no n8n | Conta autorizada | Status |
|---|---|---|---|
| Gmail | Gmail account | financeiro1@novorealitybox.com | ✅ Conectada |
| Google Drive (trabalho) | Google Drive - Produção (financeiro1@novorealitybox.com) | financeiro1@novorealitybox.com | ✅ Conectada |
| Google Drive (particular) | Google Drive - Michelle (michelle.mimiaguia@gmail.com) | michelle.mimiaguia@gmail.com | ✅ Conectada |
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

**Ordem de escrita confirmada (Opção A)**: a Fase 2 (Salvamento 1) pousa a nota DIRETO dentro da pasta `VENC_[MÊS]_[dd.mm]`, sem pasta de remessa ainda — nesse momento a automação não sabe em qual remessa a nota vai cair (o número da remessa só é calculado na Fase 3+4, pela regra de lotes por janela de tempo — seção 5.0). A subpasta `[dd.mm]_BR_SMTC_[ID]_ARQUIVO_NF_REMESSA_[n]` só é criada pela Fase 3+4, que move as notas já recebidas para dentro dela nesse momento. Os ARQUIVOS individuais dentro dessa pasta seguem o padrão de retranca da seção 4.1 (`[dd.mm]_BR_SMTC_[ID]_[RAZÃO SOCIAL]_#[nº nota]`) — só o NOME DA PASTA de remessa segue a nomenclatura de remessa, não a retranca individual.

**Fora de escopo, não implementar**: foi encontrado um exemplo real de retranca usando o tipo do documento (`APÓLICE`, `BOLETO`) no lugar do número de 6 dígitos — confirmado por Claudio que é um caso pontual manual (parcela de seguro), não faz parte do processo automatizado.
