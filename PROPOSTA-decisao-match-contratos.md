# Decisão necessária — como cruzar nomes com a planilha de Contratos

**Contexto:** as linhas 702 e 722 ficaram pendentes na execução 108 **apesar de terem contrato
`ASSINADO`**. O cruzamento é por igualdade exata de string, e falhou por diferença de grafia.

```
L702  Cost Report:  "ELIANA AMRAL JORGE"          ← falta um "A"
      Contratos:    "ELIANA AMARAL JORGE"    · status ASSINADO
      (a razão social tem o mesmo typo: "56.240.209 ELIANA AMRAL JORGE" x "…AMARAL…")

L722  Cost Report:  "GUILHERME BRUM"              ← sem o nome do meio
      Contratos:    "GUILHERME RODRIGUES BRUM" · status ASSINADO
```

**Não mexi na regra de correspondência.** Afrouxar esse match é a decisão com maior risco de
todo o fluxo: um match errado libera um pedido de nota com base no contrato **de outra
pessoa**. Prefiro que você escolha.

## O que está em jogo

| | Erra pra que lado | Consequência |
|---|---|---|
| **Exato** (hoje) | Deixa de liberar quem tem contrato | Pedido urgente parado; agora **com alerta** avisando (Parte 2 desta rodada) |
| **Frouxo** | Libera quem não tem, ou com contrato de outro | E-mail de cobrança de nota indevido, em nome errado |

O primeiro erro é visível e reversível. O segundo é silencioso e vai pra fora da empresa.

## Opções

**A — Manter exato e resolver na origem.** O alerta agora identifica exatamente quais linhas
travaram; a Michelle corrige a grafia no Cost Report e a próxima execução libera. Custo: uma
correção manual por divergência. Risco de falso positivo: **zero**.

**B — Casar pelo CPF/CNPJ da razão social.** A coluna H frequentemente traz o número antes do
nome (`56.240.209 ELIANA AMRAL JORGE`), e a planilha de Contratos também
(`56.240.209 ELIANA AMARAL JORGE`). Comparar **só os dígitos** resolveria a L702 com precisão
alta — documento é identificador, nome não é.
**Não resolve a L722**, cujo Cost traz `GUILHERME BRUM` sem número nenhum.

**C — Match por nome com tolerância** (ignorar nome do meio, aceitar 1 caractere de diferença).
Resolveria as duas, mas é o caminho perigoso: `GUILHERME BRUM` também é parecido com
`GUILHERME HENRIQUE PORTES SIQUEIRA` e com `BRUNA GUILHERME COUTO`, ambos presentes na mesma
planilha, ambos `ASSINADO`. Uma regra frouxa demais liberaria o pedido errado.

**D — B + A combinados.** Documento quando existir (preciso), exato no nome quando não houver
documento, e alerta para o resto. É o que eu recomendaria: ganha precisão sem abrir margem
para casar pessoas diferentes.

## Se for B ou D, preciso de uma confirmação sua

Comparar por documento só é seguro se o número na coluna H for **sempre** do próprio
colaborador, nunca de um intermediário/agência. Não sei responder isso pelos dados — é
conhecimento do processo.

---

# Bug menor, no mesmo tema

A busca de ficha cadastral no Gmail extrai o nome com `colunaJ.split(' - ')[1]`. Na linha 704
isso devolveu **`"REUNION"`** — ou seja, buscou `label:CONTRATAÇÃO REUNION` em vez do nome do
colaborador:

```
L704  J: "CAMAREIRA APRESENTADORA - REUNION - MARIA ISOLINA DA…"
      split(" - ")[1] = "REUNION"     ← nome do projeto, não da pessoa
```

Não afetou o resultado (aquela linha foi liberada pela planilha), mas a checagem de ficha
daquela linha foi **inútil** — e falharia silenciosamente numa linha que dependesse dela.

A extração boa é a da **IA** (`nomeColaborador`), mas ela só roda **depois** das duas checagens
paralelas, então hoje não está disponível nesse ponto. As saídas seriam: mover a checagem de
ficha para depois da IA (muda a topologia), ou melhorar a extração determinística usada na
busca. Também não mexi — me diga se quer que eu ataque.
