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
| 2. Recebimento e validação | Monitora respostas com NF anexada, extrai dados, atualiza planilha, salva a nota no pouso pessoal da Michelle E no arquivamento por função — os dois salvamentos acontecem aqui, em paralelo (seção 4.2) | n8n + IA (extração de PDF) |
| 3. Remessa para o Danilo + 4. Arquivamento da remessa | Agrupa recebidas em lotes por janela de tempo (seção 5.0), formata cópia da planilha, sobe no Drive na pasta de Contas a Pagar, monta e-mail — tudo em paralelo, na mesma execução. O arquivamento POR FUNÇÃO (08. NOTAS ARQUIVADAS) NÃO está mais aqui — foi antecipado pra Fase 2 (seção 4.2), pois a Michelle confirmou que pode ser feito assim que a nota é recebida/validada, sem esperar a remessa ao Danilo. | n8n + IA (formatação) |

As Fases 3 e 4 acontecem juntas, não uma depois da outra — confirmado por Claudio: no momento em que o e-mail do Danilo é preparado, a nota já foi arquivada (na Fase 2, por função) e a pasta de remessa/Contas a Pagar é montada em paralelo à entrega.

**IMPORTANTE — dois arquivamentos DIFERENTES, não confundir (detalhado na seção 4.2):**
- **Arquivamento por função** (`FINANCEIRO > 08. NOTAS ARQUIVADAS > ARQUIVO DE NOTAS [PROJETO] > [código] - [CARGO]`): roda na Fase 2, assim que a nota é baixada e validada.
- **Arquivamento da remessa/Danilo** (`09. CONTAS À PAGAR` / `11. CONTAS À PAGAR - [PROJETO]`, pasta de remessa com sufixo "_MI"): continua na Fase 3+4, só no momento da entrega.

## 3. Fase 1 — Solicitação de nota ao colaborador

### 3.1 Passo a passo
- 1º Verificar Status do Contrato (coluna N da aba Notas). Essa checagem vale IGUALMENTE para os dois gatilhos abaixo ("PROGRAMAR ATÉ" e "SOLICITAR") — não é mais exclusiva do primeiro.
  - Se a coluna N contém "ASSINADO" (ex.: "OK - Assinado"): segue o fluxo normal de solicitação.
  - Se a coluna N contém "PENDENTE" ou está vazia/"N/A": NÃO pula mais direto — tenta resolver ativamente. Aplica o marcador de e-mail "CONTRATAÇÃO" (seção 3.1.2) e busca no Gmail, pelo nome do colaborador, se já existe uma thread de "ficha cadastral" preenchida e enviada.
    - Se encontrar e validar a ficha cadastral enviada: segue o fluxo normal de solicitação E atualiza a coluna N (Status do Contrato) para "OK - ASSINADO".
    - Se não encontrar/validar: não dispara o e-mail de pedido (linha fica pendente, sem alteração na coluna N).
  - Busca de ficha cadastral SEM IA (decisão deliberada), com critério CORRIGIDO: a checagem é feita por regra determinística no Gmail — mas o sinal de validação NÃO é "existe um anexo de ficha cadastral na thread" (isso pode ser só o modelo em branco que foi enviado ao colaborador no pedido). O sinal correto é: o colaborador (ou representante dele) RESPONDEU na thread marcada "CONTRATAÇÃO" enviando de volta a documentação — ou seja, existe uma mensagem NA THREAD cujo remetente é de FORA do domínio da empresa (o colaborador/representante, não a Michelle/equipe) e que contém pelo menos 1 anexo. Exemplo real confirmado: thread com marcador "CONTRATAÇÃO" onde a Michelle/equipe manda o pedido com o modelo de ficha, e o colaborador (ou representante, de e-mail pessoal) responde na mesma thread anexando contrato social, alterações contratuais etc. — essa resposta é o que conta como "documentação enviada", não o anexo do pedido original. Essa busca específica não usa a API da Claude, porque já é um padrão bem definido (remetente + anexo) que uma regra fixa resolve sem ambiguidade — mais barata, previsível e fácil de auditar do que uma chamada de IA. Isso NÃO significa que a Fase 1 inteira seja sem IA: a Fase 1 usa IA em outros pontos (parsing da coluna J — seção 3.2, e identificação de linha REC/NF — seção 3.2.1); só esta checagem específica de ficha cadastral que continua determinística.
    - **Bug corrigido (27/08) — a busca de ficha cadastral deve usar o nome já extraído pela IA, não tentar adivinhar por posição no split da coluna J**: o formato da coluna J varia (ex.: "CARGO - PROJETO - NOME" vs. "CARGO - NOME - PERÍODO (...) - PROJETO"), então qualquer heurística baseada em índice fixo do split (ex.: sempre pegar o 2º campo) vai falhar em algum formato — foi o que aconteceu na linha "CAMAREIRA APRESENTADORA - REUNION - MARIA ISOLINA...", que devolveu "REUNION" (nome do projeto) em vez do nome da colaboradora. **Decisão de Claudio: não criar uma nova heurística de split — usar o `nomeColaborador` que a IA já extrai corretamente para essa mesma linha (seção 3.2)**, mesmo que isso exija reordenar a execução (a busca de ficha cadastral roda hoje em paralelo com a checagem de contrato, seção 3.1, ANTES do parsing da IA — precisa passar a rodar depois, ou a IA precisa ser chamada mais cedo só para essa extração). O objetivo é usar a mesma "inteligência" que já resolve esse problema em outro ponto do fluxo, em vez de duplicar a lógica com uma regra determinística que pode quebrar de novo com um formato de coluna J ainda não visto.
  - IMPORTANTE — a escrita na coluna N (Status do Contrato) NÃO é bloqueada pelo `MODO_EXECUCAO` (seção 3.1.3): mesmo em modo "rascunho", se o agente encontrar e validar a ficha cadastral, a coluna N é atualizada para "OK - ASSINADO" normalmente. O gate de `MODO_EXECUCAO` (rascunho vs. automático) vale SOMENTE para a coluna L (Status Box) e para o disparo do e-mail (rascunho vs. envio direto) — nunca para a coluna N. Motivo: a coluna N é um dado de cadastro que precisa estar correto para o e-mail de pedido sair com o Ref./assunto certo, e o rascunho só pode ser revisado pela Michelle se já tiver essa informação resolvida; diferente da coluna L, que fica manual no MVP justamente porque mudar o Status Box antes do e-mail realmente ser enviado confundiria quem acompanha a planilha (ex.: a Danielle vendo "SOLICITADA MI" e procurando um e-mail que ainda não foi disparado).
  - **Cruzamento com a planilha de Controle de Contratos (checagem secundária, formalizada nesta rodada)**: as 3 planilhas de Contratos (`.xlsb`, seção 6) são de propriedade da diretoria de Contratos — a automação só tem acesso de LEITURA, nunca pode alterar estrutura nem excluir/ignorar abas por conta própria. A aba correta a ler é **"EQUIPE E E FORNECEDORES"** (não outras abas do arquivo, como "CANCELADOS_DISTRATOS" — a busca já fica restrita a essa aba certa, então as demais abas nunca entram na leitura). Cabeçalho na linha 3; colunas localizadas pelo NOME do cabeçalho (não por posição fixa), pois o layout varia entre projetos.
    - **Critério de liberação — só o valor literal "ASSINADO" na coluna de status**: se a coluna STATUS contiver exatamente "ASSINADO" → preenche a coluna N do Cost Report como "OK - ASSINADO". Qualquer outro valor (incluindo variantes ambíguas como "E A dd/mm", vazio, "AGUARDANDO ASSINATURA DO CONTRATO" etc.) → NÃO preenche nada na coluna N (deixa como está — lado seguro, cai na busca de ficha cadastral se for o caso).
    - Essa aba também tem uma legenda de cores (linha 3, coluna F) indicando o estágio do contrato (amarelo = em preparação, verde = assinado pela contratada, roxo = assinado por todas as partes, azul marinho = assinado e arquivado, etc.) — não faz parte do critério de liberação hoje (que usa só o texto "ASSINADO"), registrado aqui como referência caso a regra precise refinar por cor no futuro.
    - **Correspondência de nome — tolerante a variações de grafia, não exigir igualdade exata de string (decisão de 27/08, corrige bug real da execução 108)**: comparar o nome do Cost Report contra os nomes da planilha de Contratos usando as seguintes prioridades, na ordem:
      1. **Documento (CPF/CNPJ) quando disponível nos dois lados**: se a coluna H do Cost Report e a coluna correspondente da planilha de Contratos trazem um número de documento antes/junto do nome (ex. "56.240.209 ELIANA AMRAL JORGE"), comparar SÓ os dígitos do documento. Se baterem, é confirmação definitiva (documento identifica a pessoa de forma única, nome não) — libera imediatamente, mesmo que os nomes estejam grafados de forma diferente.
      2. **Nome com tolerância, quando não houver documento em algum dos lados**: normalizar os dois nomes (maiúsculas, sem acento, espaços múltiplos colapsados, sem espaço nas pontas) e comparar por token: o PRIMEIRO e o ÚLTIMO token (primeiro nome e último sobrenome) devem bater exatamente ou com distância de edição de até 1 caractere (cobre typo de uma letra a mais/a menos/trocada). Nomes do meio podem estar ausentes, extras ou diferentes SEM impedir o match — desde que primeiro e último token confirmem. Exemplo: "ELIANA AMRAL JORGE" casa com "ELIANA AMARAL JORGE" (só 1 letra de diferença no meio); "GUILHERME BRUM" casa com "GUILHERME RODRIGUES BRUM" (primeiro e último batem, nome do meio ausente no Cost Report).
      3. **Ambiguidade — mais de um candidato na planilha de Contratos bate com o mesmo critério de tolerância**: NÃO liberar automaticamente. Exemplo real: "GUILHERME BRUM" teria tolerância suficiente para ecoar em "GUILHERME HENRIQUE PORTES SIQUEIRA" e "BRUNA GUILHERME COUTO" se a regra fosse frouxa demais — mas a regra do item 2 (exigir primeiro E último token) já exclui esses dois automaticamente (SIQUEIRA ≠ BRUM, BRUNA ≠ GUILHERME), então ambiguidade real deve ser rara. Se mesmo assim ocorrer (dois ou mais candidatos batendo igualmente), tratar como não confirmado e cair no alerta de "SOLICITAR pendente de contrato" (mesma seção), incluindo na mensagem os nomes candidatos e o motivo da ambiguidade, para a Michelle decidir manualmente.
      4. **Nenhum candidato bate**: comportamento inalterado — linha permanece pendente, sem liberar.
      Contexto da decisão: como a Danielle só insere uma linha na planilha Cost quando já há pelo menos processo de contratação em andamento, a maioria das linhas "SOLICITAR" já tem (ou está prestes a ter) contrato assinado — por isso vale um match mais inteligente em vez de puramente exato, desde que a ambiguidade real continue caindo para revisão manual em vez de arriscar liberar a pessoa errada.
  - **ORDEM entre as duas checagens (Contratos vs. ficha cadastral no Gmail) — rodam em PARALELO, sem prioridade entre si**: não há uma checagem "primeiro" e outra "de fallback". As duas fontes são consultadas ao mesmo tempo, e a **primeira que retornar confirmação positiva** (seja o cruzamento com a planilha de Contratos encontrando "ASSINADO", seja a busca no Gmail encontrando a ficha cadastral respondida) já libera o fluxo — preenche a coluna N como "OK - ASSINADO" e segue para a criação do e-mail. Não é necessário esperar as duas terminarem nem tentar uma antes da outra.
