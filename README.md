# Automação de Notas Fiscais — Box Fish

Automação em n8n do controle e solicitação de notas fiscais de colaboradores/fornecedores
da Box Fish, cobrindo os projetos AREP, Reunion e Soft Pré.

A especificação completa (regras de negócio, templates de e-mail, arquitetura e decisões
tomadas) está em [`docs/spec.md`](docs/spec.md) — fonte da verdade do projeto.

## Estrutura do repositório

- `/workflows/` — workflows do n8n. **Os arquivos `.homolog.json` e `.producao.json`
  são GERADOS — não edite à mão** (ver "Fonte única" abaixo).
- `/workflows/_fonte/` — os arquivos-fonte (`*.fonte.json`), únicos que se edita.
- `/profiles/` — configuração de cada projeto (Reunion, Soft Pré, AREP) em JSON.
- `/docs/` — documentação, incluindo o `spec.md`.
- `/scripts/` — lógica usada em nós de Code do n8n (`fase*_logica.js`) **e** as
  ferramentas de build/validação (`gerar_workflows.js`, `validar_workflows.js`,
  `n8n_node_defs.json`).

## Fonte única + geração por ambiente

Só existe UM arquivo editável por workflow; os dois finais saem dele:

```
workflows/_fonte/fase1_solicitacao_nota.fonte.json      <- edita só aqui
        │  node scripts/gerar_workflows.js
        ├──> workflows/fase1_solicitacao_nota.homolog.json    <- importa e testa este
        └──> workflows/fase1_solicitacao_nota.producao.json   <- nunca editado à mão
```

Achou um problema testando o de homolog? Corrige na FONTE e roda o gerador de novo —
os dois saem atualizados juntos, então produção sempre reflete o que já foi validado
em homologação.

O gerador não só troca credenciais: ele **remove** do arquivo os nodes do outro
ambiente. Por isso o arquivo de homolog não tem sequer a credencial do Box — é
estruturalmente incapaz de tocar a planilha de produção, não depende de config estar
certa.

## Validação de parâmetros dos nodes

```
node scripts/validar_workflows.js
```

Confere cada parâmetro de cada node contra a definição oficial do node type (extraída
do pacote real `n8n-nodes-base`, em `scripts/n8n_node_defs.json`).

Existe porque o editor do n8n **não avisa** quando o JSON usa um nome de parâmetro que
o node não conhece — o campo só aparece vazio, silenciosamente. Foi assim que passaram
despercebidos: `to` (o certo é `sendTo`), `operation: "search"` e `"uploadVersion"`
(não existem), `options.labels` (não existe — nenhum marcador estava sendo aplicado) e
`fileId` como string onde o node espera um objeto `resourceLocator`.

Rodar sempre depois de mexer em workflow, e antes de importar no n8n.
- `/config/` — estado inicial dos arquivos de configuração que rodam em disco na VM
  do n8n (`config_execucao.json`, `apelidos.json`, `cobrancas.json` — spec.md seções
  3.1.1, 6.1 e 7.4; `log_diario.json` e `pendencias_identificacao.json` — spec.md
  seções 7.3 e 4, alimentam o resumo diário e o ciclo de identificação 8h/18h,
  não documentados por nome no spec.md, são detalhe de implementação). Não faziam
  parte da estrutura original do repositório; foram adicionados quando essas regras
  passaram a existir. Em runtime, o n8n lê/escreve esses arquivos direto do disco da
  VM, no caminho ABSOLUTO `/home/node/.n8n/box-fish-config/` (spec.md seção 7.5 —
  nunca `/home/node/.n8n/config` sozinho, que é um arquivo interno do próprio n8n
  com a chave de criptografia das credenciais) — o conteúdo aqui em `/config/` é só
  o ponto de partida versionado, não é sincronizado automaticamente com a VM depois
  do deploy inicial.

Nenhuma credencial (token, senha, chave de API) deve ir para o Git — essas ficam só
dentro do n8n (credenciais/variáveis de ambiente).
