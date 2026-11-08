'use strict';
// Gmail FALSO para o simulador (motor_q.js), 32ª rodada (07/11/2026). Nada de rede.
// Responde como o node do Gmail do n8n (n8n-nodes-base.gmail v2.1) e como a API REST do Gmail
// (HTTP Request para gmail.googleapis.com), e REGISTRA tudo em `chamadas`.
//
// Envios (message/send, reply, forward, sendAndWait, draft/send, POST messages/send ou drafts/send)
// vão para `envios`. D64 (33ª rodada): a automação NUNCA envia e-mail, em NENHUM modo. Qualquer
// envio é uma violação: entra em `violacoes` e o node falha com "ENVIO PROIBIDO (D64)", para o
// teste nunca passar em silêncio.
//
// Opções:
//   modo                 'rascunho' | 'automatico' (só registro: o envio é proibido nos dois)
//   falharRascunho       true -> draft/create dá erro (como um 500 do Gmail)
//   rascunhoSemId        true -> draft/create responde sem o id do rascunho
//   rascunhoSemThread    true -> draft/create responde sem o threadId da mensagem
//   marcadores           [{ id, name }] devolvidos por label/getAll
//   falharListagem       true -> label/getAll dá erro (como um 403/500 do Gmail)
//   falharAplicar        true -> message/addLabels dá erro
//   threads              { threadId: [{ id, labelIds }] } para thread/get e GET /threads/{id}
let seqGlobal = 0;
module.exports = function criarGmail(cfg = {}) {
  const chamadas = [], envios = [], violacoes = [], rascunhos = [];
  const threads = JSON.parse(JSON.stringify(cfg.threads || {}));
  const novoId = (p) => p + (++seqGlobal).toString(16).padStart(6, '0');
  function enviar(no, tipo, dados) {
    const reg = { no, tipo, ...dados };
    envios.push(reg);
    violacoes.push(reg);
    throw new Error('ENVIO PROIBIDO (D64) EM MODO ' + String(cfg.modo || '?').toUpperCase() + ' (' + no + ', ' + tipo + ')');
  }
  function chamar(no, p) {
    const op = p.resource + '/' + p.operation;
    chamadas.push({ no, op, p });
    switch (op) {
      case 'label/getAll':
        if (cfg.falharListagem) throw new Error('The resource you are requesting could not be found (simulado)');
        return (cfg.marcadores || []).map((l) => ({ id: l.id, name: l.name, type: 'user' }));
      case 'draft/create': {
        if (cfg.falharRascunho) throw new Error('Internal error encountered (simulado, draft/create)');
        const threadId = (p.options && p.options.threadId) || null;
        if (threadId && !threads[threadId]) throw new Error('Requested entity was not found (threadId ' + threadId + ' inexistente)');
        const id = novoId('r-'), msg = { id: novoId('m'), threadId: threadId || novoId('t'), labelIds: ['DRAFT'] };
        rascunhos.push({ no, id, messageId: msg.id, threadId: msg.threadId, threadIdPedido: threadId, assunto: p.subject, corpo: p.message, para: p.options && p.options.sendTo, cc: p.options && p.options.ccList });
        (threads[msg.threadId] = threads[msg.threadId] || []).push(msg);
        if (cfg.rascunhoSemId) return { message: {} };
        if (cfg.rascunhoSemThread) return { id, message: { id: msg.id, labelIds: ['DRAFT'] } };
        return { id, message: msg };
      }
      case 'message/send':
      case 'message/sendAndWait':
        return enviar(no, p.operation, { para: p.sendTo, assunto: p.subject });
      case 'message/reply':
      case 'message/forward':
        return enviar(no, p.operation, { messageId: p.messageId });
      case 'draft/send':
        return enviar(no, 'draft/send', { draftId: p.draftId || p.messageId });
      case 'message/addLabels': {
        if (cfg.falharAplicar) throw new Error('Bad request - please check your parameters (simulado)');
        const ids = Array.isArray(p.labelIds) ? p.labelIds : [];
        if (!p.messageId) throw new Error('Bad request - messageId vazio');
        if (!ids.length) throw new Error('Bad request - please check your parameters (labelIds vazio)');
        const validos = new Set((cfg.marcadores || []).map((l) => l.id));
        const invalido = ids.find((x) => !validos.has(x));
        if (invalido) throw new Error('Invalid label: ' + invalido);
        return { id: p.messageId, threadId: null, labelIds: ['DRAFT'].concat(ids) };
      }
      case 'thread/get': {
        const msgs = threads[p.threadId];
        if (!msgs) throw new Error('Requested entity was not found (thread ' + p.threadId + ')');
        return { id: p.threadId, messages: msgs };
      }
      case 'message/getAll':
        return [];
      default:
        throw new Error('Gmail falso: operação não simulada ' + op);
    }
  }
  function http(no, method, url, qs, body) {
    const caminho = url.replace(/^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me/, '');
    chamadas.push({ no, op: 'HTTP ' + method + ' ' + caminho, p: { qs, body } });
    if (method === 'POST' && (caminho === '/drafts/send' || caminho === '/messages/send')) enviar(no, 'HTTP ' + caminho, { body });
    if (method === 'GET' && caminho.startsWith('/threads/')) {
      const t = caminho.slice('/threads/'.length).split('?')[0];
      return threads[t] ? { status: 200, body: { id: t, messages: threads[t] } } : { status: 404, body: { error: { code: 404 } } };
    }
    if (method === 'GET' && caminho.startsWith('/drafts/')) {
      const id = caminho.slice('/drafts/'.length);
      const r = rascunhos.find((x) => x.id === id);
      return r ? { status: 200, body: { id, message: { id: r.messageId, threadId: r.threadId } } } : { status: 404, body: { error: { code: 404 } } };
    }
    if (method !== 'GET') { violacoes.push({ no, tipo: 'HTTP ' + method + ' ' + caminho }); throw new Error('Gmail falso: chamada que escreve não simulada: ' + method + ' ' + caminho); }
    return { status: 404, body: {} };
  }
  return { chamar, http, chamadas, envios, violacoes, rascunhos, threads };
};
