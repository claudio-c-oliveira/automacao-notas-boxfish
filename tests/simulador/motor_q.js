// Mini-motor n8n para o ZZ-TEMP da coluna Q (sem rede): code (com require e getBinaryDataBuffer),
// httpRequest (JSON, multipart, headers, neverError, onError), box download (continueErrorOutput),
// if, executeOnce, $('X').first()/all()/isExecuted.
//
// Trazido do scratchpad (q/motor_q.js, 22/10/2026) para o repositório no passo 5 do C.8 (D12 = sim).
// Única mudança: os módulos do sandbox (jszip, exceljs) vêm do node_modules do projeto, e não
// mais de um node_modules ao lado do arquivo. O exceljs não está nas devDependencies: um Code
// node que faça require('exceljs') falha aqui até ele ser acrescentado.
const AsyncF = Object.getPrototypeOf(async function () {}).constructor;
const reqLocal = (m) => require(m);
module.exports = function criarMotor({ box, semJszip }) {
  return async function executar(wf) {
    const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
    const runs = {}; const ordem = [];
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
    const requireSandbox = (m) => { if (m === 'jszip' && semJszip) throw new Error("Cannot find module 'jszip'"); if (['jszip', 'exceljs'].includes(m)) return reqLocal(m); throw new Error('módulo bloqueado: ' + m); };
    async function rodar(nome, input) {
      const n = byName[nome]; let outs;
      if (n.executeOnce) input = input.slice(0, 1);
      if (n.type.endsWith('manualTrigger')) outs = [[{ json: {} }]];
      else if (n.type.endsWith('.code')) {
        const helpers = { getBinaryDataBuffer: async (i, p) => Buffer.from(input[i].binary[p].data, 'base64') };
        const its = await new AsyncF('$', '$input', 'require', 'Buffer', n.parameters.jsCode).call({ helpers }, $, { all: () => input, first: () => input[0] }, requireSandbox, Buffer);
        outs = [its.map((x) => ({ json: x.json, binary: x.binary }))];
      } else if (n.type.endsWith('httpRequest')) {
        outs = [[]];
        for (const [ix, it] of input.entries()) {
          const P = n.parameters; const url = ev(P.url, it.json, ix);
          const qs = P.sendQuery ? JSON.parse(ev(P.jsonQuery, it.json)) : {};
          const body = P.sendBody && P.contentType === 'json' ? JSON.parse(ev(P.jsonBody, it.json)) : null;
          const headers = {}; if (P.sendHeaders) for (const h of P.headerParameters.parameters) headers[h.name] = ev(h.value, it.json);
          const arquivo = P.contentType === 'multipart-form-data' ? Buffer.from(it.binary[P.bodyParameters.parameters[0].inputDataFieldName].data, 'base64') : null;
          let json;
          try { const r = box.http(P.method, url, qs, body, headers, arquivo); json = r.status < 300 ? (r.body || {}) : { type: 'error', status: r.status, code: r.code || 'x', message: r.message || '' }; }
          catch (e) { if (n.onError === 'continueRegularOutput') json = { error: { message: e.message } }; else throw e; }
          outs[0].push({ json });
        }
      } else if (n.type.endsWith('.box')) {
        outs = [[], []];
        for (const it of input) {
          const id = ev(n.parameters.fileId, it.json);
          try { const buf = box.download(id); outs[0].push({ json: { id }, binary: { data: { data: buf.toString('base64') } } }); }
          catch (e) { if (n.onError === 'continueErrorOutput') outs[1].push({ json: { error: e.message } }); else throw e; }
        }
      } else if (n.type.endsWith('.if')) {
        const c = n.parameters.conditions.conditions[0]; outs = [[], []];
        for (const it of input) (ev(c.leftValue, it.json) === true ? outs[0] : outs[1]).push(it);
      } else throw new Error('tipo ' + n.type);
      const principal = outs[0] && outs[0].length ? outs[0] : (outs[1] || []);
      runs[nome] = (runs[nome] || []).concat([principal]); ordem.push(nome);
      const c = wf.connections[nome]; if (!c) return;
      for (let i = 0; i < c.main.length; i++) { if (!outs[i] || !outs[i].length) continue; for (const d of c.main[i]) await rodar(d.node, outs[i]); }
    }
    let erro = null;
    try { await rodar('Manual Trigger', []); } catch (e) { erro = e.message; }
    return { runs, ordem, erro, saida: (n) => runs[n] ? runs[n][runs[n].length - 1][0].json : null };
  };
};
