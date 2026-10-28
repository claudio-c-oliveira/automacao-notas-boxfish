AUTOMAÇÃO — CONTROLE DE NOTAS FISCAIS · Box Fish · Michelle Aguiar

> **Mapa dos arquivos do spec (`docs/spec/`)**: `00-comum.md` (leitura obrigatória em qualquer tarefa) · `01-arquitetura-infra.md` · `fase-1.md` · `fase-2.md` · `fase-3-4.md` · `90-decisoes-e-proximos-passos.md`. Os números das seções são os do documento original e não mudaram. O Claude Code lê estes arquivos e **nunca os edita**.

> *Leia antes o `00-comum.md`.*

## 3. Fase 1 — Solicitação de nota ao colaborador

### 3.1 Passo a passo
- 1º Verificar Status do Contrato (coluna N da aba Notas). Essa checagem vale IGUALMENTE para os dois gatilhos abaixo ("PROGRAMAR ATÉ" e "SOLICITAR") — não é mais exclusiva do primeiro.
  - Se a coluna N contém "ASSINADO" (ex.: "OK - Assinado"): segue o fluxo normal de solicitação.
  - Se a coluna N contém "PENDENTE" ou está vazia/"N/A": NÃO pula mais direto — tenta resolver ativamente. Aplica o marcador de e-mail "CONTRATAÇÃO" (seção 3.1.2) e busca no Gmail, pelo nome do colaborador, se já existe uma thread de "ficha cadastral" preenchida e enviada.
    - Se encontrar e validar a ficha cadastral enviada: segue o fluxo normal de solicitação E atualiza a coluna N (Status do Contrato) para "OK - ASSINADO".
    - Se não encontrar/validar: não dispara o e-mail de pedido (linha fica pendente, sem alteração na coluna N).
  - **Busca de ficha cadastral — REDESENHADA em 11/09, corrige bug crítico de falso positivo por correspondência de nome (caso real: "Vanessa Paes")**: a versão anterior buscava o nome do colaborador em qualquer lugar da mensagem (incluindo CC), o que confirmava "OK - ASSINADO" com base em alguém apenas copiado numa thread alheia — ex.: a Coordenadora Executiva, que fica em cópia em quase toda thread de contratação da empresa, casava com sua própria linha de colaboradora (mesma pessoa, dois papéis) sem a ficha ser dela. A nova lógica tem DUAS ETAPAS distintas, com papéis diferentes — a primeira nunca decide sozinha, só restringe a lista de candidatos; só a segunda confirma:
    - **Etapa 1 — Restringir candidatos (sem abrir anexo, rápido e barato)**: dentro do marcador "CONTRATAÇÃO", buscar mensagens com `has:attachment` e remetente de FORA dos domínios internos da empresa (hoje: `novorealitybox.com` e `boxfishtv.com` — lista pode crescer, checar com Claudio se aparecer um terceiro domínio). Dentro desse conjunto, um candidato é "plausível" se: (a) a thread foi endereçada originalmente para o e-mail do colaborador que está na coluna R da planilha Cost, OU (b) o nome do colaborador OU a razão social da empresa (ambos já existentes na planilha Cost) aparece no ASSUNTO ou no CORPO NOVO da mensagem de resposta (nunca no CC, nunca em corpo citado/thread anterior, nunca na lista de destinatários). Esses dois critérios servem só para reduzir a lista de e-mails a investigar (de centenas para um punhado) — não são suficientes sozinhos para confirmar o contrato.
    - **Etapa 2 — Confirmar de verdade, lendo o conteúdo da ficha cadastral (SEM IA — corrigido em 11/09 após investigação real)**: investigação nos anexos reais mostrou que a premissa inicial ("sempre PDF ou Word") estava errada — a distribuição real é 29 PDF, 8 xlsx, 2 docx, 2 html, 1 jpeg por mensagem, mas **a ficha cadastral em si é sempre um arquivo `.xlsx`** (confirmado por Claudio; exemplo real: `BR_SMTC_S01_FICHA CADASTRAL....xlsx`). Os PDFs anexados são documentos de APOIO da empresa contratada (certidão de NIRE, CNPJ, contrato de locação) — provam que a empresa existe e está regular, mas NÃO são o documento usado para confirmar identidade, e não entram nesta checagem. Etapa 2 revisada: entre os anexos do candidato (vindos da Etapa 1), identificar o arquivo `.xlsx` (a ficha cadastral real — pode-se usar "FICHA" no nome do arquivo como sinal adicional). Ler esse arquivo com `exceljs` (já disponível na VM, mesma biblioteca usada para Cost Report e Contratos — SEM custo de IA, sem PDF, sem rebuild de imagem) e aplicar a MESMA lógica de correspondência tolerante já definida para a checagem de Contratos (documento > nome com tolerância de 1º/último token > ambiguidade cai em alerta) comparando o conteúdo da ficha com o nome do colaborador / razão social da planilha Cost. Confirmar "OK - ASSINADO" somente com esse match positivo. **Anexos que não são `.xlsx`** (só PDF, Word, imagem, HTML) não são suficientes para confirmar — a linha cai em pendente, mesmo que a Etapa 1 tenha achado um candidato plausível; não há suporte hoje para ler Word/imagem como ficha (raro: 2/42 nos dados reais), fica para decisão futura se a demanda justificar.
    - **Se nenhum candidato da Etapa 1 tiver Etapa 2 confirmada**: a linha fica PENDENTE — mesmo que algum candidato pareça "quase certo" pela Etapa 1, nunca liberar só com base nela. Não adivinhar; melhor esperar confirmação manual da Michelle do que liberar pedido de nota para pessoa/empresa errada.
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

