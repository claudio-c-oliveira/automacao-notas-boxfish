#!/usr/bin/env node
// Nome original: zz-temp-coluna-q.js
// Data: 28/10/2026
// referência provada em 21–22/10/2026 (backup verificado, Passo 0, lock/If-Match/unlock, comparação completa); reaproveitar na Fase 1
/**
 * ZZ-TEMP — marcação da coluna Q ("CHECK ARQUIVO DRIVE" = "OK") nas notas do piloto, 21/10/2026.
 *
 * NÃO EXECUTAR sem OK explícito do Claudio. Rodada A (cópia descartável) antes; rodada B (arquivo
 * real) só se a A sair idêntica E com novo OK dele.
 *
 * Como os outros ZZ-TEMP: este script não toca no Box. Ele monta, cria e apaga, via API do n8n, um
 * workflow descartável (inativo, só Manual Trigger, sem webhook, sem Telegram, sem e-mail) que o
 * Claudio executa no editor. A execução fica salva; "ler" lê o resultado pela API e "apagar" apaga a
 * execução e o workflow. UM arquivo por execução (S01 e S02 nunca no mesmo ciclo de escrita).
 *
 * Grava com scripts/lib/xlsx_cirurgico.js (embutido no Code node): só o XML da aba NOTAS é
 * reescrito; todas as outras partes do pacote são copiadas como estavam. NUNCA exceljs para gravar
 * (exceljs só lê). NÃO usa nada da Fase 1.
 *
 * Ciclo (credencial "Box account" = michelle.mimiaguia@gmail.com):
 *   0. jszip e exceljs disponíveis no Code node? Se não, para antes de qualquer chamada ao Box.
 *   1. identidade (users/me) e portão do Cost (ID novo + nome exato, com ou sem .xlsx).
 *   2. pastas ZZ-TESTE-ESCRITA e ZZ-BACKUP-COST na raiz do Box da Michelle: cria se faltar, confere
 *      que não têm link nem colaboradores. Se houver duas com o mesmo nome, para.
 *   3. (só rodada A) copia o Cost, pelo próprio Box, para ZZ-TESTE-ESCRITA; confere sha1 e tamanho.
 *      O ALVO da rodada A é essa cópia. Na rodada B o alvo é o Cost real.
 *   4. BACKUP do alvo: cópia pelo Box em ZZ-BACKUP-COST, nome "<nome>_copia_AAAA-MM-DD_HHMMSS.xlsx",
 *      conferida por sha1 e tamanho (e relida). Sem backup verificado, para.
 *   5. RETENÇÃO: 5 backups por planilha. Se o novo for o 6º, apaga o mais antigo (só em
 *      ZZ-BACKUP-COST, só com o padrão de nome daquela planilha, no máximo 1, só depois do novo
 *      verificado). Se faltar permissão, não apaga e avisa.
 *   6. checa o lock: travado por QUALQUER pessoa (inclusive nós) -> não escreve, para.
 *      Guarda a versão: sha1, version id, etag. sha1 tem de ser o do backup.
 *   7. LOCK. Daqui em diante, o UNLOCK roda em qualquer caminho.
 *   8. relê o arquivo, confere sha1, cabeçalho Q4/Q2 e B, E, G e H de cada linha-alvo, acha o estilo
 *      do "OK" verde já existente, aplica, compara antes/depois EM MEMÓRIA. Se algo divergir, não sobe.
 *   9. upload da nova versão com If-Match: etag (se alguém subiu outra versão, o Box recusa).
 *  10. UNLOCK.
 *  11. relê e compara de novo (sha1 do upload, partes do pacote, células Q).
 *  12. se 11 falhar: RESTAURA — backup do estado atual, lock, sobe o backup do passo 4 como nova
 *      versão (If-Match), unlock, confere sha1 = sha1 do backup.
 *
 * Uso:
 *   node zz-temp-coluna-q.js gerar A S01     # grava zz-temp-coluna-q.workflow.json (sem rede)
 *   node zz-temp-coluna-q.js criar A S01     # cria INATIVO no n8n
 *   node zz-temp-coluna-q.js ler             # lê a execução salva (resultado compacto)
 *   node zz-temp-coluna-q.js apagar          # apaga execução(ões) e workflow, e confere
 *   (rodada B só é gerada se existir zz-temp-coluna-q-resultado-A-<fonte>.json com resultado IDÊNTICO)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { carregarEnv, N8nApi } = require('./scripts/lib/n8n_api.js');

const ARQ_WF = path.join(__dirname, 'zz-temp-coluna-q.workflow.json');
const ARQ_ESTADO = path.join(__dirname, 'zz-temp-coluna-q.estado.json');
const arqResultado = (rodada, fonte) => path.join(__dirname, 'zz-temp-coluna-q-resultado-' + rodada + '-' + fonte + '.json');

const CRED_BOX = { boxOAuth2Api: { id: 'F3IAn9JMongsJnSZ', name: 'Box account' } };
const BOX_API = 'https://api.box.com/2.0';
const BOX_UPLOAD = 'https://upload.box.com/api/2.0';
const LOGIN_ESPERADO = 'michelle.mimiaguia@gmail.com';
const PASTA_TESTE = 'ZZ-TESTE-ESCRITA';
const PASTA_BACKUP = 'ZZ-BACKUP-COST';
const RETER = 5;

// Cost novos (confirmados pelo Claudio em 21/10) e as células do piloto. B/E/H = texto da célula
// como a leitura de 21/10 viu; G = data ISO. Q só recebe "OK" se estiver vazio.
const COST = {
  S01: {
    id: '2482160269668', nome: 'BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_22.09',
    alvos: [
      { ref: 'Q247', linha: 247, nota: 'GAMBOA #001427', b: '1641.R', e: '14-27', g: '2026-10-20', h: 'GAMBOA AGENCIA DE VIAGENS E TURISMO ME' },
      { ref: 'Q1552', linha: 1552, nota: 'ALTNET #09344', b: '3793.R', e: '09344', g: '2026-10-05', h: 'ALTNET SERVIÇOS DE INFORMÁTICA E TECNOLOGIA LTDA' },
    ],
  },
  S02: {
    id: '2482145718537', nome: 'BR_SMTC_S02_SOFTPRE_PROVISÓRIO_22.09',
    alvos: [
      { ref: 'Q60', linha: 60, nota: 'TELEVIZOL #000049', b: '1420.S', e: '000049', g: '2026-09-20', h: 'TELEVIZOL PRODUCOES ARTISTICAS LTDA' },
    ],
  },
};
const CAMPOS = 'name,sha1,size,etag,file_version,lock,item_status,modified_at,modified_by,parent,permissions';
// Estilo do "OK" verde que cada Cost já usa (visto nas rodadas A de 21/10). Se a escolha automática
// der outro índice, não escreve.
COST.S01.estiloOK = '370';
COST.S02.estiloOK = '410';
// Escopos aprovados pelo Claudio em 21/10, por rodada e fonte. Linhas da aba NOTAS; os dados de
// conferência (B, E, G, H) vêm do registro. Linha com duas peças (NF + boleto) entra uma vez só.
const ESCOPO = {
  'B-S02': [11, 12, 13, 14, 18, 19, 23, 40, 41, 42, 46, 47, 51, 52, 53, 56, 57, 60, 67, 68, 104, 105, 112, 113, 117, 118, 120, 121, 138, 169, 170, 172, 173, 197, 229, 230],
  'A-S01': [955, 1780, 1813, 1828, 284, 779, 780, 1798],
  'B-S01': [955, 1780, 1813, 1828, 284, 779, 780, 1798],
};
function alvosDe(rodada, fonte) {
  const linhas = ESCOPO[rodada + '-' + fonte];
  if (!linhas) return COST[fonte].alvos;
  if (new Set(linhas).size !== linhas.length) throw new Error('escopo ' + rodada + '-' + fonte + ' com linha repetida. Nada gerado.');
  const reg = notasDoRegistro().filter((x) => x.f === fonte);
  return linhas.map((l) => {
    const ns = reg.filter((x) => x.l === l);
    if (!ns.length) throw new Error('escopo ' + rodada + '-' + fonte + ': a linha ' + l + ' não tem nota no registro. Nada gerado.');
    const k = (x) => [x.b, x.e, x.g, x.h].join('|');
    if (new Set(ns.map(k)).size !== 1) throw new Error('escopo ' + rodada + '-' + fonte + ': a linha ' + l + ' tem notas com B/E/G/H diferentes. Nada gerado.');
    return { ref: 'Q' + l, linha: l, nota: ns.map((x) => x.nota).join(' + '), b: ns[0].b, e: ns[0].e, g: ns[0].g, h: ns[0].h };
  });
}

// As 151 notas do registro durável (3 do piloto + 27 do resto + 121 existentes), montadas com os
// resultados das três execuções de escrita, cada uma casada (nome + MD5) com exatamente um item do
// plano, de onde vêm fonte, linha e B/E/G/H. Usadas na contagem (só leitura) e como reservas da
// rodada A quando a célula do plano já está "OK".
function notasDoRegistro() {
  const plano = JSON.parse(fs.readFileSync(path.join(__dirname, 'zz-temp-plano-2026-10-19.json'), 'utf8'));
  const itens = Object.values(plano.projetos).flatMap((pp) => [...pp.copias, ...pp.jaExistiam]);
  const notas = ['piloto', 'resto', 'existentes'].flatMap((l) => JSON.parse(fs.readFileSync(path.join(__dirname, 'zz-temp-escrita-resultado-' + l + '.json'), 'utf8')).notas);
  const out = notas.map((n) => {
    const m = itens.filter((x) => x.origem.nome === n.arquivo && x.origem.md5 === n.origemMd5);
    if (m.length !== 1) throw new Error('registro: "' + n.arquivo + '" casa com ' + m.length + ' itens do plano (esperado 1). Nada gerado.');
    const x = m[0];
    const num = (n.arquivo.match(/#([^#]+?)\.pdf$/i) || [])[1] || '?';
    return { f: x.fonte, l: x.linha, b: x.codigo, e: x.colunaE, g: x.vencimento, h: x.fornecedorCost, nota: x.fornecedorCost + ' #' + num, status: n.status };
  });
  if (out.length !== 151) throw new Error('registro: ' + out.length + ' notas, esperado 151. Nada gerado.');
  return out;
}

// Biblioteca de escrita cirúrgica, embutida como está no repositório (sem o module.exports).
function fonteCirurgico() {
  const src = fs.readFileSync(path.join(__dirname, 'scripts/lib/xlsx_cirurgico.js'), 'utf8');
  const semExport = src.replace(/^'use strict';\s*/m, '').replace(/\nmodule\.exports\s*=[^\n]*\n?/, '\n');
  if (/module\.exports/.test(semExport)) throw new Error('não consegui remover o module.exports do xlsx_cirurgico.js');
  return semExport;
}