- 2º Filtrar Status Box = "PROGRAMAR ATÉ [data]" (texto exato). Se a checagem de contrato acima liberar → monta e programa o e-mail de pedido, informando prazo de envio até data+5 dias, e deixa em RASCUNHO no Gmail (modo MVP) ou envia direto (modo automático — ver seção 3.1.3). Status Box deste passo: ver regra de MVP abaixo.
- 3º Filtrar Status Box = "SOLICITAR"/"SOLICITAR URG"/qualquer variante de "SOLICITAR". Mesma checagem de contrato do passo 1º se aplica aqui também. Se liberar → monta e-mail para envio imediato (RASCUNHO no MVP, envio direto no modo automático). Mesma regra de Status Box. Dentro dessas variantes existe uma escala de urgência que define ordem de processamento, prefixo do assunto e comportamento de envio — detalhada na seção 3.1.4.
  - **Alerta obrigatório quando "SOLICITAR" fica pendente de contrato**: diferente de "PROGRAMAR ATÉ" (que tem prazo, não precisa de alerta imediato), o Status Box "SOLICITAR" (em qualquer variante/escala) indica um pedido URGENTE feito pela Danielle (Controller) para a Michelle agir imediatamente. Se a checagem de contrato do passo 1º não conseguir confirmar "ASSINADO" (nenhuma das duas fontes libera) para uma linha "SOLICITAR", a automação envia um alerta via Telegram para a Michelle avisando que existe(m) linha(s) "SOLICITAR" pendente(s) de contrato que NÃO tiveram e-mail disparado nesta execução — para que ela saiba agir manualmente, em vez de descobrir isso só ao checar a planilha por conta própria. *(Adicionado em 27/08 — Claudio explicou que a planilha nasce das inserções da Danielle, e a Michelle monitora esses status; sem esse alerta, ela não teria como saber que uma solicitação urgente ficou parada sem investigar a planilha inteira.)*
- Quando o colaborador enviar a NF (pela thread original ou por e-mail avulso identificado — seção 4): Status Box = "RECEBIDA MI" + preenchimento das demais colunas correspondentes. Esta atualização é SEMPRE automática, inclusive no MVP.

### 3.1.1 Monitoramento e cobrança (a partir do dia "PROGRAMAR ATÉ")
- No próprio dia do prazo, monitorar e-mails o dia todo: a thread original E qualquer e-mail avulso com NF em anexo (ver seção 4 — identificação fora da thread).
- Se identificar a nota correspondente: segue fluxo normal (Status Box = "RECEBIDA MI").
- Se não identificar até o fim do dia: agendar e-mail de cobrança pela MESMA thread para o dia seguinte (RASCUNHO no MVP, envio direto no modo automático).
- Repetir a cobrança a cada 5 dias, até aproximadamente 5 dias antes do vencimento da NF (tolerância de alguns dias para mais ou menos é aceitável — não precisa ser exato). Isso funciona porque o ciclo do mês seguinte já abre uma thread nova.
- Exemplo: Status Box = "PROGRAMAR ATÉ 20/08" e vencimento da NF em 10/09 → monitorar/cobrar a cada 5 dias entre 20/08 e ~05/09.
- Se chegar ao fim desse ciclo sem resposta: alertar a Michelle via Telegram e ENCERRAR o fluxo automático para aquela nota — nenhuma cobrança adicional é enviada. Ação manual fica a critério da Michelle (é comum o colaborador mandar a NF com valor duplicado no ciclo do mês seguinte).
- Armazenamento do controle de cobrança (data da última cobrança + contagem): NÃO fica na planilha (editada por terceiros, seria frágil). Fica num arquivo `cobrancas.json` no disco da VM do n8n, lido/escrito pelos nodes nativos de arquivo do n8n (não precisa de configuração extra de infra, diferente do exceljs) — uma entrada por nota, com data da última cobrança e contagem de ciclos.

Estrutura de `cobrancas.json` (uma entrada por nota, chave real usada pela implementação = projeto + linha, ex. `REUNION_S01_L71` — não "projeto + colaborador + vencimento" como versões anteriores deste spec sugeriam; a chave por linha é a correta porque distingue duas linhas do mesmo fornecedor/vencimento, caso do agrupamento REC+NF da seção 3.2.1):
```json
{
  "<chave_da_nota>": {
    "threadId": "<id da thread do Gmail — usado pela Fase 2 para monitorar respostas>",
    "data_ultima_cobranca": "<data ISO>",
    "contagem_cobrancas": <número inteiro>,
    "status_ciclo": "em_andamento" | "encerrado_sem_resposta" | "recebido"
  }
}
```
O `threadId` é gravado assim que o e-mail de pedido é criado (rascunho ou enviado) — é o dado que a Fase 2 vai usar para saber em qual thread monitorar a resposta do colaborador, sem precisar buscar por texto toda vez.
- Inicialização dos arquivos JSON (`cobrancas.json`, `apelidos.json`, `config_execucao.json`): a entrega da Fase 1 inclui esses 3 arquivos já criados com valores iniciais sensatos, para a primeira execução funcionar sem passo manual extra — `config_execucao.json` iniciando em `"rascunho"`, `apelidos.json` com o apelido atual de cada um dos 3 projetos (AREP, Reunion, Soft Pré/PNS), `cobrancas.json` vazio. Os workflows de comando via Telegram (`/modo`, `/apelido`) para escrever nesses arquivos depois de criados ficam para uma entrega separada — não fazem parte do escopo desta Fase 1.

### 3.1.2 Marcadores de e-mail (labels do Gmail)
Toda interação da automação com e-mail deve aplicar o marcador **"IA"** (já criado por Claudio no Gmail) + o marcador do projeto/contexto correspondente, para a Michelle conseguir identificar visualmente o que já foi feito pela automação e conferir o processo:
- Criar e-mail de pedido/cobrança de NF ao colaborador → marcador "IA" + marcador do projeto (ver tabela abaixo).
- Receber NF fora da thread original, após identificar o projeto → marcador "IA" + marcador do projeto.
- Criar e-mail de entrega de NF para o Danilo → marcador "IA" + "DANILO FINANCEIRO".
- Buscar/validar ficha cadastral quando o Status do Contrato está "Pendente"/vazio (seção 3.1) → marcador "CONTRATAÇÃO".