### 3.1.8 Comportamento de "PROGRAMAR ATÉ" (redesenhado em 27/08 — corrige bug crítico)
**Bug encontrado antes de ir para produção**: a implementação anterior tratava toda linha "PROGRAMAR ATÉ" como `acao: 'agendar_envio'`, que caía num node placeholder vazio (`NoOp — Agendar envio (TODO)`) — nenhum e-mail era criado, mas a coluna L era escrita como "SOLICITADA MI" mesmo assim, e sem checagem de data (rodava para TODAS as linhas "PROGRAMAR ATÉ" da planilha, vencidas ou não). Isso reproduzia exatamente a falha que a seção 3.1.5 existe para evitar. Motivo raiz: a API do Gmail (e o node de Gmail do n8n) NÃO possui recurso de envio agendado ("scheduled send") — esse recurso só existe na interface web do Gmail, não é alcançável via automação. O comportamento correto, desenhado para contornar essa limitação, é:

1. **Criação antecipada do rascunho**: assim que a linha "PROGRAMAR ATÉ [data]" tem o contrato confirmado (mesma checagem da seção 3.1), a automação cria o e-mail já em RASCUNHO desde já — não espera a data-alvo chegar para montar o e-mail. Guarda o ID desse rascunho e a data-alvo associada (`cobrancas.json` ou estrutura equivalente).
2. **Coluna L não muda neste momento**: continua refletindo que está programado, não enviado — evita a falha do bug original.
3. **Execuções seguintes, antes da data-alvo**: a linha não deve gerar um novo rascunho duplicado a cada execução — precisa reconhecer que já tem um rascunho pendente para aquela data e não fazer nada até o dia chegar.
4. **Quando a data-alvo chega** (numa execução no dia certo ou depois, dependendo da frequência do Schedule Trigger):
   - **Modo automático**: checar via API se o rascunho (pelo ID guardado) AINDA EXISTE.
     - **Existe**: enviar de verdade, aplicando a mesma dupla camada de verificação da seção 3.1.5, e só então atualizar a coluna L para "SOLICITADA MI".
     - **NÃO existe mais** (a Michelle já enviou manualmente antes da automação agir — cenário real e esperado, não um erro): NÃO reenviar (evita duplicar o e-mail). **Antes de atualizar a coluna L, checar o valor ATUAL do Status Box na planilha**: só atualizar para "SOLICITADA MI" se o valor atual ainda for "PROGRAMAR ATÉ" (ou equivalente anterior no fluxo). Se o Status Box já avançou para um estágio posterior do processo (ex.: "ENTREGUE MI", "ENTREGUE MI R1", "ENTREGUE MI R2"... — seção 5.3, a Michelle já pegou a nota recebida e entregou ao Danilo), a automação NÃO pode regredir esse status — não escreve nada na coluna L nesse caso, preservando o estágio mais avançado já alcançado manualmente. Registrar a ocorrência (rascunho ausente, envio já feito manualmente) de forma auditável, sem precisar de alerta urgente — é um caminho normal.
   - **Modo rascunho**: nunca envia sozinho, mesmo passando da data-alvo — fica aguardando revisão manual da Michelle.
5. **Este redesenho substitui o `NoOp — Agendar envio (TODO)`** e a lógica de `acao: 'agendar_envio'` anterior — não deve mais existir um caminho que grava a coluna L sem um e-mail ter sido de fato criado (rascunho) e, no caso de envio automático, sem confirmação real de envio.

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

**Processamento SEQUENCIAL por fonte de Cost Report, nunca misturado (decidido em 09/09 — corrige bug crítico encontrado antes do primeiro disparo real em produção)**: quando a execução processa mais de uma fonte de Cost Report na mesma rodada (produção tem duas: S01 — AREP+Reunion, e S02 — Soft Pré), o ciclo completo de leitura → checagem de contrato → escrita → confirmação (as duas camadas acima) deve rodar por INTEIRO para uma fonte antes de começar a próxima — nunca as duas fontes abertas/escritas/conferidas juntas na mesma passada. Cada fonte usa seu próprio caminho de planilha de Contratos para a checagem: lendo S01, busca em `JURIDICO > BR_AREP_S01_REUNION_CONTROLE DE CONTRATOS.xlsb` (Reunion) e `JURIDICO > BR_AREP_S01_CONTROLE DE CONTRATOS.xlsb` (AREP); lendo S02, busca em `SMTC_S02_EXECUTIVA > JURIDICO S02 > BR_SMTC_S02_CONTROLE DE CONTRATOS.xlsb` (Soft Pré). Motivo: como os números de linha se repetem entre S01 e S02 (ex. célula N293 existe nas duas planilhas, são arquivos independentes), tentar escrever/conferir as duas fontes na mesma operação fazia a Camada 2 (arquivo salvo) conferir a lista de mudanças de AMBAS as fontes contra um único arquivo aberto por vez — na melhor hipótese abortando a execução inteira por divergência espúria, na pior (e mais perigosa) dando falso positivo: confirmando como bem-sucedida uma escrita que nunca aconteceu na outra fonte, por coincidência de valor na mesma célula/linha. Processar uma fonte inteira de cada vez elimina esse cenário — a conferência de cada fonte só compara contra a lista de mudanças daquela mesma fonte, nunca uma mistura.