// ---------------------------------------------------------------------------------------
// Fábricas de node
// ---------------------------------------------------------------------------------------
let posX = 0;
const pos = () => { posX += 220; return [posX, 0]; };
const code = (name, js, extra) => ({ id: crypto.randomUUID(), name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(), parameters: { jsCode: js }, ...(extra || {}) });
// Box via HTTP Request. Compacto (sem cabeçalhos); o status sai do corpo de erro do Box
// ({ type: 'error', status }). neverError: quem decide é o Code node seguinte.
function boxHttp(name, method, url, opt = {}) {
  const parameters = {
    method, url, authentication: 'predefinedCredentialType', nodeCredentialType: 'boxOAuth2Api',
    options: { response: { response: { neverError: true, responseFormat: 'json' } } },
  };
  if (opt.query) Object.assign(parameters, { sendQuery: true, specifyQuery: 'json', jsonQuery: opt.query });
  if (opt.body) Object.assign(parameters, { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: opt.body });
  if (opt.upload) Object.assign(parameters, { sendBody: true, contentType: 'multipart-form-data', bodyParameters: { parameters: [{ parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' }] } });
  if (opt.ifMatch) Object.assign(parameters, { sendHeaders: true, specifyHeaders: 'keypair', headerParameters: { parameters: [{ name: 'If-Match', value: opt.ifMatch }] } });
  const n = { id: crypto.randomUUID(), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos(), parameters, credentials: CRED_BOX };
  if (opt.continuar) n.onError = 'continueRegularOutput';
  if (opt.umaVez) n.executeOnce = true;
  return n;
}
function boxDownload(name, fileIdExpr) {
  return {
    id: crypto.randomUUID(), name, type: 'n8n-nodes-base.box', typeVersion: 1, position: pos(),
    parameters: { resource: 'file', operation: 'download', fileId: fileIdExpr, binaryPropertyName: 'data' },
    credentials: CRED_BOX, onError: 'continueErrorOutput',
  };
}
const se = (name, expr) => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.if', typeVersion: 2, position: pos(),
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr, rightValue: true, operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' } },
});

// ---------------------------------------------------------------------------------------
// Código comum dos Code nodes
// ---------------------------------------------------------------------------------------
const COMUM = String.raw`
const BOX_API = '${BOX_API}';
const BOX_UPLOAD = '${BOX_UPLOAD}';
function status(it) { const j = it && it.json; if (!j) return undefined; if (j.type === 'error') return j.status || 500; return 200; }
function corpo(it) { return (it && it.json) || {}; }
function resumoErro(it) { const j = corpo(it); return 'HTTP ' + status(it) + (j.code ? ' ' + j.code : '') + (j.message ? ' — ' + String(j.message).slice(0, 200) : ''); }
function quem(u) { return u ? (u.login || u.name || u.id) : null; }
function semExt(n) { return String(n).replace(/\.xlsx$/i, ''); }
function carimbo(d) {
  // AAAA-MM-DD_HHMMSS no horário de São Paulo.
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return p.year + '-' + p.month + '-' + p.day + '_' + (p.hour === '24' ? '00' : p.hour) + p.minute + p.second;
}
function escRe(s) { return String(s).replace(/[.*+?^$${'{'}}()|[\]\\]/g, '\\$&'); }
function cfg() { return $('Config').first().json; }
`;

// SHA-1 em JS puro (o Code node não libera o módulo crypto). Entrada: Buffer/Uint8Array.
const SHA1 = String.raw`
function sha1(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = b.length, total = (((n + 8) >> 6) + 1) << 4, w = new Int32Array(total);
  for (let i = 0; i < n; i++) w[i >> 2] |= b[i] << (24 - (i % 4) * 8);
  w[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
  w[total - 1] = n * 8; w[total - 2] = Math.floor(n / 0x20000000);
  let h0 = 0x67452301, h1 = 0xEFCDAB89 | 0, h2 = 0x98BADCFE | 0, h3 = 0x10325476, h4 = 0xC3D2E1F0 | 0;
  const x = new Int32Array(80);
  for (let o = 0; o < total; o += 16) {
    for (let t = 0; t < 16; t++) x[t] = w[o + t];
    for (let t = 16; t < 80; t++) { const v = x[t - 3] ^ x[t - 8] ^ x[t - 14] ^ x[t - 16]; x[t] = (v << 1) | (v >>> 31); }
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? ((bb & c) | (~bb & d)) + 0x5A827999 : t < 40 ? (bb ^ c ^ d) + 0x6ED9EBA1 : t < 60 ? ((bb & c) | (bb & d) | (c & d)) + 0x8F1BBCDC | 0 : (bb ^ c ^ d) + 0xCA62C1D6 | 0;
      const tmp = (((a << 5) | (a >>> 27)) + f + e + x[t]) | 0;
      e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = tmp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}
const sha1Txt = (s) => sha1(Buffer.from(s, 'utf8'));
`;

// Impressão digital do pacote: tudo o que as comparações pedem, compacto (contagens + sha1).
const IMPRESSAO = String.raw`
async function impressao(zip, abaAlvo, refsMascarar) {
  const partes = {};
  for (const nome of Object.keys(zip.files).sort()) { if (zip.files[nome].dir) continue; partes[nome] = sha1(await zip.file(nome).async('uint8array')); }
  const wb = await zip.file('xl/workbook.xml').async('string');
  const abas = (wb.match(/<sheet\b[^>]*?\/>/g) || []).map((t) => (t.match(/\bname="([^"]*)"/) || [])[1]);
  const secoes = (xml) => {
    const todos = (re) => xml.match(re) || [];
    const um = (lista) => ({ n: lista.length, sha1: sha1Txt(lista.join('\n')) });
    const cfLeg = todos(/<conditionalFormatting[\s>][\s\S]*?<\/conditionalFormatting>/g);
    const ext = todos(/<extLst[\s>][\s\S]*?<\/extLst>/g);
    return {
      cols: um(todos(/<cols>[\s\S]*?<\/cols>/g)),
      cfLegado: { blocos: cfLeg.length, regras: (cfLeg.join('').match(/<cfRule[\s>]/g) || []).length, sha1: sha1Txt(cfLeg.join('\n')) },
      x14cfRule: { regras: (xml.match(/<x14:cfRule[\s>]/g) || []).length, sha1: sha1Txt(todos(/<x14:conditionalFormatting[\s>][\s\S]*?<\/x14:conditionalFormatting>/g).join('\n')) },
      extLst: um(ext),
      autoFilter: um(todos(/<autoFilter\b[^>]*\/>|<autoFilter\b[^>]*>[\s\S]*?<\/autoFilter>/g)),
      mesclagens: { n: (xml.match(/<mergeCell\b/g) || []).length, sha1: sha1Txt(todos(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/g).join('\n')) },
    };
  };
  const porAba = {};
  let notasMascarada = null, notasLinhas = null, notasCelulas = null;
  for (const nome of abas) {
    const parte = await caminhoDaAba(zip, nome);
    const xml = await zip.file(parte).async('string');
    porAba[nome] = { parte, ...secoes(xml) };
    if (nome === abaAlvo) {
      let m = xml;
      for (const ref of refsMascarar) m = m.replace(new RegExp('<c\\b[^>]*?\\br="' + ref + '"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)'), '');
      notasMascarada = sha1Txt(m);
      notasLinhas = (xml.match(/<row[ >]/g) || []).length;
      notasCelulas = (xml.match(/<c[ >]/g) || []).length;
    }
  }
  const st = await zip.file('xl/styles.xml').async('string');
  const bloco = st.match(/<dxfs[^>]*>([\s\S]*?)<\/dxfs>/);
  const dxfs = bloco ? (bloco[1].match(/<dxf>[\s\S]*?<\/dxf>/g) || []) : [];
  const xfs = ((st.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '').match(/<xf\b/g) || [];
  return { partes, abas, porAba, estilos: { sha1: partes['xl/styles.xml'], dxfTotal: dxfs.length, dxfDistintos: new Set(dxfs).size, cellXfs: xfs.length }, notasMascarada, notasLinhas, notasCelulas };
}
// Compara duas impressões. 'mudaNotas' = a parte da aba NOTAS pode diferir (só as células-alvo,
// conferido pelo XML mascarado). Devolve a tabela de itens e a lista de divergências.
function comparar(A, B, abaAlvo, mudaNotas) {
  const itens = [], div = [];
  const item = (nome, a, b, igual) => { itens.push({ item: nome, antes: a, depois: b, igual }); if (!igual) div.push(nome + ': ' + JSON.stringify(a) + ' -> ' + JSON.stringify(b)); };
  const j = (x) => JSON.stringify(x);
  const nA = Object.keys(A.partes), nB = Object.keys(B.partes);
  item('lista de partes do pacote', nA.length, nB.length, j(nA) === j(nB));
  const parteNotas = (A.porAba[abaAlvo] || {}).parte;
  const difPartes = nA.filter((p) => A.partes[p] !== B.partes[p] && !(mudaNotas && p === parteNotas));
  item('partes byte a byte iguais (fora a aba NOTAS)', nA.length - (mudaNotas ? 1 : 0), nA.length - (mudaNotas ? 1 : 0) - difPartes.length, difPartes.length === 0);
  if (difPartes.length) div.push('partes diferentes: ' + difPartes.join(', '));
  item('lista de abas', A.abas, B.abas, j(A.abas) === j(B.abas));
  item('styles.xml (cores/estilos)', A.estilos.sha1.slice(0, 12), B.estilos.sha1.slice(0, 12), A.estilos.sha1 === B.estilos.sha1);
  item('dxfs (total / distintos)', A.estilos.dxfTotal + ' / ' + A.estilos.dxfDistintos, B.estilos.dxfTotal + ' / ' + B.estilos.dxfDistintos, A.estilos.dxfTotal === B.estilos.dxfTotal && A.estilos.dxfDistintos === B.estilos.dxfDistintos);
  for (const aba of A.abas) {
    const a = A.porAba[aba], b = B.porAba[aba] || {};
    for (const k of ['cols', 'cfLegado', 'x14cfRule', 'extLst', 'autoFilter', 'mesclagens']) {
      const ra = a[k] || {}, rb = b[k] || {};
      const qa = ra.n != null ? ra.n : (ra.regras != null ? ra.regras : ''), qb = rb.n != null ? rb.n : (rb.regras != null ? rb.regras : '');
      item(aba + ' · ' + k, qa, qb, j(ra) === j(rb));
    }
  }
  item('NOTAS com as células-alvo mascaradas', (A.notasMascarada || '').slice(0, 12), (B.notasMascarada || '').slice(0, 12), A.notasMascarada === B.notasMascarada);
  item('NOTAS · nº de linhas', A.notasLinhas, B.notasLinhas, A.notasLinhas === B.notasLinhas);
  return { itens, divergencias: div };
}
`;

// Lê células direto do XML (valor bruto, fórmula, estilo), para as células Q.
const CELULAS = String.raw`
async function sharedStrings(zip) {
  const f = zip.file('xl/sharedStrings.xml'); if (!f) return [];
  const xml = await f.async('string');
  return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map((si) => (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));
}
function celulaXml(xml, ref, ss) {
  const m = xml.match(new RegExp('<c\\b([^>]*?)\\br="' + ref + '"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)'));
  if (!m) return { existe: false, valor: '', formula: false, estilo: null };
  const attrs = m[1] + ' ' + m[2], dentro = m[3] || '';
  const estilo = (attrs.match(/\bs="(\d+)"/) || [])[1] || null;
  const tipo = (attrs.match(/\bt="([^"]*)"/) || [])[1] || null;
  const formula = /<f[\s>\/]/.test(dentro);
  let valor = '';
  if (tipo === 's') { const v = (dentro.match(/<v>([^<]*)<\/v>/) || [])[1]; valor = v != null ? (ss[+v] != null ? ss[+v] : '') : ''; }
  else if (tipo === 'inlineStr') valor = (dentro.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('');
  else valor = (dentro.match(/<v>([^<]*)<\/v>/) || [])[1] || '';
  return { existe: true, valor, formula, estilo };
}
// Linha da aba NOTAS lida com exceljs (só leitura): B, E, H como texto; G como data ISO.
function texto(row, col) { try { const x = row.getCell(col); if (!x || x.value === null || x.value === undefined) return ''; return String(x.text).trim(); } catch (e) { return ''; } }
function dataIso(row, col) { try { let v = row.getCell(col).value; if (v && typeof v === 'object' && 'result' in v) v = v.result; if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v.toISOString().slice(0, 10); } catch (e) {} return null; }
function lerLinha(ws, n) { const row = ws.getRow(n); return { b: texto(row, 'B'), e: texto(row, 'E'), g: dataIso(row, 'G'), h: texto(row, 'H') }; }
function difLinha(lido, a) { return ['b', 'e', 'g', 'h'].filter((k) => lido[k] !== a[k]).map((k) => k.toUpperCase() + ' "' + lido[k] + '" (esperado "' + a[k] + '")'); }
function chavesBEH(ws) { const ch = {}; ws.eachRow({ includeEmpty: false }, (row) => { const k = texto(row, 'B') + '|' + texto(row, 'E') + '|' + texto(row, 'H'); ch[k] = (ch[k] || 0) + 1; }); return ch; }
// Regra da Michelle (21/10): só vazio e "PENDENTE" são tratados. "OK", "ARQUIVO INTERNO", "N/A" e
// qualquer outro valor ficam como estão.
function vazioOuPendente(v) { return v === '' || String(v).trim().toUpperCase() === 'PENDENTE'; }
`;

// ---------------------------------------------------------------------------------------
// Code nodes
// ---------------------------------------------------------------------------------------
function jsConfig(rodada, fonte) {
  const c = COST[fonte];
  return COMUM.replace("function cfg() { return $('Config').first().json; }\n", '') + String.raw`
// 0. Bibliotecas. Se faltar alguma, PARA aqui — nada foi chamado no Box ainda.
const faltando = [];
for (const m of ['jszip', 'exceljs']) { try { require(m); } catch (e) { faltando.push(m + ' (' + String(e.message).slice(0, 120) + ')'); } }
if (faltando.length) throw new Error('PAROU antes de tocar no Box: biblioteca indisponível no Code node: ' + faltando.join('; ') + '. Ver comandos-vm-instalar-jszip.txt.');
const agora = new Date();
return [{ json: {
  rodada: ${JSON.stringify(rodada)}, fonte: ${JSON.stringify(fonte)},
  costId: ${JSON.stringify(c.id)}, nomeEsperado: ${JSON.stringify(c.nome)},
  alvos: ${JSON.stringify(alvosDe(rodada, fonte))},
  estiloOK: ${JSON.stringify(c.estiloOK || null)},
  passo0: ${JSON.stringify(PASSO0[rodada + '-' + fonte] || null)},
  costs: ${JSON.stringify(Object.fromEntries(Object.entries(COST).map(([f, x]) => [f, { id: x.id, nome: x.nome }])))},
  registro: ${JSON.stringify(notasDoRegistro())},
  loginEsperado: ${JSON.stringify(LOGIN_ESPERADO)}, pastaTeste: ${JSON.stringify(PASTA_TESTE)}, pastaBackup: ${JSON.stringify(PASTA_BACKUP)}, reter: ${RETER},
  carimbo: carimbo(agora), inicio: agora.toISOString(),
} }];
`;
}

const JS_PORTAO = COMUM + String.raw`
const c = cfg();
const me = $('Box — identidade (users/me)').first();
const meta = $('Box — Cost (metadados)').first();
const problemas = [];
const login = corpo(me).login;
if (status(me) !== 200 || login !== c.loginEsperado) problemas.push('IDENTIDADE: Box responde como ' + login + ' (' + resumoErro(me) + '), esperado ' + c.loginEsperado);
const m = corpo(meta);
const nome = m.name || '';
const bate = status(meta) === 200 && (nome === c.nomeEsperado || (nome.toLowerCase().endsWith('.xlsx') && nome.slice(0, -5) === c.nomeEsperado));
if (!bate) problemas.push('PORTÃO: Cost ' + c.fonte + ' id ' + c.costId + ' -> ' + (status(meta) === 200 ? '"' + nome + '"' : resumoErro(meta)) + ', esperado "' + c.nomeEsperado + '"');
if (status(meta) === 200 && m.item_status !== 'active') problemas.push('Cost ' + c.fonte + ' com item_status ' + m.item_status);
if (problemas.length) throw new Error('PAROU antes de escrever: ' + problemas.join(' | '));
return [{ json: { ok: true, login, costNome: nome, costSha1: m.sha1, costTamanho: m.size, costVersao: (m.file_version || {}).id, lockNoInicio: m.lock ? { por: quem(m.lock.created_by), em: m.lock.created_at, expira: m.lock.expires_at } : null, url: BOX_API + '/folders/0/items', qs: { fields: 'id,name,type', limit: 1000 } } }];
`;

// CONTAGEM (só leitura, nos dois Cost reais): para as 151 notas do registro, o valor da coluna Q.
// Só GET de metadados e download; nada é escrito. Qualquer falha aqui para ANTES de tocar no alvo.
const JS_CONTAGEM_PEDIR = COMUM + String.raw`
const c = cfg();
return ['S01', 'S02'].map((f) => ({ json: { fonte: f, id: c.costs[f].id, url: BOX_API + '/files/' + c.costs[f].id, qs: { fields: '${CAMPOS}' } } }));
`;
const JS_CONTAGEM_NOMES = COMUM + String.raw`
const c = cfg();
const pedidos = $('Contagem — pedir').all().map((x) => x.json);
const res = $input.all();
if (res.length !== pedidos.length) throw new Error('PAROU antes de escrever: contagem recebeu ' + res.length + ' respostas de metadados, esperado ' + pedidos.length);
return res.map((it, i) => {
  const p = pedidos[i], m = corpo(it), nome = m.name || '', esp = c.costs[p.fonte].nome;
  const bate = status(it) === 200 && m.id === p.id && (nome === esp || (nome.toLowerCase().endsWith('.xlsx') && nome.slice(0, -5) === esp));
  if (!bate) throw new Error('PAROU antes de escrever: contagem, Cost ' + p.fonte + ' id ' + p.id + ' -> ' + (status(it) === 200 ? '"' + nome + '"' : resumoErro(it)) + ', esperado "' + esp + '"');
  return { json: { fonte: p.fonte, id: m.id, nome, sha1: m.sha1, tamanho: m.size } };
});
`;
const JS_CONTAGEM_FALHA = `throw new Error('PAROU antes de escrever: falha ao baixar um Cost real para a contagem: ' + JSON.stringify($input.first().json).slice(0, 300));`;
function jsContagem() {
  return COMUM + SHA1 + fonteCirurgico() + CELULAS + String.raw`
const helpers = this.helpers;
const c = cfg();
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const metas = $('Contagem — conferir nomes').all().map((x) => x.json);
const its = $input.all();
if (its.length !== metas.length) throw new Error('PAROU antes de escrever: contagem baixou ' + its.length + ' arquivos, esperado ' + metas.length);
const porFonte = {};
for (let i = 0; i < its.length; i++) {
  const it = its[i];
  if (!it.binary || !it.binary.data) throw new Error('PAROU antes de escrever: download da contagem sem binário');
  const buf = it.binary.data.id ? await helpers.getBinaryDataBuffer(i, 'data') : Buffer.from(it.binary.data.data, 'base64');
  const sha = sha1(buf);
  const m = metas.filter((x) => x.sha1 === sha);
  if (m.length !== 1) throw new Error('PAROU antes de escrever: o arquivo baixado (sha1 ' + sha + ') não corresponde a exatamente um Cost (' + m.length + ')');
  const f = m[0].fonte;
  if (porFonte[f]) throw new Error('PAROU antes de escrever: Cost ' + f + ' baixado duas vezes');
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file(await caminhoDaAba(zip, 'NOTAS')).async('string');
  const ss = await sharedStrings(zip);
  let wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets.find((w) => w.name === 'NOTAS');
  if (!ws) throw new Error('PAROU antes de escrever: Cost ' + f + ' sem aba "NOTAS"');
  let cab = false;
  for (let l = 1; l <= 10; l++) if (texto(ws.getRow(l), 'Q') === 'CHECK ARQUIVO DRIVE') cab = true;
  if (!cab) throw new Error('PAROU antes de escrever: Cost ' + f + ' sem o cabeçalho "CHECK ARQUIVO DRIVE" na coluna Q');
  const r = { cost: m[0].nome, sha1: sha, notas: 0, ok: 0, aTratar: [], outros: {}, linhaNaoConfere: [] };
  for (const n of c.registro.filter((x) => x.f === f)) {
    r.notas++;
    const dif = difLinha(lerLinha(ws, n.l), n);
    const cel = celulaXml(xml, 'Q' + n.l, ss);
    if (dif.length) r.linhaNaoConfere.push({ linha: n.l, nota: n.nota, q: cel.valor, dif: dif.join('; ') });
    else if (cel.valor === 'OK') r.ok++;
    else if (vazioOuPendente(cel.valor)) r.aTratar.push({ linha: n.l, nota: n.nota, valor: cel.valor === '' ? '(vazio)' : cel.valor });
    else (r.outros[cel.valor] = r.outros[cel.valor] || []).push({ linha: n.l, nota: n.nota });
  }
  porFonte[f] = r;
  wb = null;
}
const p = $('Portão (identidade + nome do Cost)').first().json;
const tot = (k) => Object.values(porFonte).reduce((s, r) => s + (Array.isArray(r[k]) ? r[k].length : typeof r[k] === 'number' ? r[k] : Object.values(r[k]).reduce((a, v) => a + v.length, 0)), 0);
return [{ json: { contagem: { totais: { notas: tot('notas'), ok: tot('ok'), aTratar: tot('aTratar'), outros: tot('outros'), linhaNaoConfere: tot('linhaNaoConfere') }, porFonte }, url: p.url, qs: p.qs } }];
`;
}

// PASSO 0 (só leitura, ajustado em 21/10 para a rodada A do S01): o Cost real foi salvo pelo Excel
// Online depois do backup de 20h49. Compara esse backup com o Cost real ATUAL. styles.xml e índices
// de estilo podem mudar (renumeração) desde que o estilo RESOLVIDO de toda célula/linha/coluna seja o
// mesmo e as mesclagens sejam o mesmo conjunto. Qualquer outra diferença de formatação PARA.
const PASSO0 = {
  'A-S01': { backupId: '2541641854847', backupSha1: 'ed9bd3d9ec4df6c162a8e8afbec93ed476013fec', rotulo: 'backup de 21/10 20h49 (cópia de teste 2541650610922)' },
  // Rodada B: referência = o estado do S01 real usado na rodada A (backup de 22/10 00h10).
  'B-S01': { backupId: '2541931467905', backupSha1: '67016ba71c6b4ba279262cc6c250a465a6ae0bad', rotulo: 'backup de 22/10 00h10 (base da rodada A, exec 650)' },
};
const JS_PASSO0_PEDIR = COMUM + String.raw`
const c = cfg();
return [{ json: { papel: 'backup', id: c.passo0.backupId, url: BOX_API + '/files/' + c.passo0.backupId, qs: { fields: '${CAMPOS}' } } }, { json: { papel: 'atual', id: c.costId, url: BOX_API + '/files/' + c.costId, qs: { fields: '${CAMPOS}' } } }];
`;
const JS_PASSO0_METAS = COMUM + String.raw`
const c = cfg();
const ped = $('Passo 0 — pedir').all().map((x) => x.json);
const res = $input.all();
if (res.length !== 2) throw new Error('PAROU antes de escrever: Passo 0 recebeu ' + res.length + ' respostas de metadados');
return res.map((it, i) => {
  const m = corpo(it), p = ped[i];
  if (status(it) !== 200 || m.id !== p.id) throw new Error('PAROU antes de escrever: Passo 0, metadados de ' + p.papel + ' ' + p.id + ': ' + resumoErro(it));
  if (p.papel === 'backup' && m.sha1 !== c.passo0.backupSha1) throw new Error('PAROU antes de escrever: Passo 0, o backup ' + p.id + ' tem sha1 ' + m.sha1 + ', esperado ' + c.passo0.backupSha1);
  return { json: { papel: p.papel, id: m.id, nome: m.name, sha1: m.sha1, tamanho: m.size, versao: (m.file_version || {}).id, modificadoEm: m.modified_at, modificadoPor: m.modified_by ? { login: m.modified_by.login, nome: m.modified_by.name } : null, lock: m.lock ? quem(m.lock.created_by) : null } };
});
`;
function jsPasso0() {
  return COMUM + SHA1 + fonteCirurgico() + IMPRESSAO + CELULAS + String.raw`
const helpers = this.helpers;
const c = cfg();
const p = $('Portão (identidade + nome do Cost)').first().json;
const metas = $('Passo 0 — metadados').all().map((x) => x.json);
// Estilo RESOLVIDO: o índice s da célula é traduzido pelo styles.xml do próprio arquivo em fonte,
// preenchimento, borda, formato numérico, alinhamento, proteção (e o estilo-base cellStyleXfs).
function resolvedor(st) {
  const bloco = (n) => (st.match(new RegExp('<' + n + '\\b[^>]*>([\\s\\S]*?)</' + n + '>')) || [])[1] || '';
  const itens = (n, tag) => bloco(n).match(new RegExp('<' + tag + '\\b[^>]*?/>|<' + tag + '\\b[^>]*?[^/]>[\\s\\S]*?</' + tag + '>', 'g')) || [];
  const norm = (x) => String(x || '').replace(/>\s+</g, '><').replace(/<([\w:]+)((?:\s+[\w:]+="[^"]*")*)\s*(\/?)>/g, (m, n, a, sl) => '<' + n + (a.match(/[\w:]+="[^"]*"/g) || []).sort().map((y) => ' ' + y).join('') + sl + '>');
  const at = (tag) => Object.fromEntries([...String(tag).replace(/>[\s\S]*$/, '').matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const fmts = Object.fromEntries((bloco('numFmts').match(/<numFmt\b[^>]*\/>/g) || []).map((t) => [at(t).numFmtId, at(t).formatCode]));
  const fonts = itens('fonts', 'font'), fills = itens('fills', 'fill'), borders = itens('borders', 'border');
  const xfs = itens('cellXfs', 'xf'), bases = itens('cellStyleXfs', 'xf');
  const filho = (xf, n) => norm((xf.match(new RegExp('<' + n + '\\b[^>]*?/>|<' + n + '\\b[\\s\\S]*?</' + n + '>')) || [])[0] || '');
  const desc = (xf) => { const a = at(xf); return { formatoNumerico: a.numFmtId in fmts ? fmts[a.numFmtId] : 'interno:' + (a.numFmtId || '0'), fonte: norm(fonts[+(a.fontId || 0)]), preenchimento: norm(fills[+(a.fillId || 0)]), bordas: norm(borders[+(a.borderId || 0)]), alinhamento: filho(xf, 'alignment'), protecao: filho(xf, 'protection'), quotePrefix: a.quotePrefix || '0' }; };
  const cache = {};
  return {
    nXfs: xfs.length,
    desc(i) { i = String(i == null ? 0 : i); if (!(i in cache)) { const xf = xfs[+i]; cache[i] = xf ? { ...desc(xf), base: bases[+(at(xf).xfId || 0)] ? desc(bases[+(at(xf).xfId || 0)]) : null } : { inexistente: i }; } return cache[i]; },
  };
}
function estilosDaAba(xml) {
  const cel = new Map(), lin = new Map(), col = [];
  const semDados = xml.replace(/<sheetData[\s\S]*<\/sheetData>/, '');
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>)/g)) { const r = (m[1].match(/\br="([A-Z]+\d+)"/) || [])[1]; if (r) cel.set(r, (m[1].match(/\bs="(\d+)"/) || [])[1] || '0'); }
  for (const m of xml.matchAll(/<row\b([^>]*?)(?:\/>|>)/g)) { const r = (m[1].match(/\br="(\d+)"/) || [])[1]; const s = (m[1].match(/\bs="(\d+)"/) || [])[1]; if (r && s != null) lin.set(r, s); }
  for (const m of semDados.matchAll(/<col\b([^>]*?)\/>/g)) { const a = m[1]; col.push({ faixa: ((a.match(/\bmin="(\d+)"/) || [])[1]) + '-' + ((a.match(/\bmax="(\d+)"/) || [])[1]), s: (a.match(/\bstyle="(\d+)"/) || [])[1] || '0' }); }
  const merges = new Set((xml.match(/<mergeCell\b[^>]*\/>/g) || []).map((t) => (t.match(/\bref="([^"]+)"/) || [])[1]));
  return { cel, lin, col, merges };
}
let out;
try {
  const JSZip = require('jszip');
  const its = $input.all();
  if (its.length !== 2) throw new Error('Passo 0 baixou ' + its.length + ' arquivos, esperado 2');
  const zips = {};
  for (let i = 0; i < 2; i++) {
    const it = its[i];
    if (!it.binary || !it.binary.data) throw new Error('download do Passo 0 sem binário');
    const buf = it.binary.data.id ? await helpers.getBinaryDataBuffer(i, 'data') : Buffer.from(it.binary.data.data, 'base64');
    const sha = sha1(buf);
    // o download preserva a ordem dos pedidos (backup, atual); o sha1 de cada um tem de bater
    if (!metas[i] || metas[i].sha1 !== sha) throw new Error('arquivo baixado no Passo 0, posição ' + i + ' (sha1 ' + sha + '), não bate com ' + (metas[i] ? metas[i].papel + ' ' + metas[i].sha1 : 'nada'));
    zips[metas[i].papel] = await JSZip.loadAsync(buf);
  }
  if (!zips.backup || !zips.atual) throw new Error('Passo 0 não identificou backup e atual');
  const A = await impressao(zips.backup, 'NOTAS', []), B = await impressao(zips.atual, 'NOTAS', []);
  const j = (x) => JSON.stringify(x);
  const nA = Object.keys(A.partes), nB = Object.keys(B.partes);
  const partes = { totalAntes: nA.length, totalDepois: nB.length, so_no_backup: nA.filter((x) => !(x in B.partes)), so_no_atual: nB.filter((x) => !(x in A.partes)), mudaram: nA.filter((x) => x in B.partes && A.partes[x] !== B.partes[x]) };
  partes.iguais = nA.filter((x) => B.partes[x] === A.partes[x]).length;
  const paradas = [];
  // 1. Partes: só podem mudar docProps, styles.xml, sharedStrings/calcChain (conteúdo) e abas que não são a NOTAS.
  const parteNotas = (A.porAba.NOTAS || {}).parte;
  const abasPartes = Object.values(A.porAba).map((x) => x.parte);
  const permitida = (x) => /^docProps\//.test(x) || x === 'xl/styles.xml' || x === 'xl/sharedStrings.xml' || x === 'xl/calcChain.xml' || (abasPartes.includes(x) && x !== parteNotas);
  if (partes.so_no_backup.length || partes.so_no_atual.length) paradas.push('partes do pacote diferentes: ' + j({ so_no_backup: partes.so_no_backup, so_no_atual: partes.so_no_atual }));
  const fora = partes.mudaram.filter((x) => !permitida(x));
  if (fora.length) paradas.push('mudaram partes fora do permitido: ' + fora.join(', '));
  if (parteNotas && A.partes[parteNotas] !== B.partes[parteNotas]) paradas.push('a aba NOTAS mudou');
  // 2. Itens estruturais de formatação (paradas de antes).
  const formatacao = [];
  const fmt = (item, a, b, igual) => { formatacao.push({ item, antes: a, depois: b, igual }); if (!igual) paradas.push(item + ' ' + j(a) + ' -> ' + j(b)); };
  fmt('lista de abas', A.abas, B.abas, j(A.abas) === j(B.abas));
  const stA = await zips.backup.file('xl/styles.xml').async('string'), stB = await zips.atual.file('xl/styles.xml').async('string');
  const dxfsBloco = (st) => (st.match(/<dxfs[^>]*>[\s\S]*?<\/dxfs>/) || [''])[0];
  fmt('dxfs (total / distintos)', A.estilos.dxfTotal + ' / ' + A.estilos.dxfDistintos, B.estilos.dxfTotal + ' / ' + B.estilos.dxfDistintos, A.estilos.dxfTotal === B.estilos.dxfTotal && A.estilos.dxfDistintos === B.estilos.dxfDistintos);
  fmt('dxfs (conteúdo e ordem)', sha1Txt(dxfsBloco(stA)).slice(0, 12), sha1Txt(dxfsBloco(stB)).slice(0, 12), dxfsBloco(stA) === dxfsBloco(stB));
  for (const aba of A.abas) {
    const a = A.porAba[aba], b = B.porAba[aba] || {};
    const d = (x) => (x ? x.n + ' (' + x.sha1.slice(0, 8) + ')' : null);
    fmt(aba + ' · formatação condicional legada (blocos/regras)', a.cfLegado.blocos + '/' + a.cfLegado.regras, b.cfLegado ? b.cfLegado.blocos + '/' + b.cfLegado.regras : null, j(a.cfLegado) === j(b.cfLegado));
    fmt(aba + ' · formatação condicional x14 (regras)', a.x14cfRule.regras, b.x14cfRule ? b.x14cfRule.regras : null, j(a.x14cfRule) === j(b.x14cfRule));
    for (const k of ['extLst', 'cols', 'autoFilter']) fmt(aba + ' · ' + k, d(a[k]), d(b[k]), j(a[k]) === j(b[k]));
  }
  // 3. Estilo resolvido de cada célula, linha e coluna, em TODAS as abas; mesclagens como conjunto.
  const RA = resolvedor(stA), RB = resolvedor(stB);
  const ssA = await sharedStrings(zips.backup), ssB = await sharedStrings(zips.atual);
  const porAba = {};
  for (const aba of A.abas) {
    if (!B.porAba[aba]) continue;
    const xa = await zips.backup.file(A.porAba[aba].parte).async('string'), xb = await zips.atual.file(B.porAba[aba].parte).async('string');
    const EA = estilosDaAba(xa), EB = estilosDaAba(xb);
    const r = { celulas: EA.cel.size, indiceMudou: 0, estiloResolvidoDiferente: 0, linhasComEstilo: EA.lin.size, colunas: EA.col.length, novas: 0, removidas: 0, valorMudou: 0, exemplosEstilo: [], exemplosValor: [] };
    const difCampos = (da, db) => Object.keys({ ...da, ...db }).filter((k) => j(da[k]) !== j(db[k]));
    const comparaEstilo = (onde, sa, sb) => {
      if (sa !== sb) r.indiceMudou++;
      const da = RA.desc(sa), db = RB.desc(sb);
      if (j(da) !== j(db)) { r.estiloResolvidoDiferente++; if (r.exemplosEstilo.length < 15) { const campos = difCampos(da, db); r.exemplosEstilo.push({ onde, indice: sa + ' -> ' + sb, campos, antes: Object.fromEntries(campos.map((k) => [k, j(da[k]).slice(0, 160)])), depois: Object.fromEntries(campos.map((k) => [k, j(db[k]).slice(0, 160)])) }); } }
    };
    for (const [ref, sa] of EA.cel) { if (!EB.cel.has(ref)) { r.removidas++; continue; } comparaEstilo(ref, sa, EB.cel.get(ref)); }
    for (const ref of EB.cel.keys()) if (!EA.cel.has(ref)) r.novas++;
    const linhas = new Set([...EA.lin.keys(), ...EB.lin.keys()]);
    for (const l of linhas) comparaEstilo('linha ' + l, EA.lin.get(l) || '0', EB.lin.get(l) || '0');
    if (j(EA.col.map((x) => x.faixa)) !== j(EB.col.map((x) => x.faixa))) paradas.push(aba + ': faixas de colunas diferentes');
    else EA.col.forEach((x, i) => comparaEstilo('colunas ' + x.faixa, x.s, EB.col[i].s));
    // mesclagens como conjunto
    const soA = [...EA.merges].filter((x) => !EB.merges.has(x)), soB = [...EB.merges].filter((x) => !EA.merges.has(x));
    r.mesclagens = { antes: EA.merges.size, depois: EB.merges.size, mesmoConjunto: soA.length === 0 && soB.length === 0, mesmaOrdem: A.porAba[aba].mesclagens.sha1 === B.porAba[aba].mesclagens.sha1, so_no_backup: soA.slice(0, 15), so_no_atual: soB.slice(0, 15) };
    // valores (conteúdo de célula): só relatado
    if (xa !== xb) {
      const celsB = new Map();
      for (const m of xb.matchAll(/<c\b[^>]*?\br="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) celsB.set(m[1], m[0]);
      for (const m of xa.matchAll(/<c\b[^>]*?\br="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
        const vb = celsB.get(m[1]);
        if (!vb || vb === m[0]) continue;
        const ca = celulaXml(m[0], m[1], ssA), cb = celulaXml(vb, m[1], ssB);
        if (ca.valor !== cb.valor) { r.valorMudou++; if (r.exemplosValor.length < 10) r.exemplosValor.push({ ref: m[1], antes: String(ca.valor).slice(0, 60), depois: String(cb.valor).slice(0, 60) }); }
      }
    }
    if (r.estiloResolvidoDiferente) paradas.push(aba + ': ' + r.estiloResolvidoDiferente + ' células/linhas/colunas com estilo resolvido diferente');
    if (!r.mesclagens.mesmoConjunto) paradas.push(aba + ': mesclagens são outro conjunto (' + soA.length + ' só no backup, ' + soB.length + ' só no atual)');
    if (r.novas || r.removidas) paradas.push(aba + ': ' + r.novas + ' células novas e ' + r.removidas + ' removidas');
    porAba[aba] = r;
  }
  const atual = metas.find((x) => x.papel === 'atual'), bk = metas.find((x) => x.papel === 'backup');
  const ok = paradas.length === 0;
  const renumeracao = ok && partes.mudaram.length > 0;
  out = { ok, conclusao: ok ? (renumeracao ? 'SÓ RENUMERAÇÃO: todos os estilos resolvidos iguais e as mesclagens são o mesmo conjunto' : 'IDÊNTICO') : 'DIFERENÇA REAL', motivo: ok ? null : paradas.slice(0, 20).join(' | '),
    backup: bk, atual, partes, stylesXml: { antes: A.estilos.sha1.slice(0, 12), depois: B.estilos.sha1.slice(0, 12), cellXfsAntes: RA.nXfs, cellXfsDepois: RB.nXfs }, formatacao: formatacao.filter((x) => !x.igual).length ? formatacao : { todosIguais: formatacao.length }, porAba };
} catch (e) {
  out = { ok: false, conclusao: 'ERRO', motivo: 'ERRO no Passo 0: ' + String(e && e.message || e).slice(0, 400) };
}
return [{ json: { passo0: out, seguir: out.ok, url: p.url, qs: p.qs } }];
`;
}

// Raiz: acha as duas pastas ZZ pelo nome exato. Emite as que faltam para criar.
const JS_PASTAS = COMUM + String.raw`
const c = cfg();
const r = $input.first();
if (status(r) !== 200) throw new Error('PAROU: listar a raiz do Box: ' + resumoErro(r));
const itens = corpo(r).entries || [];
if ((corpo(r).total_count || 0) > itens.length) throw new Error('PAROU: raiz do Box com mais de ' + itens.length + ' itens (listagem truncada).');
const precisa = c.rodada === 'A' ? [c.pastaTeste, c.pastaBackup] : [c.pastaBackup];
const criar = [];
for (const nome of precisa) {
  const achadas = itens.filter((x) => x.name === nome);
  if (achadas.some((x) => x.type !== 'folder')) throw new Error('PAROU: existe na raiz um item "' + nome + '" que não é pasta.');
  if (achadas.length > 1) throw new Error('PAROU: há ' + achadas.length + ' pastas "' + nome + '" na raiz do Box.');
  if (!achadas.length) criar.push(nome);
}
return [{ json: { criar: criar.map((nome) => ({ nome, corpo: { name: nome, parent: { id: '0' } } })), algumaPraCriar: criar.length > 0 } }];
`;
const JS_ITENS_CRIAR = `return $input.first().json.criar.map((x) => ({ json: x }));`;
const JS_PASTAS_CRIADAS = COMUM + String.raw`
const res = $input.all();
const pedidas = $('Pastas ZZ na raiz').first().json.criar;
const criadas = [];
res.forEach((it, i) => {
  const b = corpo(it);
  if (status(it) !== 200 || b.type !== 'folder' || b.name !== pedidas[i].nome || ((b.parent || {}).id || '0') !== '0') throw new Error('PAROU: falha ao criar a pasta "' + pedidas[i].nome + '": ' + resumoErro(it) + ' ' + JSON.stringify(b).slice(0, 200));
  criadas.push({ id: b.id, nome: b.name });
});
return [{ json: { criadas, url: BOX_API + '/folders/0/items', qs: { fields: 'id,name,type', limit: 1000 } } }];
`;
const JS_PREP_RELISTAR = COMUM + `return [{ json: { criadas: [], url: BOX_API + '/folders/0/items', qs: { fields: 'id,name,type', limit: 1000 } } }];`;
// Relista a raiz: agora tem de haver exatamente uma de cada. Emite um GET de detalhes por pasta.
const JS_PASTAS_CONF = COMUM + String.raw`
const c = cfg();
const r = $input.first();
if (status(r) !== 200) throw new Error('PAROU: relistar a raiz: ' + resumoErro(r));
const itens = corpo(r).entries || [];
const precisa = c.rodada === 'A' ? [c.pastaTeste, c.pastaBackup] : [c.pastaBackup];
return precisa.map((nome) => {
  const achadas = itens.filter((x) => x.name === nome && x.type === 'folder');
  if (achadas.length !== 1) throw new Error('PAROU: depois de criar, há ' + achadas.length + ' pastas "' + nome + '" na raiz.');
  return { json: { nome, id: achadas[0].id, url: BOX_API + '/folders/' + achadas[0].id, qs: { fields: 'id,name,parent,shared_link,has_collaborations,owned_by,item_status' } } };
});
`;
const JS_PASTAS_PRIVADAS = COMUM + String.raw`
const c = cfg();
const pedidos = $('Conferir pastas ZZ').all().map((x) => x.json);
const out = {};
$input.all().forEach((it, i) => {
  const b = corpo(it), p = pedidos[i];
  if (status(it) !== 200 || b.id !== p.id) throw new Error('PAROU: detalhes da pasta "' + p.nome + '": ' + resumoErro(it));
  if (((b.parent || {}).id || '0') !== '0') throw new Error('PAROU: a pasta "' + p.nome + '" não está na raiz.');
  if (b.shared_link) throw new Error('PAROU: a pasta "' + p.nome + '" tem link compartilhado. Não uso pasta compartilhada.');
  if (b.has_collaborations) throw new Error('PAROU: a pasta "' + p.nome + '" tem colaboradores. Não uso pasta compartilhada.');
  if (((b.owned_by || {}).login) !== c.loginEsperado) throw new Error('PAROU: a pasta "' + p.nome + '" é de ' + quem(b.owned_by) + ', não da Michelle.');
  out[p.nome] = b.id;
});
const p = $('Portão (identidade + nome do Cost)').first().json;
const base = { pastaTesteId: out[c.pastaTeste] || null, pastaBackupId: out[c.pastaBackup], criadasAgora: (($('Conferir pastas criadas').isExecuted ? $('Conferir pastas criadas').first().json.criadas : []) || []) };
if (c.rodada === 'A') {
  // ALVO da rodada A = uma cópia do Cost, feita pelo próprio Box, na pasta de testes.
  const nomeTeste = 'ZZ-TESTE_' + semExt(p.costNome) + '_' + c.carimbo + '.xlsx';
  return [{ json: { ...base, nomeTeste, corpoCopia: { parent: { id: base.pastaTesteId }, name: nomeTeste } } }];
}
return [{ json: { ...base } }];
`;
const JS_CONF_COPIA_TESTE = COMUM + String.raw`
const c = cfg();
const r = $input.first(), b = corpo(r);
const ant = $('Pastas privadas?').first().json;
const p = $('Portão (identidade + nome do Cost)').first().json;
if (status(r) !== 200) throw new Error('PAROU: copiar o Cost para ' + c.pastaTeste + ': ' + resumoErro(r));
const prob = [];
if (b.name !== ant.nomeTeste) prob.push('nome ' + b.name);
if (((b.parent || {}).id) !== ant.pastaTesteId) prob.push('pasta ' + (b.parent || {}).id);
if (b.sha1 !== p.costSha1) prob.push('sha1 ' + b.sha1 + ' ≠ ' + p.costSha1);
if (b.size !== p.costTamanho) prob.push('tamanho ' + b.size + ' ≠ ' + p.costTamanho);
if (prob.length) throw new Error('PAROU: a cópia de teste não confere (' + prob.join('; ') + '). id ' + b.id + ' (fica em ' + c.pastaTeste + ').');
return [{ json: { ...ant, alvoId: b.id, alvoNome: b.name, copiaTeste: { id: b.id, nome: b.name, sha1: b.sha1, tamanho: b.size } } }];
`;
const JS_ALVO_REAL = COMUM + String.raw`
const c = cfg();
const p = $('Portão (identidade + nome do Cost)').first().json;
return [{ json: { ...$input.first().json, alvoId: c.costId, alvoNome: p.costNome, copiaTeste: null } }];
`;
// Metadados do alvo -> pedido de backup.
const JS_PEDIR_BACKUP = COMUM + String.raw`
const c = cfg();
const ctx = $('Definir alvo').first().json;
const r = $input.first(), m = corpo(r);
if (status(r) !== 200 || m.id !== ctx.alvoId) throw new Error('PAROU: metadados do alvo ' + ctx.alvoId + ': ' + resumoErro(r));
const nomeBackup = semExt(m.name) + '_copia_' + c.carimbo + '.xlsx';
return [{ json: { ...ctx, alvoAntes: { sha1: m.sha1, tamanho: m.size, versao: (m.file_version || {}).id, etag: m.etag, modificadoEm: m.modified_at, modificadoPor: quem(m.modified_by) }, nomeBackup, corpoBackup: { parent: { id: ctx.pastaBackupId }, name: nomeBackup } } }];
`;
const JS_CONF_BACKUP = COMUM + String.raw`
const c = cfg();
const ctx = $('Pedir backup').first().json;
const r = $('Box — backup (cópia)').first(), b = corpo(r);
const rr = $input.first(), b2 = corpo(rr);
if (status(r) !== 200) throw new Error('PAROU: backup não foi criado: ' + resumoErro(r) + '. Nada foi escrito.');
const prob = [];
for (const [rot, x] of [['resposta da cópia', b], ['releitura', b2]]) {
  if (x.name !== ctx.nomeBackup) prob.push(rot + ': nome ' + x.name);
  if (((x.parent || {}).id) !== ctx.pastaBackupId) prob.push(rot + ': pasta ' + (x.parent || {}).id);
  if (x.sha1 !== ctx.alvoAntes.sha1) prob.push(rot + ': sha1 ' + x.sha1 + ' ≠ ' + ctx.alvoAntes.sha1);
  if (x.size !== ctx.alvoAntes.tamanho) prob.push(rot + ': tamanho ' + x.size + ' ≠ ' + ctx.alvoAntes.tamanho);
}
if (status(rr) !== 200 || b2.id !== b.id) prob.push('releitura do backup: ' + resumoErro(rr));
if (prob.length) throw new Error('PAROU: backup NÃO verificado (' + prob.join('; ') + '). Nada foi escrito.');
return [{ json: { ...ctx, backup: { id: b.id, nome: b.name, pasta: c.pastaBackup + ' (' + ctx.pastaBackupId + ')', sha1: b2.sha1, tamanho: b2.size, versao: (b2.file_version || {}).id }, url: BOX_API + '/folders/' + ctx.pastaBackupId + '/items', qs: { fields: 'id,name,type', limit: 1000 } } }];
`;
// Retenção: 5 por planilha (padrão exato do nome daquela planilha). Apaga no máximo 1.
const JS_RETENCAO = COMUM + String.raw`
const c = cfg();
const ctx = $('Conferir backup').first().json;
const r = $input.first();
const out = { ...ctx, retencao: { reter: c.reter, encontrados: null, apagar: null, aviso: null } };
if (status(r) !== 200) { out.retencao.aviso = 'não consegui listar ' + c.pastaBackup + ' (' + resumoErro(r) + '); nada apagado'; return [{ json: { ...out, apagar: false } }]; }
const itens = corpo(r).entries || [];
if ((corpo(r).total_count || 0) > itens.length) { out.retencao.aviso = c.pastaBackup + ' tem mais de ' + itens.length + ' itens; nada apagado'; return [{ json: { ...out, apagar: false } }]; }
const re = new RegExp('^' + escRe(semExt(ctx.alvoNome)) + '_copia_(\\d{4}-\\d{2}-\\d{2}_\\d{6})\\.xlsx$');
const daPlanilha = itens.filter((x) => x.type === 'file' && re.test(x.name)).sort((a, b) => a.name.match(re)[1].localeCompare(b.name.match(re)[1]));
out.retencao.encontrados = daPlanilha.length;
if (!daPlanilha.some((x) => x.id === ctx.backup.id)) { out.retencao.aviso = 'o backup novo não aparece na listagem; nada apagado'; return [{ json: { ...out, apagar: false } }]; }
if (daPlanilha.length <= c.reter) return [{ json: { ...out, apagar: false } }];
const velho = daPlanilha[0];
if (velho.id === ctx.backup.id) { out.retencao.aviso = 'o mais antigo seria o novo; nada apagado'; return [{ json: { ...out, apagar: false } }]; }
out.retencao.apagar = { id: velho.id, nome: velho.name };
return [{ json: { ...out, apagar: true, urlApagar: BOX_API + '/files/' + velho.id } }];
`;
const JS_RETENCAO_CONF = COMUM + String.raw`
const ctx = $('Retenção (5 por planilha)').first().json;
const del = $('Box — apagar backup mais antigo').first();
const rel = $input.first();
const ret = { ...ctx.retencao };
if (status(del) !== 200) ret.aviso = 'NÃO apaguei "' + ret.apagar.nome + '": ' + resumoErro(del) + (status(del) === 403 ? ' (sem permissão de apagar)' : '');
else if (status(rel) === 404) ret.apagado = true;
else ret.aviso = 'DELETE respondeu ok, mas o arquivo ainda aparece (' + resumoErro(rel) + ')';
return [{ json: { ...ctx, retencao: ret } }];
`;
const JS_PREP_LOCK_CHECK = COMUM + String.raw`
const ctx = $input.first().json;
return [{ json: { ...ctx, url: BOX_API + '/files/' + ctx.alvoId, qs: { fields: '${CAMPOS}' } } }];
`;
// 6. Lock de outra pessoa (ou nosso) -> não escreve. Guarda a versão.
const JS_CHECAR_LOCK = COMUM + String.raw`
const ctx = $('Antes do lock').first().json;
const r = $input.first(), m = corpo(r);
if (status(r) !== 200 || m.id !== ctx.alvoId) throw new Error('PAROU: metadados antes do lock: ' + resumoErro(r) + '. Nada foi escrito.');
if (m.lock) throw new Error('PAROU: o arquivo está TRAVADO por ' + quem(m.lock.created_by) + ' desde ' + m.lock.created_at + ' (expira ' + m.lock.expires_at + '). Não escrevi e não mexi no lock.');
if (m.sha1 !== ctx.backup.sha1) throw new Error('PAROU: o arquivo mudou depois do backup (sha1 ' + m.sha1 + ' ≠ backup ' + ctx.backup.sha1 + '). Nada foi escrito.');
// Com Passo 0: o arquivo que vai ser escrito tem de ser o mesmo que o Passo 0 aprovou.
if (cfg().passo0) { const p0 = $('Passo 0 — metadados').all().map((x) => x.json).find((x) => x.papel === 'atual'); if (cfg().rodada === 'B' && (!p0 || p0.sha1 !== m.sha1)) throw new Error('PAROU: o Cost mudou entre o Passo 0 e o lock (sha1 ' + m.sha1 + ' ≠ ' + (p0 && p0.sha1) + '). Nada foi escrito.'); }
const p = m.permissions || {};
if (p.can_upload === false) throw new Error('PAROU: a conta não tem permissão de upload neste arquivo. Nada foi escrito.');
const expira = new Date(Date.now() + 30 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
return [{ json: { ...ctx, versaoGuardada: { sha1: m.sha1, versao: (m.file_version || {}).id, etag: m.etag, tamanho: m.size, modificadoEm: m.modified_at, modificadoPor: quem(m.modified_by) }, url: BOX_API + '/files/' + ctx.alvoId, qs: { fields: 'lock,etag,sha1,file_version,size' }, corpoLock: { lock: { type: 'lock', is_download_prevented: false, expires_at: expira } } } }];
`;
// 7. Confere que o lock é NOSSO. Se não for, para SEM unlock (o lock não é nosso).
const JS_CONF_LOCK = COMUM + String.raw`
const c = cfg();
const ctx = $('Checar lock e guardar versão').first().json;
const r = $input.first(), m = corpo(r);
if (status(r) !== 200 || !m.lock || ((m.lock.created_by || {}).login) !== c.loginEsperado) {
  throw new Error('PAROU: não consegui travar o arquivo (' + resumoErro(r) + (m.lock ? ', lock de ' + quem(m.lock.created_by) : '') + '). Nada foi escrito; o unlock não roda porque o lock não é nosso.');
}
const seguir = m.sha1 === ctx.versaoGuardada.sha1;
return [{ json: { ...ctx, temLock: true, lock: { id: m.lock.id, em: m.lock.created_at, expira: m.lock.expires_at }, etagPosLock: m.etag, seguir, motivo: seguir ? null : 'o arquivo mudou entre a checagem e o lock (sha1 ' + m.sha1 + ')' } }];
`;

// 8. Releitura + conferências + aplicação + comparação em memória. Nunca lança exceção: devolve
// seguir=false com o motivo (o unlock precisa rodar).
function jsAplicar() {
  return COMUM + SHA1 + fonteCirurgico() + IMPRESSAO + CELULAS + String.raw`
const helpers = this.helpers;
const ctx = $('Conferir lock').first().json;
const c = cfg();
let saida;
try {
  const JSZip = require('jszip');
  const ExcelJS = require('exceljs');
  const it = $input.first();
  if (!it.binary || !it.binary.data) throw new Error('download sem binário');
  const buf = it.binary.data.id ? await helpers.getBinaryDataBuffer(0, 'data') : Buffer.from(it.binary.data.data, 'base64');
  const sha = sha1(buf);
  if (sha !== ctx.versaoGuardada.sha1) throw new Error('o arquivo baixado depois do lock tem sha1 ' + sha + ', esperado ' + ctx.versaoGuardada.sha1);
  const zip = await JSZip.loadAsync(buf);
  const parteNotas = await caminhoDaAba(zip, 'NOTAS');
  const xml = await zip.file(parteNotas).async('string');
  const ss = await sharedStrings(zip);

  // Linhas-alvo: B, E, G, H conferidos com exceljs (só leitura). Aba 'NOTAS' com nome exato.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets.find((w) => w.name === 'NOTAS');
  if (!ws) throw new Error('aba "NOTAS" não encontrada (abas: ' + wb.worksheets.map((w) => w.name).join(', ') + ')');
  let cab = null;
  for (let l = 1; l <= 10; l++) if (texto(ws.getRow(l), 'Q') === 'CHECK ARQUIVO DRIVE') { cab = 'Q' + l; break; }
  if (!cab) throw new Error('cabeçalho "CHECK ARQUIVO DRIVE" não encontrado na coluna Q (linhas 1 a 10)');
  // índice de unicidade: a mesma combinação B+E+H em outra linha deixa a célula de fora
  const chaves = chavesBEH(ws);

  // Estilo do "OK" verde já existente NO MESMO arquivo: fonte branca e negrito, preenchimento sólido.
  const st = await zip.file('xl/styles.xml').async('string');
  const lista = (n, tag) => (((st.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)</' + n + '>')) || [])[1]) || '').match(new RegExp('<' + tag + '\\b[^>]*?/>|<' + tag + '\\b[\\s\\S]*?</' + tag + '>', 'g')) || [];
  const xfs = lista('cellXfs', 'xf'), fonts = lista('fonts', 'font'), fills = lista('fills', 'fill');
  const tema = zip.file('xl/theme/theme1.xml') ? await zip.file('xl/theme/theme1.xml').async('string') : '';
  const lt1 = (tema.match(/<a:lt1>([\s\S]*?)<\/a:lt1>/) || [])[1] || '';
  const tema0Branco = /lastClr="FFFFFF"/i.test(lt1) || /srgbClr val="FFFFFF"/i.test(lt1);
  const descrever = (idx) => {
    const x = xfs[+idx] || ''; const g = (a) => (x.match(new RegExp('\\b' + a + '="(\\d+)"')) || [])[1];
    const f = fonts[+g('fontId')] || '', p = fills[+g('fillId')] || '';
    const negrito = /<b\/>|<b val="(1|true)"\/>/.test(f);
    const cor = (f.match(/<color ([^>]*)\/>/) || [])[1] || '';
    const branco = /rgb="FFFFFFFF"/i.test(cor) || (/theme="0"/.test(cor) && !/tint=/.test(cor) && tema0Branco);
    const solido = /patternType="solid"/.test(p);
    const fg = (p.match(/<fgColor ([^>]*)\/>/) || [])[1] || '';
    return { idx: String(idx), negrito, branco, solido, fonte: f.replace(/\s+/g, ''), preenchimento: fg, numFmtId: g('numFmtId'), borderId: g('borderId') };
  };
  const contagem = {};
  for (const m of xml.matchAll(/<c\b[^>]*?\br="Q(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const cel = celulaXml(m[0], 'Q' + m[1], ss);
    if (cel.valor === 'OK' && cel.estilo != null) contagem[cel.estilo] = (contagem[cel.estilo] || 0) + 1;
  }
  const candidatos = Object.entries(contagem).map(([idx, n]) => ({ ...descrever(idx), n })).sort((a, b) => b.n - a.n);
  const verdes = candidatos.filter((x) => x.negrito && x.branco && x.solido);
  const coresVerdes = [...new Set(verdes.map((x) => x.preenchimento))];
  const estiloInfo = { candidatosOK: candidatos.map((x) => ({ idx: x.idx, n: x.n, negrito: x.negrito, branco: x.branco, preenchimento: x.preenchimento, numFmtId: x.numFmtId, borderId: x.borderId })), coresVerdes, tema0Branco };
  if (!verdes.length) { saida = { seguir: false, precisaEstiloNovo: true, motivo: 'não achei nenhum "OK" em negrito, fonte branca e preenchimento sólido na coluna Q deste arquivo. Para marcar seria preciso ACRESCENTAR um estilo em styles.xml (não fiz).', estiloInfo }; }
  else if (coresVerdes.length > 1) { saida = { seguir: false, motivo: 'os "OK" em negrito/branco usam mais de uma cor de preenchimento (' + coresVerdes.join(' | ') + '); não sei qual é o verde claro', estiloInfo }; }
  else {
    const escolhido = verdes[0]; // o mais usado
    if (c.estiloOK && escolhido.idx !== c.estiloOK) throw new Error('o "OK" verde mais usado agora é o estilo ' + escolhido.idx + ', não o ' + c.estiloOK + ' visto antes; não escrevi');
    const celulas = [], gravar = [];
    const avaliar = (a, origem) => {
      const lido = lerLinha(ws, a.linha);
      const cel = celulaXml(xml, a.ref, ss);
      const linha = { aba: 'NOTAS', linha: a.linha, coluna: 'Q', nota: a.nota, origem, valorAnterior: cel.valor, estiloAnterior: cel.estilo, valorNovo: cel.valor, estiloNovo: cel.estilo, resultado: null };
      const dif = difLinha(lido, a);
      const k = lido.b + '|' + lido.e + '|' + lido.h;
      if (dif.length) linha.resultado = 'NÃO ESCRITA: a linha não confere: ' + dif.join('; ');
      else if (chaves[k] !== 1) linha.resultado = 'NÃO ESCRITA: a combinação B+E+H aparece em ' + chaves[k] + ' linhas';
      else if (cel.formula) linha.resultado = 'NÃO ESCRITA: a célula tem fórmula';
      else if (cel.valor === 'OK') linha.resultado = 'JÁ ESTAVA "OK"';
      else if (!vazioOuPendente(cel.valor)) linha.resultado = 'NÃO ESCRITA: já tem "' + cel.valor + '"';
      else { linha.valorNovo = 'OK'; linha.estiloNovo = escolhido.idx; linha.resultado = 'A ESCREVER'; }
      return linha;
    };
    for (const a of c.alvos) {
      const linha = avaliar(a, 'plano');
      if (linha.resultado === 'A ESCREVER') gravar.push({ ref: a.ref, valor: 'OK', estiloIndice: escolhido.idx });
      celulas.push(linha);
    }
    // Rodada A, célula do plano já "OK" (e só nesse caso): escolhe NA CÓPIA uma reserva entre as
    // notas do registro desta fonte, vazia ou "PENDENTE", com B/E/G/H conferidos. Exatamente uma.
    let reserva = null;
    if (c.rodada === 'A' && !gravar.length && celulas.every((l) => l.resultado === 'JÁ ESTAVA "OK"')) {
      const doPlano = new Set(c.alvos.map((a) => a.linha));
      const vistas = new Set();
      const avaliadas = [];
      for (const r of c.registro.filter((x) => x.f === c.fonte).sort((x, y) => x.l - y.l)) {
        if (doPlano.has(r.l) || vistas.has(r.l)) continue;
        vistas.add(r.l);
        const linha = avaliar({ ref: 'Q' + r.l, linha: r.l, nota: r.nota, b: r.b, e: r.e, g: r.g, h: r.h }, 'reserva (a célula do plano já estava "OK")');
        avaliadas.push({ linha: r.l, resultado: linha.resultado });
        if (linha.resultado === 'A ESCREVER') { celulas.push(linha); gravar.push({ ref: 'Q' + r.l, valor: 'OK', estiloIndice: escolhido.idx }); break; }
      }
      reserva = { avaliadas: avaliadas.length, escolhida: gravar.length ? gravar[0].ref : null, descartadas: avaliadas.filter((x) => x.resultado !== 'A ESCREVER').slice(0, 60) };
    }
    if (!gravar.length) { saida = { seguir: false, nadaAEscrever: true, motivo: 'nenhuma célula a escrever' + (reserva ? ' (nenhuma reserva vazia ou "PENDENTE" em ' + c.fonte + ')' : ''), celulas, reserva, estiloInfo: { ...estiloInfo, escolhido: escolhido.idx } }; }
    else {
      const res = await gravarPreservando(buf, 'NOTAS', gravar, JSZip);
      if (res.caminhoAba !== parteNotas) throw new Error('a escrita foi para ' + res.caminhoAba + ', não para ' + parteNotas);
      const refs = celulas.map((l) => 'Q' + l.linha);
      const zipNovo = await JSZip.loadAsync(res.buffer);
      const A = await impressao(zip, 'NOTAS', refs);
      const D = await impressao(zipNovo, 'NOTAS', refs);
      const cmp = comparar(A, D, 'NOTAS', true);
      // As células escritas, lidas de volta do buffer novo.
      const xmlNovo = await zipNovo.file(parteNotas).async('string');
      const ssNovo = await sharedStrings(zipNovo);
      for (const l of celulas) {
        const cel = celulaXml(xmlNovo, 'Q' + l.linha, ssNovo);
        const esperado = l.resultado === 'A ESCREVER' ? { v: 'OK', s: l.estiloNovo } : { v: l.valorAnterior, s: l.estiloAnterior };
        if (cel.valor !== esperado.v || cel.estilo !== esperado.s) cmp.divergencias.push('Q' + l.linha + ' no buffer novo: "' + cel.valor + '" s=' + cel.estilo + ' (esperado "' + esperado.v + '" s=' + esperado.s + ')');
      }
      const ok = cmp.divergencias.length === 0;
      saida = { seguir: ok, motivo: ok ? null : 'comparação em memória divergiu: ' + cmp.divergencias.slice(0, 10).join(' | '), celulas, reserva, refs, estiloInfo: { ...estiloInfo, escolhido: escolhido.idx }, integridade: res.integridade, comparacaoMemoria: cmp, impressaoAntes: A, impressaoNova: D, sha1Novo: sha1(res.buffer), tamanhoNovo: res.buffer.length };
      if (ok) saida.__bin = res.buffer;
    }
  }
} catch (e) {
  saida = { seguir: false, motivo: 'ERRO na releitura/aplicação: ' + String(e && e.message || e).slice(0, 500) };
}
const bin = saida.__bin; delete saida.__bin;
const item = { json: { ...ctx, aplicar: saida, seguir: saida.seguir, etag: ctx.etagPosLock, urlUpload: BOX_UPLOAD + '/files/' + ctx.alvoId + '/content', qsUpload: { fields: 'sha1,size,etag,file_version' } } };
if (bin) item.binary = { data: { data: bin.toString('base64'), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: ctx.alvoNome } };
return [item];
`;
}
const JS_FALHA_DOWNLOAD = COMUM + String.raw`
const ctx = $('Conferir lock').first().json;
return [{ json: { ...ctx, seguir: false, aplicar: { seguir: false, motivo: 'falha no download depois do lock: ' + JSON.stringify($input.first().json).slice(0, 300) } } }];
`;
const JS_CONF_UPLOAD = COMUM + String.raw`
const ap = $('Reler, conferir e aplicar').first().json;
const r = $input.first(), b = corpo(r);
const e = (b.entries || [])[0] || {};
const upou = status(r) === 200 && !!e.id;
return [{ json: { upload: { status: status(r), erro: upou ? null : resumoErro(r), sha1: e.sha1 || null, tamanho: e.size || null, versao: (e.file_version || {}).id || null, confere: upou && e.sha1 === ap.aplicar.sha1Novo } } }];
`;
// Unlock: um único node, alimentado por todos os caminhos depois do lock.
const JS_PREP_UNLOCK_EXPR = `={{ '${BOX_API}/files/' + $('Conferir lock').first().json.alvoId }}`;
const JS_POS_UNLOCK = COMUM + String.raw`
const ctx = $('Conferir lock').first().json;
const r = $input.first(), m = corpo(r);
const unlock = { status: status(r), ok: status(r) === 200 && !m.lock, erro: status(r) === 200 ? (m.lock ? 'ainda travado' : null) : resumoErro(r) };
const houveUpload = $('Conferir upload').isExecuted;
const up = houveUpload ? $('Conferir upload').first().json.upload : null;
return [{ json: { alvoId: ctx.alvoId, unlock, houveUpload: !!(up && up.status === 200), upload: up, url: BOX_API + '/files/' + ctx.alvoId, qs: { fields: '${CAMPOS}' } } }];
`;
// 11. Releitura depois do upload e comparação completa.
function jsComparar() {
  return COMUM + SHA1 + fonteCirurgico() + IMPRESSAO + CELULAS + String.raw`
const helpers = this.helpers;
const c = cfg();
const ap = $('Reler, conferir e aplicar').first().json;
const pu = $('Depois do unlock').first().json;
const meta = corpo($('Box — metadados depois').first());
const div = [];
let cmpA = null, cmpN = null, celulas = [];
try {
  const JSZip = require('jszip');
  const it = $input.first();
  if (!it.binary || !it.binary.data) throw new Error('download depois do upload sem binário');
  const buf = it.binary.data.id ? await helpers.getBinaryDataBuffer(0, 'data') : Buffer.from(it.binary.data.data, 'base64');
  const sha = sha1(buf);
  if (sha !== ap.aplicar.sha1Novo) div.push('sha1 relido ' + sha + ' ≠ sha1 gerado ' + ap.aplicar.sha1Novo);
  if (meta.sha1 !== ap.aplicar.sha1Novo) div.push('sha1 no Box ' + meta.sha1 + ' ≠ sha1 gerado');
  if (!pu.upload || pu.upload.sha1 !== ap.aplicar.sha1Novo) div.push('sha1 da resposta do upload ≠ sha1 gerado');
  if (meta.lock) div.push('o arquivo continua travado por ' + quem(meta.lock.created_by));
  const zip = await JSZip.loadAsync(buf);
  const R = await impressao(zip, 'NOTAS', ap.aplicar.refs);
  cmpA = comparar(ap.aplicar.impressaoAntes, R, 'NOTAS', true);   // contra o backup (antes)
  cmpN = comparar(ap.aplicar.impressaoNova, R, 'NOTAS', false);   // contra o que foi gerado
  div.push(...cmpA.divergencias, ...cmpN.divergencias.map((x) => 'vs gerado: ' + x));
  const parte = await caminhoDaAba(zip, 'NOTAS');
  const xml = await zip.file(parte).async('string');
  const ss = await sharedStrings(zip);
  celulas = ap.aplicar.celulas.map((l) => {
    const cel = celulaXml(xml, 'Q' + l.linha, ss);
    const okv = cel.valor === l.valorNovo && cel.estilo === l.estiloNovo;
    if (!okv) div.push('Q' + l.linha + ' relido "' + cel.valor + '" s=' + cel.estilo + ' (esperado "' + l.valorNovo + '" s=' + l.estiloNovo + ')');
    return { ...l, relido: cel.valor, estiloRelido: cel.estilo, resultado: l.resultado === 'A ESCREVER' ? (okv ? 'ESCRITA E CONFERIDA' : 'DIVERGENTE') : l.resultado };
  });
} catch (e) { div.push('ERRO na releitura: ' + String(e && e.message || e).slice(0, 300)); }
const ok = div.length === 0;
return [{ json: { ok, divergencias: div.slice(0, 30), comparacaoContraAntes: cmpA ? cmpA.itens : null, celulas, depois: { sha1: meta.sha1, versao: (meta.file_version || {}).id, tamanho: meta.size, etag: meta.etag },
  pedidoBackup2: ok ? null : { corpo: { parent: { id: $('Conferir lock').first().json.pastaBackupId }, name: semExt($('Conferir lock').first().json.alvoNome) + '_copia_' + carimbo(new Date()) + '.xlsx' } } } }];
`;
}

// 12. Restauração.
const JS_REST_CONF_BACKUP2 = COMUM + String.raw`
// Vem de "Comparar depois" ou de "Falha no download depois"; o sha1 de referência é o do Box agora.
const cmp = ($('Comparar depois').isExecuted ? $('Comparar depois') : $('Falha no download depois')).first().json;
const atual = corpo($('Box — metadados depois').first());
const r = $input.first(), b = corpo(r);
const ok = status(r) === 200 && !!atual.sha1 && b.sha1 === atual.sha1 && b.name === cmp.pedidoBackup2.corpo.name;
const ctx = $('Conferir lock').first().json;
return [{ json: { backup2: { ok, id: b.id || null, nome: b.name || null, sha1: b.sha1 || null, erro: ok ? null : resumoErro(r) }, seguir: ok,
  url: BOX_API + '/files/' + ctx.alvoId, qs: { fields: 'lock,etag,sha1,file_version' }, corpoLock: { lock: { type: 'lock', is_download_prevented: false, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z') } } } }];
`;
const JS_REST_CONF_LOCK = COMUM + String.raw`
const c = cfg();
const ctx = $('Conferir lock').first().json;
const r = $input.first(), m = corpo(r);
const nosso = status(r) === 200 && m.lock && ((m.lock.created_by || {}).login) === c.loginEsperado;
return [{ json: { temLock: !!nosso, etag: m.etag || null, erro: nosso ? null : resumoErro(r) + (m.lock ? ' (lock de ' + quem(m.lock.created_by) + ')' : ''), backupId: ctx.backup.id } }];
`;
const JS_REST_PREP_UPLOAD = SHA1 + COMUM + String.raw`
const helpers = this.helpers;
const ctx = $('Conferir lock').first().json;
const lk = $('Restauração — conferir lock').first().json;
const it = $input.first();
let ok = false, erro = null, bin = null;
try {
  if (!it.binary || !it.binary.data) throw new Error('download do backup sem binário');
  const buf = it.binary.data.id ? await helpers.getBinaryDataBuffer(0, 'data') : Buffer.from(it.binary.data.data, 'base64');
  const s = sha1(buf);
  if (s !== ctx.backup.sha1) throw new Error('o backup baixado tem sha1 ' + s + ', esperado ' + ctx.backup.sha1);
  ok = true; bin = buf;
} catch (e) { erro = String(e.message || e).slice(0, 300); }
const item = { json: { seguir: ok, erro, etag: lk.etag, urlUpload: BOX_UPLOAD + '/files/' + ctx.alvoId + '/content', qsUpload: { fields: 'sha1,size,etag,file_version' } } };
if (bin) item.binary = { data: { data: bin.toString('base64'), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: ctx.alvoNome } };
return [item];
`;
const JS_REST_FALHA_DOWNLOAD = `return [{ json: { seguir: false, erro: 'falha no download do backup: ' + JSON.stringify($input.first().json).slice(0, 300) } }];`;
const JS_REST_FIM = COMUM + String.raw`
const ctx = $('Conferir lock').first().json;
const ul = $input.first(), mu = corpo(ul);
const passos = {};
passos.backupDoEstadoAtual = $('Restauração — conferir backup do estado atual').first().json.backup2;
passos.lock = $('Restauração — conferir lock').isExecuted ? $('Restauração — conferir lock').first().json : null;
passos.prepUpload = $('Restauração — preparar upload').isExecuted ? { seguir: $('Restauração — preparar upload').first().json.seguir, erro: $('Restauração — preparar upload').first().json.erro } : null;
const up = $('Restauração — upload do backup').isExecuted ? $('Restauração — upload do backup').first() : null;
passos.upload = up ? { status: status(up), sha1: ((corpo(up).entries || [])[0] || {}).sha1 || null, erro: status(up) === 200 ? null : resumoErro(up) } : null;
passos.unlock = { status: status(ul), ok: status(ul) === 200 && !mu.lock };
return [{ json: { passos, url: BOX_API + '/files/' + ctx.alvoId, qs: { fields: 'sha1,size,file_version,lock' } } }];
`;
const JS_REST_CONF = COMUM + String.raw`
const ctx = $('Conferir lock').first().json;
const f = $('Restauração — fim do ciclo').first().json;
const m = corpo($input.first());
const restaurado = m.sha1 === ctx.backup.sha1 && !m.lock;
return [{ json: { restauracao: { ...f.passos, restaurado, sha1Final: m.sha1 || null, versaoFinal: (m.file_version || {}).id || null, travado: m.lock ? quem(m.lock.created_by) : null } } }];
`;

// Resultado final (compacto), de qualquer caminho que chegue ao fim.
const JS_RESULTADO = COMUM + String.raw`
const c = cfg();
const ex = (n) => $(n).isExecuted;
const j = (n) => (ex(n) ? $(n).first().json : null);
const lk = j('Conferir lock');
const ap = j('Reler, conferir e aplicar');
const pu = j('Depois do unlock');
const cmp = j('Comparar depois');
const rest = j('Restauração — conferir') || j('Restauração — não executada');
let estado;
const p0 = c.passo0 ? j('Passo 0 — comparar backup x atual') : null;
if (p0 && !p0.passo0.ok) estado = 'PAROU NO PASSO 0 (nada escrito): ' + p0.passo0.motivo;
else if (rest) estado = rest.restauracao.restaurado ? 'FALHOU NA RELEITURA — RESTAURADO' : 'FALHOU NA RELEITURA — RESTAURAÇÃO NÃO CONFIRMADA';
else if (cmp && cmp.ok) estado = 'IDÊNTICO (só as células Q escritas mudaram)';
else if (ap && !ap.aplicar.seguir) estado = ap.aplicar.nadaAEscrever ? 'NADA A ESCREVER' : 'NÃO ESCRITO: ' + ap.aplicar.motivo;
else if (lk && !lk.seguir) estado = 'NÃO ESCRITO: ' + lk.motivo;
else if (pu && !pu.houveUpload) estado = 'NÃO ESCRITO: upload recusado (' + ((pu.upload || {}).erro || 'download falhou') + ')';
else estado = 'INDEFINIDO';
const ctx = lk || {};
return [{ json: {
  rodada: c.rodada, fonte: c.fonte, status: estado,
  alvo: { id: ctx.alvoId, nome: ctx.alvoNome, copiaTeste: ctx.copiaTeste || null },
  pastas: { teste: ctx.pastaTesteId, backup: ctx.pastaBackupId, criadasAgora: ctx.criadasAgora },
  backup: ctx.backup || null, retencao: ctx.retencao || null,
  versaoGuardada: ctx.versaoGuardada || null, lock: ctx.lock || null,
  estilo: ap ? ap.aplicar.estiloInfo : null,
  celulas: (cmp && cmp.celulas && cmp.celulas.length) ? cmp.celulas : (ap ? ap.aplicar.celulas || null : null),
  comparacaoEmMemoria: ap && ap.aplicar.comparacaoMemoria ? { divergencias: ap.aplicar.comparacaoMemoria.divergencias } : null,
  comparacaoDepois: cmp ? { ok: cmp.ok, itens: cmp.comparacaoContraAntes, divergencias: cmp.divergencias } : null,
  upload: pu ? pu.upload : null, unlock: pu ? pu.unlock : null,
  depois: cmp ? cmp.depois : null,
  restauracao: rest ? rest.restauracao : null,
  integridade: ap ? ap.aplicar.integridade || null : null,
  reserva: ap ? ap.aplicar.reserva || null : null,
  passo0: p0 ? p0.passo0 : null,
  contagem: ex('Contagem coluna Q (só leitura)') ? $('Contagem coluna Q (só leitura)').first().json.contagem : null,
} }];
`;

// ---------------------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------------------
function montar(rodada, fonte) {
  posX = 0;
  const nodes = [], conn = {};
  const add = (n) => (nodes.push(n), n);
  const liga = (de, para, saida = 0) => {
    conn[de] = conn[de] || { main: [] };
    while (conn[de].main.length <= saida) conn[de].main.push([]);
    conn[de].main[saida].push({ node: para, type: 'main', index: 0 });
  };
  const cadeia = (...ns) => { for (let i = 0; i + 1 < ns.length; i++) liga(ns[i], ns[i + 1]); };
  const Q = '={{ JSON.stringify($json.qs) }}';

  add({ id: crypto.randomUUID(), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} });
  add(code('Config', jsConfig(rodada, fonte)));
  add(boxHttp('Box — identidade (users/me)', 'GET', BOX_API + '/users/me', { query: "={{ JSON.stringify({ fields: 'login,name' }) }}" }));
  add(boxHttp('Box — Cost (metadados)', 'GET', BOX_API + '/files/' + COST[fonte].id, { query: "={{ JSON.stringify({ fields: '" + CAMPOS + "' }) }}" }));
  add(code('Portão (identidade + nome do Cost)', JS_PORTAO));
  add(boxHttp('Box — listar raiz', 'GET', '={{ $json.url }}', { query: Q }));
  add(code('Pastas ZZ na raiz', JS_PASTAS));
  add(se('Criar pasta ZZ?', '={{ $json.algumaPraCriar }}'));
  add(code('Contagem — pedir', JS_CONTAGEM_PEDIR));
  add(boxHttp('Box — Cost reais (metadados)', 'GET', '={{ $json.url }}', { query: Q }));
  add(code('Contagem — conferir nomes', JS_CONTAGEM_NOMES));
  add(boxDownload('Box — baixar Cost reais (só leitura)', '={{ $json.id }}'));
  add(code('Contagem coluna Q (só leitura)', jsContagem()));
  add(code('Contagem — falha no download', JS_CONTAGEM_FALHA));
  cadeia('Manual Trigger', 'Config', 'Box — identidade (users/me)', 'Box — Cost (metadados)', 'Portão (identidade + nome do Cost)', 'Contagem — pedir', 'Box — Cost reais (metadados)', 'Contagem — conferir nomes', 'Box — baixar Cost reais (só leitura)');
  liga('Box — baixar Cost reais (só leitura)', 'Contagem coluna Q (só leitura)', 0);
  liga('Box — baixar Cost reais (só leitura)', 'Contagem — falha no download', 1);
  if (PASSO0[rodada + '-' + fonte]) {
    add(code('Passo 0 — pedir', JS_PASSO0_PEDIR));
    add(boxHttp('Box — Passo 0 (metadados)', 'GET', '={{ $json.url }}', { query: Q }));
    add(code('Passo 0 — metadados', JS_PASSO0_METAS));
    add(boxDownload('Box — Passo 0 baixar backup e atual (só leitura)', '={{ $json.id }}'));
    add(code('Passo 0 — comparar backup x atual', jsPasso0()));
    add(code('Passo 0 — falha no download', `throw new Error('PAROU antes de escrever: Passo 0, falha no download: ' + JSON.stringify($input.first().json).slice(0, 300));`));
    add(se('Passo 0 ok?', '={{ $json.seguir }}'));
    cadeia('Contagem coluna Q (só leitura)', 'Passo 0 — pedir', 'Box — Passo 0 (metadados)', 'Passo 0 — metadados', 'Box — Passo 0 baixar backup e atual (só leitura)');
    liga('Box — Passo 0 baixar backup e atual (só leitura)', 'Passo 0 — comparar backup x atual', 0);
    liga('Box — Passo 0 baixar backup e atual (só leitura)', 'Passo 0 — falha no download', 1);
    cadeia('Passo 0 — comparar backup x atual', 'Passo 0 ok?');
    liga('Passo 0 ok?', 'Box — listar raiz', 0);
    liga('Passo 0 ok?', 'Resultado', 1);
  } else liga('Contagem coluna Q (só leitura)', 'Box — listar raiz');
  cadeia('Box — listar raiz', 'Pastas ZZ na raiz', 'Criar pasta ZZ?');
  add(code('Uma pasta por item', JS_ITENS_CRIAR));
  add(boxHttp('Box — criar pasta ZZ', 'POST', BOX_API + '/folders', { body: '={{ JSON.stringify($json.corpo) }}', query: "={{ JSON.stringify({ fields: 'id,name,type,parent' }) }}" }));
  add(code('Conferir pastas criadas', JS_PASTAS_CRIADAS));
  add(code('Nenhuma pasta a criar', JS_PREP_RELISTAR));
  add(boxHttp('Box — relistar raiz', 'GET', '={{ $json.url }}', { query: Q, umaVez: true }));
  liga('Criar pasta ZZ?', 'Uma pasta por item', 0);
  cadeia('Uma pasta por item', 'Box — criar pasta ZZ', 'Conferir pastas criadas', 'Box — relistar raiz');
  liga('Criar pasta ZZ?', 'Nenhuma pasta a criar', 1);
  liga('Nenhuma pasta a criar', 'Box — relistar raiz');
  add(code('Conferir pastas ZZ', JS_PASTAS_CONF));
  add(boxHttp('Box — detalhes das pastas ZZ', 'GET', '={{ $json.url }}', { query: Q }));
  add(code('Pastas privadas?', JS_PASTAS_PRIVADAS));
  cadeia('Box — relistar raiz', 'Conferir pastas ZZ', 'Box — detalhes das pastas ZZ', 'Pastas privadas?');
  if (rodada === 'A') {
    add(boxHttp('Box — copiar Cost para ZZ-TESTE-ESCRITA', 'POST', BOX_API + '/files/' + COST[fonte].id + '/copy', { body: '={{ JSON.stringify($json.corpoCopia) }}', query: "={{ JSON.stringify({ fields: 'id,name,sha1,size,parent,file_version' }) }}" }));
    add(code('Definir alvo', JS_CONF_COPIA_TESTE));
    cadeia('Pastas privadas?', 'Box — copiar Cost para ZZ-TESTE-ESCRITA', 'Definir alvo');
  } else {
    add(code('Definir alvo', JS_ALVO_REAL));
    liga('Pastas privadas?', 'Definir alvo');
  }
  add(boxHttp('Box — alvo (metadados)', 'GET', "={{ '" + BOX_API + "/files/' + $json.alvoId }}", { query: "={{ JSON.stringify({ fields: '" + CAMPOS + "' }) }}" }));
  add(code('Pedir backup', JS_PEDIR_BACKUP));
  add(boxHttp('Box — backup (cópia)', 'POST', "={{ '" + BOX_API + "/files/' + $json.alvoId + '/copy' }}", { body: '={{ JSON.stringify($json.corpoBackup) }}', query: "={{ JSON.stringify({ fields: 'id,name,sha1,size,parent,file_version' }) }}" }));
  add(boxHttp('Box — reler backup', 'GET', "={{ '" + BOX_API + "/files/' + $json.id }}", { query: "={{ JSON.stringify({ fields: 'id,name,sha1,size,parent,file_version' }) }}" }));
  add(code('Conferir backup', JS_CONF_BACKUP));
  add(boxHttp('Box — listar ZZ-BACKUP-COST', 'GET', '={{ $json.url }}', { query: Q }));
  add(code('Retenção (5 por planilha)', JS_RETENCAO));
  add(se('Apagar backup antigo?', '={{ $json.apagar }}'));
  cadeia('Definir alvo', 'Box — alvo (metadados)', 'Pedir backup', 'Box — backup (cópia)', 'Box — reler backup', 'Conferir backup', 'Box — listar ZZ-BACKUP-COST', 'Retenção (5 por planilha)', 'Apagar backup antigo?');
  add(boxHttp('Box — apagar backup mais antigo', 'DELETE', '={{ $json.urlApagar }}', { continuar: true }));
  add(boxHttp('Box — conferir backup apagado', 'GET', "={{ $('Retenção (5 por planilha)').first().json.urlApagar }}", { query: "={{ JSON.stringify({ fields: 'id,name' }) }}" }));
  add(code('Conferir retenção', JS_RETENCAO_CONF));
  add(code('Antes do lock', JS_PREP_LOCK_CHECK));
  liga('Apagar backup antigo?', 'Box — apagar backup mais antigo', 0);
  cadeia('Box — apagar backup mais antigo', 'Box — conferir backup apagado', 'Conferir retenção', 'Antes do lock');
  liga('Apagar backup antigo?', 'Antes do lock', 1);
  add(boxHttp('Box — alvo antes do lock', 'GET', '={{ $json.url }}', { query: Q, umaVez: true }));
  add(code('Checar lock e guardar versão', JS_CHECAR_LOCK));
  add(boxHttp('Box — LOCK', 'PUT', '={{ $json.url }}', { query: Q, body: '={{ JSON.stringify($json.corpoLock) }}' }));
  add(code('Conferir lock', JS_CONF_LOCK));
  add(se('Seguir depois do lock?', '={{ $json.seguir }}'));
  cadeia('Antes do lock', 'Box — alvo antes do lock', 'Checar lock e guardar versão', 'Box — LOCK', 'Conferir lock', 'Seguir depois do lock?');
  add(boxDownload('Box — baixar alvo (pós-lock)', '={{ $json.alvoId }}'));
  add(code('Reler, conferir e aplicar', jsAplicar()));
  add(code('Falha no download', JS_FALHA_DOWNLOAD));
  add(se('Subir nova versão?', '={{ $json.seguir }}'));
  liga('Seguir depois do lock?', 'Box — baixar alvo (pós-lock)', 0);
  liga('Box — baixar alvo (pós-lock)', 'Reler, conferir e aplicar', 0);
  liga('Box — baixar alvo (pós-lock)', 'Falha no download', 1);
  liga('Reler, conferir e aplicar', 'Subir nova versão?');
  add(boxHttp('Box — upload nova versão (If-Match)', 'POST', '={{ $json.urlUpload }}', { query: '={{ JSON.stringify($json.qsUpload) }}', upload: true, ifMatch: '={{ $json.etag }}', continuar: true }));
  add(code('Conferir upload', JS_CONF_UPLOAD));
  liga('Subir nova versão?', 'Box — upload nova versão (If-Match)', 0);
  liga('Box — upload nova versão (If-Match)', 'Conferir upload');
  add(boxHttp('Box — UNLOCK (sempre)', 'PUT', JS_PREP_UNLOCK_EXPR, { query: "={{ JSON.stringify({ fields: 'lock' }) }}", body: '={{ JSON.stringify({ lock: null }) }}', continuar: true, umaVez: true }));
  liga('Conferir upload', 'Box — UNLOCK (sempre)');
  liga('Subir nova versão?', 'Box — UNLOCK (sempre)', 1);
  liga('Seguir depois do lock?', 'Box — UNLOCK (sempre)', 1);
  liga('Falha no download', 'Box — UNLOCK (sempre)');
  add(code('Depois do unlock', JS_POS_UNLOCK));
  add(se('Houve upload?', '={{ $json.houveUpload }}'));
  cadeia('Box — UNLOCK (sempre)', 'Depois do unlock', 'Houve upload?');
  add(boxHttp('Box — metadados depois', 'GET', '={{ $json.url }}', { query: Q }));
  add(boxDownload('Box — baixar depois', '={{ $json.id }}'));
  add(code('Comparar depois', jsComparar()));
  add(code('Falha no download depois', `return [{ json: { ok: false, divergencias: ['falha no download depois do upload'], celulas: [], depois: {}, pedidoBackup2: { corpo: { parent: { id: $('Conferir lock').first().json.pastaBackupId }, name: String($('Conferir lock').first().json.alvoNome).replace(/\\.xlsx$/i, '') + '_copia_' + $('Config').first().json.carimbo + '_2.xlsx' } } } }];`));
  add(se('Idêntico?', '={{ $json.ok }}'));
  add(code('Resultado', JS_RESULTADO));
  liga('Houve upload?', 'Box — metadados depois', 0);
  liga('Houve upload?', 'Resultado', 1);
  liga('Box — metadados depois', 'Box — baixar depois');
  liga('Box — baixar depois', 'Comparar depois', 0);
  liga('Box — baixar depois', 'Falha no download depois', 1);
  liga('Comparar depois', 'Idêntico?');
  liga('Falha no download depois', 'Idêntico?');
  liga('Idêntico?', 'Resultado', 0);
  // Restauração
  add(boxHttp('Restauração — backup do estado atual', 'POST', "={{ '" + BOX_API + "/files/' + $('Conferir lock').first().json.alvoId + '/copy' }}", { body: '={{ JSON.stringify($json.pedidoBackup2.corpo) }}', query: "={{ JSON.stringify({ fields: 'id,name,sha1,size,parent' }) }}" }));
  add(code('Restauração — conferir backup do estado atual', JS_REST_CONF_BACKUP2));
  add(se('Restauração — backup ok?', '={{ $json.seguir }}'));
  liga('Idêntico?', 'Restauração — backup do estado atual', 1);
  cadeia('Restauração — backup do estado atual', 'Restauração — conferir backup do estado atual', 'Restauração — backup ok?');
  add(boxHttp('Restauração — LOCK', 'PUT', '={{ $json.url }}', { query: Q, body: '={{ JSON.stringify($json.corpoLock) }}' }));
  add(code('Restauração — conferir lock', JS_REST_CONF_LOCK));
  add(se('Restauração — lock nosso?', '={{ $json.temLock }}'));
  liga('Restauração — backup ok?', 'Restauração — LOCK', 0);
  cadeia('Restauração — LOCK', 'Restauração — conferir lock', 'Restauração — lock nosso?');
  add(boxDownload('Restauração — baixar backup', '={{ $json.backupId }}'));
  add(code('Restauração — preparar upload', JS_REST_PREP_UPLOAD));
  add(code('Restauração — falha no download', JS_REST_FALHA_DOWNLOAD));
  add(se('Restauração — subir?', '={{ $json.seguir }}'));
  add(boxHttp('Restauração — upload do backup', 'POST', '={{ $json.urlUpload }}', { query: '={{ JSON.stringify($json.qsUpload) }}', upload: true, ifMatch: '={{ $json.etag }}', continuar: true }));
  add(boxHttp('Restauração — UNLOCK (sempre)', 'PUT', JS_PREP_UNLOCK_EXPR, { query: "={{ JSON.stringify({ fields: 'lock' }) }}", body: '={{ JSON.stringify({ lock: null }) }}', continuar: true, umaVez: true }));
  liga('Restauração — lock nosso?', 'Restauração — baixar backup', 0);
  liga('Restauração — baixar backup', 'Restauração — preparar upload', 0);
  liga('Restauração — baixar backup', 'Restauração — falha no download', 1);
  liga('Restauração — preparar upload', 'Restauração — subir?');
  liga('Restauração — falha no download', 'Restauração — UNLOCK (sempre)');
  liga('Restauração — subir?', 'Restauração — upload do backup', 0);
  liga('Restauração — subir?', 'Restauração — UNLOCK (sempre)', 1);
  liga('Restauração — upload do backup', 'Restauração — UNLOCK (sempre)');
  add(code('Restauração — fim do ciclo', JS_REST_FIM));
  add(boxHttp('Restauração — reler', 'GET', '={{ $json.url }}', { query: Q }));
  add(code('Restauração — conferir', JS_REST_CONF));
  cadeia('Restauração — UNLOCK (sempre)', 'Restauração — fim do ciclo', 'Restauração — reler', 'Restauração — conferir', 'Resultado');
  // Sem lock nosso ou sem backup do estado atual: não restaura, vai direto ao resultado.
  add(code('Restauração — não executada', COMUM + String.raw`
const motivo = $('Restauração — backup ok?').isExecuted && !$('Restauração — conferir backup do estado atual').first().json.seguir ? 'o backup do estado atual falhou; NÃO restaurei' : 'não consegui o lock para restaurar; NÃO restaurei';
return [{ json: { restauracao: { restaurado: false, motivo, backupDoEstadoAtual: $('Restauração — conferir backup do estado atual').first().json.backup2, lock: $('Restauração — conferir lock').isExecuted ? $('Restauração — conferir lock').first().json : null } } }];`));
  liga('Restauração — backup ok?', 'Restauração — não executada', 1);
  liga('Restauração — lock nosso?', 'Restauração — não executada', 1);
  // "Restauração — não executada" também alimenta o Resultado, com o mesmo nome de leitura.
  liga('Restauração — não executada', 'Resultado');

  return {
    name: 'ZZ-TEMP coluna Q rodada ' + rodada + ' ' + fonte + ' (apagar)',
    nodes, connections: conn,
    settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveManualExecutions: true, saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all', saveExecutionProgress: false },
  };
}

// Trava: confere no JSON gerado que só existem as chamadas permitidas.
function conferirEscritas(wf, rodada, fonte) {
  const erros = [];
  const id = COST[fonte].id;
  const tipos = ['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.code', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.box', 'n8n-nodes-base.if'];
  const alvoExpr = "={{ '" + BOX_API + "/files/' + $json.alvoId }}";
  const escritas = {
    'Box — criar pasta ZZ': ['POST', BOX_API + '/folders'],
    'Box — copiar Cost para ZZ-TESTE-ESCRITA': ['POST', BOX_API + '/files/' + id + '/copy'],
    'Box — backup (cópia)': ['POST', "={{ '" + BOX_API + "/files/' + $json.alvoId + '/copy' }}"],
    'Box — apagar backup mais antigo': ['DELETE', '={{ $json.urlApagar }}'],
    'Box — LOCK': ['PUT', '={{ $json.url }}'],
    'Box — upload nova versão (If-Match)': ['POST', '={{ $json.urlUpload }}'],
    'Box — UNLOCK (sempre)': ['PUT', JS_PREP_UNLOCK_EXPR],
    'Restauração — backup do estado atual': ['POST', "={{ '" + BOX_API + "/files/' + $('Conferir lock').first().json.alvoId + '/copy' }}"],
    'Restauração — LOCK': ['PUT', '={{ $json.url }}'],
    'Restauração — upload do backup': ['POST', '={{ $json.urlUpload }}'],
    'Restauração — UNLOCK (sempre)': ['PUT', JS_PREP_UNLOCK_EXPR],
  };
  for (const n of wf.nodes) {
    if (!tipos.includes(n.type)) erros.push(n.name + ': tipo não permitido ' + n.type);
    if (n.type === 'n8n-nodes-base.box' && n.parameters.operation !== 'download') erros.push(n.name + ': operação Box ' + n.parameters.operation);
    if ((n.type === 'n8n-nodes-base.box' || n.type === 'n8n-nodes-base.httpRequest') && JSON.stringify(n.credentials) !== JSON.stringify(CRED_BOX)) erros.push(n.name + ': credencial diferente da Box account');
    if (n.type === 'n8n-nodes-base.httpRequest') {
      const m = n.parameters.method, u = n.parameters.url;
      if (m === 'GET') { if (!(u.startsWith(BOX_API) || u.startsWith('={{ $json.url }}') || u.startsWith("={{ '" + BOX_API) || u.startsWith("={{ $('Retenção"))) erros.push(n.name + ': GET fora do Box'); continue; }
      const e = escritas[n.name];
      if (!e || e[0] !== m || e[1] !== u) erros.push(n.name + ': escrita não prevista (' + m + ' ' + u + ')');
      if (n.name === 'Box — copiar Cost para ZZ-TESTE-ESCRITA' && rodada !== 'A') erros.push('cópia de teste fora da rodada A');
      if (/upload/.test(n.name) && !(n.parameters.headerParameters || { parameters: [] }).parameters.some((h) => h.name === 'If-Match')) erros.push(n.name + ': upload sem If-Match');
    }
    // comentários fora (o cabeçalho do xlsx_cirurgico cita writeBuffer para explicar por que não usa)
    const js = (n.parameters.jsCode || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/exceljs[\s\S]{0,80}\.xlsx\.write|writeBuffer\(/.test(js)) erros.push(n.name + ': grava com exceljs');
    if (/require\(['"](fs|http|https|child_process|net)['"]\)/.test(js)) erros.push(n.name + ': require proibido');
    if (/api\.telegram|googleapis\.com|gmail\.googleapis/i.test(js)) erros.push(n.name + ': referência a Gmail/Telegram/Drive');
  }
  // O alvo da escrita só pode ser o Cost (B) ou a cópia de teste conferida (A).
  if (!JS_CONF_COPIA_TESTE.includes("alvoId: b.id") || !JS_ALVO_REAL.includes('alvoId: c.costId')) erros.push('definição do alvo inesperada');
  if (!/escRe\(semExt\(ctx\.alvoNome\)\) \+ '_copia_/.test(JS_RETENCAO)) erros.push('padrão da retenção inesperado');
  const ap = (wf.nodes.find((n) => n.name === 'Reler, conferir e aplicar') || { parameters: {} }).parameters.jsCode || '';
  if (!/await gravarPreservando\(buf, 'NOTAS', gravar, JSZip\);/.test(ap)) erros.push('chamada de gravarPreservando inesperada (sem estilo novo, só aba NOTAS)');
  if (wf.settings.errorWorkflow) erros.push('errorWorkflow definido');
  void alvoExpr;
  if (erros.length) throw new Error('trava falhou:\n  ' + erros.join('\n  '));
}

async function main() {
  const [modo, rodadaArg, fonteArg] = process.argv.slice(2);
  if (modo === 'gerar' || modo === 'criar') {
    const rodada = String(rodadaArg || '').toUpperCase(), fonte = String(fonteArg || '').toUpperCase();
    if (!['A', 'B'].includes(rodada) || !COST[fonte]) throw new Error('uso: node zz-temp-coluna-q.js ' + modo + ' A|B S01|S02');
    if (rodada === 'B') {
      const a = arqResultado('A', fonte);
      if (!fs.existsSync(a)) throw new Error('rodada B recusada: não existe ' + path.basename(a) + ' (rode a A antes).');
      const st = (JSON.parse(fs.readFileSync(a, 'utf8')).resultado || {}).status || '';
      if (!st.startsWith('IDÊNTICO')) throw new Error('rodada B recusada: a rodada A de ' + fonte + ' terminou com "' + st + '".');
    }
    const wf = montar(rodada, fonte);
    conferirEscritas(wf, rodada, fonte);
    fs.writeFileSync(ARQ_WF, JSON.stringify(wf, null, 2));
    console.log('Gerado ' + path.basename(ARQ_WF) + ': rodada ' + rodada + ', ' + fonte + ', ' + wf.nodes.length + ' nodes. Células: ' + alvosDe(rodada, fonte).map((a) => a.ref).join(', ') + '. Trava: ok.');
    if (modo === 'gerar') return;
    if (fs.existsSync(ARQ_ESTADO)) throw new Error('já existe ' + path.basename(ARQ_ESTADO) + ': rode "apagar" antes.');
    const env = carregarEnv();
    const api = new N8nApi(env);
    if (((await api.listarWorkflows()) || []).some((w) => /^ZZ-TEMP/.test(w.name))) throw new Error('já existe workflow ZZ-TEMP na instância; apague antes.');
    const r = await api.criarWorkflow(wf);
    fs.writeFileSync(ARQ_ESTADO, JSON.stringify({ id: r.id, nome: wf.name, rodada, fonte, criadoEm: new Date().toISOString() }, null, 2));
    console.log('Criado INATIVO: ' + wf.name + ' (id ' + r.id + ')');
    console.log('Abra: ' + env.N8N_BASE_URL.replace(/\/+$/, '') + '/workflow/' + r.id + '  e clique em "Execute workflow".');
    return;
  }
  if (modo === 'ler') {
    const est = JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8'));
    const api = new N8nApi(carregarEnv());
    const lista = (await api.requisitar('GET', '/executions?workflowId=' + encodeURIComponent(est.id) + '&limit=50')).data || [];
    if (!lista.length) throw new Error('o workflow ' + est.id + ' ainda não tem execução salva.');
    const ex0 = lista.sort((a, b) => Number(b.id) - Number(a.id))[0];
    const ex = await api.requisitar('GET', '/executions/' + ex0.id + '?includeData=true');
    const rd = (ex.data || {}).resultData || {};
    const runData = rd.runData || {};
    const saida = (nome) => { const r = runData[nome]; if (!r || !r.length) return null; const it = ((((r[r.length - 1].data || {}).main || [])[0] || [])[0]) || null; return it ? it.json : null; };
    const resumo = {
      execucao: ex.id, status: ex.status, inicio: ex.startedAt, fim: ex.stoppedAt, rodada: est.rodada, fonte: est.fonte,
      erro: rd.error ? { mensagem: String(rd.error.message || '').slice(0, 800), node: rd.lastNodeExecuted } : null,
      nodesExecutados: Object.keys(runData).length,
      lockFeito: !!runData['Box — LOCK'], uploadFeito: !!runData['Box — upload nova versão (If-Match)'], unlockFeito: !!runData['Box — UNLOCK (sempre)'],
      resultado: saida('Resultado'),
      portao: saida('Portão (identidade + nome do Cost)'),
      contagem: (saida('Contagem coluna Q (só leitura)') || {}).contagem || null,
      passo0: (saida('Passo 0 — comparar backup x atual') || {}).passo0 || null,
    };
    est.execucoes = lista.map((x) => x.id);
    fs.writeFileSync(ARQ_ESTADO, JSON.stringify(est, null, 2));
    fs.writeFileSync(arqResultado(est.rodada, est.fonte), JSON.stringify(resumo, null, 2));
    console.log(JSON.stringify(resumo, null, 2));
    return;
  }
  if (modo === 'apagar') {
    if (!fs.existsSync(ARQ_ESTADO)) throw new Error('não achei ' + path.basename(ARQ_ESTADO) + '.');
    const { id, nome } = JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8'));
    const api = new N8nApi(carregarEnv());
    const wf = await api.obterWorkflow(id);
    if (wf.name !== nome) throw new Error('o workflow ' + id + ' se chama "' + wf.name + '". Não apaguei.');
    const lista = (await api.requisitar('GET', '/executions?workflowId=' + encodeURIComponent(id) + '&limit=250')).data || [];
    for (const x of lista) {
      if (String(x.workflowId) !== String(id)) throw new Error('execução ' + x.id + ' não é deste workflow. Parei.');
      await api.requisitar('DELETE', '/executions/' + x.id);
      try { await api.requisitar('GET', '/executions/' + x.id); throw new Error('execução ' + x.id + ' ainda existe depois do DELETE'); } catch (e) { if (e.status !== 404) throw e; }
      console.log('Execução apagada: ' + x.id);
    }
    await api.requisitar('DELETE', '/workflows/' + id);
    try { await api.obterWorkflow(id); throw new Error('o workflow ' + id + ' ainda existe depois do DELETE'); } catch (e) { if (e.status !== 404) throw e; }
    fs.unlinkSync(ARQ_ESTADO);
    const restantes = ((await api.listarWorkflows()) || []).filter((w) => /^ZZ-TEMP/.test(w.name));
    console.log('Apagado: ' + nome + '. Workflows ZZ-TEMP restantes: ' + restantes.length);
    return;
  }
  throw new Error('modo deve ser gerar, criar, ler ou apagar');
}

if (require.main === module) main().catch((e) => { console.error('ERRO: ' + e.message); process.exit(1); });
module.exports = { montar, conferirEscritas, COST, ESCOPO, alvosDe, PASSO0 };
