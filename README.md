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

Nenhuma credencial (token, senha, chave de API) deve ir para o Git — essas ficam só
dentro do n8n (credenciais/variáveis de ambiente).
