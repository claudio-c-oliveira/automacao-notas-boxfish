'use strict';
/**
 * Testes locais de scripts/lib/xlsx_conferencia.js + scripts/lib/xlsx_cirurgico.js
 * (passo 3 do roteiro da migração da Fase 1, plano C.7/C.8).
 *
 * Usa os Cost reais baixados pelo navegador SOMENTE PARA LEITURA (sha1 conferido antes).
 * Nada é gravado na pasta dos Cost: toda edição é feita em memória, e as saídas vão para _lixo/.
 *
 * Uso: node tests/xlsx_conferencia.teste.js ["<pasta dos Cost>"]
 * Precisa do jszip das devDependencies do package.json (npm install).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const JSZip = require('jszip');
const C = require('../scripts/lib/xlsx_conferencia.js');
const W = require('../scripts/lib/xlsx_cirurgico.js');

const PASTA_COST = path.resolve(process.argv[2] || '/home/claudio/Documentos/0.3 - MICHELLE_BOXFISH');
const SAIDA = path.join(RAIZ, '_lixo');
const ARQUIVOS = {
  S01: { nome: 'BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_22.09.xlsx', sha1: 'ebdb972082bb85f3eb9cca2f2b62c5a69acb77bf' },
  S02: { nome: 'BR_SMTC_S02_SOFTPRE_PROVISÓRIO_22.09.xlsx', sha1: 'a3a659c5c2e958784b50acb12b48e551bfed1a9f' },
};
const CFG = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'cost_reports.json'), 'utf8'));
const CFG_HML = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'cost_reports_hml.json'), 'utf8'));
const ABA = CFG.aba;

function gravarSaida(nome, conteudo) {
  const destino = path.resolve(SAIDA, nome);
  if (!destino.startsWith(SAIDA + path.sep) || destino.startsWith(PASTA_COST)) throw new Error('saída fora de _lixo/: ' + destino);
  fs.writeFileSync(destino, conteudo);
  return destino;
}

// ---------------------------------------------------------------------------------------
const casos = [];
function caso(grupo, nome, esperado, obtido, detalhe) {
  const ok = JSON.stringify(esperado) === JSON.stringify(obtido);
  casos.push({ grupo, nome, esperado, obtido, ok, detalhe: detalhe || null });
  console.log((ok ? '  ok   ' : '  FALHA') + ' [' + grupo + '] ' + nome + (ok ? '' : ' — esperado ' + JSON.stringify(esperado) + ', obtido ' + JSON.stringify(obtido)) + (detalhe && !ok ? ' — ' + JSON.stringify(detalhe).slice(0, 400) : ''));
}
function lanca(fn) { try { fn(); return null; } catch (e) { return e.message; } }
async function lancaAsync(fn) { try { await fn(); return null; } catch (e) { return e.message; } }

// ---------------------------------------------------------------------------------------
// Helpers de teste (mexem SÓ em cópias em memória)
// ---------------------------------------------------------------------------------------
async function zipDe(buf) { return JSZip.loadAsync(buf); }
async function gerar(zip) { return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }); }
async function editarParte(buf, parte, fn) { const z = await zipDe(buf); z.file(parte, fn(await z.file(parte).async('string'))); return gerar(z); }

/** Desloca 1 linha para baixo a partir da linha k, como o Excel faz ao inserir uma linha. */
function deslocarFaixa(token, k) {
  return token.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (m, d1, col, d2, n) => d1 + col + d2 + (+n >= k ? +n + 1 : +n));
}
function inserirLinhaXml(xml, k) {
  let x = xml.replace(/<row\b[^>]*>|<row\b[^>]*\/>/g, (tag) => tag.replace(/\br="(\d+)"/, (m, n) => 'r="' + (+n >= k ? +n + 1 : +n) + '"'));
  x = x.replace(/(<c\b[^>]*?\br=")([A-Z]+)(\d+)"/g, (m, a, col, n) => a + col + (+n >= k ? +n + 1 : +n) + '"');
  x = x.replace(/\bsqref="([^"]*)"/g, (m, s) => 'sqref="' + deslocarFaixa(s, k) + '"');
  x = x.replace(/<xm:sqref>([^<]*)<\/xm:sqref>/g, (m, s) => '<xm:sqref>' + deslocarFaixa(s, k) + '</xm:sqref>');
  x = x.replace(/(<(?:mergeCell|autoFilter|dimension)\b[^>]*?\bref=")([^"]*)"/g, (m, a, s) => a + deslocarFaixa(s, k) + '"');
  return x.replace(new RegExp('(<row\\b[^>]*\\br="' + (k + 1) + '")'), '<row r="' + k + '"/>$1');
}
/**
 * nomes: 'nenhum' (só a aba), 'aba' (também o _FilterDatabase oculto DA ABA NOTAS) ou
 * 'todos' (todos os nomes definidos que apontam para a NOTAS, como o Excel faz de verdade).
 */
