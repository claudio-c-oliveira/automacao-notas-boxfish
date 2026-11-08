'use strict';
/**
 * D66 (34ª rodada, 08/11/2026): antes de criar uma cobrança, conferir (SÓ LEITURA) se o rascunho do
 * PEDIDO e o da cobrança ANTERIOR ainda existem no Gmail.
 *
 *   - rascunho do pedido ainda existe       -> não cria a cobrança ("pedido ainda em rascunho")
 *   - rascunho da cobrança anterior existe  -> não cria outra ("cobrança anterior ainda em rascunho")
 *   - não existe mais (a Michelle enviou ou apagou) -> segue a cadência e cria
 *
 * Regra de segurança: "sumiu" só vale com resposta clara do Gmail de que o rascunho não existe
 * (HTTP 404). QUALQUER outra coisa (5xx, falha de rede, autenticação, 2xx sem o rascunho no corpo,
 * resposta estranha) = "não consegui verificar": não cria, não soma e relata. Na dúvida, não cria.
 * Entrada sem o id a consultar (entrada antiga): nada a consultar, segue como antes.
 *
 * Embutido no Code node "Decidir cobrança (rascunhos)" pelo marcador de inclusão do gerador.
 */

/**
 * Lê a resposta do HTTP Request (GET drafts/{id}, com "nunca dar erro" e "resposta completa"; ou o
 * item de erro do "continuar em erro").
 * @returns {{estado: 'existe'|'sumiu'|'nao_verificado', motivo: string|null}}
 */
function classificarLeituraRascunho(resp, draftIdEsperado) {
  if (!resp || typeof resp !== 'object') return { estado: 'nao_verificado', motivo: 'sem resposta' };
  if (resp.error) return { estado: 'nao_verificado', motivo: 'erro na consulta: ' + String(resp.error.message || resp.error).slice(0, 150) };
  const st = Number(resp.statusCode);
  if (st === 404) return { estado: 'sumiu', motivo: null };
  if (st >= 200 && st < 300) {
    const corpo = resp.body;
    if (corpo && typeof corpo === 'object' && corpo.id && (!draftIdEsperado || corpo.id === draftIdEsperado)) return { estado: 'existe', motivo: null };
    return { estado: 'nao_verificado', motivo: 'HTTP ' + st + ' sem o rascunho no corpo' };
  }
  if (!st) return { estado: 'nao_verificado', motivo: 'resposta sem código HTTP' };
  return { estado: 'nao_verificado', motivo: 'HTTP ' + st };
}

/**
 * Decide UMA linha de cobrança devida, com o resultado das consultas (null = não consultado, porque
 * não havia id a consultar). O pedido vem antes da cobrança anterior.
 * @returns {{acao: string, motivo: string|null}}
 */
function decidirCobrancaPorRascunhos(leituraPedido, leituraCobranca) {
  for (const [leitura, acaoExiste] of [[leituraPedido, 'cobranca_pedido_em_rascunho'], [leituraCobranca, 'cobranca_anterior_em_rascunho']]) {
    if (!leitura) continue;
    if (leitura.estado === 'existe') return { acao: acaoExiste, motivo: null };
    if (leitura.estado !== 'sumiu') return { acao: 'cobranca_nao_verificada', motivo: leitura.motivo || 'resultado desconhecido' };
  }
  return { acao: 'cobrar_rascunho', motivo: null };
}

module.exports = { classificarLeituraRascunho, decidirCobrancaPorRascunhos };
