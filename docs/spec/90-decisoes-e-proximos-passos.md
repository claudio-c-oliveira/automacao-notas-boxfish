AUTOMAÇÃO — CONTROLE DE NOTAS FISCAIS · Box Fish · Michelle Aguiar

> **Mapa dos arquivos do spec (`docs/spec/`)**: `00-comum.md` (leitura obrigatória em qualquer tarefa) · `01-arquitetura-infra.md` · `fase-1.md` · `fase-2.md` · `fase-3-4.md` · `90-decisoes-e-proximos-passos.md`. Os números das seções são os do documento original e não mudaram. O Claude Code lê estes arquivos e **nunca os edita**.

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