async function inserirLinha(buf, k, nomes) {
  const z = await zipDe(buf);
  const parte = await C.parteDaAba(z, ABA);
  z.file(parte, inserirLinhaXml(await z.file(parte).async('string'), k));
  if (nomes && nomes !== 'nenhum') {
    const idx = (await C.abasDoPacote(z)).findIndex((a) => a.nome === ABA);
    const wb = await z.file('xl/workbook.xml').async('string');
    z.file('xl/workbook.xml', wb.replace(/(<definedName\b([^>]*)>)(NOTAS![^<]*)(<\/definedName>)/g, (m, a, attrs, s, b) => {
      const daAba = /\bname="_xlnm\._FilterDatabase"/.test(attrs) && (attrs.match(/\blocalSheetId="(\d+)"/) || [])[1] === String(idx);
      return nomes === 'todos' || daAba ? a + deslocarFaixa(s, k) + b : m;
    }));
  }
  return gerar(z);
}
/** Reordena a sharedStrings (inverte a ordem) e remapeia TODOS os índices t="s" das abas. */
async function reordenarSharedStrings(buf) {
  const z = await zipDe(buf);
  const sst = await z.file('xl/sharedStrings.xml').async('string');
  const itens = sst.match(/<si>[\s\S]*?<\/si>/g);
  const n = itens.length;
  const ini = sst.indexOf(itens[0]), fim = sst.lastIndexOf(itens[n - 1]) + itens[n - 1].length;
  z.file('xl/sharedStrings.xml', sst.slice(0, ini) + itens.slice().reverse().join('') + sst.slice(fim));
  for (const a of await C.abasDoPacote(z)) {
    const x = await z.file(a.parte).async('string');
    z.file(a.parte, x.replace(/(<c\b[^>]*\bt="s"[^>]*>)([\s\S]*?)(<\/c>)/g, (m, ab, dentro, fe) => ab + dentro.replace(/<v>(\d+)<\/v>/, (mm, v) => '<v>' + (n - 1 - +v) + '</v>') + fe));
  }
  return gerar(z);
}

/** Linhas de dados (abaixo do cabeçalho) agrupadas por valor de uma coluna, só com célula existente e estilizada. */
function linhasPorValor(xml, ss, col, linhaCab) {
  const por = {};
  for (const l of C.linhasDaAba(xml)) {
    if (l.numero <= linhaCab) continue;
    const c = C.lerCelulaBruta(l.celulas[col], ss);
    if (!c.existe || !c.estilo || c.formula) continue;
    const temH = C.lerCelulaBruta(l.celulas.H, ss).valor.trim() !== '';
    if (!temH) continue;
    (por[c.valor.trim()] = por[c.valor.trim()] || []).push(l.numero);
  }
  return por;
}

/** Estilo mais usado entre as células Q com valor OK (para conferir estilo_ok_coluna_q). */
function estiloOkMaisUsado(xml, ss) {
  const cont = {};
  for (const l of C.linhasDaAba(xml)) { const c = C.lerCelulaBruta(l.celulas.Q, ss); if (c.valor.trim() === 'OK' && c.estilo) cont[c.estilo] = (cont[c.estilo] || 0) + 1; }
  return Object.entries(cont).sort((a, b) => b[1] - a[1])[0] || [null, 0];
}

/** Escreve, confere e devolve a tabela da comparação. */
async function escreverEConferir(bufAntes, colunas, alvos, fonte, extra) {
  const zA = await zipDe(bufAntes);
  const parte = await C.parteDaAba(zA, ABA);
  const xml = await zA.file(parte).async('string');
  const ss = await C.sharedStrings(zA);
  const imp = await C.impressao(zA, ABA, []);
  const prep = C.prepararAlvos({ xml, ss, alvos, colunas, cabecalho: CFG.cabecalho_notas, regraQ: CFG.coluna_q, estiloOkQ: CFG[fonte].estilo_ok_coluna_q, totalEstilos: imp.styles.cellXfs, ...(extra || {}) });
  const { buffer } = await W.gravarPreservando(bufAntes, ABA, prep.gravar.map((g) => ({ ref: g.ref, valor: g.valor, estiloIndice: g.estiloIndice })), JSZip);
  const conf = await C.conferirEscrita(zA, await zipDe(buffer), ABA, prep.gravar);
  return { prep, buffer, conf };
}

function tabelaResumo(itens) {
  const pega = (re) => itens.filter((i) => re.test(i.item)).map((i) => ({ item: i.item, antes: i.antes, depois: i.depois, igual: i.igual }));
  return pega(/.*/);
}