| Projeto | Marcador |
|---|---|
| Reunion | REUNION - PEDIDO DE NOTAS |
| Soft Pré | SOFT PRE - PEDIDO NOTAS |
| AREP | AREP - PEDIDO DE NOTAS |
| Entrega ao Danilo (qualquer projeto) | DANILO FINANCEIRO |
| Validação de ficha cadastral (contrato pendente/vazio) | CONTRATAÇÃO |

### 3.1.3 MVP — Status Box manual vs. automático, e modo de execução
Nesta 1ª fase de MVP (testando o fluxo e conferindo cenários, alinhado com a Michelle em reunião), o Status Box de dois pontos específicos NÃO deve ser alterado automaticamente — fica com a Michelle mudar manualmente, enquanto os e-mails estiverem em rascunho:
- E-mail inicial de pedido/cobrança de NF ao colaborador → alteração do Status Box é MANUAL (Michelle).
- E-mail de entrega de NF ao Danilo → alteração do Status Box é MANUAL (Michelle).
- Recebimento de NF (thread ou avulso, quando o colaborador é identificado) → Status Box = "RECEBIDA MI" continua AUTOMÁTICO, mesmo no MVP.

Só depois que o fluxo for validado e aprovado para rodar 100% automatizado é que os dois pontos acima passam a ser automáticos também.

Nova variável de ambiente **`MODO_EXECUCAO`**, além das já existentes de homologação/produção:
- `"rascunho"` (padrão do MVP atual): e-mails ficam em RASCUNHO no Gmail; Status Box dos pontos acima é manual.
- `"automatico"`: quando Status Box = "SOLICITAR"/"SOLICITAR URG"/variantes → envia o e-mail direto (sem rascunho); quando Status Box = "PROGRAMAR ATÉ [data]" → programa a data de disparo do e-mail em vez de deixar em rascunho; Status Box dos pontos acima passa a ser 100% automático.
- Alterável via comando no Telegram (ex.: `/modo automatico`), do mesmo jeito que o comando de apelidos (seção 6.1).

### 3.1.6 Deduplicação do pedido em produção (evitar rascunho/envio repetido para a mesma linha)
Enquanto o Status Box de uma linha permanecer "SOLICITAR" (porque a Michelle ainda não o atualizou manualmente, seção 3.1.3), a linha continua batendo no filtro a cada execução. Em `MODO_EXECUCAO = automatico` e ambiente `produção`, isso não pode gerar um novo e-mail duplicado a cada execução para o mesmo colaborador/período.
- Antes de criar o e-mail de pedido, checar se já existe uma entrada em `cobrancas.json` para aquela chave (projeto + linha, seção 3.1.1) com `threadId` já preenchido — se existir, a linha já teve um pedido criado antes; pular a criação de um novo e-mail para ela nesta execução (ela pode voltar a ser considerada pela lógica de monitoramento/cobrança da seção 3.1.1, se for o caso, mas não gera um pedido novo).
- Esta regra vale apenas para `ambiente = produção`. Em `homolog`, não é necessária — Claudio controla manualmente quais linhas processar mudando o Status Box na planilha de teste conforme quiser gerar novos rascunhos.

### 3.1.7 Destinatários e cópia (To/CC) por ambiente
O e-mail de pedido de nota (seção 3.1, passo 3º) sempre leva um destinatário principal (colaborador) e uma cópia (controller), variando por ambiente:

**Homologação**: destinatário = `grandesnegocioseoportunidades+colaborador@gmail.com` (fixo, independe de quem é o colaborador real da linha); cópia (CC) = `grandesnegocioseoportunidades+danielle@gmail.com`.

**Produção**: destinatário = e-mail do colaborador real (coluna R da planilha Cost); cópia (CC) = `financeiro@novorealitybox.com` (Danielle/Controller).

Tabela De-Para completa dos papéis envolvidos no processo (referência para outros pontos do sistema que também endereçam essas pessoas — cobrança, alertas, etc.):

| Papel | Pessoa | E-mail homologação | E-mail produção |
|---|---|---|---|
| Assistente de Controller | Michelle | `imperialdiamondlead@gmail.com` | `financeiro1@novorealitybox.com` |
| Controller | Danielle | `grandesnegocioseoportunidades+danielle@gmail.com` | `financeiro@novorealitybox.com` |
| Assistente Executiva | Bruna | `grandesnegocioseoportunidades+bruna@gmail.com` | `assistente.executiva@novorealitybox.com` |
| Coordenadora Executiva | Vanessa | `grandesnegocioseoportunidades+vanessa@gmail.com` | `executiva@novorealitybox.com` |
| Financeiro | Danilo | `grandesnegocioseoportunidades+danilo@gmail.com` | `dgneris@boxfishtv.com` |

### 3.1.4 Escala de urgência dentro de "SOLICITAR" (Status Box)
O texto do Status Box (coluna L) para o filtro "SOLICITAR" (passo 3º, seção 3.1) varia — confirmado por Claudio, exemplos reais já vistos: `SOLICITAR URG`, `SOLICITAR MI`, `SOLICITAR`, `SOLICITAR / AGUARDAR DOCS`, entre outros. Cada variante corresponde a um nível de urgência numa escala de 0 (mais urgente) a 5 (menos urgente, mas ainda mais urgente que `PROGRAMAR ATÉ`):

| Status Box | Escala | Prefixo no assunto | Comportamento de envio |
|---|---|---|---|
| `SOLICITAR URG` | 0 (máxima) | `URG \|` no início do assunto (seção 3.5) | Processado PRIMEIRO dentro da categoria SOLICITAR. Em modo automático, enviado direto. |
| `SOLICITAR` ou `SOLICITAR <qualquer outro sufixo>` (exceto os dois casos acima/abaixo) | 1 | Nenhum | Processado logo após os de escala 0. Em modo automático, enviado direto. |
| `SOLICITAR / AGUARDAR DOCS` | 5 | Nenhum | Processado por último dentro da categoria SOLICITAR. O e-mail SEMPRE fica em rascunho — mesmo em `MODO_EXECUCAO = automatico` e ambiente `produção` (única exceção à regra da seção 3.1.3/7.4). A Michelle envia manualmente. |

Dentro da categoria de prioridade 1 ("SOLICITAR", seção 7.4), a ordem de processamento segue esta escala (0 → 1 → 5), antes de passar para a categoria 2 ("PROGRAMAR ATÉ"). **Correção (25/08) — quem decide rascunho vs. envio direto é sempre o `MODO_EXECUCAO` (seção 3.1.3/7.4), igualmente nos ambientes `homolog` e `produção`**: `homolog + automatico` também envia de verdade (para os destinatários fake de homolog) — é justamente esse o propósito dessa combinação (testar o ciclo completo de envio automático com segurança, seção 7.4). O "sempre rascunho" desta seção é uma regra exclusiva da escala 5 (`SOLICITAR / AGUARDAR DOCS`), não uma regra de ambiente — não se aplica às escalas 0 e 1.

O Status Box `SOLICITADA MI` (seção 3.1.1) não faz parte desta escala — é um valor de outra natureza (marca que a solicitação já foi feita, usado no monitoramento de cobrança), e continua sujeito à regra manual da seção 3.1.3 enquanto a automação não for autorizada a escrevê-lo automaticamente.

### 3.1.5 Confirmação pós-escrita (segurança contra escrita na aba/linha/coluna errada)
Toda escrita feita pela automação na planilha Cost (coluna N — Status do Contrato, seção 3.1; e qualquer outra escrita futura nas demais fases) passa por DUAS camadas de verificação, complementares, antes de prosseguir para o próximo passo (ex.: antes de criar o e-mail):
- **Camada 1 — em memória, logo após escrever, antes do upload**: reler a célula recém-escrita no workbook em memória (mesma aba "Notas", mesma linha, mesma coluna) e comparar com o valor esperado. Pega erros de aba/linha/coluna errada antes de subir o arquivo.
- **Camada 2 — no arquivo salvo, após o upload**: reler o arquivo já persistido (Drive ou Box) e confirmar que o valor está lá. Pega falhas que a camada 1 não alcança (upload que não persistiu, arquivo sobrescrito no meio do caminho, etc.) — "verificar o efeito real após a escrita" só é garantido nesta camada.
- **Se qualquer uma das duas camadas encontrar divergência**: como a escrita é uma única operação no arquivo cobrindo todas as linhas da execução, uma divergência torna o arquivo salvo não confiável como um todo — a automação ABORTA A EXECUÇÃO INTEIRA (não só a linha divergente), não cria nenhum e-mail, e envia alerta via Telegram descrevendo célula, valor esperado e valor encontrado para cada divergência.
Esta é uma camada de segurança independente da causa do erro: ela não depende de prever todos os cenários possíveis de bug — verifica o efeito real após cada escrita, então continua protegendo mesmo diante de um cenário não mapeado em homologação.

