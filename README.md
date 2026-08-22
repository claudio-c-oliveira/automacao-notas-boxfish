# Automação de Notas Fiscais — Box Fish

Automação em n8n do controle e solicitação de notas fiscais de colaboradores/fornecedores
da Box Fish, cobrindo os projetos AREP, Reunion e Soft Pré.

A especificação completa (regras de negócio, templates de e-mail, arquitetura e decisões
tomadas) está em [`docs/spec.md`](docs/spec.md) — fonte da verdade do projeto.

## Estrutura do repositório

- `/workflows/` — JSON exportado dos workflows do n8n (um por fase + rollback).
- `/profiles/` — configuração de cada projeto (Reunion, Soft Pré, AREP) em JSON.
- `/docs/` — documentação, incluindo o `spec.md`.
- `/scripts/` — lógica mais longa usada em nós de Code do n8n.
- `/config/` — estado inicial dos arquivos de configuração que rodam em disco na VM
  do n8n (`config_execucao.json`, `apelidos.json`, `cobrancas.json` — spec.md seções
  3.1.1, 6.1 e 7.4; `log_diario.json` e `pendencias_identificacao.json` — spec.md
  seções 7.3 e 4, alimentam o resumo diário e o ciclo de identificação 8h/18h,
  não documentados por nome no spec.md, são detalhe de implementação). Não faziam
  parte da estrutura original do repositório; foram adicionados quando essas regras
  passaram a existir. Em runtime, o n8n lê/escreve esses arquivos direto do disco da
  VM — o conteúdo aqui é só o ponto de partida versionado, não é sincronizado
  automaticamente com o disco depois do deploy inicial.

Nenhuma credencial (token, senha, chave de API) deve ir para o Git — essas ficam só
dentro do n8n (credenciais/variáveis de ambiente).
