# Proposta de esclarecimento no `docs/spec.md` — contradição entre 3.1.4 e 7.4

**Encontrei uma contradição ao implementar a seção 3.1.4.** Não decidi sozinho: implementei
só o que é inequívoco e deixei o comportamento atual intacto no ponto ambíguo.

## A contradição

**Seção 3.1.4** (último parágrafo antes da nota sobre `SOLICITADA MI`):

> Em ambiente `homolog`, **independentemente da escala, o e-mail sempre fica em rascunho**
> (regra de ambiente, seção 7.4) — isso não altera a escala em si, só o efeito final de envio.

**Seção 7.4** (tabela das 4 combinações) diz o contrário:

| | rascunho | automático |
|---|---|---|
| **homolog** | testar o fluxo com segurança, nada real envolvido | **testar o ciclo completo de envio automático**, mas só com destinatários fake |

Ou seja: a 3.1.4 afirma que homolog sempre deixa em rascunho e cita a 7.4 como fonte; a 7.4
descreve `homolog` + `automatico` justamente como o cenário para **testar o envio automático**
com destinatários de teste. As duas não podem estar certas ao mesmo tempo.

## O que fiz

**Não mexi nesse ponto.** O comportamento continua como está hoje: quem decide rascunho vs.
envio é o `MODO_EXECUCAO`, e o ambiente troca apenas destinatário e credencial. Motivo:

- Mudar isso não foi pedido nesta rodada.
- Se eu aplicasse "homolog sempre rascunho", **eliminaria a possibilidade de testar o ciclo de
  envio automático em homologação** — que é exatamente o que a 7.4 descreve como propósito
  daquela combinação. Seria uma perda de capacidade de teste decidida por mim.

A regra da escala 5 (`SOLICITAR / AGUARDAR DOCS` sempre em rascunho, mesmo em automático +
produção) **foi implementada**, porque essa é inequívoca e está só na 3.1.4.

## Qual das duas vale?

**Opção A — 7.4 vence (nada muda no código).** `homolog` + `automatico` envia de verdade, para
os destinatários de teste. Sugestão de ajuste na 3.1.4: trocar a frase por
> "Em ambiente `homolog`, o envio segue o `MODO_EXECUCAO` normalmente — a diferença é que o
> destinatário é o e-mail de teste (seção 7.4). A escala de urgência não altera isso."

**Opção B — 3.1.4 vence (preciso mudar o código).** `homolog` nunca envia, só cria rascunho.
Nesse caso a tabela da 7.4 precisa mudar: a célula `homolog` + `automatico` deixaria de ser
"testar o ciclo completo de envio automático" e passaria a ser algo como "sem efeito prático —
o comportamento é o mesmo do modo rascunho".

Me diga qual vale e eu ajusto — se for a B, é uma linha no `decidirAcaoEnvio`.

## Observação menor, no mesmo contexto

A tabela da 3.1.4 define escala 0 como o Status Box `SOLICITAR URG`, e "qualquer outro sufixo"
como escala 1. Implementei **literalmente**: só o token `URG` cai na escala 0.

Isso significa que **`SOLICITAR URGENTE` cairia na escala 1**, não na 0. Hoje não existe essa
variante na planilha (as reais são `SOLICITAR`, 32×, e `SOLICITAR / AGUARDAR DOCS`, 1×), então
não muda nada na prática — mas é o tipo de coisa que aparece quando alguém digita diferente.
Se quiser que qualquer variação de "urgente" caia na escala 0, é só dizer.