**Duas escritas distintas, duas posições distintas no fluxo — não confundir:**
- **Coluna N (Status do Contrato)**: escrita ANTES da criação do e-mail, com as duas camadas de verificação acima. É pré-requisito para o e-mail sair com o Ref./assunto corretos (seção 3.1).
- **Coluna L (Status Box, ex. "SOLICITADA MI")**: escrita **SOMENTE DEPOIS** do envio do e-mail ser confirmado com sucesso (em `MODO_EXECUCAO = automatico`). NUNCA antes. Se a coluna L fosse escrita antes e o envio falhasse depois, a planilha afirmaria que a nota foi solicitada sem que nenhum e-mail tenha realmente saído — confundindo quem acompanha a planilha (ex.: alguém vendo "SOLICITADA MI" e procurando um e-mail que nunca foi disparado). Esta regra já existia na seção 3.1 antes da 3.1.5 e continua valendo integralmente: a reordenação da gravação para antes do e-mail (motivada pela 3.1.5) se aplica apenas à coluna N, nunca à coluna L.


Usar apenas as colunas: G (Vencimento), H (Fornecedor), J (Descrição), K (Valor a pagar), L (Status Box), R (E-mail do colaborador).
A coluna J se separa em 3 partes: [CARGO] - [NOME DO COLABORADOR] - [DE "DATA" A "DATA"]. O nome vem daqui; se não achar, cai para a coluna H (Fornecedor).

**CORREÇÃO IMPORTANTE — esta etapa USA IA (API da Claude), não é 100% determinística.** A tentativa anterior de resolver isso só com regex (posição dos blocos) não é suficiente: nomes de cargo (ex.: "AGENCIAMENTO DE FIGURAÇÃO") e nomes de colaborador (ex.: "LARISSA CRISTIANE DO AMARAL GOMES") não têm um padrão de formato que os diferencie — só o conteúdo semântico do texto permite distinguir um do outro. Por isso, a IA é usada para interpretar o texto da coluna J e:
1. Localizar o Período (padrão de data, ex.: "DD/MM A DD/MM").
2. Localizar a palavra-chave de tipo de emissão, se houver, em qualquer posição do texto: **JOB, DIÁRIA/DIÁRIAS, PACOTE, REC, REC+NF**. No corpo do e-mail, ela SEMPRE aparece entre parênteses logo após o período (ex.: "Período de 25/08 A 27/08 (JOB)"). Ausência de palavra-chave = NF normal (não escreve nada entre parênteses).
3. Dos blocos restantes (excluindo data e a palavra-chave de tipo): identificar semanticamente qual é o Cargo e qual é o Nome do colaborador (não por posição fixa — casos como "AGENCIAMENTO DE FIGURAÇÃO" mostram que a ordem pode não ser confiável).
4. Reconhecer e REMOVER do texto qualquer menção ao nome do projeto (REUNION, AREP, SOFT PRE, PNS/PNL etc.) antes de montar o corpo do e-mail — esse nome não deve ser replicado no corpo, pois já aparece no assunto.
5. Se a coluna J não tiver informação suficiente pra preencher Cargo e/ou Nome do colaborador com confiança: marca a lacuna como **"FALTA INFORMAÇÃO"** no campo correspondente do corpo (Serviço Prestado como / Colaborador), monta o e-mail mesmo assim, e envia um alerta via Telegram para a Michelle avisando que existe e-mail em rascunho (ou já enviado, no modo automático) com dado faltante no corpo — ela interage manualmente depois. Vale tanto para modo rascunho quanto automático.
6. **Cargo sem numeração**: ao extrair o Cargo da coluna J, remover qualquer numeração ao final (ex.: "ASS. DE CONTROLLER 1" → "ASS. DE CONTROLLER"; "CONTRARREGRA 1", "CONTRARREGRA 2" → "CONTRARREGRA"), independentemente de como o número aparece na planilha Cost — vale para qualquer cargo, sem exceção. O número na planilha é só um identificador interno de controle (ex. distinguir múltiplos colaboradores no mesmo cargo), não faz parte do nome do cargo e nunca deve aparecer no corpo do e-mail. *(Adicionado em 26/08 — encontrado um caso real com "ASS. DE CONTROLLER 1" vazando pro e-mail.)*
6. **Regra geral de segurança**: sempre que a IA encontrar uma situação que não está mapeada nesta especificação, ela NUNCA pode inventar ou adivinhar um valor. Para o processamento daquela linha, envia um alerta via Telegram para a Michelle descrevendo o ponto de indecisão, onde foi encontrado (projeto/linha da planilha) e o que já foi feito até ali — ela resolve manualmente.

| Tipo | Quando usar | Assunto |
|---|---|---|
| NF normal | Cachê mensal | REF. [MÊS ABREV. 3 LETRAS] |
| JOB | Período pontual de job | REF. JOB (com parcela "P.X/Y" se houver) |
| DIÁRIA | Diária avulsa | REF. DIÁRIA |
| PACOTE | Caso raro e específico do AREP (diárias agrupadas em pacote fechado); não deve se repetir fora do AREP | REF. PACOTE (sem mês) |
| REC | Recibo/Fatura puro — locação (equipamento, estúdio, gerador etc.), nunca "serviço prestado" (recibo/fatura é o documento correto para locação, questão fiscal) | "[retranca] \| EMISSÃO DE RECIBO (ou FATURA — a palavra varia, tanto faz) \| REF. LOCAÇÃO - [MÊS] (ou "- P.X/Y" se for locação parcelada) \| (ENVIAR ATÉ DD.MM) \| [FORNECEDOR]" — NUNCA leva "E SERVIÇOS" no Ref. |
| REC + NF | Fornecedor que fatura em parte recibo (locação) + parte nota fiscal (serviço) — corpo do e-mail numerado 1, 2 (e mais, se houver mais linhas), um bloco pra cada documento (seção 3.2.1) | "[retranca] \| EMISSÃO DE FATURA \| REF. LOCAÇÃO E SERVIÇOS - [MÊS] \| (ENVIAR ATÉ DD.MM) \| [FORNECEDOR]" — SEMPRE usa a palavra "FATURA" (nunca "RECIBO" sozinho) e SEMPRE leva "E SERVIÇOS" no Ref. |
| COLABORADOR, 2 PERÍODOS, MESMO VENCIMENTO (novo, 27/08) | Mesmo colaborador com duas linhas na planilha para o MESMO vencimento, mas referentes a MESES DIFERENTES (ex.: fim de julho + agosto inteiro, ambos vencendo 10/09) — cada linha é um documento distinto (Valor Nota = Valor a Pagar dentro da própria linha, ver regra de consolidação da seção 3.2.1). Corpo do e-mail com dois blocos numerados "1-"/"2-", cada um com seu período e valor. | REF. [MÊS1 ABREV.] E [MÊS2 ABREV.] — ex. "REF. JUL E AGO" — o assunto cita os DOIS meses (não só um), sempre nesse formato "[MÊS] E [MÊS]", abreviação de 3 letras cada. Regra geral: sempre que houver mais de um bloco de colaborador no mesmo e-mail com meses de referência diferentes, todos os meses envolvidos entram no Ref., nesse formato. |

Regra crítica: em casos de locação/recibo, o e-mail NUNCA pode usar a expressão "serviço prestado" em nenhuma hipótese — a frase é exclusiva de nota fiscal de serviço. Colaboradores normalmente são só JOB ou mensal; a distinção PACOTE/REC/REC+NF é mais comum entre fornecedores.

### 3.2.1 Caso especial — Fornecedor/Locação (REC e REC+NF)
Esses casos aparecem no filtro Status Box = "PROGRAMAR ATÉ" como UMA OU MAIS linhas separadas na planilha para o mesmo fornecedor/vencimento — pode ser só REC (uma ou mais linhas, ex.: locação parcelada), só NF, ou a combinação REC+NF. NÃO existe nome de colaborador nesses casos, pois é uma empresa fazendo locação, não uma pessoa prestando serviço.

**Nota de escopo (27/08): a regra de "documentos distintos = blocos numerados separados" desta seção NÃO é exclusiva de fornecedor.** O mesmo princípio vale para COLABORADOR quando há duas linhas do mesmo colaborador com o MESMO vencimento mas MESES/períodos de referência diferentes (cada linha sendo, dentro de si, um documento completo — Valor Nota = Valor a Pagar da própria linha) — ver linha "COLABORADOR, 2 PERÍODOS, MESMO VENCIMENTO" na tabela de tipos de emissão (seção 3.2) para o formato de assunto específico desse caso (cita os dois meses). A regra de CONSOLIDAÇÃO (não numerar, pedido único) descrita mais abaixo nesta seção, por outro lado, é específica de fornecedor com rateio interno de uma única nota — não se aplica a colaborador.

Exemplo real confirmado (planilha, aba Notas — seção 3.2, colunas H/I/J/K):
- Linha 1 — Descrição (coluna J): "(REC) LOCAÇÃO DE GERADOR - 23/08 A 27/08 - REUNION" | Fornecedor (coluna H): "POWER BRASIL LOCAÇÃO E COMERCIO DE GRUPOS GERADORES LTDA" | Valor: R$ 12.856,00
- Linha 2 — Descrição (coluna J): "(NF) SERVIÇOS DE GERADORISTA - 23/08 A 27/08 - REUNION" | mesmo Fornecedor | Valor: R$ 3.214,00

