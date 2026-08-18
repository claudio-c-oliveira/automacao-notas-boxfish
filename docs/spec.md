AUTOMAÇÃO — CONTROLE DE NOTAS FISCAIS Box Fish · Michelle Aguiar — Documento mestre do projeto Preparado por Claude a pedido de Claudio Carvalho de Oliveira · 17/08/2026

## 1\. Objetivo e escopo

Este documento consolida tudo o que foi mapeado, validado e decidido sobre o processo de trabalho da Michelle na Box Fish (controle e solicitação de notas fiscais de colaboradores/fornecedores), servindo tanto de referência técnica de implementação quanto de material para a Michelle conferir se o comportamento descrito bate com o que ela faz hoje. O processo cobre 3 projetos, com regras idênticas mas dados/nomenclaturas próprios de cada um:

- AREP / SMTC-S01 (antigo) — projeto quase encerrado, poucos casos restantes.  
- SMTC-S01 Reunion — projeto atual em andamento.  
- SMTC-S02 Soft Pré — segunda temporada, Box/Drive separados. Fora de escopo por enquanto: processo de Recibos de Reembolso (RDP'S) — reembolso de despesas do colaborador (passagem, atendimento médico em set, alimentação em viagem). Existe, é real, mas será especificado numa etapa futura separada.

## 2\. Visão geral das 4 fases

| Fase | O que faz | Onde processa |
| :---- | :---- | :---- |
| 1\. Solicitação de nota | Filtra planilha, valida contrato, monta e programa e-mail de pedido em rascunho | n8n (nuvem) |
| 2\. Recebimento e validação | Monitora respostas com NF anexada, extrai dados, atualiza planilha, salva a nota | n8n \+ IA (extração de PDF) |
| 3\. Remessa para o Danilo \+ 4\. Arquivamento | Agrupa recebidas (até 30/remessa), formata cópia da planilha, sobe no Drive, monta e-mail, arquiva a nota na pasta por função — tudo em paralelo, na mesma execução | n8n \+ IA (formatação) |

As Fases 3 e 4 acontecem juntas, não uma depois da outra — confirmado por Claudio: no momento em que o e-mail do Danilo é preparado, a nota já é arquivada na pasta correta.

## 3\. Fase 1 — Solicitação de nota ao colaborador

### 3.1 Passo a passo

- 1º Verificar Status do Contrato (coluna N da aba Notas). Se vazio ou "N/A", buscar em outra planilha (o arquivo de Controle de Contratos, por projeto — seção 6), cruzando por Razão Social ou nome do colaborador. A comparação ignora diferença de maiúsculas/minúsculas e espaços a mais ou a menos.  
- 2º Filtrar Status Box \= "PROGRAMAR ATÉ \[data\]" (texto exato). Regra pelo Status do Contrato:  
- — "Pendente" (já checado na outra planilha) → não dispara.  
- — vazio/"N/A" (já checado na outra planilha) → não dispara.  
- — "OK \- Assinado" → monta e programa o e-mail de pedido, informando prazo de envio até data+5 dias, e deixa em RASCUNHO no Gmail.  
- Se o colaborador não enviar a NF até o prazo, o sistema envia cobrança automaticamente no mesmo e-mail, respondendo a "Todos".  
- 3º Filtrar Status Box \= "SOLICITAR" → monta e-mail para envio imediato, mas por enquanto também fica em RASCUNHO.  
- O Status Box é atualizado assim que o rascunho é criado — não é preciso esperar o envio manual.

### 3.2 Dados de origem e tipos de emissão

Usar apenas as colunas: G (Vencimento), J (Descrição), K (Valor a pagar), L (Status Box), R (E-mail do colaborador). A coluna J se separa em 3 partes: \[CARGO\] \- \[NOME DO COLABORADOR\] \- \[DE "DATA" A "DATA"\]. O nome vem daqui; se não achar, cai para a coluna H (Fornecedor). | Tipo | Quando usar | Assunto | |---|---|---| | NF normal | Cachê mensal | REF. \[MÊS ABREV. 3 LETRAS\] | | JOB | Período pontual de job | REF. JOB (com parcela "P.X/Y" se houver) | | DIÁRIA | Diária avulsa | REF. DIÁRIA | | PACOTE | Caso raro e específico do AREP (diárias agrupadas em pacote fechado); não deve se repetir fora do AREP | REF. PACOTE (sem mês) | | REC \+ NF | Locação (equipamento, estúdio, mesas etc.) faturada em parte recibo/fatura \+ parte nota — mais comum com fornecedores do que colaboradores | EMISSÃO DE NF E REC | REF. \[MÊS\] |

Regra crítica: em casos de locação, o e-mail NUNCA pode usar a expressão "serviço prestado" — sempre "locação" (questão fiscal). Colaboradores normalmente são só JOB ou mensal; a distinção PACOTE/REC+NF é mais comum entre fornecedores.

### 3.3 Exemplo real — e-mail de pedido de nota (Reunion)

Réplica linha a linha do modelo enviado pela Michelle — mesmo espaçamento (linha em branco entre cada campo, mas sem espaço extra dentro do bloco do Tomador e dentro do aviso de dados bancários), mesmo negrito, grifo amarelo, cor do aviso e emoji. | Assunto: SMTC \- S01 | REUNION | EMISSÃO DE NF | REF. JOB (ENVIAR ATÉ 10.08) | GUILHERME HENRIQUE PORTES SIQUEIRA | |---| | Olá GUILHERME\! Tudo bem? Seguem as instruções para a emissão da sua nota fiscal que deverá ser enviada até o dia 10/08 com vencimento em 10/09/2026. Tomador BOXFISH PRODUTORA DE PROGRAMAS TELEVISIVOS, INTERNET E FILMES PUBLICITÁRIOS LTDA. Endereço: Rua Butantã, 194, sala 24, Pinheiros. CEP 05.424-000 \- São Paulo, SP CNPJ: 14.788.649/0001-23 IM: 4.436.095-9 IE: ISENTA 1- Emitir nota fiscal no valor de R$ 3.000,00 com os dados abaixo no corpo da nota: Ref. "SMTC \- REUNION" Serviço Prestado como: PRODUTOR DE CONTEÚDO Colaborador: GUILHERME HENRIQUE PORTES SIQUEIRA Período de 25/08 A 27/08 (JOB) Dados bancários: Chave pix: \--------------------------------------------------------------------- Importante: Peço a gentileza de enviar a sua nota nestes e-mails: [financeiro@novorealitybox.com](mailto:financeiro@novorealitybox.com) [financeiro1@novorealitybox.com](mailto:financeiro1@novorealitybox.com) "Os dados bancários considerados para pagamento são os que estão cadastrados. O cadastro é feito baseado nas informações cedidas pelo contratado através do preenchimento de ficha cadastral da Box. Qualquer alteração bancária ou mudança na forma de pagamento deve ser notificada por e-mail pelo contratado e se faz necessário atualização da ficha cadastral e envio prévio ao responsável financeiro do projeto." Muito obrigada\! Beijo 🌷 |

### 3.4 Exemplo real — e-mail de pedido de nota (Soft Pré)

Mesma estrutura, só troca "REUNION" por "SOFT PRE" no assunto e no "Ref." — todo o resto (Tomador, negrito, grifo, aviso, disclaimer, assinatura) é idêntico. | Assunto: SMTC \- S02 | SOFT PRE | EMISSÃO DE NF | REF. JUL (ENVIAR ATÉ 27.07) | BRUNA BORTOLAZO | |---| | Olá BRU\! Tudo bem? Seguem as instruções para a emissão da sua nota fiscal que deverá ser enviada até o dia 27/07 com vencimento em 10/08/2026. Tomador BOXFISH PRODUTORA DE PROGRAMAS TELEVISIVOS, INTERNET E FILMES PUBLICITÁRIOS LTDA. Endereço: Rua Butantã, 194, sala 24, Pinheiros. CEP 05.424-000 \- São Paulo, SP CNPJ: 14.788.649/0001-23 IM: 4.436.095-9 IE: ISENTA 1- Emitir nota fiscal no valor de R$ 5.100,00 com os dados abaixo no corpo da nota: Ref. "SMTC \- SOFT PRE" Serviço Prestado como: ASS. PRODUÇÃO EXECUTIVA Colaborador: BRUNA BORTOLAZO Período de 15/07 A 31/07 Dados bancários: Chave pix: \--------------------------------------------------------------------- Importante: Peço a gentileza de enviar a sua nota nestes e-mails: [financeiro@novorealitybox.com](mailto:financeiro@novorealitybox.com) [financeiro1@novorealitybox.com](mailto:financeiro1@novorealitybox.com) "Os dados bancários considerados para pagamento são os que estão cadastrados. O cadastro é feito baseado nas informações cedidas pelo contratado através do preenchimento de ficha cadastral da Box. Qualquer alteração bancária ou mudança na forma de pagamento deve ser notificada por e-mail pelo contratado e se faz necessário atualização da ficha cadastral e envio prévio ao responsável financeiro do projeto." Muito obrigada\! Beijo 🌷 |

No AREP, o "Ref." fica só "SMTC", sem sufixo — o restante da estrutura é o mesmo. Confirmado: o link no e-mail do Danilo também leva o mesmo grifo azul-claro usado na data de vencimento do e-mail de pedido — comparei com os prints ampliados enviados por Claudio.

## 4\. Fase 2 — Recebimento e validação da nota

- Monitorar e-mails recebidos com nota fiscal (ou recibo) anexada.  
- Caso o remetente não seja obviamente o colaborador: abrir a nota fiscal em anexo, extrair dela o nome do colaborador, a razão social e o projeto (Ref.), e usar essas informações para localizar a linha correspondente na aba Notas.  
- Atualizar a planilha do Box: coluna D \= tipo de documento, coluna E \= número da nota (6 dígitos), coluna F \= data de emissão.  
- Atualizar Status Box → "RECEBIDA MI \[Rn\]".  
- Salvar a nota no Drive particular da Michelle (substitui o salvamento local), na pasta do projeto, com a retranca abaixo.

### 4.1 Regra de retranca (nome do arquivo da nota)

Formato: \[dia.mês do vencimento\]*BR\_SMTC*\[IDENTIFICADOR DO PROJETO\]*\[RAZÃO SOCIAL\]*\#\[nº da nota, 6 dígitos\] | Projeto | Identificador | Exemplo real | |---|---|---| | AREP (antigo) | S01 | 10.08\_BR\_SMTC\_S01\_BARLAVENTO FILMES LTDA\_\#000000 | | Reunion | REUNION\_S01 | 10.09\_BR\_SMTC\_REUNION\_S01\_BARLAVENTO FILMES LTDA\_\#000000 | | Soft Pré | SOFT PRE\_S02 (sem underline) | 10.08\_BR\_SMTC\_SOFT PRE\_S02\_BARLAVENTO FILMES LTDA\_\#000000 |

## 5\. Fase 3 \+ 4 — Remessa para o Danilo e Arquivamento (em paralelo)

Confirmado por Claudio: essas duas fases acontecem juntas, na mesma execução — não uma depois da outra.

- Filtrar recebidas por Vencimento (coluna G).  
- Importante: dentro da mesma planilha/aba Notas do S01, AREP e Reunion convivem juntos, diferenciados pela cor de preenchimento da linha (Reunion \= roxo/cinza-arroxeado; AREP \= sem preenchimento). Depois de filtrar por vencimento, é preciso também "Filtrar por cor" para não misturar notas dos dois projetos que caem no mesmo vencimento.  
- Agrupar em remessas de até 30 notas (R1, R2, R3...); regra de agrupamento no e-mail: mesmo Fornecedor \+ mesmo Vencimento \= agrupa no mesmo e-mail, sem limite de quantidade.  
- Nunca usar "Classificar" — sempre "Filtrar" (Classificar quebra a estrutura da planilha).  
- Fazer uma cópia da planilha antes de mexer (nunca editar a original), remover as colunas que não vão para o Danilo, formatar "Valor a Pagar" como número com 2 casas decimais mantendo a cor vermelha, mudar Status Box da cópia para "ENTREGUE".  
- Colar o recorte formatado no e-mail do Danilo (RASCUNHO); essa mesma imagem da planilha formatada também deve ser salva na pasta de arquivamento (seção 5.3), junto com a nota fiscal.  
- Solicitar aprovação via Drive (Danielle \+ Vanessa).

### 5.1 Exemplo real — e-mail de remessa para o Danilo

| Assunto: SMTC \- S01 | REUNION | NOTAS À PAGAR | VENC\_20.08.26 | REMESSA\_1 | |---| | Oi Danilo, tudo bem?😊 Atualizei a pasta de contas a pagar no Drive \==\> 11\. CONTAS A PAGAR \- REUNION \==\> Pasta nº 1\. AGOSTO \==\> VENC. 20.08.26 \==\> REMESSA\_1 Segue o link para vencimento em 20/08/26 🔗 20.08\_BR\_SMTC\_REUNION\_S01\_CONTROLE\_NF\_REMESSA\_1 Obs.: Van e Dani, o pedido de aprovação foi direto pelo Drive\! \[ver planilha formatada abaixo, seção 5.2\] Bjs, 🌷 |

Confirmado: o link no e-mail do Danilo sempre leva o identificador completo do projeto, igual à retranca (SMTC\_S01 para o AREP, SMTC\_REUNION\_S01 para o Reunion, SMTC\_SOFT PRE\_S02 para o Soft Pré). Um exemplo anterior que aparecia sem "REUNION" estava errado — foi um esquecimento pontual, não a regra.

### 5.2 Planilha recortada — cores e formatação

Colunas (nesta ordem, SOMENTE estas): Tipo Doc Fiscal, Nº Doc Fiscal, Emissão, Venc., Fornecedor, Descrição, Valor a Pagar, Status Box, Dados Bancários, E-mail. NUNCA incluir Status Cost nem Status Contrato neste recorte, em nenhum projeto. | TIPO DOC FISCAL | Nº DOC FISCAL | VENC. | VALOR A PAGAR | STATUS BOX | |---|---|---|---|---| | NF | 000792 | 20-ago-26 | 20647,29 | ENTREGUE | |  |  | TOTAL | R$ 20.647,29 |  |

Fonte Verdana em todo o e-mail. Cabeçalho: fundo preto/texto branco negrito. Valor a Pagar: número com 2 casas decimais (sem "R$"), vermelho, linha a linha — só a linha de total (fundo preto) leva "R$". Status Box: destaque verde, texto exatamente "ENTREGUE" (só nesta cópia — ver variações na planilha interna, seção 5.3).

### 5.3 Arquivamento (em paralelo à entrega)

- Mover a nota fiscal individual (retranca) e a imagem da planilha formatada (seção 5.2) para a pasta correspondente à função/cargo do colaborador.  
- Identificar a pasta: código da Conta Netflix vem da coluna B, nome da função/cargo vem da coluna C. Se a pasta daquele código ainda não existir, criar seguindo a mesma nomenclatura das pastas já existentes.  
- Caminho: "FINANCEIRO \> 08\. NOTAS ARQUIVADAS \> ARQUIVO DE NOTAS \[PROJETO\]" — pastas separadas por projeto ("ARQUIVO DE NOTAS S01" para AREP, "ARQUIVO DE NOTAS REUNION" para Reunion).  
- Padrão de nome de pasta por função — confirmado com exemplos reais: AREP usa "\[código\] \- \[CARGO\]" (ex.: "1301 \- DIRETOR GERAL"); Reunion usa "\[código\].R \- \[CARGO\]" (ex.: "1301.R- DIRETOR GERAL", "7007.R \- ACESSORIA JURÍDICA"); Soft Pré vai seguir o mesmo padrão do AREP ("\[código\] \- \[CARGO\]") assim que surgirem os primeiros casos.  
- Atualizar a coluna "Check arquivo drive" da planilha para "OK" depois de arquivar cada nota.  
- Atualizar Status Box da planilha interna, contando por pasta de vencimento (cada vencimento tem sua própria contagem): "ENTREGUE MI" para as primeiras 30 notas entregues; "ENTREGUE MI R1" para a 31ª a 60ª; "ENTREGUE MI R2" para a 61ª a 90ª; e assim sucessivamente a cada 30\. A cópia enviada ao Danilo usa sempre só "ENTREGUE", nunca "MI" nem número de remessa. Vencimentos no dia 10 costumam ser os que mais acumulam notas (podendo passar de 30 e precisar de R1, R2...); as demais datas dificilmente ultrapassam 30\.

## 6\. Perfis de projeto (parametrização)

Cada projeto vira um "perfil" de configuração — o motor (as 4 fases) é o mesmo para todos, só troca o perfil. Isso permite adicionar um projeto futuro sem reescrever a automação. | Campo | AREP (S01 antigo) | Reunion (S01) | Soft Pré (S02) | |---|---|---|---| | Prefixo assunto (pedido) | AREP | EMISSÃO DE NF... | SMTC \- S01 | REUNION | EMISSÃO DE NF... | SMTC \- S02 | SOFT PRE | EMISSÃO DE NF... | | Prefixo assunto (entrega) | AREP | NOTAS À PAGAR... | SMTC \- S01 | REUNION | NOTAS À PAGAR... | SMTC \- S02 | SOFT PRE | NOTAS À PAGAR... | | Texto "Ref." | "SMTC" | "SMTC \- REUNION" | "SMTC \- SOFT PRE" | | Retranca | S01 | REUNION\_S01 | SOFT PRE\_S02 | | Planilha Cost Report (Box) | Mesmo arquivo do Reunion — linhas sem preenchimento de cor | BR\_SMTC\_S01\_\_COST REPORT\_VS\_EXECUÇÃO\_1201.xlsx — linhas com preenchimento roxo/cinza | BR\_SMTC\_S02\_SOFTPRE\_PROVISÓRIO.xlsx (nome pode mudar, link permanece) | | Planilha de Contratos | BR\_AREP\_S01\_CONTROLE\_DE\_CONTRATOS.xlsb | BR\_AREP\_S01\_REUNION\_CONTROLE\_DE\_CONTRATOS.xlsb | BR\_SMTC\_S02\_CONTROLE\_DE\_CONTRATOS.xlsb |

| Papel | Produção | Homologação |
| :---- | :---- | :---- |
| Danielle | [financeiro@novorealitybox.com](mailto:financeiro@novorealitybox.com) | [dinhoolhosazuis@gmail.com](mailto:dinhoolhosazuis@gmail.com) |
| Vanessa | [executiva@novorealitybox.com](mailto:executiva@novorealitybox.com) | [grandesnegocioseoportunidades@gmail.com](mailto:grandesnegocioseoportunidades@gmail.com) |

## 7\. Arquitetura técnica

### 7.1 Decisão

Tudo roda em nuvem, dentro do próprio n8n — sem script separado rodando por fora (cron), e sem depender de nenhuma máquina/notebook ligado.

- Orquestração: n8n Community Edition (self-hosted, gratuito), com nodes nativos de Box, Google Drive e Gmail.  
- Regras determinísticas (datas, zero-padding, contagem de 30 notas): node de Code do n8n, roda dentro da execução do workflow.  
- Extração de dados do PDF/imagem da nota fiscal: node de IA do n8n chamando a API da Claude com o anexo, devolvendo os dados em JSON.  
- Hospedagem: instância e2-micro do Google Cloud Free Tier (gratuita para sempre, região EUA), rodando o n8n 24/7 sem custo nem dependência de notebook.  
- Erros: "Error Workflow" nativo do n8n — qualquer falha dispara aviso automático no Telegram.

### 7.2 Trava de arquivo no Box (evitar sobrescrita)

A API do Box permite consultar e travar/destravar um arquivo, impedindo que outra pessoa suba uma nova versão por cima enquanto a automação trabalha.

- Antes de editar: consultar se está travado; se estiver, adiar para a próxima execução.  
- Se livre: travar → baixar → editar → subir a nova versão → destravar.  
- Tratamento de erro obrigatório: destravar sempre, mesmo em falha no meio do processo. PENDENTE: Confirmar com teste real, na implementação, se o campo "lock" da API reflete também o indicador de coautoria do Excel Online, ou só o lock manual do Box.

### 7.3 Notificações — bot do Telegram

- Pendências/bloqueios: contrato não assinado, dado bancário/Pix faltando, remetente não identificado, dado ilegível.  
- Alertas de cobrança disparada automaticamente.  
- Relatório ao final de cada execução: rascunhos criados/atualizados, notas processadas, itens pendentes de revisão manual.

### 7.4 Ambiente de homologação

Um perfil extra ("homolog") usa os e-mails de teste do Claudio no lugar dos destinatários reais. Enquanto o ambiente de produção mantiver os e-mails em rascunho, essa é a política padrão — nada é enviado automaticamente sem revisão humana.

## 8\. Acessos validados

| Item | Status |
| :---- | :---- |
| Gmail ([financeiro1@novorealitybox.com](mailto:financeiro1@novorealitybox.com)) | Validado — marcadores e modelos conferidos |
| Box — Cost Report S01 | Validado — arquivo e estrutura conferidos |
| Box — Cost Report S02 | Validado — nome "PROVISÓRIO", link permanece o mesmo |
| Google Drive S01 (Reunion) | Validado por acesso direto |
| Google Drive S02 (Soft Pré) | Validado por prints — acesso direto ainda pendente (ver seção 9\) |
| Planilhas de Controle de Contratos | Validadas (AREP, Reunion e Soft Pré) |

## 9\. Pendências e itens em aberto

PENDENTE: Confirmar com teste real, na implementação, se o campo "lock" da API do Box reflete também o indicador de coautoria do Excel Online, ou só o lock manual. PENDENTE: Escopo de Recibos de Reembolso (RDP'S) — fora desta automação por enquanto, será tratado numa etapa futura separada.

## 10\. Regras resolvidas nesta rodada

- Identificar de qual colaborador é uma nota quando o remetente do e-mail não é óbvio (Fase 2): abrir a nota fiscal em anexo, extrair dela o nome do colaborador, a razão social e o projeto (Ref.), e usar essas informações para localizar a linha correspondente na aba Notas.  
- Cruzamento entre a aba Notas e as planilhas de Contratos (Razão Social / nome do colaborador): comparar ignorando diferença de maiúsculas/minúsculas e espaços a mais ou a menos — não precisa de comparação fonética/aproximada mais complexa.  
- Acesso ao Drive S02 via conector: será testado ao vivo durante a montagem do n8n, quando a própria Michelle autenticar — não é mais tratado como bloqueio.  
- Fase 4 (Arquivamento): revalidada e fundida com a Fase 3 (seção 5.3) — acontecem em paralelo, com estrutura de pastas e nomenclatura confirmadas por prints reais dos Drives S01 e S02.  
- Estrutura completa de pastas por função: confirmada por prints reais (não é mais uma lista a levantar do zero — os padrões "\[código\] \- \[CARGO\]" e "\[código\].R \- \[CARGO\]" já estão documentados na seção 5.3).  
- Detalhamento de PACOTE e REC \+ NF: esclarecido — PACOTE é caso raro específico do AREP; REC \+ NF ocorre em locação, sobretudo com fornecedores, por motivo fiscal (nunca usar "serviço prestado" nesses casos).  
- Numeração de remessa no Status Box interno: confirmada — "ENTREGUE MI" (1ª a 30ª nota daquele vencimento), "ENTREGUE MI R1" (31ª a 60ª), "ENTREGUE MI R2" (61ª a 90ª), contando por pasta de vencimento.

## 11\. Checklist de próximos passos

| \# | Ação | Responsável |
| :---- | :---- | :---- |
| 1 | Criar conta no Google Cloud e provisionar a instância e2-micro (Always Free) | Claudio |
| 2 | Instalar n8n Community Edition na instância | Claudio \+ Claude Code |
| 3 | Criar o bot no Telegram via @BotFather e a Michelle enviar a primeira mensagem a ele — CONCLUÍDO | Michelle |
| 4 | Configurar credenciais OAuth no n8n: Gmail, Google Drive e Box (login da própria Michelle) | Michelle \+ Claudio |
| 5 | Claude Code monta os workflows completos (JSON) das 4 fases \+ perfis de projeto | Claude Code |
| 6 | Importar os workflows no n8n e validar em ambiente de homologação | Claudio |
| 7 | Resolver as pendências da seção 9 antes de cada fase entrar em produção | Claudio \+ Michelle |

## 13\. Rollback e controle de versão

### 13.1 Git

Sem o recurso pago de Git integrado do n8n (Business plan). Controle de versão feito manualmente: workflows exportados como JSON e commitados no repositório Git do projeto (GitHub, privado). Estrutura do repositório:

- /workflows/  \-\> JSON exportado de cada workflow do n8n (um por fase \+ um de rollback)  
- /profiles/   \-\> config de cada projeto (Reunion, Soft Pré, AREP) em JSON/YAML  
- /docs/       \-\> este documento (spec.md)  
- /scripts/    \-\> lógica mais longa usada em nós de Code Nenhuma credencial (token do Telegram, senha, chave de API) deve ir para o Git — essas ficam só dentro do n8n (credenciais/variáveis de ambiente).

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

