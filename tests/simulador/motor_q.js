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
const AsyncF = Object.getPrototypeOf(async function () {}).constructor;
const reqLocal = (m) => require(m);
module.exports = function criarMotor({ box, semJszip, fs: disco }) {
  disco = disco || {};
  return async function executar(wf, opcoes = {}) {
    const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
    const runs = opcoes.runs || {}; const ordem = []; const chegou = {}; const mensagens = [];
    const parar = opcoes.parar || new Set();
    const $ = (nome) => ({
      first: () => { const r = runs[nome]; if (!r) throw new Error("Node '" + nome + "' hasn't been executed"); return r[r.length - 1][0]; },
      all: () => { const r = runs[nome]; if (!r) throw new Error("Node '" + nome + "' hasn't been executed"); return r[r.length - 1]; },
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
    const requireSandbox = (m) => { if (m === 'jszip' && semJszip) throw new Error("Cannot find module 'jszip'"); if (['jszip', 'exceljs'].includes(m)) return reqLocal(m); throw new Error('módulo bloqueado: ' + m); };
    async function rodar(nome, input) {
      const n = byName[nome];
      if (!n) throw new Error('simulador: node inexistente "' + nome + '"');
      if (parar.has(nome)) { (chegou[nome] = chegou[nome] || []).push(input); ordem.push('[parou em] ' + nome); return; }
      let outs;
      if (n.executeOnce) input = input.slice(0, 1);
      if (n.type.endsWith('manualTrigger')) outs = [[{ json: {} }]];
      else if (n.type.endsWith('executeWorkflowTrigger')) outs = [input.length ? input : [{ json: {} }]];
      else if (n.type.endsWith('.noOp')) outs = [input];
      else if (n.type.endsWith('.code')) {
        const helpers = { getBinaryDataBuffer: async (i, p) => Buffer.from(input[i].binary[p].data, 'base64') };
        try {
          const its = await new AsyncF('$', '$input', 'require', 'Buffer', n.parameters.jsCode).call({ helpers }, $, { all: () => input, first: () => input[0] }, requireSandbox, Buffer);
          outs = [its.map((x) => ({ json: x.json, binary: x.binary }))];
        } catch (e) {
          if (n.onError === 'continueErrorOutput') outs = [[], [{ json: { error: e.message } }]];
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
            const r = box.http(P.method || 'GET', url, qs, body, headers, arquivo, form);
            if (r.status >= 300 && !neverError) throw new Error('HTTP ' + r.status + ' ' + (r.code || ''));
            json = r.status < 300 ? (r.body || {}) : { type: 'error', status: r.status, code: r.code || 'x', message: r.message || '' };
          } catch (e) { if (n.onError === 'continueRegularOutput') json = { error: { message: e.message } }; else throw new Error('[' + nome + '] ' + e.message); }
          outs[0].push({ json });
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
        for (const [ix, it] of input.entries()) {
          const res = (P.conditions || []).map((c) => condicao(c, it.json, ix));
          const ok = (P.combinator || 'and') === 'or' ? res.some(Boolean) : res.every(Boolean);
          (ok ? outs[0] : outs[1]).push(it);
        }
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
      const principal = outs[0] && outs[0].length ? outs[0] : (outs[1] || []);
      runs[nome] = (runs[nome] || []).concat([principal]); ordem.push(nome);
      const c = wf.connections[nome]; if (!c) return;
      for (let i = 0; i < c.main.length; i++) { if (!outs[i] || !outs[i].length) continue; for (const d of c.main[i]) await rodar(d.node, outs[i]); }
    }
    let erro = null;
    try { await rodar(opcoes.inicio || 'Manual Trigger', opcoes.entrada || []); } catch (e) { erro = e.message; }
    return { runs, ordem, erro, chegou, mensagens, saida: (n) => runs[n] ? runs[n][runs[n].length - 1][0].json : null };
  };
};