Segundo exemplo real confirmado (WTECH EVENTOS LTDA, mesma estrutura REC+NF): Linha 1 = RECIBO de "LOCAÇÃO DE ESTRUTURA E MAQUINÁRIA REUNION" (22/08 A 27/08); Linha 2 = NOTA FISCAL de "SERVIÇOS DE GAFFER REUNION" (22/08 A 27/08).

Terceiro exemplo real confirmado (MEDIA ARTS ENTERTAINMENT & FILM PRODUCTIONS LTDA, caso REC PURO — só uma linha, sem NF): RECIBO de "LOCAÇÃO DE EQUIPAMENTOS DE INGEST" (24/08 A 28/08).

Regras de montagem:
- Dados vêm da coluna H (Fornecedor) + do período/serviço extraídos da coluna J (data primeiro, depois a descrição do serviço quando é NF, ou a menção à locação quando é REC).
- A IA precisa identificar, quando não houver uma marcação inequívoca (como o prefixo "(REC)"/"(NF)" do exemplo acima), qual das linhas é NF e qual é REC — sem isso estar explícito, NÃO adivinhar (regra geral de segurança do item 6 acima: alerta via Telegram).
- **Status do Contrato divergente entre linhas do mesmo fornecedor/vencimento** (ex.: REC+NF onde uma linha está "OK - ASSINADO" e a outra "PENDENTE"/vazia): na prática, isso é sempre esquecimento de preenchimento da controller, nunca uma divergência real. Regra: se QUALQUER linha daquele fornecedor/vencimento estiver "OK - ASSINADO", atualizar TODAS as outras linhas do mesmo fornecedor/vencimento para "OK - ASSINADO" também, e montar o e-mail já com todos os blocos (RECIBO + NOTA FISCAL) completos — não esperar cada linha resolver separadamente, nem mandar e-mail incompleto. Depois de corrigir, enviar mensagem via Telegram para a Michelle avisando que a inconsistência foi corrigida, informando o nome do fornecedor e o valor da nota — para ela conseguir localizar e validar onde foi alterado.
- **Ordem dos blocos CONFIRMADA por 2 exemplos reais (POWER BRASIL e WTECH)**: quando há REC+NF, o bloco 1 é SEMPRE o RECIBO, o bloco 2 é SEMPRE a NOTA FISCAL — ordem fixa, não varia caso a caso.
- **Número de blocos acompanha o número de linhas encontradas** na planilha para aquele fornecedor/vencimento — não é sempre 2. Pode ser 1 linha só (REC puro, como o exemplo da Media Arts), 2 linhas (REC+NF, como Power Brasil/WTECH), ou mais de 2 (ex.: locação parcelada em várias linhas — indício real: assunto com "REF. LOCAÇÃO - P. 2/3", sugerindo parcelamento em 3 partes). Numerar os blocos na ordem em que aparecem na planilha. **EXCEÇÃO — ver regra de consolidação abaixo: isto só vale quando cada linha for de fato um documento distinto.**
- **Regra de consolidação vs. separação (decisão de 27/08, crítica — determina a estrutura do e-mail ANTES de montar os blocos)**: antes de aplicar a regra acima (um bloco numerado por linha), verificar a relação entre a coluna **I (Valor Nota)** e a coluna **K (Valor a Pagar)** em todas as linhas do grupo (mesmo fornecedor/vencimento):
  - **Cada linha é um documento distinto (regra padrão acima se aplica)**: quando, em cada linha do grupo, Valor Nota (coluna I) é IGUAL ao Valor a Pagar (coluna K) DAQUELA MESMA linha — ou seja, cada linha já representa uma nota/recibo completo e independente (é o caso do REC+NF descrito acima: cada linha é seu próprio documento). Nesse caso, monta um bloco numerado por linha, cada um com seu próprio valor.
  - **CONSOLIDAR em um único pedido, sem numerar (caso novo)**: quando o Valor Nota (coluna I) é IDÊNTICO e SE REPETE em todas as linhas do grupo, e a SOMA dos Valores a Pagar (coluna K) de todas as linhas bate com esse valor repetido. Isso indica que a Bruna/Danielle rateou uma única nota fiscal real (tipicamente fornecedor de locação + serviços combinados, ex. "LABORATÓRIO DIGITAL / ESTRUTURA") em várias linhas de controle orçamentário interno (uma por categoria de custo) — mas é UMA nota fiscal só, de UM fornecedor, com UM vencimento. Neste caso: montar o e-mail de pedido com **um único bloco, sem numeração "1-", "2-"...**, pedindo o valor total (o valor repetido da coluna I), não a soma nem os valores individuais de cada linha. Exemplo real confirmado (fornecedor Mística, vencimento 20/08, 5 linhas): todas as 5 linhas tinham Valor Nota = R$ 36.118,43 (idêntico, repetido), com Valores a Pagar variados (R$ 8.662,68 + R$ 8.540,00 + R$ 13.840,75 + R$ 840,00 + R$ 4.235,00) somando exatamente R$ 36.118,43 — pedido correto é um e-mail com um único bloco de R$ 36.118,43, sem separar em itens.
  - Este critério vale tanto para o filtro "PROGRAMAR ATÉ" quanto "SOLICITAR" (seção 3.1) — a decisão de consolidar ou separar precisa ser tomada ANTES/DURANTE a montagem do e-mail de pedido (Fase 1), não depois (Fase 3/4, recebimento/arquivamento) — é o pedido em si que precisa refletir a estrutura real da nota a ser emitida.
- O corpo do bloco de RECIBO NUNCA contém a frase "Serviço Prestado" — usa "Fornecedor:" e o texto da locação; o corpo do bloco de NOTA FISCAL usa "Serviço Prestado:" normalmente. Não pode inverter isso.
- O nome do projeto (ex.: "REUNION", presente na coluna J no exemplo) NÃO é replicado no corpo do e-mail — só aparece no "Ref." e no assunto.
- **Regra do assunto (diferencia REC puro de REC+NF pelo texto do "Ref.", não pela palavra RECIBO/FATURA)**:
  - REC puro (só locação, 1 ou mais linhas): `REF. LOCAÇÃO - [MÊS]` (ou `- P.X/Y` se parcelado) — NUNCA leva "E SERVIÇOS". A palavra "EMISSÃO DE RECIBO" ou "EMISSÃO DE FATURA" pode variar livremente, é indiferente.
  - REC + NF (locação + serviço): `REF. LOCAÇÃO E SERVIÇOS - [MÊS]` — SEMPRE leva "E SERVIÇOS", e SEMPRE usa a palavra "EMISSÃO DE FATURA" (nunca "EMISSÃO DE RECIBO" sozinho nesse caso, por padrão observado em todos os exemplos reais).

Corpo do e-mail modelo (exemplo real, REC + NF juntos):
```
Olá! Tudo bem?

Seguem as instruções para a emissão do RECIBO e da NOTA FISCAL que deverão ser enviadas até o dia 25/08 (TERÇA-FEIRA) com VENCIMENTO para 20/09/26:

Tomador
BOXFISH PRODUTORA DE PROGRAMAS TELEVISIVOS, INTERNET E FILMES PUBLICITÁRIOS LTDA.
Endereço: Rua Butantã, 194, sala 24, Pinheiros.
CEP 05.424-000 - São Paulo, SP
CNPJ: 14.788.649/0001-23
IM: 4.436.095-9
IE: ISENTA

1- Emitir RECIBO no valor de R$ 12.856,00 com os dados abaixo no corpo do recibo:
Ref. "SMTC - REUNION"
Fornecedor: POWER BRASIL LOCAÇÃO E COMERCIO DE GRUPOS GERADORES LTDA
Período de 23/08 A 27/08 - LOCAÇÃO DE GERADOR
Dados bancários:
chave pix:
---------------------------------------------------------------------
2 - Emitir NOTA FISCAL no valor de R$ 3.214,00 com os dados abaixo no corpo da nota:
Ref. "SMTC - REUNION"
Fornecedor: POWER BRASIL LOCAÇÃO E COMERCIO DE GRUPOS GERADORES LTDA
Serviço Prestado: SERVIÇOS DE GERADORISTA
Período de 23/08 A 27/08
Dados bancários:
chave pix:
---------------------------------------------------------------------
Importante: Peço a gentileza de enviar a sua nota nestes e-mails:
financeiro@novorealitybox.com
financeiro1@novorealitybox.com

"Os dados bancários considerados para pagamento são os que estão cadastrados..."

Beijos e Muito Obrigada! 🌷
```

