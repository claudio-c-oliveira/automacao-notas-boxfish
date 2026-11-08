// Mini-motor n8n para o ZZ-TEMP da coluna Q (sem rede): code (com require e getBinaryDataBuffer),
// httpRequest (JSON, multipart, headers, neverError, onError), box download (continueErrorOutput),
// if, executeOnce, $('X').first()/all()/isExecuted.
//
// Trazido do scratchpad (q/motor_q.js, 22/10/2026) para o repositório no passo 5 do C.8 (D12 = sim).
// Única mudança: os módulos do sandbox (jszip, exceljs) vêm do node_modules do projeto, e não
// mais de um node_modules ao lado do arquivo. O exceljs não está nas devDependencies: um Code
// node que faça require('exceljs') falha aqui até ele ser acrescentado.
//
// Adaptações do passo 6 do C.8 (29/10/2026), para rodar os cenários do C.7 sobre os nodes GERADOS:
//   1. executar(wf, opcoes): começa no node `opcoes.inicio` (padrão: 'Manual Trigger', como antes)
//      com os itens `opcoes.entrada`; aceita `executeWorkflowTrigger` (gatilho de sub-workflow).
//      `opcoes.runs` deixa várias chamadas compartilharem o histórico, para um trecho ler $() de
//      outro já executado. `opcoes.parar` = nodes onde a execução só é REGISTRADA (chegou), sem
//      rodar: é assim que se isola o ciclo do Cost do resto (Gmail, IA, Drive dos Contratos).
//   2. IF com VÁRIAS condições e combinador and/or; operadores boolean, number e string.
//   3. HTTP multipart com campos de texto (formData) além do arquivo (formBinaryData), passados
//      ao Box falso; neverError respeitado (sem ele, status >= 300 vira erro do node).
//   4. alwaysOutputData; onError continueErrorOutput no Code node.
//   5. readWriteFile (read/write) sobre um disco falso em memória (`fs` do criarMotor).
//   6. telegram: NÃO envia nada; só registra o texto em `mensagens`.
//   7. noOp.
//
// Adaptações da 32ª rodada (07/11/2026), para testar o Gmail e as rotas da Fase 1 de ponta a ponta:
//   8. A execução usa uma PILHA explícita (mesma ordem da recursão antiga: 1ª saída e 1º destino
//      primeiro, cada ramo até o fim). Isso permite o item 9.
//   9. merge (append, numberInputs): como no n8n v1, ESPERA — só roda quando nenhum trabalho
//      pendente ainda pode chegar a ele; junta as entradas na ordem dos índices. Entrada sem dado
//      não impede o merge de rodar (o mesmo que a execução 682 mostrou).
//  10. switch (rules, v3) com fallbackOutput 'extra'; $('X').all(saida) devolve os itens daquela
//      SAÍDA (é o que os nodes "Casar resposta…" usam com o Switch e os IF).
//  11. gmail (n8n-nodes-base.gmail) e HTTP para gmail.googleapis.com: vão para o Gmail FALSO do
//      criarMotor (`gmail`, de tests/simulador/gmail_falso.js), que só registra; sem ele, erro.
//      onError continueRegularOutput em qualquer node: o item com erro vira { json: { error } }.
//  12. relógio falso: `agora` (ISO ou ms) troca o Date dos Code nodes (new Date() e Date.now()).
const AsyncF = Object.getPrototypeOf(async function () {}).constructor;
const reqLocal = (m) => require(m);

function criarDateFalso(agora) {
  if (agora == null) return Date;
  const T = typeof agora === 'number' ? agora : Date.parse(agora);
  if (!isFinite(T)) throw new Error('simulador: relógio falso inválido: ' + agora);
  class DateFalso extends Date {
    constructor(...a) { if (a.length) super(...a); else super(T); }
    static now() { return T; }
  }
  return DateFalso;
}