**Duas escritas distintas, duas posições distintas no fluxo — não confundir:**
- **Coluna N (Status do Contrato)**: escrita ANTES da criação do e-mail, com as duas camadas de verificação acima. É pré-requisito para o e-mail sair com o Ref./assunto corretos (seção 3.1).
- **Coluna L (Status Box, ex. "SOLICITADA MI")**: escrita **SOMENTE DEPOIS** do envio do e-mail ser confirmado com sucesso (em `MODO_EXECUCAO = automatico`). NUNCA antes. Se a coluna L fosse escrita antes e o envio falhasse depois, a planilha afirmaria que a nota foi solicitada sem que nenhum e-mail tenha realmente saído — confundindo quem acompanha a planilha (ex.: alguém vendo "SOLICITADA MI" e procurando um e-mail que nunca foi disparado). Esta regra já existia na seção 3.1 antes da 3.1.5 e continua valendo integralmente: a reordenação da gravação para antes do e-mail (motivada pela 3.1.5) se aplica apenas à coluna N, nunca à coluna L. **Confirmado em 29/08**: em `MODO_EXECUCAO = rascunho`, a coluna L continua manual (a Michelle quem atualiza) mesmo que `ambiente = produção` — o `MODO_EXECUCAO` é o que decide isso, não o `ambiente`. A coluna N, por outro lado, é escrita automaticamente independente do modo, inclusive em produção+rascunho, desde o início (seção 3.1.3).


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

**Detalhes de implementação do caso "COLABORADOR, 2 PERÍODOS, MESMO VENCIMENTO" (confirmados em 27/08):**
- **Agrupamento**: as duas linhas (mesmo projeto + colaborador + vencimento) formam UM ÚNICO e-mail com dois blocos — não dois e-mails separados. Colaboradores diferentes, mesmo que no mesmo vencimento, continuam gerando e-mails separados (regra normal).
- **Dois cenários distintos que resultam em "REF. MÊS1 E MÊS2", não confundir**: (a) DUAS LINHAS separadas na planilha, cada uma com seu próprio período dentro de um mês, mesmo vencimento — vira dois blocos numerados "1-"/"2-" no e-mail, como descrito nesta seção; (b) UMA ÚNICA LINHA cujo período (coluna J) atravessa dois meses (ex. "26/07 A 05/08") — continua sendo UM bloco só (não numera), mas o REF. do assunto ainda cita os dois meses, porque o período em si cruza a virada do mês.
- **Mês de referência quando um período (dentro de uma única linha, coluna J) atravessa dois meses** (ex.: "26/07 A 05/08"): o REF. do assunto cita OS DOIS MESES, no mesmo formato "[MÊS1] E [MÊS2]" já usado para o caso de duas linhas — NÃO escolhe um mês só (nem pelo mês da primeira data, nem por quantidade de dias trabalhados em cada mês; critério é puramente sobre o período cronológico do colaborador, não sobre carga de trabalho). *(Corrigido em 27/08 — versão anterior desta seção dizia "usar o mês da primeira data", que estava errada; o correto é citar ambos.)*
- **Normalização de ordem cronológica (novo, 27/08)**: tanto o período exibido no corpo do e-mail quanto a ordem dos meses no REF. devem estar em ordem cronológica ASCENDENTE (data mais cedo primeiro), independentemente de como a data está escrita na planilha de origem. Se a coluna J trouxer as datas invertidas por erro de digitação (ex.: "05/08 A 26/07"), a automação corrige e exibe "26/07 A 05/08" — nunca reproduz uma ordem de datas invertida vinda da planilha.
- **Ordem dos meses no assunto** ("REF. [MÊS1] E [MÊS2]"): segue a ORDEM DE APARIÇÃO das linhas na planilha, não ordem cronológica ascendente — evita inverter um par que atravessa a virada do ano (ex.: DEZ + JAN não pode virar "JAN E DEZ").
- **Texto de abertura do e-mail no plural quando há mais de um bloco**: "para a emissão da sua nota fiscal" (singular, usado quando há só 1 bloco) deve virar "para a emissão das suas notas fiscais" (plural) quando o e-mail tiver mais de um bloco — pluralizar só os termos necessários ("nota fiscal" → "notas fiscais", "sua" → "suas"), sem alterar o resto da frase.

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
