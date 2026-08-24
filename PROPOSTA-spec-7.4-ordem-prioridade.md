# Proposta de alteração no `docs/spec.md` — seção 7.4

**Por que esta proposta existe:** você confirmou a ordem de prioridade dentro do
`limite_linhas_execucao` (Opção 1) dizendo que já estava documentada na seção 7.4. O
`spec.md` do repositório ainda não tem essa regra — o texto atual diz o contrário
("na ordem em que aparecem na planilha"). Implementei conforme sua instrução; falta o
spec refletir isso.

Como não edito mais o `spec.md` direto, segue o texto pronto pra você levar ao Claude.

---

## Trecho ATUAL (seção 7.4, parágrafo "Terceiro controle")

> **Terceiro controle, independente dos dois eixos acima — limite de execução ("modo
> assistido")**: para acompanhar a validação em produção com mais controle, Claudio pode
> limitar quantas linhas são processadas numa única execução, em qualquer fase. Ex.: se o
> filtro "PROGRAMAR ATÉ" bater 20 linhas, mas o limite estiver setado em 5, o workflow
> processa só as **5 primeiras linhas que bateram no filtro (na ordem em que aparecem na
> planilha)** e ignora o restante naquela execução — as demais entram na próxima.

## Trecho PROPOSTO (substituindo o acima)

> **Terceiro controle, independente dos dois eixos acima — limite de execução ("modo
> assistido")**: para acompanhar a validação em produção com mais controle, Claudio pode
> limitar quantas linhas são processadas numa única execução, em qualquer fase. Ex.: se o
> filtro bater 20 linhas, mas o limite estiver setado em 5, o workflow processa só 5 e
> ignora o restante naquela execução — as demais entram na próxima.
>
> **Ordem de prioridade dentro do limite (confirmada por Claudio)**: as vagas do limite
> NÃO são preenchidas na ordem em que as linhas aparecem na planilha. São preenchidas por
> prioridade:
>
> | Ordem | Tipo de linha | Por quê |
> |---|---|---|
> | 1º | `SOLICITAR` e variantes | Pedido imediato — é o que está sendo esperado para sair |
> | 2º | `PROGRAMAR ATÉ [data]` | Tem data marcada; aguenta a próxima execução |
> | 3º | Monitoramento (`SOLICITADA MI`) | Só se sobrar vaga; cobrança pode esperar |
>
> Dentro de uma mesma prioridade, vale a ordem em que as linhas aparecem na planilha.
> A regra vale igualmente para `homolog` e `produção`.
>
> Motivo: sem essa ordenação, o corte era pela ordem da planilha, e uma leva de linhas de
> monitoramento no topo consumia todas as vagas do limite — nenhum pedido saía. Aconteceu na
> validação: com `limite_linhas_execucao = 2`, uma das duas vagas foi para uma linha
> `SOLICITADA MI` que não tinha nenhuma ação a executar.

---

## Observação adicional, se você quiser incluir

A ordenação por prioridade roda **mesmo quando não há limite** (`null`/`0`). Isso não muda
*quais* linhas são processadas, só a ordem — mantém o comportamento previsível entre uma
execução limitada e uma sem limite. Se preferir que a ordenação só valha quando há limite,
me avise que eu ajusto o código; hoje está sempre ativa.