Corpo do e-mail modelo (exemplo real, REC puro — só locação, sem NF na mesma remessa; assunto real: "SMTC - S01 | REUNION | EMISSÃO DE RECIBO | REF. LOCAÇÃO - AGO | (ENVIAR ATÉ 25.08) | MEDIA ARTS"):
```
Olá! Tudo bem?

Seguem as instruções para a emissão da sua FATURA que deverá ser enviada até o dia 25/08 com vencimento em 20/09/2026

Tomador

BOXFISH PRODUTORA DE PROGRAMAS TELEVISIVOS, INTERNET E FILMES PUBLICITÁRIOS LTDA.

Endereço: Rua Butantã, 194, sala 24, Pinheiros.

CEP 05.424-000 - São Paulo, SP

CNPJ: 14.788.649/0001-23

IM: 4.436.095-9

IE: ISENTA

1- Emitir RECIBO no valor de R$ 5.000,00 com os dados abaixo:

Ref. "SMTC - REUNION"

Fornecedor: MEDIA ARTS ENTERTAINMENT & FILM PRODUCTIONS LTDA

Período:  24/08 A 28/08 - LOCAÇÃO DE EQUIPAMENTOS DE INGEST

Dados bancários:

Chave pix:

---------------------------------------------------------------------

Importante: Peço a gentileza de enviar a sua nota nestes e-mails:
financeiro@novorealitybox.com
financeiro1@novorealitybox.com

"Os dados bancários considerados para pagamento são os que estão cadastrados..."

Muito obrigada!

Beijo, 🌷
```
Note que quando é REC puro (sem NF), o corpo do e-mail refere-se ao documento como "FATURA" na frase de abertura ("emissão da sua FATURA"), mesmo o bloco numerado dizendo "Emitir RECIBO" — não há inconsistência, é assim mesmo no modelo real.

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

### 3.5 Especificação técnica de formatação (cores exatas, fonte e emojis)
Detalhamento técnico do modelo de e-mail (seções 3.2, 3.3, 3.4), com valores exatos extraídos por inspeção do HTML de e-mails reais de produção — refina "mesmo negrito, grifo amarelo, cor do aviso e emoji" (seção 3.3) com os códigos precisos que a automação deve replicar, inclusive em homologação (o e-mail de teste deve ser visualmente idêntico ao de produção, mudando apenas destinatário/credencial). **Fonte de referência oficial (25/08): thread Paulo Bento/Reunion** — confirmada por Claudio como o modelo padrão real, usada para resolver toda divergência pontual encontrada entre e-mails diferentes (ex.: cor da data, dois-pontos em rótulos, espaçamento):
- **Fonte**: Verdana em todo o corpo do e-mail.
- **Saudação (fixa, não varia por e-mail)**: "Olá [NOME]! Tudo bem?" seguido do emoji 😊.
- **Fechamento (fixo, não varia por e-mail)**: duas linhas separadas — a primeira com a palavra de agradecimento ("Muito obrigada!", pode variar), a segunda com a despedida seguida do emoji 🌷 ("Bjs 🌷", "Beijo 🌷" — a palavra pode variar, o emoji e a separação em linha própria não). *(Corrigido em 25/08 — confirmado por comparação direta com e-mail padrão de produção; a versão anterior desta seção não especificava a separação em duas linhas.)*
- **Bloco "N- Emitir nota fiscal no valor de R$ X..."**: destaque (highlight) na cor exata `#FFE599`; o valor em R$ em negrito.
- **"...que deverá ser enviada até o dia DD/MM"**: formato de data SEM ano (`DD/MM`, ex. "25/08") — diferente de "vencimento em DD/MM/AAAA" logo depois, que tem ano completo; são dois formatos distintos de propósito, confirmados por e-mail padrão de produção. A frase "até o dia DD/MM" INTEIRA (não só os números da data) em cor `#cc0000` (vermelho vivo) E em negrito. *(Corrigido em 26/08 — Claudio e Michelle decidiram que "até o dia" também fica em negrito, não só a data; a versão anterior desta seção deixava "até o dia" vermelho mas sem negrito.)* O restante da frase ("...que deverá ser enviada") sem cor/negrito especial.
- **"vencimento em DD/MM/AAAA."**: a frase "vencimento em DD/MM/AAAA" INTEIRA (não só os números da data) em negrito e com destaque (highlight) azul-acinzentado `#CFE2F3`; o ponto final fica dentro do highlight mas fora do negrito.
- **Atenção — três formatos de data distintos no mesmo e-mail, propositais, não intercambiáveis**: assunto usa `DD.MM` com ponto (ex. "ENVIAR ATÉ 25.08"); "até o dia" no corpo usa `DD/MM` com barra e sem ano (ex. "até o dia 25/08"); "vencimento em" no corpo usa `DD/MM/AAAA` com barra e ano completo (ex. "vencimento em 10/09/2026"). São gerados por helpers de formatação separados no código — não reaproveitar um formato no lugar do outro.
- **Negrito fixo**: "Tomador", "Serviço Prestado como" (sem dois-pontos), "Colaborador:", "Período de", "Dados bancários:", "Chave pix:".
- **"Importante: Peço a gentileza de enviar a sua nota nestes e-mails:"**: cor `#FF0000` (vermelho) e negrito.
- **Parágrafo final** (dados bancários/ficha cadastral — texto já documentado nos modelos das seções 3.2.1/3.3/3.4): itálico, sem nenhum destaque/highlight.
- **Espaçamento**: cada campo (Ref., Serviço Prestado como, Colaborador, Período de, Dados bancários, Chave pix) é um parágrafo `<p>` separado, sequenciais, **sem nenhuma linha em branco extra entre eles** — o espaçamento vem só da margem padrão do `<p>`.
- **Padrão de assunto**: usar sempre hífen com espaços ao redor — `SMTC - S01` (não `SMTC-S01`) — conforme já usado nos exemplos das seções 3.3/3.4/6.
- **PROIBIDO — assinatura automática do n8n**: nenhum e-mail enviado pela automação (rascunho ou envio direto, em nenhum ambiente) pode conter a frase "This email was sent automatically with n8n" nem o link de referência do n8n que o node de Gmail insere por padrão. Essa assinatura precisa ser removida/desabilitada na configuração do node de envio — o e-mail final deve ser indistinguível de um escrito manualmente. Esta regra vale também para as mensagens de Telegram enviadas pela automação (alertas, relatório final, etc.) — nenhuma delas pode conter "This message was sent automatically with n8n" nem o link de referência, mesmo sendo comunicação interna hoje. *(Adicionado em 26/08, expandido para Telegram no mesmo dia — encontrado num e-mail real enviado pelo modo automático e num alerta real do Telegram; a decisão foi tratar preventivamente mesmo o Telegram sendo hoje só uso interno, para não depender de lembrar disso manualmente quando/se passar a ir para fora.)*


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
- Padrão de nome de pasta por função — confirmado com exemplos reais: AREP usa "[código] - [CARGO]" (ex.: "1301 - DIRETOR GERAL"); Reunion usa "[código].R - [CARGO]" (ex.: "1301.R- DIRETOR GERAL", "7007.R - ACESSORIA JURÍDICA"); Soft Pré vai seguir o mesmo padrão do AREP ("[código] - [CARGO]") assim que surgirem os primeiros casos.
- Credencial já configurada no n8n: **"Google Drive - Produção (financeiro1@novorealitybox.com)"** (Google Drive OAuth2 API, conectada como financeiro1@novorealitybox.com)

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
- Atualizar a coluna "Check arquivo drive" da planilha para "OK" depois de confirmar que a nota já foi arquivada por função na Fase 2.
- Atualizar Status Box da planilha interna com "ENTREGUE MI R{n}", onde `n` é o número do lote/remessa calculado pela regra de janela de tempo (seção 5.0) — não mais por contagem fixa de 30. A cópia enviada ao Danilo usa sempre só "ENTREGUE", nunca "MI" nem número de remessa.
Vencimentos no dia 10 costumam ser os que mais acumulam notas (podendo passar de 30 num único lote e precisar de R1, R2 dentro do mesmo lote); as demais datas dificilmente ultrapassam 30 por lote.
- Nomenclatura de pasta de remessa (a partir de agora): todas as pastas de remessa criadas no último nível levam o sufixo "_MI". Exemplo: "10.08_BR_SMTC_S01_ARQUIVO_NF_REMESSA_1" vira "10.08_BR_SMTC_S01_ARQUIVO_NF_REMESSA_1_MI". Vale para REUNION e SOFT PRE (e qualquer novo projeto daqui pra frente).

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

## 7. Arquitetura técnica

