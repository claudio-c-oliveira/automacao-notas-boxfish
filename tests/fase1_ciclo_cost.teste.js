'use strict';
/**
 * Cenários do C.7 (coluna "simulador") sobre os nodes GERADOS da Fase 1 (passo 6 do C.8):
 * workflows/fase1_solicitacao_nota.homolog.json, rodado pelo tests/simulador/motor_q.js contra o
 * Box falso (tests/simulador/box_falso.js). Sem rede, sem n8n, sem Box, sem VM.
 *
 * Os Cost reais são lidos SÓ PARA LEITURA (a mesma pasta e o mesmo sha1 do xlsx_conferencia.teste.js);
 * as cópias ficam em memória, no Box falso. As saídas vão para _lixo/.
 *
 * Em cada cenário prova: (1) o que foi escrito no Box; (2) que nada foi escrito no Cost quando devia
 * abortar; (3) que o lock nosso saiu (UNLOCK) ou que o lock de outro não foi tocado; (4) quando houve
 * escrita, que o resto do pacote ficou byte a byte idêntico (conferência INDEPENDENTE das bibliotecas:
 * parte a parte, e na aba NOTAS o XML sem as células-alvo).
 *
 * Isola o ciclo do resto do workflow pelo `parar` do motor: Gmail, IA, Drive dos Contratos e o Merge
 * depois da escrita só são registrados ("chegou"), nunca executados.
 *
 * Uso: node tests/fase1_ciclo_cost.teste.js [pasta dos Cost]
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const C = require('../scripts/lib/xlsx_conferencia.js');
const criarMotor = require('./simulador/motor_q.js');
const criarBox = require('./simulador/box_falso.js');

const RAIZ = path.join(__dirname, '..');
const PASTA_COST = path.resolve(process.argv[2] || '/home/claudio/Documentos/0.3 - MICHELLE_BOXFISH');
const SAIDA = path.join(RAIZ, '_lixo');
const ARQUIVOS = {
  S01: { nome: 'BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_22.09.xlsx', sha1: 'ebdb972082bb85f3eb9cca2f2b62c5a69acb77bf' },
  S02: { nome: 'BR_SMTC_S02_SOFTPRE_PROVISÓRIO_22.09.xlsx', sha1: 'a3a659c5c2e958784b50acb12b48e551bfed1a9f' },
};
const DIR_CFG = '/home/node/.n8n-files/box-fish-config/';
const ME = 'michelle.mimiaguia@gmail.com';

// ---------------------------------------------------------------------------------------
// Relógio falso: cada chamada ao Box anda 1 s (o carimbo do backup tem resolução de segundo, e no
// simulador o ciclo inteiro roda em milissegundos; no n8n, cada chamada ao Box leva bem mais que isso).
// ---------------------------------------------------------------------------------------
const DateReal = Date;
let deslocamento = 0;
class DateFalso extends DateReal {
  constructor(...a) { if (a.length) super(...a); else super(DateReal.now() + deslocamento); }
  static now() { return DateReal.now() + deslocamento; }
}
global.Date = DateFalso;

const casos = [];
function caso(cenario, nome, esperado, obtido, detalhe) {
  const ok = JSON.stringify(esperado) === JSON.stringify(obtido);
  casos.push({ cenario, nome, esperado, obtido, ok, detalhe: detalhe === undefined ? null : detalhe });
  console.log((ok ? '  ok   ' : '  FALHA') + ' [' + cenario + '] ' + nome + (ok ? '' : ' — esperado ' + JSON.stringify(esperado) + ', obtido ' + JSON.stringify(obtido) + (detalhe ? ' — ' + JSON.stringify(detalhe).slice(0, 500) : '')));
}
function gravarSaida(nome, conteudo) {
  const destino = path.resolve(SAIDA, nome);
  if (!destino.startsWith(SAIDA + path.sep) || destino.startsWith(PASTA_COST)) throw new Error('saída fora de _lixo/: ' + destino);
  fs.writeFileSync(destino, conteudo);
}

// ---------------------------------------------------------------------------------------
// Ambiente falso do homolog (o que o passo 7 do C.8 vai preencher de verdade)
// ---------------------------------------------------------------------------------------
const CFG_HML_REPO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'cost_reports_hml.json'), 'utf8'));
const CFG_PROD_REPO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'cost_reports.json'), 'utf8'));
const PASTA_RAIZ_BK = '9200000000000';
const FALSO = {
  S01: { box_id: '9100000000001', nome: 'ZZ-HML_BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_22.09', subpasta: '9200000000001' },
  S02: { box_id: '9100000000002', nome: 'ZZ-HML_BR_SMTC_S02_SOFTPRE_PROVISÓRIO_22.09', subpasta: '9200000000002' },
};
function cfgHomologPreenchida() {
  const c = JSON.parse(JSON.stringify(CFG_HML_REPO));
  delete c._pendente;
  c.login_box_esperado = ME;
  for (const f of ['S01', 'S02']) Object.assign(c[f], { box_id: FALSO[f].box_id, nome_esperado: FALSO[f].nome, dono_esperado: 'financeiro@novorealitybox.com', backup: { pasta_raiz_id: PASTA_RAIZ_BK, subpasta_id: FALSO[f].subpasta, subpasta_nome: f } });
  return c;
}
const lerCfgRepo = (n) => fs.readFileSync(path.join(RAIZ, 'config', n));

// ---------------------------------------------------------------------------------------
// Utilidades sobre .xlsx (só em memória)
// ---------------------------------------------------------------------------------------
async function alterarXlsx(buf, fn) {
  const zip = await JSZip.loadAsync(buf);
  await fn(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
async function xmlDaNotas(buf) {
  const zip = await JSZip.loadAsync(buf);
  const parte = await C.parteDaAba(zip, 'NOTAS');
  return { zip, parte, xml: await zip.file(parte).async('string'), ss: await C.sharedStrings(zip) };
}
const reCel = (ref) => new RegExp('<c\\b[^>]*?\\br="' + ref + '"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)');
/** (4) Conferência independente: todas as partes iguais byte a byte, menos a NOTAS; na NOTAS, só as refs. */
async function restoIdentico(antes, depois, refs) {
  const za = await JSZip.loadAsync(antes), zb = await JSZip.loadAsync(depois);
  const lista = (z) => Object.keys(z.files).filter((n) => !z.files[n].dir).sort();
  const na = lista(za), nb = lista(zb);
  if (JSON.stringify(na) !== JSON.stringify(nb)) return { ok: false, motivo: 'lista de partes mudou' };
  const parteNotas = await C.parteDaAba(za, 'NOTAS');
  const diferentes = [];
  for (const p of na) {
    const a = Buffer.from(await za.file(p).async('uint8array')), b = Buffer.from(await zb.file(p).async('uint8array'));
    if (p === parteNotas) {
      let xa = a.toString('utf8'), xb = b.toString('utf8');
      for (const r of refs) { xa = xa.replace(reCel(r), ''); xb = xb.replace(reCel(r), ''); }
      if (xa !== xb) diferentes.push(p + ' (fora das células-alvo)');
    } else if (!a.equals(b)) diferentes.push(p);
  }
  return { ok: diferentes.length === 0, partes: na.length, iguais: na.length - diferentes.length, diferentes };
}
function linhasComValor(xml, ss, col, valores, depoisDe, quantas) {
  const out = [];
  for (const l of C.linhasDaAba(xml)) {
    if (l.numero <= depoisDe) continue;
    if (!C.lerCelulaBruta(l.celulas.H, ss).valor.trim()) continue; // só linha de nota (fornecedor preenchido)
    const c = C.lerCelulaBruta(l.celulas[col], ss);
    if (c.existe && c.estilo && !c.formula && valores.includes(c.valor.trim())) out.push(l.numero);
    if (out.length >= quantas) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Execução de uma fonte no simulador: leitura (até o Merge dos downloads) e, depois, as escritas
// ---------------------------------------------------------------------------------------
const WF_HML = JSON.parse(fs.readFileSync(path.join(RAIZ, 'workflows', 'fase1_solicitacao_nota.homolog.json'), 'utf8'));
const WF_PROD = JSON.parse(fs.readFileSync(path.join(RAIZ, 'workflows', 'fase1_solicitacao_nota.producao.json'), 'utf8'));
const PARAR = new Set(['Gmail — Listar marcadores', 'Merge — arquivos de config', 'Merge — downloads + config', 'Drive — Buscar pasta JURIDICO (AREP+Reunion)', 'Drive — Buscar pasta SMTC_S02_EXECUTIVA', 'Merge — gravação concluída']);
const LEITURAS = ['Ler config_execucao.json', 'Ler cobrancas.json', 'Ler apelidos.json', 'Ler cost_reports.json'];

function montarAmbiente(fonte, original, { sufixo = '_hml', cfg, estado, boxCfg = {}, prep } = {}) {
  const box = criarBox({ login: ME, ...boxCfg });
  const http = box.http;
  box.http = (...a) => { deslocamento += 1000; return http(...a); };
  const custos = cfg || cfgHomologPreenchida();
  box.novaPasta('ZZ-BACKUP-COST', null, PASTA_RAIZ_BK);
  for (const f of ['S01', 'S02']) box.novaPasta(f, PASTA_RAIZ_BK, String(custos[f].backup.subpasta_id));
  const cost = box.novoArq(custos[fonte].nome_esperado + '.xlsx', null, original, { id: String(custos[fonte].box_id) });
  const disco = {
    [DIR_CFG + 'config_execucao' + sufixo + '.json']: lerCfgRepo('config_execucao' + sufixo + '.json'),
    [DIR_CFG + 'cobrancas' + sufixo + '.json']: lerCfgRepo('cobrancas' + sufixo + '.json'),
    [DIR_CFG + 'apelidos' + sufixo + '.json']: lerCfgRepo('apelidos' + sufixo + '.json'),
    [DIR_CFG + 'cost_reports' + sufixo + '.json']: Buffer.from(JSON.stringify(custos)),
  };
  if (estado !== null) disco[DIR_CFG + 'estado_cost' + sufixo + '.json'] = Buffer.from(JSON.stringify(estado));
  if (prep) prep(box, cost);
  return { box, disco, cost, custos, sufixo };
}
/** Impressão digital inicial (o que o ZZ-TEMP de leitura do C.3.1 grava na VM). */
async function estadoInicial(fonte, buf, boxId) {
  return { [fonte]: { box_id: String(boxId), gravado_em: '2026-10-29T10:00:00-03:00', execucao_n8n: 'ZZ-TEMP', impressao: await C.impressao(await JSZip.loadAsync(buf), 'NOTAS', []) } };
}

async function rodarFonte(amb, { wf = WF_HML, fonte, n, l, entreLeituraEEscrita, entreNeL }) {
  const motor = criarMotor({ box: amb.box, fs: amb.disco });
  const runs = {};
  const r = { erros: [], chegou: {}, mensagens: [], ordem: [] };
  const passo = async (opcoes) => {
    const x = await motor(wf, { runs, parar: PARAR, ...opcoes });
    r.ordem.push(...x.ordem); r.mensagens.push(...x.mensagens);
    for (const [k, v] of Object.entries(x.chegou)) (r.chegou[k] = r.chegou[k] || []).push(...v);
    if (x.erro) r.erros.push(x.erro);
    return x;
  };
  await passo({ inicio: 'Trigger — fonte a processar', entrada: [{ json: { fonteId: fonte } }] });
  for (const nome of LEITURAS) await passo({ inicio: nome, entrada: [{ json: {} }] });
  // Merge — arquivos de config (append): as 4 leituras, na ordem das entradas
  const merged = LEITURAS.flatMap((nome) => runs[nome][runs[nome].length - 1]);
  await passo({ inicio: 'Carregar config + perfis', entrada: merged });
  r.leuCost = !!runs['Leitura do Cost — 08 conferir download e identidades'];
  if (r.erros.length || !r.leuCost) return r;
  if (entreLeituraEEscrita) await entreLeituraEEscrita(amb.box, amb.cost);
  if (n) {
    await passo({ inicio: 'Preparar gravação da coluna N', entrada: n.map((m) => ({ json: { nota: { projetoId: m.projetoId, linha: m.linha }, atualizarColunaNPara: m.valor } })) });
    r.erroN = r.erros.length ? r.erros[r.erros.length - 1] : null;
  }
  if (l && !r.erroN) {
    if (entreNeL) await entreNeL(amb.box, amb.cost, runs);
    const antes = r.erros.length;
    await passo({ inicio: 'Preparar gravação da coluna L', entrada: [{ json: { mudancasColunaL: l } }] });
    r.erroL = r.erros.length > antes ? r.erros[r.erros.length - 1] : null;
  }
  r.runs = runs;
  return r;
}

// Fotografia do Box para as provas (1), (2) e (3)
function provas(amb, original) {
  const f = amb.box.F[amb.cost.id];
  const esc = amb.box.escritas;
  const nossas = esc.filter((e) => !e.startsWith('POR FORA'));
  return {
    costIgualAoOriginal: C.sha1(f.buf) === C.sha1(original),
    novaVersao: esc.filter((e) => e.startsWith('NOVA VERSÃO')).length,
    backups: esc.filter((e) => e.startsWith('BACKUP NOVO')).length,
    locks: esc.filter((e) => e.startsWith('LOCK:')).length,
    unlocks: esc.filter((e) => e.startsWith('UNLOCK:')).length,
    deletes: esc.filter((e) => e.startsWith('DELETE')).length,
    lockFinal: f.lock ? f.lock.created_by.login : null,
    listouPastas: amb.box.log.filter((x) => /^GET \/folders\/[^/]+\/items$/.test(x)).map((x) => x.split('/')[2]),
    escritas: nossas,
  };
}
const curto = (s) => String(s || '').replace(/^\[[^\]]*\]\s*/, '').slice(0, 260);
const tabela = [];
function registrar(cenario, esperado, obtido, p, unlock, resto) {
  tabela.push({ cenario, esperado, obtido, escrito: p.escritas.length ? p.escritas.join(' ; ') : 'nada', unlock, resto });
}

// ---------------------------------------------------------------------------------------
(async () => {
  const buf = {};
  console.log('\n== 0. Entradas (só leitura) e versão da config ==');
  for (const f of ['S01', 'S02']) {
    buf[f] = fs.readFileSync(path.join(PASTA_COST, ARQUIVOS[f].nome));
    caso('0 entradas', f + ': Cost lido só para leitura, sha1 conhecido', ARQUIVOS[f].sha1, C.sha1(buf[f]));
  }
  const fonteJs = fs.readFileSync(path.join(RAIZ, 'workflows', '_fonte', 'fase1_solicitacao_nota.fonte.json'), 'utf8');
  const versaoFonte = (fonteJs.match(/const VERSAO_COST_REPORTS = '([^']+)'/) || [])[1];
  caso('0 versão', 'a versão esperada escrita na fonte = config/cost_reports.json', CFG_PROD_REPO.versao, versaoFonte);
  caso('0 versão', 'a versão esperada escrita na fonte = config/cost_reports_hml.json', CFG_HML_REPO.versao, versaoFonte);
  // os dois gerados têm o mesmo ciclo (só o sufixo dos arquivos da VM e o ambiente assado diferem)
  {
    const norm = (wf) => JSON.stringify(wf.nodes.filter((x) => /^(Escrita [NL] — |Leitura do Cost — |Box — Download Cost Report \(fonte)/.test(x.name)).map((x) => ({ ...x, id: undefined })))
      .split('_hml.json').join('.json');
    caso('0 gerados', 'homolog e produção: os nodes do ciclo e da leitura são iguais (fora o sufixo _hml)', true, norm(WF_HML) === norm(WF_PROD));
    caso('0 gerados', 'os dois gerados estão inativos', [false, false], [WF_HML.active, WF_PROD.active]);
  }

  // alvos reais (células que existem, com estilo, sem fórmula, abaixo do cabeçalho)
  const alvos = {};
  for (const f of ['S01', 'S02']) {
    const { xml, ss } = await xmlDaNotas(buf[f]);
    const cab = C.linhaDoCabecalho(xml, ss, CFG_PROD_REPO.cabecalho_notas);
    const proj = f === 'S01' ? 'AREP' : 'SOFT_PRE';
    alvos[f] = {
      cab,
      n: linhasComValor(xml, ss, 'N', [''], cab, 2).map((linha) => ({ projetoId: proj, linha, valor: 'OK - ASSINADO' })),
      l: linhasComValor(xml, ss, 'L', ['', 'PENDENTE'], cab, 2).map((linha) => ({ projetoId: proj, linha, valor: 'SOLICITADA MI' })),
    };
    caso('0 entradas', f + ': achei 2 alvos N e 2 alvos L', [2, 2], [alvos[f].n.length, alvos[f].l.length]);
  }

  async function cenario(nome, f, opcoes = {}) {
    const original = opcoes.original || buf[f];
    const custos = opcoes.cfg || cfgHomologPreenchida();
    const estado = opcoes.estado === null ? null : (opcoes.estado || await estadoInicial(f, opcoes.originalDoEstado || original, custos[f].box_id));
    const amb = montarAmbiente(f, original, { cfg: custos, estado, boxCfg: opcoes.box || {}, prep: opcoes.prep, sufixo: opcoes.sufixo != null ? opcoes.sufixo : '_hml' });
    const r = await rodarFonte(amb, { wf: opcoes.wf || WF_HML, fonte: f, n: opcoes.n === undefined ? alvos[f].n : opcoes.n, l: opcoes.l, entreLeituraEEscrita: opcoes.entreLeituraEEscrita, entreNeL: opcoes.entreNeL });
    const p = provas(amb, original);
    console.log('\n### ' + nome + (r.erros.length ? '\n    parou: ' + curto(r.erros[r.erros.length - 1]) : '') + '\n    escrito: ' + (p.escritas.join(' ; ') || 'nada'));
    return { amb, r, p, original };
  }
  const refsDe = (lista, col) => lista.map((x) => col + x.linha);
  const semEscritaNoCost = (cen, p) => { caso(cen, '(2) o Cost não foi alterado', [true, 0], [p.costIgualAoOriginal, p.novaVersao]); };
  const semLock = (cen, p) => { caso(cen, '(3) nenhum LOCK nosso (nada a destravar)', [0, 0, null], [p.locks, p.unlocks, p.lockFinal]); };
  const destravou = (cen, p) => { caso(cen, '(3) o LOCK nosso saiu (LOCK = UNLOCK, sem lock no fim)', [true, null], [p.locks > 0 && p.locks === p.unlocks, p.lockFinal]); };
  const semRetencao = (cen, p) => { caso(cen, 'retenção: não listou nem apagou nada (só roda depois do sucesso)', [[], 0], [p.listouPastas, p.deletes]); };

  // ======================================================================================
  console.log('\n== 1. Caminho feliz ==');
  for (const f of ['S01', 'S02']) {
    const cen = '1 feliz ' + f + ' N';
    const { amb, r, p, original } = await cenario('caminho feliz ' + f + ' (rascunho: só a coluna N)', f);
    caso(cen, 'sem erro', [], r.erros);
    caso(cen, '(1) escreveu: 1 backup, 1 LOCK, 1 nova versão, 1 UNLOCK', [1, 1, 1, 1], [p.backups, p.locks, p.novaVersao, p.unlocks]);
    destravou(cen, p);
    const final = amb.box.F[amb.cost.id].buf;
    const resto = await restoIdentico(original, final, refsDe(alvos[f].n, 'N'));
    caso(cen, '(4) resto do pacote byte a byte idêntico (só ' + refsDe(alvos[f].n, 'N').join(', ') + ' mudaram)', true, resto.ok, resto);
    const { xml, ss } = await xmlDaNotas(final);
    caso(cen, '(1) as células têm o valor novo e o estilo de antes', alvos[f].n.map(() => true), await Promise.all(alvos[f].n.map(async (a) => { const d = C.celulaXml(xml, 'N' + a.linha, ss); const o = C.celulaXml((await xmlDaNotas(original)).xml, 'N' + a.linha, (await xmlDaNotas(original)).ss); return d.valor === 'OK - ASSINADO' && d.estilo === o.estilo; })));
    const bk = Object.values(amb.box.F).find((x) => /_copia_\d{4}-\d{2}-\d{2}_\d{6}\.xlsx$/.test(x.name));
    caso(cen, 'backup na subpasta ' + f + ', com o nome original + _copia_AAAA-MM-DD_HHMMSS e os mesmos bytes do original', [true, true, true], [!!bk && bk.parent === amb.custos[f].backup.subpasta_id, !!bk && bk.name.startsWith(amb.custos[f].nome_esperado + '_copia_'), !!bk && C.sha1(bk.buf) === C.sha1(original)]);
    caso(cen, 'chegou ao "Merge — gravação concluída" (o e-mail pode seguir)', true, !!r.chegou['Merge — gravação concluída']);
    caso(cen, 'Telegram: recibo (só registrado, nada enviado)', true, r.mensagens.some((m) => m.node === 'Telegram — Recibo da escrita no Cost' && m.texto.includes('Escrita no Cost conferida')));
    const est = JSON.parse(amb.disco[DIR_CFG + 'estado_cost_hml.json']);
    caso(cen, 'estado_cost_hml.json: nova impressão gravada, com o sha1 do arquivo escrito e o backup', [C.sha1(final), bk && bk.id], [est[f].arquivo.sha1, est[f].backup.id]);
    caso(cen, 'retenção: listou SÓ a subpasta ' + f + ' e não apagou (1 cópia, limite 30)', [[amb.custos[f].backup.subpasta_id], 0], [p.listouPastas, p.deletes]);
    if (f === 'S01') gravarSaida('zz-temp-ciclo-feliz-S01-N.xlsx', final);
    registrar('Caminho feliz ' + f + ' (N)', 'escreve; idêntico; 1 backup verificado; retenção', r.erros.length ? 'parou' : 'escreveu e conferiu', p, p.lockFinal === null && p.locks === p.unlocks ? 'sim' : 'NÃO', resto.ok ? 'sim (' + resto.iguais + '/' + resto.partes + ' partes; na NOTAS só os alvos)' : 'NÃO');
  }
  // D28 = (a): a janela da cadeia L é dispensada SÓ se a versão atual é a que a nossa N gravou nesta execução
  {
    const f = 'S01', cen = 'D28 (1) N e L';
    let bufDepoisDaN = null;
    const { amb, r, p, original } = await cenario('D28 (1): N e depois L na mesma execução', f, { l: alvos.S01.l, entreNeL: (box, cost) => { bufDepoisDaN = Buffer.from(cost.buf); } });
    caso(cen, 'sem erro: a N e a L escreveram', [[], null, null], [r.erros, r.erroN || null, r.erroL || null]);
    caso(cen, '(1) 2 backups, 2 LOCK, 2 versões, 2 UNLOCK', [2, 2, 2, 2], [p.backups, p.locks, p.novaVersao, p.unlocks]);
    destravou(cen, p);
    const refs = [...refsDe(alvos.S01.n, 'N'), ...refsDe(alvos.S01.l, 'L')];
    const resto = await restoIdentico(original, amb.box.F[amb.cost.id].buf, refs);
    caso(cen, '(4) resto do pacote idêntico (só as N e as L)', true, resto.ok, resto);
    const recL = r.runs['Escrita L — 35 recibo e novo estado'][0][0].json.recibo;
    caso(cen, 'o recibo da L registra a janela dispensada pela D28', true, /^D28: modificado há/.test(recL.janelaDispensada || ''), recL.janelaDispensada);
    const bks = Object.values(amb.box.F).filter((x) => /_copia_\d{4}-\d{2}-\d{2}_\d{6}\.xlsx$/.test(x.name)).sort((x, y) => (x.name < y.name ? -1 : 1));
    caso(cen, 'D28 (5): o backup da L é o arquivo DEPOIS da N (já com as marcações da N)', [2, true, true], [bks.length, C.sha1(bks[0].buf) === C.sha1(original), C.sha1(bks[1].buf) === C.sha1(bufDepoisDaN)]);
    caso(cen, 'a cadeia L usou o estado gravado pela N (Passo 0 passou) e gravou o seu', 'L', JSON.parse(amb.disco[DIR_CFG + 'estado_cost_hml.json']).S01.coluna);
    registrar('D28 (1): N e L na mesma execução', 'as duas escrevem; o backup da L já tem a N', r.erros.length ? 'parou' : 'N e L escritas; janela dispensada pela D28', p, p.lockFinal === null && p.locks === p.unlocks ? 'sim (2x)' : 'NÃO', resto.ok ? 'sim (só N e L)' : 'NÃO');
  }
  for (const [rotulo, mexer] of [
    ['outra pessoa salva depois da N (sha1 e versão diferentes)', (box, cost) => box.salvarPorFora(cost.id, Buffer.concat([cost.buf, Buffer.from('edição da Danielle')]))],
    ['outra pessoa salva depois da N com os MESMOS bytes (só a versão difere)', (box, cost) => box.salvarPorFora(cost.id, Buffer.from(cost.buf))],
    ['recibo da N adulterado (versão)', (box, cost, runs) => { runs['Escrita N — 35 recibo e novo estado'][0][0].json.recibo.versaoDepois = 'v-adulterada'; }],
    ['recibo da N adulterado (sha1)', (box, cost, runs) => { runs['Escrita N — 35 recibo e novo estado'][0][0].json.recibo.sha1Depois = '0'.repeat(40); }],
    ['recibo da N ausente (sem o campo recibo)', (box, cost, runs) => { delete runs['Escrita N — 35 recibo e novo estado'][0][0].json.recibo; }],
  ]) {
    const cen = 'D28 ' + rotulo.slice(0, 44);
    let custoDepoisDaN = null;
    const { amb, r, p } = await cenario('D28: ' + rotulo, 'S01', { l: alvos.S01.l, entreNeL: (box, cost, runs) => { mexer(box, cost, runs); custoDepoisDaN = Buffer.from(cost.buf); } });
    caso(cen, 'a N escreveu', [null, 1], [r.erroN || null, p.backups >= 1 ? 1 : 0]);
    caso(cen, 'a L PAROU pela janela de silêncio', true, /coluna L/.test(r.erroL || '') && /janela de silêncio/.test(r.erroL), r.erroL);
    caso(cen, '(2) a L não escreveu nada: 1 backup, 1 LOCK e 1 versão (todos da N); o Cost ficou como estava antes da L', [1, 1, 1, true], [p.backups, p.locks, p.escritas.filter((e) => e.startsWith('NOVA VERSÃO')).length, C.sha1(amb.box.F[amb.cost.id].buf) === C.sha1(custoDepoisDaN)]);
    destravou(cen, p);
    registrar('D28: ' + rotulo, 'a L para pela janela', curto(r.erroL).slice(0, 160), p, p.lockFinal === null && p.locks === p.unlocks ? 'sim' : 'NÃO', '— (a L não escreveu)');
  }
  {
    const cen = 'D28 (3) L sozinha, recente';
    const { r, p } = await cenario('D28 (3): só a L, Cost modificado há 3 min (a N não escreveu)', 'S01', { n: null, l: alvos.S01.l, prep: (box, cost) => { cost.modified_at = new Date(Date.now() - 3 * 60000).toISOString(); } });
    caso(cen, 'a L PAROU pela janela (sem recibo da N, a janela vale)', true, /coluna L/.test(r.erroL || '') && /janela de silêncio/.test(r.erroL), r.erroL);
    caso(cen, 'nada escrito: nem backup, nem lock', [0, 0, true], [p.backups, p.locks, p.costIgualAoOriginal]);
    registrar('D28 (3): L sozinha com o Cost modificado há 3 min', 'para', curto(r.erroL).slice(0, 160), p, 'sem lock', '—');
  }
  {
    const f = 'S01', cen = '1 feliz S01 L';
    const { amb, r, p, original } = await cenario('caminho feliz S01, só a coluna L (Cost parado há 60 min)', f, { n: null, l: alvos.S01.l });
    caso(cen, 'sem erro', [], r.erros);
    caso(cen, '(1) 1 backup, 1 LOCK, 1 versão, 1 UNLOCK', [1, 1, 1, 1], [p.backups, p.locks, p.novaVersao, p.unlocks]);
    destravou(cen, p);
    const resto = await restoIdentico(original, amb.box.F[amb.cost.id].buf, refsDe(alvos.S01.l, 'L'));
    caso(cen, '(4) resto do pacote idêntico (só as L)', true, resto.ok, resto);
    caso(cen, 'o estado gravado é o da cadeia L', 'L', JSON.parse(amb.disco[DIR_CFG + 'estado_cost_hml.json']).S01.coluna);
    caso(cen, 'Telegram: recibo da coluna L', true, r.mensagens.some((m) => m.node === 'Telegram — Recibo da escrita no Cost' && /coluna L/.test(m.texto)));
    registrar('Caminho feliz S01 (só L)', 'escreve; idêntico', r.erros.length ? 'parou' : 'escreveu e conferiu', p, p.lockFinal === null && p.locks === p.unlocks ? 'sim' : 'NÃO', resto.ok ? 'sim' : 'NÃO');
  }
  {
    const f = 'S01', cen = '1 feliz produção';
    const custos = JSON.parse(JSON.stringify(CFG_PROD_REPO));
    const { amb, r, p, original } = await cenario('caminho feliz S01 no GERADO DE PRODUÇÃO (ids reais só em memória)', f, { wf: WF_PROD, cfg: custos, sufixo: '' });
    caso(cen, 'sem erro', [], r.erros);
    caso(cen, '(1) 1 backup, 1 LOCK, 1 versão, 1 UNLOCK', [1, 1, 1, 1], [p.backups, p.locks, p.novaVersao, p.unlocks]);
    const resto = await restoIdentico(original, amb.box.F[amb.cost.id].buf, refsDe(alvos.S01.n, 'N'));
    caso(cen, '(4) resto idêntico', true, resto.ok, resto);
    caso(cen, 'leu os arquivos SEM sufixo (cost_reports.json, estado_cost.json)', true, !!amb.disco[DIR_CFG + 'estado_cost.json'] && JSON.parse(amb.disco[DIR_CFG + 'estado_cost.json']).S01.coluna === 'N');
    registrar('Caminho feliz S01 no gerado de produção', 'igual ao homolog', r.erros.length ? 'parou' : 'escreveu e conferiu', p, p.lockFinal === null ? 'sim' : 'NÃO', resto.ok ? 'sim' : 'NÃO');
  }

  // ======================================================================================
  console.log('\n== 2. Nome do Cost divergente ==');
  {
    const cen = '2 nome (leitura)';
    const { r, p } = await cenario('nome divergente na LEITURA', 'S01', { prep: (box, cost) => { cost.name = 'ZZ-HML_BR_SMTC_S01__COST REPORT_VS_EXECUÇÃO_30.10.xlsx'; } });
    caso(cen, 'PAROU no portão da leitura, com o nome achado e candidatos', true, /portão recusou/.test(r.erros[0] || '') && /30\.10/.test(r.erros[0]) && /Candidatos/.test(r.erros[0]), r.erros);
    caso(cen, 'não baixou o Cost', false, r.leuCost);
    semEscritaNoCost(cen, p); semLock(cen, p);
    registrar('Nome do Cost divergente (leitura)', 'para antes de baixar; candidatos', curto(r.erros[0]), p, 'sem lock', '—');
  }
  {
    const cen = '2 nome (escrita)';
    const { r, p } = await cenario('nome divergente entre a leitura e a escrita', 'S01', { entreLeituraEEscrita: (box, cost) => { cost.name = 'OUTRO NOME.xlsx'; } });
    caso(cen, 'PAROU no portão da escrita (04), antes de baixar', true, /04 portão/.test(r.erroN || '') && /nome/.test(r.erroN), r.erroN);
    semEscritaNoCost(cen, p); semLock(cen, p);
    caso(cen, 'não fez backup', 0, p.backups);
    registrar('Nome do Cost divergente (escrita)', 'para antes de baixar', curto(r.erroN), p, 'sem lock', '—');
  }

  // ======================================================================================
  console.log('\n== 3. Passo 0 com diferença ==');
  for (const [rotulo, mudar] of [
    ['largura de coluna da NOTAS', async (zip) => { const parte = await C.parteDaAba(zip, 'NOTAS'); const x = await zip.file(parte).async('string'); zip.file(parte, x.replace(/(<col\b[^>]*\bwidth=")([\d.]+)"/, (m, a, w) => a + (parseFloat(w) + 3) + '"')); }],
    ['um dxf alterado', async (zip) => { const x = await zip.file('xl/styles.xml').async('string'); zip.file('xl/styles.xml', x.replace(/<dxf>/, '<dxf><font><b/></font>')); }],
    ['uma regra de formatação condicional a menos', async (zip) => { const parte = await C.parteDaAba(zip, 'NOTAS'); const x = await zip.file(parte).async('string'); zip.file(parte, x.replace(/<cfRule\b[\s\S]*?<\/cfRule>/, '')); }],
  ]) {
    const cen = '3 Passo 0: ' + rotulo;
    const alterado = await alterarXlsx(buf.S01, mudar);
    const { r, p } = await cenario('Passo 0 com diferença: ' + rotulo, 'S01', { original: alterado, originalDoEstado: buf.S01 });
    caso(cen, 'PAROU no Passo 0 (09)', true, /09 Passo 0/.test(r.erroN || '') && /Passo 0: a formatação mudou/.test(r.erroN), r.erroN);
    caso(cen, 'nada escrito: nem backup, nem lock, nem versão', [0, 0, 0], [p.backups, p.locks, p.novaVersao]);
    semEscritaNoCost(cen, p);
    caso(cen, 'não chegou ao Merge (nenhum e-mail)', false, !!r.chegou['Merge — gravação concluída']);
    registrar('Passo 0 com diferença (' + rotulo + ')', 'para, nada escrito', curto(r.erroN).slice(0, 160), p, 'sem lock', '—');
  }
  {
    const cen = '3 sem estado';
    const { r, p } = await cenario('sem arquivo de estado na VM', 'S01', { estado: null });
    caso(cen, 'PAROU no Passo 0: sem arquivo de estado', true, /sem arquivo de estado/.test(r.erroN || ''), r.erroN);
    semEscritaNoCost(cen, p); semLock(cen, p);
    registrar('Sem arquivo de estado (C.3.1)', 'para', curto(r.erroN).slice(0, 160), p, 'sem lock', '—');
  }

  // ======================================================================================
  console.log('\n== 4. Backup sem verificação ==');
  for (const [rotulo, box, onde] of [
    ['o Box guarda outra coisa (sha1 e tamanho na resposta do upload)', { corromperBackup: (b) => Buffer.concat([b, Buffer.from('x')]) }, /11 conferir envio do backup/],
    ['a cópia baixada de volta tem sha1 diferente (mesmo tamanho)', { alterarDownload: (id, n, copia, api) => { const f = api.F[id]; if (!/_copia_/.test(f.name)) return null; const o = Buffer.from(copia); o[o.length - 10] ^= 0xff; return o; } }, /13 conferir backup baixado/],
    ['a cópia baixada de volta tem outro tamanho', { alterarDownload: (id, n, copia, api) => (/_copia_/.test(api.F[id].name) ? copia.subarray(0, copia.length - 1) : null) }, /13 conferir backup baixado/],
  ]) {
    const cen = '4 backup: ' + rotulo.slice(0, 40);
    const { r, p } = await cenario('backup sem verificação: ' + rotulo, 'S01', { box });
    caso(cen, 'PAROU na conferência do backup, sem escrever', true, onde.test(r.erroN || '') && /Sem backup verificado, não escrevo/.test(r.erroN), r.erroN);
    semEscritaNoCost(cen, p); semLock(cen, p); semRetencao(cen, p);
    registrar('Backup sem verificação: ' + rotulo, 'não escreve', curto(r.erroN).slice(0, 160), p, 'sem lock', '—');
  }
  {
    const cen = '4 backup: nome já existe (409)';
    const { r, p } = await cenario('backup: já existe um item com o mesmo nome (409)', 'S01', {
      prep: (box) => { box.cfg.antes = ({ method, caminho, form }) => { if (method === 'POST' && caminho === '/files/content' && !box.cfg.jaCriou) { box.cfg.jaCriou = true; const at = JSON.parse(form.attributes); box.novoArq(at.name, at.parent.id, Buffer.from('outro')); } return null; }; },
    });
    caso(cen, 'PAROU: 409, não sobrescreve', true, /409/.test(r.erroN || '') && /não sobrescrevo/.test(r.erroN), r.erroN);
    semEscritaNoCost(cen, p); semLock(cen, p);
    registrar('Backup: nome já existe (409)', 'não sobrescreve; não escreve', curto(r.erroN).slice(0, 160), p, 'sem lock', '—');
  }

  // ======================================================================================
  console.log('\n== 5. Arquivo travado por outra pessoa ==');
  {
    const cen = '5 travado';
    const lockOutro = { type: 'lock', created_by: { login: 'danielle@exemplo.com' }, created_at: 'hoje 09:00', expires_at: 'hoje 10:00' };
    const { r, p } = await cenario('Cost travado pela Danielle', 'S01', { entreLeituraEEscrita: (box, cost) => { cost.lock = { ...lockOutro }; } });
    caso(cen, 'PAROU na checagem do lock (15)', true, /15 checar lock/.test(r.erroN || '') && /TRAVADO por danielle/.test(r.erroN), r.erroN);
    caso(cen, '(3) não mexeu no lock dela (nenhum LOCK/UNLOCK nosso; o lock dela continua)', [0, 0, 'danielle@exemplo.com'], [p.locks, p.unlocks, p.lockFinal]);
    semEscritaNoCost(cen, p);
    caso(cen, 'o backup já tinha sido feito e conferido (fica na subpasta)', 1, p.backups);
    registrar('Arquivo travado por outra pessoa', 'não escreve e não mexe no lock', curto(r.erroN).slice(0, 160), p, 'não tocou no lock dela', '—');
  }

  // ======================================================================================
  console.log('\n== 6. Upload recusado por If-Match (412) ==');
  {
    const cen = '6 412';
    let versaoOutra = null;
    const { amb, r, p, original } = await cenario('alguém sobe outra versão entre o lock e o nosso upload', 'S01', {
      prep: (box, cost) => { box.cfg.antes = ({ method, caminho }) => { if (method === 'POST' && caminho === '/files/' + cost.id + '/content' && !versaoOutra) { versaoOutra = Buffer.concat([cost.buf, Buffer.from('')]); box.salvarPorFora(cost.id, Buffer.from(versaoOutra)); } return null; }; },
    });
    caso(cen, 'PAROU depois do UNLOCK: 412, nada nosso entrou, não restaura', true, /24 depois do unlock/.test(r.erroN || '') && /412/.test(r.erroN) && /não restauro/.test(r.erroN) && /UNLOCK confirmado/.test(r.erroN), r.erroN);
    caso(cen, '(1)(2) nenhuma versão NOSSA entrou; o Cost tem a versão da outra pessoa', [0, true], [p.novaVersao, C.sha1(amb.box.F[amb.cost.id].buf) === C.sha1(versaoOutra)]);
    destravou(cen, p); semRetencao(cen, p);
    caso(cen, 'não restaurou (só 1 backup, o de antes)', 1, p.backups);
    registrar('Upload recusado por If-Match (412)', 'não escreve, destrava, não restaura', curto(r.erroN).slice(0, 160), p, p.lockFinal === null && p.locks === p.unlocks ? 'sim' : 'NÃO', '— (não escreveu)');
  }

  // ======================================================================================
  console.log('\n== 7. etag mudando entre o download e o upload (nada escrito) ==');
  {
    const cen = '7 etag: durante o download';
    const { r, p } = await cenario('alguém salva logo depois do nosso download integral', 'S01', {
      prep: (box, cost) => { box.cfg.depoisDoDownload = (id, n, api) => { if (id === cost.id && n === 2) api.salvarPorFora(cost.id, Buffer.concat([cost.buf])); }; },
    });
    caso(cen, 'PAROU nos metadados depois do download (09): o Cost mudou durante o download', true, /mudou durante o download/.test(r.erroN || ''), r.erroN);
    caso(cen, 'nada escrito: nem backup, nem lock', [0, 0], [p.backups, p.locks]);
    caso(cen, '(2) nenhuma versão nossa', 0, p.novaVersao);
    registrar('etag muda durante o download', 'para, nada escrito', curto(r.erroN).slice(0, 160), p, 'sem lock', '—');
  }
  {
    const cen = '7 etag: depois do backup';
    let backupFeito = false, feito = false;
    const { r, p } = await cenario('alguém salva entre o backup e a checagem do lock', 'S01', {
      prep: (box, cost) => { box.cfg.antes = ({ method, caminho }) => { if (method === 'POST' && caminho === '/files/content') backupFeito = true; else if (backupFeito && !feito && method === 'GET' && caminho === '/files/' + cost.id) { feito = true; box.salvarPorFora(cost.id, Buffer.concat([cost.buf])); } return null; }; },
    });
    caso(cen, 'PAROU na checagem do lock (15): o Cost mudou depois do backup', true, /mudou depois do backup/.test(r.erroN || ''), r.erroN);
    caso(cen, 'nada escrito: nenhum lock, nenhuma versão nossa', [0, 0], [p.locks, p.novaVersao]);
    registrar('etag muda entre o backup e o lock', 'para, nada escrito', curto(r.erroN).slice(0, 160), p, 'sem lock', '—');
  }

  // ======================================================================================
  console.log('\n== 8. D16: etag novo depois do lock ==');
  {
    const cen = '8 D16 sha1 igual';
    const { amb, r, p, original } = await cenario('o lock muda o etag, o sha1 continua igual', 'S01', { box: { lockMudaEtag: true } });
    caso(cen, 'sem erro: usou o etag NOVO no If-Match', [], r.erros);
    caso(cen, 'o recibo registra que o etag mudou no lock', true, r.runs['Escrita N — 35 recibo e novo estado'][0][0].json.recibo.d16.etagMudouNoLock);
    const resto = await restoIdentico(original, amb.box.F[amb.cost.id].buf, refsDe(alvos.S01.n, 'N'));
    caso(cen, '(1)(4) escreveu, e o resto ficou idêntico', [1, true], [p.novaVersao, resto.ok]);
    destravou(cen, p);
    registrar('D16: lock muda o etag, sha1 igual', 'If-Match com o etag novo', r.erros.length ? 'parou' : 'escreveu', p, p.lockFinal === null ? 'sim' : 'NÃO', resto.ok ? 'sim' : 'NÃO');
  }
  {
    const cen = '8 D16 sha1 diferente';
    const { r, p, amb } = await cenario('depois do nosso lock, o conteúdo mudou (sha1 diferente)', 'S01', { box: { depoisDoLock: (f, api) => { if (!api.cfg.jaMudou) { api.cfg.jaMudou = true; api.salvarPorFora(f.id, Buffer.concat([f.buf, Buffer.from('editado no Excel Online')])); } } } });
    caso(cen, 'PAROU depois do UNLOCK, pela D16', true, /D16: o sha1 relido/.test(r.erroN || '') && /UNLOCK confirmado/.test(r.erroN), r.erroN);
    caso(cen, '(2) nenhuma versão nossa', 0, p.novaVersao);
    destravou(cen, p); semRetencao(cen, p);
    registrar('D16: sha1 diferente depois do lock', 'aborta e faz UNLOCK', curto(r.erroN).slice(0, 160), p, p.lockFinal === null && p.locks === p.unlocks ? 'sim' : 'NÃO', '—');
  }

  // ======================================================================================
  console.log('\n== 9. Unlock sempre, inclusive depois de falha ao aplicar ==');
  {
    const cen = '9 falha ao aplicar (D9)';
    const f = 'S01', alvo = alvos.S01.n[0];
    const { r, p } = await cenario('a linha mudou entre a leitura e a escrita (D9)', f, {
      entreLeituraEEscrita: async (box, cost) => {
        const novo = await alterarXlsx(cost.buf, async (zip) => { const parte = await C.parteDaAba(zip, 'NOTAS'); const x = await zip.file(parte).async('string'); zip.file(parte, x.replace(reCel('H' + alvo.linha), (m) => { const est = (m.match(/\bs="(\d+)"/) || [])[1]; return '<c r="H' + alvo.linha + '"' + (est ? ' s="' + est + '"' : '') + ' t="inlineStr"><is><t>OUTRO FORNECEDOR</t></is></c>'; })); });
        box.salvarPorFora(cost.id, novo); cost.modified_at = new Date(Date.now() - 30 * 60000).toISOString();
      },
      originalDoEstado: buf.S01,
    });
    caso(cen, 'PAROU depois do UNLOCK: D9, a linha mudou', true, /D9: a linha mudou/.test(r.erroN || '') && /UNLOCK confirmado/.test(r.erroN), r.erroN);
    caso(cen, '(2) nenhuma versão nossa', 0, p.novaVersao);
    destravou(cen, p);
    registrar('Falha ao aplicar: linha mudou (D9)', 'aborta e destrava', curto(r.erroN).slice(0, 160), p, p.lockFinal === null && p.locks === p.unlocks ? 'sim' : 'NÃO', '—');
  }
  {
    const cen = '9 falha ao aplicar (D7)';
    const alvo = alvos.S01.n[0];
    const semCelula = await alterarXlsx(buf.S01, async (zip) => { const parte = await C.parteDaAba(zip, 'NOTAS'); const x = await zip.file(parte).async('string'); zip.file(parte, x.replace(reCel('N' + alvo.linha), '')); });
    const { r, p } = await cenario('célula-alvo inexistente no XML (D7(b))', 'S01', { original: semCelula });
    caso(cen, 'PAROU depois do UNLOCK: D7', true, /D7/.test(r.erroN || '') && /UNLOCK confirmado/.test(r.erroN), r.erroN);
    caso(cen, '(2) nenhuma versão nossa', 0, p.novaVersao);
    destravou(cen, p);
    registrar('Falha ao aplicar: célula inexistente (D7)', 'aborta e destrava', curto(r.erroN).slice(0, 160), p, p.lockFinal === null && p.locks === p.unlocks ? 'sim' : 'NÃO', '—');
  }
  {
    const cen = '9 unlock que falha';
    let feito = false;
    const { r, p } = await cenario('412 e o UNLOCK também falha (o recibo de erro avisa)', 'S01', {
      box: { unlockFalha: true },
      prep: (box, cost) => { box.cfg.antes = ({ method, caminho }) => { if (method === 'POST' && caminho === '/files/' + cost.id + '/content' && !feito) { feito = true; box.salvarPorFora(cost.id, Buffer.concat([cost.buf])); } return null; }; },
    });
    caso(cen, 'a mensagem diz que o UNLOCK NÃO confirmou', true, /UNLOCK NÃO confirmou/.test(r.erroN || ''), r.erroN);
    caso(cen, 'o UNLOCK foi tentado (PUT lock:null) depois do LOCK', true, p.locks === 1 && r.ordem.includes('Escrita N — 23 Box: UNLOCK (sempre)'));
    registrar('UNLOCK que falha (depois de 412)', 'relata que o lock pode ter ficado', curto(r.erroN).slice(0, 160), p, 'tentado; o Box recusou (relatado)', '—');
  }

  // ======================================================================================
  console.log('\n== 10. Restauração depois de falha na comparação ==');
  {
    const cen = '10 restauração';
    const { amb, r, p, original } = await cenario('o Box guarda bytes diferentes dos que subimos', 'S01', { box: { corromperUpload: (b) => Buffer.concat([b, Buffer.from('lixo')]) } });
    caso(cen, 'sem erro de execução (vai ao alerta)', [], r.erros);
    caso(cen, 'o Cost voltou byte a byte ao original (sha1 do backup)', true, p.costIgualAoOriginal);
    caso(cen, '(1) 2 backups (o de antes e o do estado atual), 2 versões, 2 LOCK, 2 UNLOCK', [2, 2, 2, 2], [p.backups, p.novaVersao, p.locks, p.unlocks]);
    destravou(cen, p); semRetencao(cen, p);
    const alerta = r.mensagens.find((m) => m.node === 'Telegram — Escrita não confirmada');
    caso(cen, 'Telegram (registrado): "RESTAURADO" e "Nenhum e-mail"', true, !!alerta && /RESTAURADO/.test(alerta.texto) && /Nenhum e-mail/.test(alerta.texto), alerta && alerta.texto);
    caso(cen, 'não chegou ao Merge (nenhum e-mail)', false, !!r.chegou['Merge — gravação concluída']);
    caso(cen, 'o estado NÃO foi atualizado (continua o de antes)', 'ZZ-TEMP', JSON.parse(amb.disco[DIR_CFG + 'estado_cost_hml.json']).S01.execucao_n8n);
    registrar('Falha na comparação → restauração', 'restaura e confere sha1 = backup', alerta ? 'restaurou (sha1 = original)' : 'sem alerta', p, p.lockFinal === null && p.locks === p.unlocks ? 'sim (2x)' : 'NÃO', 'voltou ao original');
  }
  {
    const cen = '10 sem restauração (D8(b))';
    let depoisDoNosso = false, feito = false;
    const { amb, r, p } = await cenario('falha na comparação, mas alguém salvou depois de nós: NÃO restaura', 'S01', {
      box: { corromperUpload: (b) => Buffer.concat([b, Buffer.from('lixo')]) },
      prep: (box, cost) => { box.cfg.antes = ({ method, caminho }) => { if (method === 'PUT' && caminho === '/files/' + cost.id && depoisDoNosso === false && box.escritas.some((e) => e.startsWith('NOVA VERSÃO'))) depoisDoNosso = true; if (depoisDoNosso && !feito && method === 'GET' && caminho === '/files/' + cost.id) { feito = true; box.salvarPorFora(cost.id, Buffer.from('versão da Danielle')); } return null; }; },
    });
    const alerta = r.mensagens.find((m) => m.node === 'Telegram — Escrita não confirmada');
    caso(cen, 'alerta "NÃO restaurei" (D8(b)), sem restaurar', true, !!alerta && /NÃO restaurei/.test(alerta.texto), alerta && alerta.texto);
    caso(cen, 'o Cost ficou com a versão da outra pessoa (não apagamos a edição dela)', 'versão da Danielle', amb.box.F[amb.cost.id].buf.toString());
    caso(cen, '(1) 1 backup, 1 LOCK, 1 UNLOCK (sem o ciclo da restauração)', [1, 1, 1], [p.backups, p.locks, p.unlocks]);
    registrar('Falha na comparação, mas alguém salvou depois (D8(b))', 'não restaura; alerta', 'não restaurou; alertou', p, p.lockFinal === null ? 'sim' : 'NÃO', '—');
  }

  // ======================================================================================
  console.log('\n== 11. Janela de silêncio ==');
  {
    const cen = '11 janela';
    const { r, p } = await cenario('Cost modificado há 3 minutos', 'S01', { prep: (box, cost) => { cost.modified_at = new Date(Date.now() - 3 * 60000).toISOString(); } });
    caso(cen, 'PAROU no portão da escrita (04): janela de silêncio, tenta na próxima', true, /janela de silêncio/.test(r.erroN || '') && /tenta na próxima/.test(r.erroN), r.erroN);
    caso(cen, 'nada escrito: nem backup, nem lock', [0, 0], [p.backups, p.locks]);
    semEscritaNoCost(cen, p);
    registrar('Janela de silêncio (modificado há 3 min)', 'não escreve; tenta na próxima', curto(r.erroN).slice(0, 160), p, 'sem lock', '—');
  }

  // ======================================================================================
  console.log('\n== 12. Retenção e DELETE (C.5) ==');
  const comCopias = (quantas, extra) => (box) => {
    const nome = cfgHomologPreenchida().S01.nome_esperado;
    for (let i = 0; i < quantas; i++) box.novoArq(nome + '_copia_2026-09-' + String(1 + Math.floor(i / 24)).padStart(2, '0') + '_' + String(i % 24).padStart(2, '0') + '0000.xlsx', FALSO.S01.subpasta, Buffer.from('copia antiga ' + i));
    if (extra) extra(box, nome);
  };
  {
    const cen = '12 DELETE 204 + 404';
    const { amb, r, p } = await cenario('30 cópias antigas: a 31ª entra e a mais antiga sai (204, depois 404)', 'S01', {
      prep: comCopias(30, (box, nome) => {
        box.novoArq(nome + '_copia_2026-01-01_000000.xlsx', PASTA_RAIZ_BK, Buffer.from('fora da subpasta')); // na RAIZ do ZZ-BACKUP-COST: nunca listada
        box.novoArq('ZZ-TESTE_' + nome + '_copia_2026-01-01_000000.xlsx', FALSO.S01.subpasta, Buffer.from('outro nome')); // nome que não casa: nunca apagado
      }),
    });
    caso(cen, 'sem erro', [], r.erros);
    const ret = r.runs['Escrita N — 34 retenção: conferir (404)'][0][0].json.retencao;
    caso(cen, 'apagado SÓ com a releitura 404', [true, 1], [ret.apagado, p.deletes]);
    caso(cen, 'apagou a mais antiga da subpasta (01/09 00:00)', true, /_copia_2026-09-01_000000\.xlsx$/.test(ret.candidato.nome));
    caso(cen, 'listou SÓ a subpasta; a cópia da raiz e o nome que não casa continuam', [[FALSO.S01.subpasta], true, true],
      [p.listouPastas, Object.values(amb.box.F).some((x) => x.parent === PASTA_RAIZ_BK && !x.lixeira), Object.values(amb.box.F).some((x) => x.name.startsWith('ZZ-TESTE_') && !x.lixeira)]);
    caso(cen, 'ficaram 30 cópias na subpasta', 30, Object.values(amb.box.F).filter((x) => x.parent === FALSO.S01.subpasta && !x.lixeira && /^ZZ-HML_.*_copia_\d{4}-\d{2}-\d{2}_\d{6}\.xlsx$/.test(x.name)).length);
    registrar('Retenção: DELETE 204 + releitura 404', 'apagado só com 404; só na subpasta', ret.apagado ? 'apagou 1 (404 confirmado)' : 'não apagou', p, p.lockFinal === null ? 'sim' : 'NÃO', 'sim');
  }
  {
    const cen = '12 DELETE 204 sem efeito';
    const { r, p } = await cenario('o DELETE responde 204, mas o arquivo continua lá', 'S01', { prep: comCopias(30), box: { deleteSemEfeito: true } });
    const ret = r.runs['Escrita N — 34 retenção: conferir (404)'][0][0].json.retencao;
    caso(cen, 'NÃO tratado como apagado (a releitura deu 200)', [false, true], [ret.apagado, /NÃO apagado/.test(ret.aviso || '')], ret);
    caso(cen, 'a escrita continua valendo (sem erro)', [], r.erros);
    registrar('Retenção: DELETE 204 sem efeito', 'não conta como apagado', ret.aviso, p, p.lockFinal === null ? 'sim' : 'NÃO', 'sim');
  }
  {
    const cen = '12 DELETE 403';
    const { r, p } = await cenario('o DELETE é recusado (403)', 'S01', { prep: comCopias(30), box: { deleteProibido: true } });
    const ret = r.runs['Escrita N — 34 retenção: conferir (404)'][0][0].json.retencao;
    caso(cen, 'aviso com o 403, não apagado', [false, true], [ret.apagado, /403/.test(ret.aviso || '')], ret);
    registrar('Retenção: DELETE 403', 'só aviso', ret.aviso, p, p.lockFinal === null ? 'sim' : 'NÃO', 'sim');
  }
  {
    const cen = '12 listagem truncada';
    const { r, p } = await cenario('listagem da subpasta truncada', 'S01', { prep: comCopias(30), box: { truncarListagem: 10 } });
    const ret = r.runs['Escrita N — 30 retenção: escolher'][0][0].json.retencao;
    caso(cen, 'não apaga nada com a listagem truncada', [0, true], [p.deletes, /truncada/.test(ret.aviso || '')], ret);
    registrar('Retenção: listagem truncada', 'não apaga', ret.aviso, p, p.lockFinal === null ? 'sim' : 'NÃO', 'sim');
  }

  // ======================================================================================
  console.log('\n== 13. Config ==');
  {
    const cen = '13 versão';
    const custos = cfgHomologPreenchida(); custos.versao = '2026-01-01.1';
    const { r, p } = await cenario('cost_reports da VM com outra versão', 'S01', { cfg: custos });
    caso(cen, 'PAROU no Carregar config: versão', true, /a config da VM não é a do repositório/.test(r.erros[0] || ''), r.erros);
    semEscritaNoCost(cen, p); semLock(cen, p);
    registrar('Config da VM com outra versão', 'para', curto(r.erros[0]).slice(0, 160), p, 'sem lock', '—');
  }
  {
    const cen = '13 ambiente';
    const custos = cfgHomologPreenchida(); custos.ambiente = 'producao';
    const { r } = await cenario('cost_reports de produção no homolog', 'S01', { cfg: custos });
    caso(cen, 'PAROU: o cost_reports é de outro ambiente', true, /é de "producao", e este workflow é "homolog"/.test(r.erros[0] || ''), r.erros);
  }
  {
    const cen = '13 config do repositório (pendente)';
    const { r } = await cenario('cost_reports_hml.json do repositório como está (box_id null, passo 7 pendente)', 'S01', { cfg: JSON.parse(JSON.stringify(CFG_HML_REPO)) });
    caso(cen, 'PAROU: config dos Cost com problema (box_id vazio)', true, /config dos Cost com problema/.test(r.erros[0] || '') && /box_id vazio/.test(r.erros[0]), r.erros);
  }
  {
    const cen = '13 id proibido';
    const custos = cfgHomologPreenchida(); custos.S01.box_id = '2028817453680';
    const { r, p } = await cenario('config aponta para o ID ANTIGO do S01', 'S01', { cfg: custos });
    caso(cen, 'PAROU: id na lista de PROIBIDOS', true, /PROIBIDOS/.test(r.erros[0] || ''), r.erros);
    semEscritaNoCost(cen, p);
    registrar('Config aponta para um ID antigo (proibido)', 'para', curto(r.erros[0]).slice(0, 160), p, 'sem lock', '—');
  }

  // ======================================================================================
  const falhas = casos.filter((c) => !c.ok);
  const arq = path.join(SAIDA, 'zz-temp-ciclo-resultado.json');
  fs.writeFileSync(arq, JSON.stringify({ quando: new DateReal().toISOString(), total: casos.length, falhas: falhas.length, tabela, casos }, null, 2));
  console.log('\nTOTAL: ' + casos.length + ' casos, ' + falhas.length + ' falha(s). Resultado em ' + path.relative(RAIZ, arq));
  process.exitCode = falhas.length ? 1 : 0;
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exitCode = 2; });