module.exports = function criarMotor({ box, semJszip, fs: disco, gmail, agora }) {
  disco = disco || {};
  const DateSandbox = criarDateFalso(agora);
  return async function executar(wf, opcoes = {}) {
    const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
    const runs = opcoes.runs || {}; const ordem = []; const chegou = {}; const mensagens = [];
    const saidas = opcoes.saidas || {}; // nome -> [saida0, saida1, …] da última execução
    const parar = opcoes.parar || new Set();
    const $ = (nome) => ({
      first: () => { const r = runs[nome]; if (!r) throw new Error("Node '" + nome + "' hasn't been executed"); return r[r.length - 1][0]; },
      all: (saida) => {
        const r = runs[nome]; if (!r) throw new Error("Node '" + nome + "' hasn't been executed");
        if (saida === undefined || saida === null) return r[r.length - 1];
        return (saidas[nome] && saidas[nome][saida]) || [];
      },
      get isExecuted() { return !!runs[nome]; },
    });
    function ev(expr, json, idx) {
      if (typeof expr !== 'string' || !expr.startsWith('=')) return expr;
      const s = expr.slice(1);
      const f = (c) => new Function('$json', '$', '$itemIndex', '"use strict"; return (' + c + ');')(json, $, idx || 0);
      const m = s.match(/^\{\{([\s\S]*)\}\}$/); if (m) return f(m[1]);
      return s.replace(/\{\{([\s\S]*?)\}\}/g, (_, c) => f(c));
    }
    function condicao(c, json, idx) {
      const l = ev(c.leftValue, json, idx), r = ev(c.rightValue, json, idx);
      const op = c.operator || {};
      const k = op.type + '.' + op.operation;
      switch (k) {
        case 'boolean.equals': return l === r || (typeof r === 'boolean' && String(l) === String(r));
        case 'boolean.notEquals': return !(l === r || String(l) === String(r));
        case 'boolean.true': return l === true;
        case 'boolean.false': return l === false;
        case 'number.equals': return Number(l) === Number(r);
        case 'number.notEquals': return Number(l) !== Number(r);
        case 'number.gt': return Number(l) > Number(r);
        case 'number.gte': return Number(l) >= Number(r);
        case 'number.lt': return Number(l) < Number(r);
        case 'number.lte': return Number(l) <= Number(r);
        case 'string.equals': return String(l) === String(r);
        case 'string.notEquals': return String(l) !== String(r);
        case 'string.contains': return String(l).includes(String(r));
        case 'string.notEmpty': return l != null && String(l) !== '';
        case 'string.empty': return l == null || String(l) === '';
        default: throw new Error('IF: operador não suportado no simulador: ' + k);
      }
    }
    function avaliarCondicoes(P, json, ix) {
      const res = (P.conditions || []).map((c) => condicao(c, json, ix));
      return (P.combinator || 'and') === 'or' ? res.some(Boolean) : res.every(Boolean);
    }
    const requireSandbox = (m) => { if (m === 'jszip' && semJszip) throw new Error("Cannot find module 'jszip'"); if (['jszip', 'exceljs'].includes(m)) return reqLocal(m); throw new Error('módulo bloqueado: ' + m); };
    const exigirGmail = (nome) => { if (!gmail) throw new Error('[' + nome + '] simulador: node de Gmail sem o Gmail falso (criarMotor({ gmail }))'); return gmail; };

    // Alcançabilidade (para o merge saber se ainda pode receber algo)
    const alcance = {};
    function alcancaveis(nome) {
      if (alcance[nome]) return alcance[nome];
      const vistos = new Set(); const fila = [nome];
      while (fila.length) { const x = fila.pop(); const c = wf.connections[x]; if (!c) continue; for (const o of c.main) for (const d of (o || [])) if (!vistos.has(d.node)) { vistos.add(d.node); fila.push(d.node); } }
      return (alcance[nome] = vistos);
    }

    async function executarNode(nome, input) {
      const n = byName[nome];
      let outs;
      if (n.executeOnce) input = input.slice(0, 1);
      if (n.type.endsWith('manualTrigger')) outs = [[{ json: {} }]];
      else if (n.type.endsWith('executeWorkflowTrigger')) outs = [input.length ? input : [{ json: {} }]];
      else if (n.type.endsWith('.noOp')) outs = [input];
      else if (n.type.endsWith('.code')) {
        const helpers = { getBinaryDataBuffer: async (i, p) => Buffer.from(input[i].binary[p].data, 'base64') };
        try {
          const its = await new AsyncF('$', '$input', 'require', 'Buffer', 'Date', n.parameters.jsCode).call({ helpers }, $, { all: () => input, first: () => input[0] }, requireSandbox, Buffer, DateSandbox);
          outs = [its.map((x) => ({ json: x.json, binary: x.binary }))];
        } catch (e) {
          if (n.onError === 'continueErrorOutput') outs = [[], [{ json: { error: e.message } }]];
          else if (n.onError === 'continueRegularOutput') outs = [[{ json: { error: { message: e.message } } }]];
          else throw new Error('[' + nome + '] ' + e.message);
        }
      } else if (n.type.endsWith('httpRequest')) {
        outs = [[]];
        const P = n.parameters;
        const neverError = !!(P.options && P.options.response && P.options.response.response && P.options.response.response.neverError);
        for (const [ix, it] of input.entries()) {
          const url = ev(P.url, it.json, ix);
          const qs = P.sendQuery ? JSON.parse(ev(P.jsonQuery, it.json, ix)) : {};
          const body = P.sendBody && P.contentType !== 'multipart-form-data' && P.jsonBody ? JSON.parse(ev(P.jsonBody, it.json, ix)) : null;
          const headers = {}; if (P.sendHeaders) for (const h of P.headerParameters.parameters) headers[h.name] = ev(h.value, it.json, ix);
          let arquivo = null; const form = {};
          if (P.contentType === 'multipart-form-data') {
            for (const p of P.bodyParameters.parameters) {
              if (p.parameterType === 'formBinaryData') arquivo = Buffer.from(it.binary[p.inputDataFieldName].data, 'base64');
              else form[p.name] = ev(p.value, it.json, ix);
            }
          }
          let json;
          try {
            const r = /^https:\/\/gmail\.googleapis\.com\//.test(url) ? exigirGmail(nome).http(nome, P.method || 'GET', url, qs, body) : box.http(P.method || 'GET', url, qs, body, headers, arquivo, form);
            if (r.status >= 300 && !neverError) throw new Error('HTTP ' + r.status + ' ' + (r.code || ''));
            json = r.status < 300 ? (r.body || {}) : { type: 'error', status: r.status, code: r.code || 'x', message: r.message || '' };
          } catch (e) { if (n.onError === 'continueRegularOutput') json = { error: { message: e.message } }; else throw new Error('[' + nome + '] ' + e.message); }
          outs[0].push({ json });
        }
      } else if (n.type.endsWith('.gmail')) {
        const g = exigirGmail(nome);
        outs = [[]];
        const P = n.parameters;
        const params = (ix, json) => {
          const r = {};
          for (const [k, v] of Object.entries(P)) {
            if (v && typeof v === 'object' && !Array.isArray(v)) r[k] = Object.fromEntries(Object.entries(v).map(([k2, v2]) => [k2, ev(v2, json, ix)]));
            else r[k] = ev(v, json, ix);
          }
          // Os padrões do node do Gmail v2.1: sem resource é 'message'; sem operation, a do recurso
          // (em 'message' é 'send' — um node sem operação ENVIA, e o Gmail falso tem de ver isso).
          r.resource = r.resource || 'message';
          r.operation = r.operation || ({ message: 'send', draft: 'create', label: 'create', thread: 'get' }[r.resource]);
          return r;
        };
        // getAll de marcadores é uma chamada só (não por item)
        const lote = P.resource === 'label' && P.operation === 'getAll' ? input.slice(0, 1) : input;
        for (const [ix, it] of lote.entries()) {
          try {
            const r = g.chamar(nome, params(ix, it.json));
            for (const j of (Array.isArray(r) ? r : [r])) outs[0].push({ json: j });
          } catch (e) {
            if (n.onError === 'continueRegularOutput') outs[0].push({ json: { error: { message: e.message } } });
            else if (n.onError === 'continueErrorOutput') { outs[1] = outs[1] || []; outs[1].push({ json: { error: e.message } }); }
            else throw new Error('[' + nome + '] ' + e.message);
          }
        }
      } else if (n.type.endsWith('.box')) {
        outs = [[], []];
        for (const it of input) {
          const id = ev(n.parameters.fileId, it.json);
          try { const buf = box.download(id); outs[0].push({ json: { id }, binary: { data: { data: buf.toString('base64') } } }); }
          catch (e) { if (n.onError === 'continueErrorOutput') outs[1].push({ json: { error: e.message } }); else throw new Error('[' + nome + '] ' + e.message); }
        }
      } else if (n.type.endsWith('.if')) {
        const P = n.parameters.conditions; outs = [[], []];
        for (const [ix, it] of input.entries()) (avaliarCondicoes(P, it.json, ix) ? outs[0] : outs[1]).push(it);
      } else if (n.type.endsWith('.switch')) {
        const regras = (n.parameters.rules && n.parameters.rules.values) || [];
        const extra = n.parameters.options && n.parameters.options.fallbackOutput === 'extra';
        outs = Array.from({ length: regras.length + (extra ? 1 : 0) }, () => []);
        for (const [ix, it] of input.entries()) {
          const i = regras.findIndex((r) => avaliarCondicoes(r.conditions, it.json, ix));
          if (i >= 0) outs[i].push(it); else if (extra) outs[regras.length].push(it);
        }
      } else if (n.type.endsWith('.merge')) {
        outs = [input];
      } else if (n.type.endsWith('.readWriteFile')) {
        const P = n.parameters;
        if (P.operation === 'read') {
          const b = disco[P.fileSelector];
          outs = [b ? [{ json: { fileName: P.fileSelector }, binary: { data: { data: Buffer.from(b).toString('base64'), fileName: P.fileSelector } } }] : []];
        } else if (P.operation === 'write') {
          outs = [[]];
          for (const it of input) { disco[P.fileName] = Buffer.from(it.binary[P.dataPropertyName || 'data'].data, 'base64'); outs[0].push({ json: { fileName: P.fileName }, binary: it.binary }); }
        } else throw new Error('readWriteFile: operação ' + P.operation);
      } else if (n.type.endsWith('.telegram')) {
        outs = [[]];
        for (const [ix, it] of input.entries()) { mensagens.push({ node: nome, texto: ev(n.parameters.text, it.json, ix) }); outs[0].push(it); }
      } else throw new Error('tipo ' + n.type);
      if (n.alwaysOutputData && (!outs[0] || !outs[0].length) && !(outs[1] && outs[1].length)) outs[0] = [{ json: {} }];
      const principal = outs[0] && outs[0].length ? outs[0] : (outs.find((o) => o && o.length) || []);
      runs[nome] = (runs[nome] || []).concat([principal]); saidas[nome] = outs; ordem.push(nome);
      return outs;
    }

    // Pilha de trabalho: { nome, input, indiceEntrada }. Merges ficam em `esperando` até poderem rodar.
    const pilha = [];
    const esperando = new Map(); // nome do merge -> { [indiceEntrada]: itens[] }
    function empilharFilhos(nome, outs) {
      const c = wf.connections[nome]; if (!c) return;
      const tarefas = [];
      for (let i = 0; i < c.main.length; i++) { if (!outs[i] || !outs[i].length) continue; for (const d of (c.main[i] || [])) tarefas.push({ nome: d.node, input: outs[i], indiceEntrada: d.index || 0 }); }
      for (let k = tarefas.length - 1; k >= 0; k--) pilha.push(tarefas[k]);
    }
    const podeRodarMerge = (m) => !pilha.some((t) => t.nome === m || alcancaveis(t.nome).has(m));
    async function processar() {
      for (;;) {
        if (!pilha.length) {
          const pronto = [...esperando.keys()].find(podeRodarMerge);
          if (!pronto) break;
          const entradas = esperando.get(pronto); esperando.delete(pronto);
          const juntos = Object.keys(entradas).map(Number).sort((a, b) => a - b).flatMap((i) => entradas[i]);
          const outs = await executarNode(pronto, juntos);
          empilharFilhos(pronto, outs);
          continue;
        }
        const t = pilha.pop();
        const n = byName[t.nome];
        if (!n) throw new Error('simulador: node inexistente "' + t.nome + '"');
        if (parar.has(t.nome)) { (chegou[t.nome] = chegou[t.nome] || []).push(t.input); ordem.push('[parou em] ' + t.nome); continue; }
        if (n.type.endsWith('.merge')) {
          const e = esperando.get(t.nome) || {}; e[t.indiceEntrada] = (e[t.indiceEntrada] || []).concat(t.input); esperando.set(t.nome, e);
          // roda assim que nada pendente na pilha puder mais alcançá-lo
          if (podeRodarMerge(t.nome)) { esperando.delete(t.nome); const juntos = Object.keys(e).map(Number).sort((a, b) => a - b).flatMap((i) => e[i]); empilharFilhos(t.nome, await executarNode(t.nome, juntos)); }
          continue;
        }
        empilharFilhos(t.nome, await executarNode(t.nome, t.input));
      }
    }
    let erro = null;
    try { pilha.push({ nome: opcoes.inicio || 'Manual Trigger', input: opcoes.entrada || [], indiceEntrada: 0 }); await processar(); } catch (e) { erro = e.message; }
    return { runs, saidas, ordem, erro, chegou, mensagens, saida: (n) => runs[n] ? runs[n][runs[n].length - 1][0].json : null };
  };
};