### 7.1 Decisão
Tudo roda em nuvem, dentro do próprio n8n — sem script separado rodando por fora (cron), e sem depender de nenhuma máquina/notebook ligado.
- Orquestração: n8n Community Edition (self-hosted, gratuito), com nodes nativos de Box, Google Drive e Gmail.
- Regras determinísticas (datas, zero-padding, cálculo de lotes por janela de tempo — seção 5.0): node de Code do n8n, roda dentro da execução do workflow.
- Extração de dados do PDF/imagem da nota fiscal (Fase 2): node de IA do n8n chamando a API da Claude com o anexo, devolvendo os dados em JSON.
- CORREÇÃO IMPORTANTE: a Fase 1 também usa IA (API da Claude), não é 100% determinística como definido anteriormente. Os pontos que precisam de IA na Fase 1 (seção 3.2):
  - Distinguir, dentro da coluna J (Descrição), o que é Cargo e o que é Nome do colaborador, quando a posição/composição do texto é ambígua (ex.: "AGENCIAMENTO DE FIGURAÇÃO" vs. "LARISSA CRISTIANE DO AMARAL GOMES" — não dá pra saber qual é qual só por posição ou regex).
  - Nos casos de locação/fornecedor (REC / REC+NF — seção 3.2.1), identificar qual linha da planilha corresponde a NOTA FISCAL e qual corresponde a RECIBO, quando isso não estiver marcado de forma inequívoca na Descrição.
  - Reconhecer e remover menções ao nome do projeto (REUNION, AREP, SOFT PRE, PNS/PNL etc.) de dentro do texto da coluna J antes de montar o corpo do e-mail — esse nome não deve ser replicado no corpo, pois já aparece no assunto.
  - Regra geral de segurança (vale para toda a Fase 1, não só estes 3 pontos): sempre que o agente encontrar uma situação que não foi mapeada nesta especificação, ele NUNCA pode inventar ou adivinhar. Ele para o processamento daquela linha, envia um alerta via Telegram para a Michelle descrevendo o ponto de indecisão, onde foi encontrado (planilha/linha/projeto) e o que ele já fez até ali, para que ela resolva manualmente.
- Hospedagem: instância e2-micro do Google Cloud Free Tier (gratuita para sempre, região EUA), rodando o n8n 24/7 sem custo nem dependência de notebook.
- **Agendamento — só dias úteis**: o disparo automático (Schedule Trigger) roda de SEGUNDA A SEXTA-FEIRA apenas — não roda sábado nem domingo. Vale para as 3 fases (não é regra exclusiva da Fase 1). O disparo manual (Manual Trigger), usado durante os testes, não é afetado por essa regra — pode ser usado em qualquer dia.
- **Frequência do disparo automático em produção — decidido em 27/08: de 3 em 3 horas, dentro do horário comercial** (dias úteis, seção acima). Horário exato de início/fim do intervalo comercial ainda PENDENTE de confirmação com a Michelle (Claudio vai perguntar a ela quantas vezes por dia a Danielle costuma atualizar a planilha Cost, antes de fechar o horário definitivo). Contexto da decisão: "SOLICITAR URG" não exige resposta em tempo real — o gargalo real está no colaborador enviar a nota depois de receber o pedido, não na velocidade da Michelle solicitando; "urgente" aqui significa "processar ainda no mesmo dia", não "imediatamente". Por isso um intervalo de poucas horas (não minutos, não hora em hora) já atende a urgência real do processo.
- Erros: "Error Workflow" nativo do n8n — qualquer falha dispara aviso automático no Telegram.
- Credencial de IA: no Claude Console, o cartão de pagamento fica no nível da conta/organização (não por chave nem por workspace) — todas as chaves de uma mesma conta são cobradas no mesmo cartão. Por isso o projeto usa **duas contas Anthropic separadas**: (1) chave de dev/homologação `n8n-boxfish-notas-hml`, criada na conta pessoal do Claudio, cartão dele; (2) chave de produção, a criar numa conta nova aberta com o e-mail da Michelle (michelle.mimiaguia@gmail.com), cartão dela — contas e cobranças 100% independentes. No n8n isso vira duas credenciais separadas ("Claude account (dev)" e "Claude account (produção)"), trocadas conforme o perfil ativo (homolog/produção), do mesmo jeito que já é feito com os e-mails de teste (seção 7.4). Recomendado usar o modelo **Claude Haiku 4.5** para a extração de dados do PDF (tarefa estruturada e repetitiva, custo bem menor que Sonnet/Opus, com qualidade suficiente para esse tipo de extração).

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

**Resumo diário (decisão desta rodada)**: em vez de só um relatório por execução (que pode rodar várias vezes ao dia e virar difícil de acompanhar), a automação também gera um **resumo diário consolidado e curto**, em bullet points agrupados por categoria (ex.: rascunhos criados, cobranças disparadas, notas recebidas/arquivadas, alertas pendentes). Duas formas de acesso, mesma lógica de resumo:
- **Agendado**: enviado automaticamente ao fim do dia via Telegram.
- **Sob demanda**: comando `/resumo` que a Michelle pode digitar a qualquer momento pra puxar o resumo do dia corrente, sem esperar o horário agendado.
Se, na prática, a Michelle sentir falta de mais detalhe ou de outro formato, ela sinaliza e o formato é ajustado depois — não é definitivo, é o ponto de partida.

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

### 7.6 Infraestrutura da VM do n8n (referência fixa — não perguntar de novo)

**Google Cloud**
- Projeto: `automacao-notas-boxfish`
- Instância: `n8n-boxfish`, zona `us-east1-c`
- Tipo de máquina: e2-small (upgrade do e2-micro original, por saturação de CPU)
- SO: Ubuntu 22.04
- IP externo: pode mudar se a instância for parada/reiniciada — sempre conferir no Console antes de assumir

**Domínio e HTTPS**
- Domínio: `n8n.carvalhodeoliveira.com`
- DNS: Cloudflare, registro A, modo "DNS only" (nuvem cinza, NÃO proxied)
- Proxy reverso: Caddy, rodando direto na VM (fora do Docker) — config em `/etc/caddy/Caddyfile`:
  ```
  n8n.carvalhodeoliveira.com {
      reverse_proxy localhost:5678
  }
  ```
