AUTOMAÇÃO — CONTROLE DE NOTAS FISCAIS · Box Fish · Michelle Aguiar

> **Mapa dos arquivos do spec (`docs/spec/`)**: `00-comum.md` (leitura obrigatória em qualquer tarefa) · `01-arquitetura-infra.md` · `fase-1.md` · `fase-2.md` · `fase-3-4.md` · `90-decisoes-e-proximos-passos.md`. Os números das seções são os do documento original e não mudaram. O Claude Code lê estes arquivos e **nunca os edita**.

> *Contém a seção 7 (menos a 7.4, que está em `00-comum.md`), a 8 e a 13.1 a 13.3 (a 13.4 a 13.6 está em `00-comum.md`).*

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
- **Frequência do disparo automático em produção — decidido em 27/08, horário fechado em 29/08**: de 3 em 3 horas, das 9h às 21h, dias úteis (seção acima). Horários de disparo: 9h, 12h, 15h, 18h, 21h. Contexto da decisão: "SOLICITAR URG" não exige resposta em tempo real — o gargalo real está no colaborador enviar a nota depois de receber o pedido, não na velocidade da Michelle solicitando; "urgente" aqui significa "processar ainda no mesmo dia", não "imediatamente". Por isso um intervalo de poucas horas (não minutos, não hora em hora) já atende a urgência real do processo.
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


PENDENTE: Confirmar com teste real, na implementação, se o campo "lock" da API do Box reflete também o indicador de coautoria do Excel Online, ou só o lock manual.
RESOLVIDO (10/09): a credencial `Claude account (produção)` foi criada no n8n e testada com sucesso.
MARCO (11/09): primeira execução real da Fase 1 em produção rodando de ponta a ponta com sucesso (execuções 276-278, via despachante por fonte, S01 e S02). Escrita confirmada na planilha real (S02, linha 13, coluna N = "OK - ASSINADO"), lock liberado corretamente, dedup funcionando com dado real (rascunho já existente reconhecido, sem duplicar), checagem de ficha cadastral corretamente não confirmando por falta de prova documental (foi a planilha de Contratos que liberou) — validação prática da correção do caso "Vanessa Paes".
PENDENTE (decisão de padronização, não bloqueante): a automação escreve "OK - ASSINADO" (com hífen, conforme o spec), mas as linhas preenchidas manualmente pela Michelle/Danielle usam "OK ASSINADO" (sem hífen). Visualmente destoa na planilha, e um filtro manual que compare texto exato pode não pegar as linhas da automação. Recomendação: manter o padrão da automação (com hífen) e, se necessário, padronizar manualmente as linhas antigas — não mudar a automação para bater com uma inconsistência pré-existente.
PENDENTE: Escopo de Recibos de Reembolso (RDP'S) — fora desta automação por enquanto, será tratado numa etapa futura separada.
PENDENTE (verificado em 25/08): o workflow de Rollback via Telegram (seção 13.3) NÃO existe — nem publicado, nem no repositório. Além disso, o pré-requisito descrito na própria seção 13.3 ("cada execução registra um recibo das ações feitas": IDs de rascunho, caminhos antes/depois no Drive, versão da planilha antes da edição) também não existe — hoje só é gravado `threadId` (`cobrancas.json`) e um resumo agregado (`log_diario.json`). Rollback depende de construir esse recibo primeiro. Tratado como item de backlog, a priorizar antes da liberação para produção — não bloqueia os testes atuais em homologação.
DECIDIDO (07/09, resolve o risco crítico encontrado nesta data): os arquivos de configuração (`cobrancas.json`, `apelidos.json`, `config_execucao.json`) passam a ser SEPARADOS por ambiente, em vez de um único arquivo compartilhado. Convenção de nome: arquivo sem sufixo = produção (ex. `cobrancas.json`); arquivo com sufixo `_hml` = homologação (ex. `cobrancas_hml.json`). Motivo: a planilha de teste de homolog é uma cópia real da planilha Cost (mesmos números de linha), então um arquivo único fazia a deduplicação da seção 3.1.6 correr o risco de tratar linhas reais de produção como "já processadas" só porque a mesma linha foi tocada num teste de homolog. **Sem necessidade de migração dos dados atuais**: a exigência de "nunca perder um ID já contabilizado" vale só para dados de PRODUÇÃO daqui pra frente (depois que execuções reais começarem) — os dados que hoje existem no `cobrancas.json` são todos de testes de homolog, então não precisam ser preservados na separação. Ambos os arquivos (`cobrancas.json` de produção e `cobrancas_hml.json` de homolog) podem nascer vazios. **Extensão (07/09): a mesma separação por ambiente (sufixo `_hml`) vale também para `log_diario.json` e `pendencias_identificacao.json`** — mesmo mecanismo (`__SUFIXO_AMBIENTE__`), mesma regra de dados existentes (preservar o que já existe movendo pro arquivo `_hml`, já que são dados de homolog; produção nasce vazio).
PENDENTE (encontrado em 27/08, seção 3.1.8): quando a Michelle envia manualmente um e-mail de "PROGRAMAR ATÉ" e avança o Status Box (ex. para "ENTREGUE MI") antes da automação agir na data-alvo, a entrada correspondente do rascunho fica órfã no `cobrancas.json` — nunca é limpa, porque a linha não bate mais no filtro de Status Box e nunca mais é processada. Não causa dano imediato (só cresce o arquivo), mas é dívida técnica — precisaria de uma rotina própria de limpeza de estado órfão. Não implementado, sem prioridade definida ainda.
PENDENTE (levantamento de 07/09) — estado real da Fase 2: NÃO é esqueleto vazio, tem lógica substancial já implementada nos 3 arquivos (`fase2_recebimento_validacao.json` 35 nodes, `fase2_verificar_pendencias.json` 28 nodes, `fase2_finalizar_nota.json` 22 nodes) — incluindo monitoramento de e-mail com anexo, extração de NF via IA, match de colaborador via IA, atualização de colunas D/E/F e "RECEBIDA MI", e o ciclo de correlação por reply no Telegram (janela 8h/26h) exatamente como especificado. MAS nenhum dos 3 está seguro para publicar — 5 bloqueadores encontrados: (1) `boxFileId` nunca é definido, usado em 5 pontos (lock/download/upload/unlock); (2) 4 IDs de pasta do Drive são literais `REPLACE_WITH_FOLDER_ID_…`; (3) MAIS GRAVE — perda de contexto depois do node de Gmail "Baixar anexo": o `$json.config.ambiente` deixa de existir logo depois, fazendo a checagem de ambiente cair sempre no ramo de produção (usaria a credencial de produção da IA mesmo em homolog) — e a extração da IA sobrescreve campos (`ehConhecida`, `roster`, `perfis`) que nodes seguintes dependem; (4) busca manual de e-mails sem `simple: false`, fazendo o filtro descartar 100% dos e-mails naquele ramo; (5) nenhum ramo por ambiente para o Cost Report — os 3 downloads vão direto ao Box de PRODUÇÃO, então rodar a Fase 2 em homolog hoje leria/escreveria (lock+upload) na planilha real. Além disso, a regra de Salvamento 2 por MODO_EXECUCAO (seção 4.2) ainda não existe no código da Fase 2 — só no spec. Os 3 arquivos também estão fora da arquitetura de fonte única (seção 7.6) e usam nomes de config sem sufixo de ambiente, então apontam pros arquivos de produção em qualquer ambiente — não é risco imediato (nenhum publicado), mas é o primeiro item a resolver quando entrarem na migração de fonte única. Recomendação: não publicar nenhum dos 3 até esses bloqueadores serem corrigidos.

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
