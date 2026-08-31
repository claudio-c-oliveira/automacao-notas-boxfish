# Contexto do projeto — automação de notas fiscais Box Fish

Arquivo lido automaticamente a cada sessão. Serve para uma sessão nova (ou depois de um
reboot) retomar sem precisar reconstruir o contexto pelo histórico da conversa.

## A fonte da verdade é o `docs/spec.md`

Leia-o antes de qualquer mudança. Ele é grande e muda com frequência — o usuário pede
explicitamente "releia o spec.md atualizado" no início de quase toda rodada.

**Nunca invente regra que não esteja no spec.** Em caso de dúvida ou ambiguidade, pare e
pergunte, em vez de decidir sozinho.

**NÃO edite o `docs/spec.md` diretamente.** Quando precisar propor mudança nele, escreva a
sugestão num arquivo `PROPOSTA-spec-*.md` na raiz — o usuário leva ao Claude (chat) para
aplicar no spec oficial e devolve o arquivo final para commit. Isso evita conflito entre
edições suas e as dele no mesmo arquivo.

## Arquitetura: fonte única gera os dois ambientes

```
workflows/_fonte/fase1_solicitacao_nota.fonte.json     ← o ÚNICO arquivo editável à mão
        │  node scripts/gerar_workflows.js
        ├─→ workflows/fase1_solicitacao_nota.homolog.json    (gerado — não editar)
        └─→ workflows/fase1_solicitacao_nota.producao.json   (gerado — não editar)
```

Marcadores entendidos pela fonte:
- `credentials.<tipo>.__porAmbiente = { homolog, producao }` — resolve a credencial do ambiente.
- `node.__ifAmbiente = { saida0: 'homolog', saida1: 'producao' }` — o IF é removido e só o
  ramo do ambiente alvo sobrevive.

O gerador remove nodes inalcançáveis por **arestas puras**. Não preserve node por ele ser
citado em `$('...')`: sem aresta de entrada ele nunca executa, e preservá-lo já causou dois
bugs reais (vazamento de credencial do Box para o arquivo de homolog, e cadeia inteira do
Drive sobrevivendo em produção).

## Ciclo de trabalho de toda rodada

```bash
node scripts/gerar_workflows.js                                        # fonte → homolog + produção
node scripts/validar_workflows.js                                      # valida todos
node scripts/deploy_n8n.js workflows/fase1_solicitacao_nota.homolog.json
node scripts/validar_workflows.js --remoto workflows/fase1_solicitacao_nota.homolog.json
```

`deploy_n8n.js` tem trava: só publica `.homolog.json`. Produção exige
`--producao --confirmo-producao`, e nunca foi publicada.

`validar_workflows.js` compara cada parâmetro contra as definições oficiais em
`scripts/n8n_node_defs.json` (extraídas do `n8n-nodes-base`), porque **o n8n descarta
silenciosamente parâmetro que não reconhece**. Também checa referências `$('...')`:
node inexistente e node que só roda depois são ERRO.

## Regras de trabalho com o usuário (Claudio)

- **Ele não consegue copiar texto do terminal.** Toda resposta vai também em
  `resumo-ultima-entrega.md` (gitignored), com o texto do chat na íntegra, **sobrescrevendo**
  o arquivo a cada vez. Perguntas de decisão vão num `.txt` na raiz.
- **Não rode o Manual Trigger nem execute o workflow** sem confirmação explícita dele. Ele
  roda e reporta o resultado.
- Testes de verdade, não análise estática: workflows descartáveis (`ZZ-TEMP … (apagar)`) via
  API, contra dados reais, e apagados no fim. Vários bugs só apareceram assim.

## Estado atual (atualize quando mudar)

- **Fase 1** — publicada em homolog (inativa), ~120 nodes. Em validação com Manual Trigger.
- **Error Handler** — publicado e **ativo**. Alerta no Telegram em qualquer falha.
- **Fase 2** (3 workflows) e **resumo_diario** — existem como arquivo, **não publicados**, e
  ainda no formato antigo (sem fonte única).
- **Fase 3+4** — não iniciadas.
- **Rollback via Telegram (spec 13.3)** — não existe. Depende antes de a automação passar a
  registrar o "recibo" de cada execução.
- Comandos `/modo` e `/apelido` do Telegram — não existem. O `/resumo` existe em arquivo, não
  publicado. Para trocar o modo, editar `/opt/box-fish-config/config_execucao.json` na VM.

## Infraestrutura (detalhes na seção 7.6 do spec)

- n8n em `https://n8n.carvalhodeoliveira.com`, Docker puro na VM `n8n-boxfish` (GCP).
- Chave da API do n8n no `.env` (gitignored). `scripts/lib/n8n_api.js` a carrega.
- Config de execução: `/home/node/.n8n-files/box-fish-config/` no container ←
  `/opt/box-fish-config/` no host (bind mount). **Não use `/home/node/.n8n/`**: o n8n bloqueia
  acesso de arquivo ali (CVE-2025-68697).
- Bibliotecas de planilha na imagem: `exceljs` (lê cor de célula, `.xlsx`) e `xlsx`/SheetJS
  (lê `.xlsb` dos contratos). Exigem `NODE_FUNCTION_ALLOW_EXTERNAL=exceljs,xlsx`.

## Armadilhas já encontradas — não repetir

- **Binário no Code node**: esta instância guarda binário em disco (`filesystem-v2`), então
  `item.binary.data.data` é o *rótulo do modo*, não o conteúdo. Use
  `helpers.getBinaryDataBuffer(indice, prop)`, que só lê do **input direto**.
- **Aba da planilha**: `getWorksheet('Notas')` é sensível a maiúsculas e a aba é `NOTAS`. O
  fallback `|| worksheets[0]` já mandou leitura e escrita para `DETALHADO MÃE`. Sem fallback.
- **Node de Drive nativo**: manda `spaces: 'appDataFolder, drive'` e falha por escopo. As
  buscas usam HTTP Request com `spaces=drive`.
- **Editar `jsCode` por recorte de texto** ("da marca X até a marca Y") já engoliu funções
  vizinhas três vezes. Recorte por **bloco de função**.
- **`$('Node').item`** depende de pareamento de itens e quebra quando um node no meio agrega
  ou reemite sem `pairedItem`. Para correlacionar após um Switch, use
  `$('Switch — ação').all(N)`, que devolve só os itens daquela saída, em ordem.