- Certificado HTTPS: gerado/renovado automaticamente pelo Caddy (Let's Encrypt)
- Firewall GCP: regra "allow-http-https" libera portas 80/443 via tags de rede (http-server, https-server)

**Como o n8n está instalado**
- NÃO usa docker-compose — é Docker "puro" (`docker run` direto)
- Nome do container: `n8n`
- Imagem: `n8n-custom:latest` (customizada, não é a `n8nio/n8n` oficial pura — ver exceljs abaixo)
- Volume nomeado `n8n_data`, montado em `/home/node/.n8n` dentro do container (workflows e credenciais — sobrevive se o container for recriado)
- Bind mount `/opt/box-fish-config` (host) → `/home/node/.n8n-files/box-fish-config` (container): os 5 arquivos JSON de estado do projeto. Ver "Arquivos de configuração" abaixo pra entender por que eles NÃO ficam mais dentro de `/home/node/.n8n`.
- Comando completo usado pra subir o container (referência caso precise recriar):
  ```
  docker run -d --restart unless-stopped --name n8n -p 5678:5678 \
    -e N8N_HOST=n8n.carvalhodeoliveira.com \
    -e N8N_PROTOCOL=https \
    -e WEBHOOK_URL=https://n8n.carvalhodeoliveira.com/ \
    -e N8N_EDITOR_BASE_URL=https://n8n.carvalhodeoliveira.com/ \
    -e NODE_FUNCTION_ALLOW_EXTERNAL=exceljs,xlsx \
    -e NODE_PATH=/usr/local/lib/node_modules_extra/node_modules \
    -v n8n_data:/home/node/.n8n \
    -v /opt/box-fish-config:/home/node/.n8n-files/box-fish-config \
    n8n-custom:latest
  ```

**Bibliotecas de planilha: exceljs + SheetJS (`xlsx`) — as duas, cada uma pelo que a outra não faz**
- `exceljs` → **Cost Report (.xlsx)**. É a única das duas que expõe a **cor de preenchimento** da célula, que é o que separa AREP de REUNION (seção 6).
- `xlsx` (SheetJS) → **planilhas de Contratos (.xlsb)**. O exceljs **não lê .xlsb**, e o modo como ele falha é o perigoso: abre o arquivo (por fora é um zip, igual .xlsx), não encontra as partes internas que espera (num .xlsb são `.bin`, não `.xml`) e devolve um documento com **zero abas, sem erro nenhum**. Isso faria a automação tratar todo mundo como "sem contrato". Verificado nos 3 arquivos reais.
- Ambas instaladas numa pasta ISOLADA dentro da imagem customizada (`/usr/local/lib/node_modules_extra/`), não dentro da pasta do n8n (o `package.json` do n8n usa formato `catalog:` do pnpm, incompatível com npm comum)
- **Instalar a lib não basta**: `NODE_FUNCTION_ALLOW_EXTERNAL` precisa listar as duas (`exceljs,xlsx`), senão o n8n bloqueia o `require` mesmo com a biblioteca presente.
- **Estrutura real das planilhas de contratos** (verificada nos 3 arquivos): cabeçalho na **linha 3**, não na 1; abas `EQUIPE E E FORNECEDORES`, `PRESTAÇÃO DE SERVIÇO + LOCAÇÃO` e `CANCELADOS_DISTRATOS`, com **layouts diferentes** entre si (na primeira a empresa fica na coluna J, na segunda na F). Por isso o workflow localiza as colunas pelo **nome do cabeçalho** (`STATUS`, `NOME`, `INFORMAÇÕES DA EMPRESA`), não por letra fixa.
- Dockerfile da imagem customizada, em `~/n8n-custom/Dockerfile` no host (cópia versionada em `infra/Dockerfile`):
  ```
  FROM n8nio/n8n:latest
  USER root
  RUN mkdir -p /usr/local/lib/node_modules_extra
  WORKDIR /usr/local/lib/node_modules_extra
  RUN npm init -y
  RUN npm install exceljs xlsx
  USER node
  ```

**Arquivos de configuração do projeto**
- Caminho ABSOLUTO real dentro do container (usar esse caminho nos nodes "Read/Write File from Disk" dos workflows — não o caminho relativo `config/` do repositório Git, que é só para versionamento/referência):
  - `/home/node/.n8n-files/box-fish-config/config_execucao.json`
  - `/home/node/.n8n-files/box-fish-config/apelidos.json`
  - `/home/node/.n8n-files/box-fish-config/cobrancas.json`
  - `/home/node/.n8n-files/box-fish-config/log_diario.json`
  - `/home/node/.n8n-files/box-fish-config/pendencias_identificacao.json`
- No HOST da VM esses arquivos ficam em `/opt/box-fish-config/` (bind mount). Dá pra editar o `config_execucao.json` direto por SSH com `nano`, sem `docker exec`.

**⚠️ Por que NÃO ficam dentro de `/home/node/.n8n/` (mudança de 24/08/2026)**: originalmente a pasta era `/home/node/.n8n/box-fish-config/`. A partir de uma versão recente, o n8n passou a BLOQUEAR por padrão o acesso dos nodes "Read/Write File from Disk" a qualquer arquivo dentro da pasta `.n8n` — mudança de segurança deliberada, ligada à correção da CVE-2025-68697. O sintoma é o erro `Access to the file is not allowed.` mesmo com o arquivo existindo e sendo legível via `docker exec`. Não é erro de configuração nossa e não há como desligar por node.
- Verificado empiricamente nesta instância (escrevendo um arquivo em cada pasta e lendo de volta): o n8n usa uma **lista de permissão por prefixo**, não uma lista de bloqueio. Só `/home/node/.n8n-files/` e `/files/` passam — inclusive suas subpastas. `/data`, `/tmp`, `/home/node/` e `/home/node/.n8n/` respondem todos `Access to the file is not allowed.`
- **Cuidado ao testar isso**: `fileSelector` é um GLOB e a permissão é checada por ARQUIVO CASADO, não pelo padrão. Testar com um caminho onde o arquivo ainda não existe casa zero arquivos, não dispara checagem nenhuma e devolve "sucesso com zero itens" — o que faz QUALQUER caminho parecer liberado. Um teste válido precisa gravar o arquivo antes (ou usar um que exista).
- Por isso **não** usamos a variável `N8N_RESTRICT_FILE_ACCESS_TO`: ela SUBSTITUI essa lista padrão. Como `/home/node/.n8n-files/` já está liberado de fábrica, ligá-la só criaria uma segunda trava pra manter em sincronia, com risco de derrubar acessos que hoje funcionam.
- `.n8n-files` NÃO é a mesma pasta que `.n8n` — não há colisão com o arquivo de chave de criptografia citado no aviso abaixo, e o volume `n8n_data` não a cobre (daí o bind mount).
- O bind mount é obrigatório, não opcional: `/home/node/.n8n-files/` está na camada gravável do container (o volume `n8n_data` cobre `/home/node/.n8n`, que é outra pasta), então sem o mount os 5 JSONs — incluindo `cobrancas.json`, que guarda o estado das cobranças em aberto — seriam PERDIDOS no próximo `docker rm`, que é justo o passo 3 do procedimento de recriação logo abaixo.

**⚠️ ATENÇÃO CRÍTICA — nunca usar o nome "config" sozinho**: existe um ARQUIVO (não pasta) em `/home/node/.n8n/config` que pertence ao PRÓPRIO n8n — arquivo interno de configuração que contém a chave de criptografia usada para proteger as credenciais salvas (Gmail, Drive, Box, Claude API). NUNCA criar pasta/arquivo chamado "config" direto dentro de `/home/node/.n8n/`, nem apagar/sobrescrever esse arquivo — quebraria o acesso a TODAS as credenciais já configuradas. Por isso o projeto usa o nome `box-fish-config` (com prefixo), evitando colisão.

**Procedimento seguro pra mexer no container** (variável de ambiente nova, rebuild de imagem etc.):
1. Editar o Dockerfile em `~/n8n-custom/` se precisar mudar a imagem
2. `docker build -t n8n-custom:latest ~/n8n-custom`
3. `docker stop n8n && docker rm n8n`
4. Rodar o `docker run` completo de novo (comando acima), com as variáveis atualizadas — o volume `n8n_data` preserva tudo automaticamente
NUNCA apagar o volume `n8n_data`.

**Aviso sobre o terminal SSH**: o terminal SSH pelo navegador (Google Cloud Console) às vezes gruda várias linhas coladas de uma vez, causando erros. Sempre colar comandos em blocos de uma linha só (usar `printf` com `\n` literal para conteúdo multi-linha dentro de um arquivo), ou colar comando por comando.

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
PENDENTE (verificado em 25/08): o workflow de Rollback via Telegram (seção 13.3) NÃO existe — nem publicado, nem no repositório. Além disso, o pré-requisito descrito na própria seção 13.3 ("cada execução registra um recibo das ações feitas": IDs de rascunho, caminhos antes/depois no Drive, versão da planilha antes da edição) também não existe — hoje só é gravado `threadId` (`cobrancas.json`) e um resumo agregado (`log_diario.json`). Rollback depende de construir esse recibo primeiro. Tratado como item de backlog, a priorizar antes da liberação para produção — não bloqueia os testes atuais em homologação.

## 10. Regras resolvidas nesta rodada
- Identificar de qual colaborador é uma nota quando o remetente do e-mail não é óbvio (Fase 2): abrir a nota fiscal em anexo, extrair dela o nome do colaborador, a razão social e o projeto (Ref.), e usar essas informações para localizar a linha correspondente na aba Notas.
- Cruzamento entre a aba Notas e as planilhas de Contratos (Razão Social / nome do colaborador): comparar ignorando diferença de maiúsculas/minúsculas e espaços a mais ou a menos — não precisa de comparação fonética/aproximada mais complexa.
- Acesso ao Drive S02 via conector: será testado ao vivo durante a montagem do n8n, quando a própria Michelle autenticar — não é mais tratado como bloqueio.
- Fase 4 (Arquivamento): revalidada e fundida com a Fase 3 (seção 5.3) — acontecem em paralelo, com estrutura de pastas e nomenclatura confirmadas por prints reais dos Drives S01 e S02.
- Estrutura completa de pastas por função: confirmada por prints reais (não é mais uma lista a levantar do zero — os padrões "[código] - [CARGO]" e "[código].R - [CARGO]" já estão documentados na seção 4.2).
- Detalhamento de PACOTE e REC + NF: esclarecido — PACOTE é caso raro específico do AREP; REC + NF ocorre em locação, sobretudo com fornecedores, por motivo fiscal (nunca usar "serviço prestado" nesses casos).
- Numeração de remessa no Status Box interno: substituída a contagem fixa de 30 por uma regra de lotes por janela de tempo em relação ao vencimento da NF (seção 5.0) — "ENTREGUE MI R1", "ENTREGUE MI R2"... contando por pasta de vencimento, não mais por quantidade fixa de notas.
- Corte para o Danilo: Status Box = "ENTREGUE" (não "ENTREGA MI" — nomenclatura definitiva confirmada).
- Marcadores de e-mail (labels do Gmail): confirmados — "IA" + marcador do projeto em toda interação com e-mail (seção 3.1.2).
- MVP: Status Box do pedido/cobrança ao colaborador e da entrega ao Danilo ficam manuais (Michelle) enquanto o modo de execução for "rascunho"; "RECEBIDA MI" continua automático mesmo no MVP (seção 3.1.3).
- Armazenamento de controle de cobrança, apelidos de projeto e modo de execução: NÃO ficam na planilha — ficam em arquivos JSON no disco da VM do n8n (`cobrancas.json`, `apelidos.json`, `config_execucao.json`), lidos/escritos pelos nodes nativos de arquivo do n8n (seções 3.1.1, 3.1.3, 6.1). Caminho absoluto real na VM: `/home/node/.n8n-files/box-fish-config/` — seção 7.6.
- Nome do projeto confirmado como "AREP" (uma letra R) em todo o documento — confirmado por Claudio junto com a Michelle; a grafia "ARREP" usada temporariamente numa rodada anterior foi revertida.

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
| 6 | Importar os workflows no n8n e validar em `homolog` + `rascunho` (seção 7.4) — nenhuma execução em `produção` antes disso | Claudio |
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