// ---------------------------------------------------------------------------------------
(async () => {
  const relatorio = { gerado_em: new Date().toISOString(), arquivos: {}, escritas: {}, casos };
  const buf = {};

  console.log('\n== A. Arquivos de entrada (só leitura) ==');
  for (const f of ['S01', 'S02']) {
    const caminho = path.join(PASTA_COST, ARQUIVOS[f].nome);
    const b = fs.readFileSync(caminho);
    const shaNode = crypto.createHash('sha1').update(b).digest('hex');
    caso('A arquivos', f + ': sha1 do arquivo = esperado', ARQUIVOS[f].sha1, shaNode);
    if (shaNode !== ARQUIVOS[f].sha1) throw new Error('PAROU: o arquivo ' + f + ' local não é o esperado');
    caso('A arquivos', f + ': sha1 em JS puro = sha1 do Node', shaNode, C.sha1(b));
    buf[f] = b;
    relatorio.arquivos[f] = { caminho, tamanho: b.length, sha1: shaNode };
  }

  console.log('\n== B. Config ==');
  caso('B config', 'cost_reports.json sem problemas', [], C.validarConfig(CFG));
  caso('B config', 'cost_reports_hml.json sem problemas (aceitando pendências do passo 7)', [], C.validarConfig(CFG_HML, { aceitarPendente: true }));
  caso('B config', 'cost_reports_hml.json: pendências listadas sem aceitar', true, C.validarConfig(CFG_HML).length > 0, C.validarConfig(CFG_HML));
  caso('B config', 'hml: Cost reais estão nos proibidos', true, ['2482160269668', '2482145718537'].every((id) => C.idsProibidos(CFG_HML).includes(id)));
  const ctx = {};
  for (const f of ['S01', 'S02']) {
    const z = await zipDe(buf[f]);
    const parte = await C.parteDaAba(z, ABA);
    const xml = await z.file(parte).async('string');
    const ss = await C.sharedStrings(z);
    const imp = await C.impressao(z, ABA, []);
    const linhaCab = C.linhaDoCabecalho(xml, ss, CFG.cabecalho_notas);
    ctx[f] = { parte, xml, ss, imp, linhaCab };
    caso('B config', f + ': cabeçalho achado na linha', f === 'S01' ? 4 : 2, linhaCab);
    const [est, n] = estiloOkMaisUsado(xml, ss);
    caso('B config', f + ': estilo_ok_coluna_q = estilo mais usado no OK da Q (' + n + ' células)', CFG[f].estilo_ok_coluna_q, est);
    caso('B config', f + ': estilo do OK existe no styles.xml', true, +CFG[f].estilo_ok_coluna_q < imp.styles.cellXfs);
    relatorio.arquivos[f].parte_notas = parte;
    relatorio.arquivos[f].impressao_notas = imp.porAba[ABA];
    relatorio.arquivos[f].styles = imp.styles;
  }

  // ------------------------------------------------------------------------------------
  console.log('\n== C. Escritas felizes (cada cadeia: N, L e Q), antes x depois ==');
  for (const f of ['S01', 'S02']) {
    const { xml, ss, linhaCab } = ctx[f];
    const porN = linhasPorValor(xml, ss, 'N', linhaCab);
    const porL = linhasPorValor(xml, ss, 'L', linhaCab);
    const porQ = linhasPorValor(xml, ss, 'Q', linhaCab);
    const nVazias = (porN[''] || []).slice(0, 3);
    // não há linha de nota com L vazia nos Cost atuais: usa as L "PENDENTE" (só em memória)
    const lVazias = ((porL[''] || []).concat(porL['PENDENTE'] || [])).slice(0, 2);
    const qVazias = (porQ[''] || []).slice(0, 2);
    relatorio.escritas[f] = {};
    for (const [cadeia, colunas, alvos] of [
      ['N', ['N'], nVazias.map((n, i) => ({ ref: 'N' + n, valor: i === 0 ? 'OK - ASSINADO' : 'PENDENTE' }))],
      ['L', ['L'], lVazias.map((n) => ({ ref: 'L' + n, valor: 'SOLICITADA MI' }))],
      ['Q', ['Q'], qVazias.map((n) => ({ ref: 'Q' + n, valor: 'OK', arquivamentoConferido: true }))],
    ]) {
      if (!alvos.length) { caso('C escrita', f + ' ' + cadeia + ': havia linhas-alvo vazias para o teste', true, false); continue; }
      const r = await escreverEConferir(buf[f], colunas, alvos, f);
      caso('C escrita', f + ' cadeia ' + cadeia + ' (' + alvos.map((a) => a.ref).join(', ') + '): conferência completa ok', true, r.conf.ok, r.conf.divergencias);
      caso('C escrita', f + ' cadeia ' + cadeia + ': células que mudaram = só os alvos', alvos.map((a) => a.ref).sort(), r.conf.celulasQueMudaram);
      caso('C escrita', f + ' cadeia ' + cadeia + ': estilo mantido (N/L: o da própria célula; Q: estilo_ok)', true,
        r.prep.gravar.every((g) => g.estiloIndice === (cadeia === 'Q' ? CFG[f].estilo_ok_coluna_q : g.estiloAnterior)));
      const zB = await zipDe(r.buffer);
      const pB = await C.compararPasso0(ctx[f].imp, await C.impressao(zB, ABA, []));
      caso('C escrita', f + ' cadeia ' + cadeia + ': Passo 0 contra o arquivo escrito = sem divergência', [], pB.divergencias);
      relatorio.escritas[f][cadeia] = { alvos: r.prep.gravar, comparacao: tabelaResumo(r.conf.itens), divergencias: r.conf.divergencias, celulasQueMudaram: r.conf.celulasQueMudaram };
      gravarSaida('zz-temp-teste-escrita-' + f + '-' + cadeia + '.xlsx', r.buffer);
    }
  }

  // ------------------------------------------------------------------------------------
  console.log('\n== D. Matriz da coluna Q (S01, com variantes preparadas em memória) ==');
  {
    const f = 'S01';
    const { xml, ss, linhaCab } = ctx[f];
    const porQ = linhasPorValor(xml, ss, 'Q', linhaCab);
    const livres = (porQ[''] || []).slice(10);
    const pega = (v) => (porQ[v] || [])[0];
    // variantes que não existem no arquivo: grava-as numa CÓPIA em memória (estilo da própria célula)
    const variantes = { ' pendente ': livres[0], 'n/a': livres[1], ' previsão ': livres[2], 'XYZ': livres[3], 'PENDENTE': pega('PENDENTE') || livres[4], 'N/A': pega('N/A') || livres[5] };
    const prepara = Object.entries(variantes).filter(([v, n]) => n && !(porQ[v] || []).includes(n)).map(([v, n]) => ({ ref: 'Q' + n, valor: v, estiloDe: 'Q' + n }));
    const { buffer: bufQ } = await W.gravarPreservando(buf[f], ABA, prepara, JSZip);
    const zQ = await zipDe(bufQ);
    const xQ = await zQ.file(ctx[f].parte).async('string');
    const ssQ = await C.sharedStrings(zQ);
    const impQ = await C.impressao(zQ, ABA, []);
    const matriz = [
      ['vazio', livres[6], true, 'gravar'],
      ['PENDENTE', variantes.PENDENTE, true, 'gravar'],
      [' pendente ', variantes[' pendente '], true, 'gravar'],
      ['N/A', variantes['N/A'], true, 'gravar'],
      ['n/a', variantes['n/a'], true, 'gravar'],
      ['ARQUIVO INTERNO', pega('ARQUIVO INTERNO'), true, 'intocavel'],
      ['ARQUIVO DIRETORIA', pega('ARQUIVO DIRETORIA'), true, 'intocavel'],
      ['PREVISÃO', pega('PREVISÃO'), true, 'intocavel'],
      [' previsão ', variantes[' previsão '], true, 'intocavel'],
      ['ARQUIVO INERNO', pega('ARQUIVO INERNO'), true, 'intocavel'],
      ['OK já existente', pega('OK'), true, 'ja_ok'],
      ['valor desconhecido (XYZ)', variantes.XYZ, true, 'desconhecido'],
      ['vazio, mas arquivamento NÃO conferido', livres[7], false, 'nao_conferido'],
    ];
    const alvos = matriz.filter((m) => m[1]).map(([, n, arq]) => ({ ref: 'Q' + n, valor: 'OK', arquivamentoConferido: arq }));
    for (const m of matriz) if (!m[1]) caso('D coluna Q', m[0] + ': havia linha para o teste', true, false);
    const prep = C.prepararAlvos({ xml: xQ, ss: ssQ, alvos, colunas: ['Q'], cabecalho: CFG.cabecalho_notas, regraQ: CFG.coluna_q, estiloOkQ: CFG[f].estilo_ok_coluna_q, totalEstilos: impQ.styles.cellXfs });
    const { buffer } = await W.gravarPreservando(bufQ, ABA, prep.gravar.map((g) => ({ ref: g.ref, valor: g.valor, estiloIndice: g.estiloIndice })), JSZip);
    const conf = await C.conferirEscrita(zQ, await zipDe(buffer), ABA, prep.gravar);
    const xDepois = await (await zipDe(buffer)).file(ctx[f].parte).async('string');
    const ssDepois = await C.sharedStrings(await zipDe(buffer));
    relatorio.matriz_q = [];
    for (const [rotulo, n, , esperado] of matriz.filter((m) => m[1])) {
      const ref = 'Q' + n;
      const g = prep.gravar.find((x) => x.ref === ref);
      const rec = prep.recusados.find((x) => x.ref === ref);
      const obtido = g ? 'gravar' : rec ? (rec.acao || 'nao_conferido') : '?';
      const depois = C.celulaXml(xDepois, ref, ssDepois);
      const antes = C.celulaXml(xQ, ref, ssQ);
      caso('D coluna Q', rotulo + ' (' + ref + ', antes "' + antes.valor + '") → ' + esperado, esperado, obtido);
      caso('D coluna Q', rotulo + ': valor depois', esperado === 'gravar' ? 'OK' : antes.valor, depois.valor);
      relatorio.matriz_q.push({ caso: rotulo, ref, antes: antes.valor, estilo_antes: antes.estilo, decisao: obtido, motivo: rec ? rec.motivo : null, depois: depois.valor, estilo_depois: depois.estilo });
    }
    caso('D coluna Q', 'matriz: conferência completa ok (só as 5 células graváveis mudaram)', true, conf.ok, conf.divergencias);
    caso('D coluna Q', 'matriz: nº de células que mudaram', 5, conf.celulasQueMudaram.length);
  }

  // ------------------------------------------------------------------------------------
  console.log('\n== E. Travas que abortam a fonte ==');
  {
    const f = 'S01';
    const { xml, ss, linhaCab, imp } = ctx[f];
    const porN = linhasPorValor(xml, ss, 'N', linhaCab);
    const n0 = porN[''][0];
    const base = { xml, ss, cabecalho: CFG.cabecalho_notas, regraQ: CFG.coluna_q, estiloOkQ: CFG[f].estilo_ok_coluna_q, totalEstilos: imp.styles.cellXfs };
    const t = (nome, p, trecho) => { const m = lanca(() => C.prepararAlvos({ ...base, ...p })); caso('E travas', nome, true, !!m && m.includes(trecho), m); };
    t('coluna M na cadeia N', { colunas: ['N'], alvos: [{ ref: 'M' + n0, valor: 'X' }] }, 'trava de colunas');
    t('coluna Q na cadeia N', { colunas: ['N'], alvos: [{ ref: 'Q' + n0, valor: 'OK' }] }, 'trava de colunas');
    t('ref malformada (N0A)', { colunas: ['N'], alvos: [{ ref: 'N0A', valor: 'X' }] }, 'trava de colunas');
    t('S01: Q4 = cabeçalho', { colunas: ['Q'], alvos: [{ ref: 'Q4', valor: 'OK', arquivamentoConferido: true }] }, 'cabeçalho');
    t('S01: N3 acima do cabeçalho', { colunas: ['N'], alvos: [{ ref: 'N3', valor: 'X' }] }, 'cabeçalho');
    t('alvo repetido', { colunas: ['N'], alvos: [{ ref: 'N' + n0, valor: 'X' }, { ref: 'N' + n0, valor: 'Y' }] }, 'repetido');
    t('valor vazio', { colunas: ['N'], alvos: [{ ref: 'N' + n0, valor: '  ' }] }, 'valor vazio');
    t('coluna Q com valor ≠ OK', { colunas: ['Q'], alvos: [{ ref: 'Q' + n0, valor: 'PENDENTE', arquivamentoConferido: true }] }, 'só recebe');
    t('estilo do OK inexistente', { colunas: ['Q'], estiloOkQ: String(imp.styles.cellXfs + 5), alvos: [{ ref: 'Q' + n0, valor: 'OK', arquivamentoConferido: true }] }, 'estilo do OK');
    t('cabeçalho não encontrado (título diferente)', { colunas: ['N'], cabecalho: { ...CFG.cabecalho_notas, Q: 'OUTRO TITULO' }, alvos: [{ ref: 'N' + n0, valor: 'X' }] }, 'cabeçalho da aba');
    // célula inexistente, sem estilo e com fórmula: só em cópia do XML, em memória
    const reCel = new RegExp('<c\\b[^>]*?\\br="N' + n0 + '"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)');
    t('célula inexistente no XML (D7)', { xml: xml.replace(reCel, ''), colunas: ['N'], alvos: [{ ref: 'N' + n0, valor: 'X' }] }, 'não existe');
    t('célula sem estilo', { xml: xml.replace(reCel, '<c r="N' + n0 + '"/>'), colunas: ['N'], alvos: [{ ref: 'N' + n0, valor: 'X' }] }, 'não tem estilo');
    t('célula com fórmula', { xml: xml.replace(reCel, '<c r="N' + n0 + '" s="1"><f>1+1</f><v>2</v></c>'), colunas: ['N'], alvos: [{ ref: 'N' + n0, valor: 'X' }] }, 'fórmula');
    const s2 = ctx.S02;
    for (const ref of ['Q1', 'Q2', 'N2']) {
      const m = lanca(() => C.prepararAlvos({ xml: s2.xml, ss: s2.ss, cabecalho: CFG.cabecalho_notas, regraQ: CFG.coluna_q, estiloOkQ: CFG.S02.estilo_ok_coluna_q, totalEstilos: s2.imp.styles.cellXfs, colunas: [ref[0]], alvos: [{ ref, valor: ref[0] === 'Q' ? 'OK' : 'X', arquivamentoConferido: true }] }));
      caso('E travas', 'S02: ' + ref + (ref === 'Q1' ? ' (título mesclado B1:R1)' : ' (cabeçalho)'), true, !!m && m.includes('cabeçalho'), m);
    }
    caso('E travas', 'S02: "CHECK ARQUIVO DRIVE" é o título da coluna Q (linha 2), não valor de nota', 'CHECK ARQUIVO DRIVE', C.celulaXml(s2.xml, 'Q' + s2.linhaCab, s2.ss).valor);
    caso('E travas', 'S01: "CHECK ARQUIVO DRIVE" só aparece no cabeçalho', [ctx.S01.linhaCab], C.linhasDaAba(ctx.S01.xml).filter((l) => C.lerCelulaBruta(l.celulas.Q, ctx.S01.ss).valor.trim() === 'CHECK ARQUIVO DRIVE').map((l) => l.numero));
    caso('E travas', 'S02: "CHECK ARQUIVO DRIVE" só aparece no cabeçalho', [s2.linhaCab], C.linhasDaAba(s2.xml).filter((l) => C.lerCelulaBruta(l.celulas.Q, s2.ss).valor.trim() === 'CHECK ARQUIVO DRIVE').map((l) => l.numero));
    // gravarPreservando com ref fora das linhas existentes: a trava do próprio módulo
    const msg = await lancaAsync(async () => { const r = await W.gravarPreservando(buf[f], ABA, [{ ref: 'N999999', valor: 'X', estiloIndice: '1' }], JSZip); if (r.relatorio.some((x) => /ERRO/.test(x.acao))) throw new Error('linha inexistente'); });
    caso('E travas', 'gravarPreservando: linha inexistente é relatada como erro', true, !!msg);
  }

  // ------------------------------------------------------------------------------------
  console.log('\n== F. Identidade da linha (D9) e linha inserida ==');
  const KINS = { S01: 100, S02: 50 };
  const insercao = {};
  for (const f of ['S01', 'S02']) {
    const { xml, ss, linhaCab } = ctx[f];
    const alvoLinha = linhasPorValor(xml, ss, 'N', linhaCab)[''].find((n) => n > KINS[f] + 5);
    const idAntes = C.identidadeLinha(xml, ss, alvoLinha, ['H', 'G', 'J', 'K']);
    caso('F identidade', f + ': mesma linha no mesmo arquivo → sem diferença', [], C.compararIdentidade(idAntes, C.identidadeLinha(xml, ss, alvoLinha, ['H', 'G', 'J', 'K'])));
    const bufIns = await inserirLinha(buf[f], KINS[f], 'nenhum');
    const zI = await zipDe(bufIns);
    const xI = await zI.file(ctx[f].parte).async('string');
    const ssI = await C.sharedStrings(zI);
    const difs = C.compararIdentidade(idAntes, C.identidadeLinha(xI, ssI, alvoLinha, ['H', 'G', 'J', 'K']));
    caso('F identidade', f + ': linha inserida acima (linha ' + KINS[f] + ') → a linha ' + alvoLinha + ' não é mais a mesma (aborta a fonte)', true, difs.length > 0, difs);
    caso('F identidade', f + ': a nota foi para a linha ' + (alvoLinha + 1), [], C.compararIdentidade(idAntes, C.identidadeLinha(xI, ssI, alvoLinha + 1, ['H', 'G', 'J', 'K'])));
    insercao[f] = { semWorkbook: bufIns, soAba: await inserirLinha(buf[f], KINS[f], 'aba'), todos: await inserirLinha(buf[f], KINS[f], 'todos') };
    // D9 com a sharedStrings reordenada (o Excel Online reescreve a sharedStrings): mesmos textos, índices diferentes
    const bufSS = await reordenarSharedStrings(buf[f]);
    const zS = await zipDe(bufSS);
    const xS = await zS.file(ctx[f].parte).async('string');
    const ssS = await C.sharedStrings(zS);
    const vBruto = (x, ref) => ((x.match(new RegExp('<c\\b[^>]*\\br="' + ref + '"[^>]*>[\\s\\S]*?<v>(\\d+)<\\/v>')) || [])[1]);
    caso('F identidade', f + ': sharedStrings reordenada → o índice bruto da H' + alvoLinha + ' mudou', true, vBruto(xml, 'H' + alvoLinha) !== vBruto(xS, 'H' + alvoLinha), [vBruto(xml, 'H' + alvoLinha), vBruto(xS, 'H' + alvoLinha)]);
    caso('F identidade', f + ': sharedStrings reordenada → MESMA linha (compara o texto resolvido)', [], C.compararIdentidade(idAntes, C.identidadeLinha(xS, ssS, alvoLinha, ['H', 'G', 'J', 'K'])));
    const xTroca = xS.replace(new RegExp('(<c\\b[^>]*\\br="H' + alvoLinha + '"[^>]*?)\\bt="s"([^>]*>)[\\s\\S]*?(<\\/c>)'), '$1t="inlineStr"$2<is><t>OUTRO FORNECEDOR</t></is>$3');
    const difT = C.compararIdentidade(idAntes, C.identidadeLinha(xTroca, ssS, alvoLinha, ['H', 'G', 'J', 'K']));
    caso('F identidade', f + ': sharedStrings reordenada + texto da H diferente → ABORTA', true, difT.length === 1 && difT[0].startsWith('H:'), difT);
    caso('F identidade', f + ': G (data) comparada pelo número serial', true, /^\d+(\.\d+)?$/.test(idAntes.G), idAntes.G);
  }

  // ------------------------------------------------------------------------------------
  console.log('\n== G. Passo 0 (D1(b) + D15(b)) ==');
  relatorio.passo0 = {};
  for (const f of ['S01', 'S02']) {
    const ref = ctx[f].imp;
    const p0 = async (b) => C.compararPasso0(ref, await C.impressao(await zipDe(b), ABA, []));
    const muda0 = async (nome, parteAlvo, fn, esperaParar, trecho) => {
      const b = await editarParte(buf[f], parteAlvo, fn);
      const r = await p0(b);
      const parou = r.divergencias.length > 0 && (!trecho || r.divergencias.some((d) => d.includes(trecho)));
      caso('G Passo 0', f + ': ' + nome + (esperaParar ? ' → PARA' : ' → passa (só relata)'), esperaParar, esperaParar ? parou : r.divergencias.length > 0, r.divergencias.length ? r.divergencias : r.relatados);
    };
    const parte = ctx[f].parte;
    const r1 = await p0(buf[f]);
    caso('G Passo 0', f + ': mesmo arquivo → passa', [], r1.divergencias);
    const rIns = await p0(insercao[f].semWorkbook);
    // ajustado pela D20: se o autoFilter andou e o _FilterDatabase da aba não, a trava para
    caso('G Passo 0', f + ': linha inserida com o workbook.xml SEM atualizar (_FilterDatabase ≠ autoFilter) → PARA pela trava da D20', true,
      rIns.divergencias.length === 1 && rIns.divergencias[0].includes('_FilterDatabase'), rIns.divergencias);
    caso('G Passo 0', f + ': … e as faixas da aba (sqref, ref do autoFilter) só foram relatadas', true, rIns.relatados.some((x) => x.includes('cf_legado (faixas)')) && rIns.relatados.some((x) => x.includes('autoFilter (ref)')), rIns.relatados);
    relatorio.passo0[f] = { linha_inserida_relatado: rIns.relatados };
    const rAba = await p0(insercao[f].soAba);
    caso('G Passo 0', f + ': linha inserida + _FilterDatabase DA ABA atualizado (D20 b) → passa, relata a faixa', [], rAba.divergencias, rAba.relatados);
    caso('G Passo 0', f + ': … e a faixa relatada', true, rAba.relatados.some((x) => x.includes('_FilterDatabase')), rAba.relatados);
    relatorio.passo0[f].linha_inserida_filterdatabase_da_aba = { divergencias: rAba.divergencias, relatados: rAba.relatados };
    const rTodos = await p0(insercao[f].todos);
    caso('G Passo 0', f + ': linha inserida + o Excel atualizando TODOS os nomes da NOTAS (inclusive o _FilterDatabase GLOBAL) → PARA (D24)', true, rTodos.divergencias.some((d) => d.includes('workbook.xml')), rTodos.divergencias);
    relatorio.passo0[f].linha_inserida_todos_os_nomes = rTodos.divergencias;
    const wbParte = 'xl/workbook.xml';
    const idxNotas = ctx[f].imp.abas.indexOf(ABA);
    const reDaAba = new RegExp('(<definedName\\b[^>]*name="_xlnm\\._FilterDatabase"[^>]*localSheetId="' + idxNotas + '"[^>]*>)([^<]*)(<\\/definedName>)');
    await muda0('_FilterDatabase da aba divergente do autoFilter', wbParte, (x) => x.replace(reDaAba, (m, a, t, b) => a + t.replace(/\$R\$(\d+)/, (mm, n) => '$R$' + (+n + 7)) + b), true, '_FilterDatabase');
    await muda0('_FilterDatabase da aba removido', wbParte, (x) => x.replace(reDaAba, ''), true, '_FilterDatabase');
    await muda0('outro nome definido alterado (o _FilterDatabase GLOBAL)', wbParte, (x) => x.replace(/(<definedName name="_xlnm\._FilterDatabase">NOTAS!\$B\$\d+:\$R\$)(\d+)/, (m, a, n) => a + (+n + 1)), true, 'workbook.xml');
    await muda0('calcPr do workbook.xml alterado', wbParte, (x) => /<calcPr\b/.test(x) ? x.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"') : x.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>'), true, 'workbook.xml');
    const muda = async (nome, parteAlvo, fn, esperaParar, trecho) => {
      const b = await editarParte(buf[f], parteAlvo, fn);
      const r = await p0(b);
      const parou = r.divergencias.length > 0 && (!trecho || r.divergencias.some((d) => d.includes(trecho)));
      caso('G Passo 0', f + ': ' + nome + (esperaParar ? ' → PARA' : ' → passa (só relata)'), esperaParar, esperaParar ? parou : r.divergencias.length > 0, r.divergencias.length ? r.divergencias : r.relatados);
    };
    await muda('uma regra legada <cfRule> alterada', parte, (x) => x.replace(/(<cfRule\b[^>]*\bpriority=")(\d+)"/, (m, a, n) => a + (+n + 1000) + '"'), true, 'cf_legado');
    await muda('um bloco de formatação condicional a menos', parte, (x) => x.replace(/<conditionalFormatting\b[\s\S]*?<\/conditionalFormatting>/, ''), true, 'cf_legado');
    await muda('um dxf alterado', 'xl/styles.xml', (x) => x.replace(/(<dxfs\b[^>]*>[\s\S]*?<dxf>)/, '$1<font><b/></font>'), true, 'dxfs');
    await muda('largura de coluna mudada', parte, (x) => x.replace(/(<col\b[^>]*\bwidth=")([\d.]+)"/, (m, a, w) => a + (+w + 3) + '"'), true, 'cols');
    await muda('mesclagem nova', parte, (x) => /<mergeCells\b/.test(x) ? x.replace(/<mergeCells count="(\d+)">/, (m, n) => '<mergeCells count="' + (+n + 1) + '"><mergeCell ref="S5:T5"/>') : x.replace(/(<\/sheetData>)/, '$1<mergeCells count="1"><mergeCell ref="S5:T5"/></mergeCells>'), true, 'mesclagens');
    await muda('critério do autoFilter mudado', parte, (x) => x.replace(/<autoFilter\b([^>]*?)\/>/, '<autoFilter$1><filterColumn colId="0"><filters><filter val="X"/></filters></filterColumn></autoFilter>'), true, 'autoFilter');
    await muda('tema (theme1.xml) alterado', 'xl/theme/theme1.xml', (x) => x.replace('</a:theme>', '<!-- x --></a:theme>'), true, 'theme');
    await muda('ordem das abas trocada', 'xl/workbook.xml', (x) => { const s = x.match(/<sheet\b[^>]*?\/>/g); return x.replace(s[0], '\u0000').replace(s[1], s[0]).replace('\u0000', s[1]); }, true, 'abas');
    await muda('styles.xml com um cellXf a mais (Excel Online renumera)', 'xl/styles.xml', (x) => x.replace(/<cellXfs count="(\d+)">/, (m, n) => '<cellXfs count="' + (+n + 1) + '"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'), false);
    await muda('valor de uma célula da NOTAS mudado (edição da Michelle)', parte, (x) => x.replace(/(<c\b[^>]*\br="J\d+"[^>]*t="s"[^>]*><v>)(\d+)(<\/v>)/, (m, a, v, b) => a + (+v === 0 ? 1 : 0) + b), false);
    // x14: o Cost atual não tem regras x14 na NOTAS; teste com um bloco sintético
    const x14 = (sq, nRegras) => '<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:conditionalFormattings><x14:conditionalFormatting xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">' +
      Array.from({ length: nRegras }, (v, i) => '<x14:cfRule type="expression" priority="' + (900 + i) + '" id="{0000000' + i + '-0000-0000-0000-000000000000}"><xm:f>$B5="X' + i + '"</xm:f></x14:cfRule>').join('') +
      '<xm:sqref>' + sq + '</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst>';
    const comX14 = (sq, n) => (x) => x.replace(/<\/worksheet>\s*$/, x14(sq, n) + '</worksheet>');
    const bRef = await editarParte(buf[f], parte, comX14('B5:R3000', 2));
    const impRefX = await C.impressao(await zipDe(bRef), ABA, []);
    const p0x = async (fn) => C.compararPasso0(impRefX, await C.impressao(await zipDe(await editarParte(buf[f], parte, fn)), ABA, []));
    caso('G Passo 0', f + ': x14 sintético, só a faixa <xm:sqref> mudou → passa', [], (await p0x(comX14('B5:R3001', 2))).divergencias);
    const rx = await p0x(comX14('B5:R3000', 1));
    caso('G Passo 0', f + ': x14 sintético, uma x14:cfRule a menos → PARA', true, rx.divergencias.some((d) => d.includes('cf_x14')), rx.divergencias);
    caso('G Passo 0', f + ': contagens legado e x14 separadas na impressão', true, impRefX.porAba[ABA].cf_x14.regras === 2 && impRefX.porAba[ABA].cf_legado.regras === ctx[f].imp.porAba[ABA].cf_legado.regras);
  }

  // ------------------------------------------------------------------------------------
  console.log('\n== H. A comparação estrita pega adulteração depois da escrita ==');
  {
    const f = 'S01';
    const { xml, ss, linhaCab, parte } = ctx[f];
    const n0 = linhasPorValor(xml, ss, 'N', linhaCab)[''][0];
    const r = await escreverEConferir(buf[f], ['N'], [{ ref: 'N' + n0, valor: 'PENDENTE' }], f);
    const zA = await zipDe(buf[f]);
    const adultera = async (nome, parteAlvo, fn, trecho) => {
      const b = await editarParte(r.buffer, parteAlvo, fn);
      const c = await C.conferirEscrita(zA, await zipDe(b), ABA, r.prep.gravar);
      caso('H estrita', nome + ' → divergência', true, !c.ok && c.divergencias.some((d) => d.includes(trecho)), c.divergencias);
    };
    await adultera('outra célula da NOTAS mudou', parte, (x) => x.replace(/(<c\b[^>]*\br="J\d+"[^>]*t="s"[^>]*><v>)(\d+)(<\/v>)/, (m, a, v, b) => a + (+v === 0 ? 1 : 0) + b), 'células fora dos alvos');
    await adultera('styles.xml mudou', 'xl/styles.xml', (x) => x.replace('</styleSheet>', '<!-- x --></styleSheet>'), 'styles.xml');
    await adultera('sharedStrings.xml mudou', 'xl/sharedStrings.xml', (x) => x.replace('</sst>', '<!-- x --></sst>'), 'sharedStrings');
    await adultera('outra aba mudou', 'xl/worksheets/sheet1.xml', (x) => x.replace('</worksheet>', '<!-- x --></worksheet>'), 'sheet1.xml');
    await adultera('estilo do alvo errado', parte, (x) => x.replace(new RegExp('(<c\\b[^>]*\\br="N' + n0 + '"[^>]*\\bs=")(\\d+)"'), (m, a, s) => a + (+s + 1) + '"'), 'alvo N' + n0);
    await adultera('valor do alvo errado', parte, (x) => x.replace(new RegExp('(<c\\b[^>]*\\br="N' + n0 + '"[^>]*>)[\\s\\S]*?(<\\/c>)'), '$1<is><t>OUTRO</t></is>$2').replace(new RegExp('(<c\\b[^>]*\\br="N' + n0 + '"[^>]*?)\\bt="s"'), '$1t="inlineStr"'), 'alvo N' + n0);
  }

  // ------------------------------------------------------------------------------------
  console.log('\n== I. Portão do Cost (D18), conta do Box e janela de silêncio ==');
  {
    const meta = (f, extra) => ({ type: 'file', id: CFG[f].box_id, name: CFG[f].nome_esperado + '.xlsx', item_status: 'active', trashed_at: null, parent: null, owned_by: { login: 'financeiro@novorealitybox.com' }, ...(extra || {}) });
    const p = (nome, m, fcfg, cfg, esperaOk, trecho) => { const r = C.conferirPortao(m, fcfg, cfg); caso('I portão', nome, esperaOk, r.ok && (!trecho || true), r.problemas); if (!esperaOk && trecho) caso('I portão', nome + ': motivo', true, r.problemas.some((x) => x.includes(trecho)), r.problemas); };
    p('S01 certo (pasta pai null, não conferida)', meta('S01'), CFG.S01, CFG, true);
    p('S02 certo', meta('S02'), CFG.S02, CFG, true);
    p('nome sem .xlsx também aceito', meta('S01', { name: CFG.S01.nome_esperado }), CFG.S01, CFG, true);
    p('ID ANTIGO do S01 na config → recusa', meta('S01', { id: '2028817453680', name: 'BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_1201.xlsx' }), { ...CFG.S01, box_id: '2028817453680' }, CFG, false, 'PROIBIDO');
    p('ID ANTIGO do S02 na config → recusa', meta('S02', { id: '2366859928452' }), { ...CFG.S02, box_id: '2366859928452' }, CFG, false, 'PROIBIDO');
    p('Box devolve outro id', meta('S01', { id: '2028817453680' }), CFG.S01, CFG, false, 'PROIBIDO');
    p('nome diferente (renomeado)', meta('S01', { name: 'BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_30.10.xlsx' }), CFG.S01, CFG, false, 'nome');
    p('na lixeira', meta('S01', { item_status: 'trashed', trashed_at: '2026-10-29T10:00:00-03:00' }), CFG.S01, CFG, false, 'situação');
    p('dono diferente', meta('S01', { owned_by: { login: 'outra@pessoa.com' } }), CFG.S01, CFG, false, 'dono');
    p('Box respondeu 404', { type: 'error', status: 404, code: 'not_found' }, CFG.S01, CFG, false, '404');
    p('homolog sem box_id (passo 7 pendente) → recusa', meta('S01'), CFG_HML.S01, CFG_HML, false, 'box_id');
    p('homolog apontando para o Cost REAL → recusa', meta('S01'), { ...CFG.S01 }, CFG_HML, false, 'PROIBIDO');
    caso('I conta', 'conta certa', true, C.conferirContaBox({ login: 'michelle.mimiaguia@gmail.com' }, CFG).ok);
    caso('I conta', 'outra conta → para', false, C.conferirContaBox({ login: 'x@y.com' }, CFG).ok);
    caso('I conta', 'erro no /users/me → para', false, C.conferirContaBox({ type: 'error', status: 401 }, CFG).ok);
    const agora = Date.parse('2026-10-29T15:00:00-03:00');
    const j = (min) => C.janelaDeSilencio(new Date(agora - min * 60000).toISOString(), agora, CFG.janela_silencio_minutos).ok;
    caso('I janela', 'modificado há 2 min → não escreve', false, j(2));
    caso('I janela', 'modificado há 9,9 min → não escreve', false, j(9.9));
    caso('I janela', 'modificado há 10 min → escreve', true, j(10));
    caso('I janela', 'modificado há 3 h → escreve', true, j(180));
    caso('I janela', 'modified_at no futuro (relógio) → não escreve', false, j(-3));
    caso('I janela', 'modified_at no formato do Box (-03:00) há 5 min → não escreve', false, C.janelaDeSilencio('2026-10-29T14:55:00-03:00', agora, 10).ok);
    caso('I janela', 'modified_at inválido → não escreve', false, C.janelaDeSilencio('ontem', agora, 10).ok);
  }

  // ------------------------------------------------------------------------------------
  console.log('\n== J. Nada foi gravado na pasta dos Cost ==');
  for (const f of ['S01', 'S02']) {
    const b = fs.readFileSync(path.join(PASTA_COST, ARQUIVOS[f].nome));
    caso('J pasta', f + ': sha1 do arquivo local continua o mesmo', ARQUIVOS[f].sha1, crypto.createHash('sha1').update(b).digest('hex'));
  }

  const falhas = casos.filter((c) => !c.ok);
  relatorio.totais = { casos: casos.length, ok: casos.length - falhas.length, falhas: falhas.length };
  const arq = gravarSaida('zz-temp-teste-conferencia-resultado.json', JSON.stringify(relatorio, null, 2));
  console.log('\nTOTAL: ' + casos.length + ' casos, ' + falhas.length + ' falha(s). Resultado em ' + path.relative(RAIZ, arq));
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('ERRO: ' + e.stack); process.exit(2); });
