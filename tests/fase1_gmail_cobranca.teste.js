'use strict';
/**
 * Fase 1 — rotas do Gmail, marcadores, datas, monitoramento e Relatório (32ª rodada, 07/11/2026).
 *
 * Roda os nodes do workflows/fase1_solicitacao_nota.homolog.json GERADO (e, onde dito, o de
 * produção) no tests/simulador/motor_q.js, com o Gmail FALSO (tests/simulador/gmail_falso.js) e
 * relógio falso. Nada de rede: o Gmail falso só registra, e em modo 'rascunho' QUALQUER envio é
 * violação (o node falha e o teste também).
 *
 * Itens desta rodada:
 *   D57 + D53 (c)  marcador do Soft Pré com o nome novo; marcador faltando só relata
 *   D59            data de Brasília no assunto ("ENVIAR ATÉ dd.mm"), no cobrancas e no log
 *   D63            o "REF." vem da DESCRIÇÃO (coluna J): mês do período ou a palavra REF/JOB/DIÁRIA;
 *                  caso duvidoso = "conferir à mão" (sem rascunho, linha no Relatório)
 *   D41            SOLICITADA MI sem entrada no cobrancas: só relata
 *   D40            Relatório também com 0 candidatas
 *   D17            (PENDENTE, não implementado nesta rodada) só se confere que, em modo
 *                  rascunho, a cobrança NÃO envia nada
 *
 * Os itens são SINTÉTICOS (nomes e e-mails inventados). O container do n8n é UTC: este teste
 * roda com TZ=UTC para reproduzir o fuso de lá.
 */
process.env.TZ = 'UTC';
const fs = require('fs');
const path = require('path');
const criarMotor = require('./simulador/motor_q.js');
const criarGmail = require('./simulador/gmail_falso.js');

const RAIZ = path.join(__dirname, '..');
const SAIDA = path.join(RAIZ, '_lixo');
const WF_HML = JSON.parse(fs.readFileSync(path.join(RAIZ, 'workflows', 'fase1_solicitacao_nota.homolog.json'), 'utf8'));
const WF_PROD = JSON.parse(fs.readFileSync(path.join(RAIZ, 'workflows', 'fase1_solicitacao_nota.producao.json'), 'utf8'));
const DIR = '/home/node/.n8n-files/box-fish-config/';

const casos = [];
function caso(cenario, nome, esperado, obtido, detalhe) {
  const ok = JSON.stringify(esperado) === JSON.stringify(obtido);
  casos.push({ cenario, nome, ok, esperado, obtido, detalhe: ok ? undefined : detalhe });
  console.log((ok ? '  ok    ' : '  FALHA ') + '[' + cenario + '] ' + nome + (ok ? '' : ' — esperado ' + JSON.stringify(esperado) + ', obtido ' + JSON.stringify(obtido) + (detalhe !== undefined ? ' — ' + JSON.stringify(detalhe).slice(0, 600) : '')));
}

// ---------------------------------------------------------------------------------------
// Dados sintéticos
// ---------------------------------------------------------------------------------------
const NOMES_5 = ['IA', 'REUNION - PEDIDO DE NOTAS', 'SOFT PRE - PEDIDO DE NOTAS', 'AREP - PEDIDO DE NOTAS', 'CONTRATAÇÃO'];
const MARC_5 = NOMES_5.map((name, i) => ({ id: 'Label_' + (1000 + i), name })).concat([{ id: 'Label_9', name: 'Faculdade' }]);
const idDe = (nome) => (MARC_5.find((l) => l.name === nome) || {}).id;
const PERFIS = {
  SOFT_PRE: { projeto: 'Soft Pré (S02)', prefixo_assunto_pedido: 'SMTC - S02 | SOFT PRE | EMISSÃO DE NF', prefixo_assunto_entrega: 'SMTC - S02 | SOFT PRE | NOTAS À PAGAR', texto_ref: 'SMTC - SOFT PRE', retranca: 'SOFT PRE_S02' },
  REUNION: { projeto: 'Reunion (S01)', prefixo_assunto_pedido: 'SMTC - S01 | REUNION | EMISSÃO DE NF', prefixo_assunto_entrega: 'SMTC - S01 | REUNION | NOTAS À PAGAR', texto_ref: 'SMTC - REUNION', retranca: 'REUNION_S01' },
};
const APELIDOS = { AREP: ['AREP'], REUNION: ['SMTC - S01 | REUNION'], SOFT_PRE: ['SMTC - S02 | SOFT PRE', 'PNS | SOFT PRE'] };
const cfgExec = (modo, limite = 1) => ({ ambiente: 'homolog', modo, limite_linhas_execucao: limite });
function nota(linha, colunaL, extra = {}) {
  return { linha, projetoId: 'SOFT_PRE', colunaB: '9999.S', colunaC: 'CARGO DE TESTE', colunaG: 'Thu Dec 10 2026 00:00:00 GMT+0000 (Coordinated Universal Time)', colunaH: '00.000.000 PESSOA DE TESTE ' + linha,
    colunaJ: 'CARGO DE TESTE - PESSOA ' + linha + ' - 01/08 A 31/08', colunaK: 1000, colunaL, colunaN: 'OK - ASSINADO', colunaR: 'pessoa' + linha + '@exemplo.invalid', ...extra };
}
/** Item como sai do "Consolidar checagem de contrato" (entrada do "Montar e-mail colaborador"). */
function itemPedido(linha, modo, cobrancas = {}) {
  return { json: { nota: nota(linha, 'SOLICITAR'), config: cfgExec(modo), cobrancas, apelidos: APELIDOS, perfil: PERFIS.SOFT_PRE, dominioEmpresa: 'novorealitybox.com',
    fluxo: 'novo_pedido', gatilho: 'SOLICITAR', escalaUrgencia: 1, forcarRascunho: false, tipoLinha: 'colaborador', periodo: '01/08 A 31/08', tipoEmissao: 'NF_NORMAL', parcela: null,
    cargo: 'CARGO DE TESTE', nomeColaborador: 'PESSOA ' + linha, documentoLinha: null, descricaoServicoOuLocacao: 'Teste', situacaoNaoMapeada: null, chaveLinha: 'SOFT_PRE|' + linha,
    liberado: true, contratoResolvido: true, atualizarColunaNPara: null, provaFicha: null, motivoLiberacao: 'coluna_n' } };
}
/** Item como sai do "Filtrar pela fonte desta passada" (entrada do "Filtrar por Status Box"). */
function itemFiltro(linha, colunaL, modo, cobrancas, extraNota = {}) {
  return { json: { nota: nota(linha, colunaL, extraNota), config: cfgExec(modo, 0), cobrancas, apelidos: APELIDOS, perfil: PERFIS.SOFT_PRE, dominioEmpresa: 'novorealitybox.com' } };
}

// ---------------------------------------------------------------------------------------
// Execução: 1º o começo da passada (Trigger -> Listar -> Mapear marcadores), depois o trecho
// ---------------------------------------------------------------------------------------
const LEITURAS_CFG = new Set(['Ler config_execucao.json', 'Ler cobrancas.json', 'Ler apelidos.json', 'Ler cost_reports.json']);
async function rodar({ wf = WF_HML, sufixo = '_hml', fonteId = 'S02', modo = 'rascunho', marcadores = MARC_5, falharListagem, falharAplicar, agora = '2026-11-08T01:13:55Z',
  cobrancas = {}, inicio, entrada, limite = 1, parar = [] }) {
  const gmail = criarGmail({ modo, marcadores, falharListagem, falharAplicar });
  const disco = { [DIR + 'cobrancas' + sufixo + '.json']: Buffer.from(JSON.stringify(cobrancas)), [DIR + 'log_diario' + sufixo + '.json']: Buffer.from('[]') };
  const antes = { cobrancas: disco[DIR + 'cobrancas' + sufixo + '.json'].toString(), log: disco[DIR + 'log_diario' + sufixo + '.json'].toString() };
  const box = { http: (m, u) => { throw new Error('simulador: este teste não fala com o Box (' + m + ' ' + u + ')'); }, download: (id) => { throw new Error('simulador: download do Box ' + id); } };
  const motor = criarMotor({ box, fs: disco, gmail, agora });
  const runs = {}, saidas = {};
  const a = await motor(wf, { inicio: 'Trigger — fonte a processar', entrada: [{ json: { fonteId } }], parar: LEITURAS_CFG, runs, saidas });
  runs['Carregar config + perfis'] = [[{ json: { config: cfgExec(modo, limite), cobrancas, apelidos: APELIDOS, perfis: PERFIS, dominioEmpresa: 'novorealitybox.com', costs: {} } }]];
  const b = await motor(wf, { inicio, entrada, runs, saidas, parar: new Set(['Escrita N — 01 config e alvos', 'Escrita L — 01 config e alvos', ...parar]) });
  const lerJson = (k) => { const v = disco[DIR + k + sufixo + '.json']; return v ? JSON.parse(v.toString()) : null; };
  return {
    erro: a.erro || b.erro, gmail, runs, chegou: b.chegou, ordem: a.ordem.concat(b.ordem), mensagens: a.mensagens.concat(b.mensagens),
    cobrancas: lerJson('cobrancas'), log: lerJson('log_diario'),
    cobrancasGravado: disco[DIR + 'cobrancas' + sufixo + '.json'].toString() !== antes.cobrancas, logGravado: disco[DIR + 'log_diario' + sufixo + '.json'].toString() !== antes.log,
    relatorio: (b.mensagens.find((m) => m.node === 'Telegram — Relatório final') || {}).texto || null,
    relatorios: b.mensagens.filter((m) => m.node === 'Telegram — Relatório final').length,
    saida: (n) => (runs[n] ? runs[n][runs[n].length - 1].map((i) => i.json) : null),
  };
}
const aplicarChamadas = (r) => r.gmail.chamadas.filter((c) => c.op === 'message/addLabels');
const semViolacao = (cen, r) => caso(cen, 'Gmail: nenhum envio em modo rascunho (0 violações)', 0, r.gmail.violacoes.length, r.gmail.violacoes);

(async () => {
  // ======================================================================================
  console.log('\n== 1. Simulador: Gmail falso ==');
  {
    const cen = '1 gmail falso';
    const g = criarGmail({ modo: 'rascunho', marcadores: MARC_5 });
    let msg = null; try { g.chamar('X', { resource: 'message', operation: 'send', sendTo: 'a@b', subject: 's' }); } catch (e) { msg = e.message; }
    caso(cen, 'envio em modo rascunho FALHA e fica registrado como violação', [true, 1], [/ENVIO EM MODO RASCUNHO/.test(msg || ''), g.violacoes.length]);
    const d = g.chamar('X', { resource: 'draft', operation: 'create', subject: 's', options: { threadId: 't-1', sendTo: 'a@b' } });
    caso(cen, 'rascunho com threadId fica na mesma conversa', ['t-1', 'DRAFT'], [d.message.threadId, d.message.labelIds[0]]);
    let erroVazio = null; try { g.chamar('X', { resource: 'message', operation: 'addLabels', messageId: 'm1', labelIds: [] }); } catch (e) { erroVazio = e.message; }
    caso(cen, 'aplicar lista VAZIA de marcadores dá "Bad request" (como na execução 677)', true, /Bad request/.test(erroVazio || ''));
    const ga = criarGmail({ modo: 'automatico', threads: { 't-9': [{ id: 'm-9', labelIds: ['SENT'] }] } });
    const rr = ga.chamar('X', { resource: 'message', operation: 'reply', messageId: 'm-9' });
    caso(cen, 'modo automático: responder na thread registra 1 envio na mesma conversa', [1, 't-9'], [ga.envios.length, rr.threadId]);
    caso(cen, 'ler thread devolve as mensagens', 2, ga.chamar('X', { resource: 'thread', operation: 'get', threadId: 't-9' }).messages.length);
  }

  // ======================================================================================
  console.log('\n== 2. D57: nome novo do marcador do Soft Pré ==');
  {
    const cen = '2 D57';
    const arquivos = ['workflows/_fonte/fase1_solicitacao_nota.fonte.json', 'workflows/fase1_solicitacao_nota.homolog.json', 'workflows/fase1_solicitacao_nota.producao.json',
      'workflows/_fonte/fase1_despachante.fonte.json', 'workflows/fase1_despachante.homolog.json', 'workflows/fase1_despachante.producao.json', 'scripts/fase1_logica.js'];
    const comAntigo = arquivos.filter((a) => /SOFT PRE - PEDIDO NOTAS/.test(fs.readFileSync(path.join(RAIZ, a), 'utf8')));
    caso(cen, 'nenhum arquivo da Fase 1 tem o nome antigo "SOFT PRE - PEDIDO NOTAS"', [], comAntigo);
    for (const [nome, wf] of [['homolog', WF_HML], ['produção', WF_PROD]]) {
      const js = wf.nodes.filter((n) => ['Mapear marcadores', 'Montar e-mail colaborador', 'Agrupar e montar e-mail fornecedor'].includes(n.name)).map((n) => n.parameters.jsCode);
      caso(cen, nome + ': os 3 nodes usam "SOFT PRE - PEDIDO DE NOTAS"', [true, true, true], js.map((s) => s.includes("'SOFT PRE - PEDIDO DE NOTAS'")));
    }
  }

  // ======================================================================================
  console.log('\n== 3. D53 (c): marcador faltando só relata ==');
  const D53 = [
    { nome: 'os 5 existem', op: {}, ids: [idDe('IA'), idDe('SOFT PRE - PEDIDO DE NOTAS')], linhaRel: null },
    { nome: 'falta o do Soft Pré (só existe o nome antigo)', op: { marcadores: MARC_5.filter((l) => l.name !== 'SOFT PRE - PEDIDO DE NOTAS').concat([{ id: 'Label_velho', name: 'SOFT PRE - PEDIDO NOTAS' }]) }, ids: [idDe('IA')], linhaRel: 'Marcadores não encontrados no Gmail: SOFT PRE - PEDIDO DE NOTAS' },
    { nome: 'lista vazia', op: { marcadores: [] }, ids: null, linhaRel: 'Marcadores não encontrados no Gmail: IA, SOFT PRE - PEDIDO DE NOTAS' },
    { nome: 'erro na listagem', op: { falharListagem: true }, ids: null, linhaRel: 'Não consegui listar os marcadores do Gmail:' },
    { nome: 'erro no Aplicar', op: { falharAplicar: true }, ids: [idDe('IA'), idDe('SOFT PRE - PEDIDO DE NOTAS')], linhaRel: 'E-mails criados sem marcador (erro ao aplicar): 1' },
  ];
  for (const c of D53) {
    const cen = '3 D53c ' + c.nome;
    const r = await rodar({ ...c.op, inicio: 'Montar e-mail colaborador', entrada: [itemPedido(194, 'rascunho')] });
    caso(cen, 'sem erro na execução', null, r.erro);
    caso(cen, '1 rascunho criado', 1, r.gmail.rascunhos.length);
    const ap = aplicarChamadas(r);
    caso(cen, c.ids ? 'Aplicar chamado 1x com os ids encontrados' : 'Aplicar NÃO chamado (nenhum id a aplicar)', c.ids ? [1, c.ids] : [0], c.ids ? [ap.length, ap[0] && ap[0].p.labelIds] : [ap.length]);
    const e = r.cobrancas && r.cobrancas['SOFT PRE_S02_L194'];
    caso(cen, 'cobrancas gravado, com o id do RASCUNHO e o threadId', [true, r.gmail.rascunhos[0] && r.gmail.rascunhos[0].id, r.gmail.rascunhos[0] && r.gmail.rascunhos[0].threadId], [r.cobrancasGravado, e && e.draftId, e && e.threadId]);
    caso(cen, 'log gravado (1 entrada nova)', [true, 1], [r.logGravado, (r.log || []).length]);
    caso(cen, 'Relatório: 1 mensagem, "Rascunhos criados: 1"', [1, true], [r.relatorios, /Rascunhos criados: 1/.test(r.relatorio || '')]);
    if (c.linhaRel) caso(cen, 'Relatório avisa: "' + c.linhaRel + '"', true, (r.relatorio || '').includes(c.linhaRel), r.relatorio);
    else caso(cen, 'Relatório sem aviso de marcador', false, /Marcadores não encontrados|sem marcador|listar os marcadores/.test(r.relatorio || ''), r.relatorio);
    semViolacao(cen, r);
  }
  {
    const cen = '3 D53c pareamento (2 pedidos)';
    const r = await rodar({ limite: 0, inicio: 'Montar e-mail colaborador', entrada: [itemPedido(194, 'rascunho'), itemPedido(195, 'rascunho')] });
    caso(cen, 'sem erro; 2 rascunhos; Aplicar 2x', [null, 2, 2], [r.erro, r.gmail.rascunhos.length, aplicarChamadas(r).length]);
    const porAssunto = Object.fromEntries(r.gmail.rascunhos.map((d) => [/PESSOA (\d+)/.exec(d.assunto)[1], d]));
    caso(cen, 'cada linha guarda o rascunho e o threadId DELA (pareamento por índice certo)', [porAssunto['194'].id, porAssunto['194'].threadId, porAssunto['195'].id, porAssunto['195'].threadId],
      [r.cobrancas['SOFT PRE_S02_L194'].draftId, r.cobrancas['SOFT PRE_S02_L194'].threadId, r.cobrancas['SOFT PRE_S02_L195'].draftId, r.cobrancas['SOFT PRE_S02_L195'].threadId]);
    semViolacao(cen, r);
  }
  {
    const cen = '3 D53c envio pedido (automático)';
    const r = await rodar({ modo: 'automatico', inicio: 'Montar e-mail colaborador', entrada: [itemPedido(194, 'automatico')] });
    caso(cen, 'sem erro; 1 envio direto; Aplicar 1x com IA + SOFT PRE', [null, 1, 1, [idDe('IA'), idDe('SOFT PRE - PEDIDO DE NOTAS')]], [r.erro, r.gmail.envios.length, aplicarChamadas(r).length, aplicarChamadas(r)[0] && aplicarChamadas(r)[0].p.labelIds]);
    caso(cen, 'cobrancas com o threadId do envio; a coluna L foi para a cadeia de escrita (parada aqui)', [true, true], [!!(r.cobrancas['SOFT PRE_S02_L194'] && r.cobrancas['SOFT PRE_S02_L194'].threadId), !!r.chegou['Escrita L — 01 config e alvos']]);
  }

  // ======================================================================================
  console.log('\n== 4. D59: data de Brasília (o container é UTC) ==');
  const D59 = [
    { nome: '22:13 de 07/11 em Brasília (01:13Z de 08/11)', agora: '2026-11-08T01:13:55Z', ddmm: '07.11', ymd: '2026-11-07', ref: 'REF. AGO' },
    { nome: '10:00 de 07/11 em Brasília', agora: '2026-11-07T13:00:00Z', ddmm: '07.11', ymd: '2026-11-07', ref: 'REF. AGO' },
    { nome: '00:30 de 08/11 em Brasília (03:30Z)', agora: '2026-11-08T03:30:00Z', ddmm: '08.11', ymd: '2026-11-08', ref: 'REF. AGO' },
    { nome: '22:30 de 31/10 em Brasília (01:30Z de 01/11): o REF. continua AGO (o do período)', agora: '2026-11-01T01:30:00Z', ddmm: '31.10', ymd: '2026-10-31', ref: 'REF. AGO' },
  ];
  for (const c of D59) {
    const cen = '4 D59 ' + c.nome;
    const r = await rodar({ agora: c.agora, inicio: 'Montar e-mail colaborador', entrada: [itemPedido(194, 'rascunho')] });
    const assunto = (r.gmail.rascunhos[0] || {}).assunto || '';
    caso(cen, 'assunto com "(ENVIAR ATÉ ' + c.ddmm + ')"', true, assunto.includes('(ENVIAR ATÉ ' + c.ddmm + ')'), assunto.replace(/\| PESSOA.*$/, '| …'));
    caso(cen, 'D63: "' + c.ref + '" (mês do período 01/08 A 31/08, não o do envio)', true, assunto.includes(c.ref + ' (ENVIAR'), assunto.replace(/\| PESSOA.*$/, '| …'));
    caso(cen, 'cobrancas: data_ultima_cobranca = ' + c.ymd, c.ymd, r.cobrancas && r.cobrancas['SOFT PRE_S02_L194'] && r.cobrancas['SOFT PRE_S02_L194'].data_ultima_cobranca);
    caso(cen, 'log: data = ' + c.ymd + ' e o timestamp é o instante (UTC)', [c.ymd, new Date(c.agora).toISOString()], [(r.log || [])[0] && r.log[0].data, (r.log || [])[0] && r.log[0].timestamp]);
  }
  {
    const cen = '4 D59 biblioteca';
    const B = require(path.join(RAIZ, 'scripts', 'lib', 'data_brasilia.js'));
    caso(cen, 'hojeBrasilia: 01:13Z de 08/11 -> 2026-11-07; 03:00Z -> 2026-11-08; 02:59Z -> 2026-11-07', ['2026-11-07', '2026-11-08', '2026-11-07'], [B.hojeBrasilia('2026-11-08T01:13:55Z'), B.hojeBrasilia('2026-11-08T03:00:00Z'), B.hojeBrasilia('2026-11-08T02:59:59Z')]);
    const d = B.dataBrasilia('2026-11-08T01:13:55Z');
    caso(cen, 'dataBrasilia: getDate/getMonth do dia de Brasília; +5 dias', ['2026-11-07', '2026-11-12'], [B.ymdBrasilia(d), (() => { const x = new Date(d); x.setDate(x.getDate() + 5); return B.ymdBrasilia(x); })()]);
    const nos = WF_HML.nodes.filter((n) => /data_brasilia|function hojeBrasilia/.test((n.parameters && n.parameters.jsCode) || '')).map((n) => n.name).sort();
    caso(cen, 'a biblioteca está embutida nos 6 nodes que usam data', ['Agrupar e montar e-mail fornecedor', 'Avaliar cobrança', 'Capturar threadId (envio direto)', 'Capturar threadId (rascunho)', 'Consolidar mudanças e cobrancas.json', 'Montar e-mail colaborador'], nos);
    // o dia UTC de "agora" (new Date() / hoje .toISOString().slice(0,10)), fora de comentários
    const semComentario = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const sobrou = WF_HML.nodes.filter((n) => /(new Date\(\)|\bhoje)\.toISOString\(\)\.slice\(0, ?10\)/.test(semComentario((n.parameters && n.parameters.jsCode) || ''))).map((n) => n.name);
    caso(cen, 'nenhum "dia UTC de agora" (new Date()/hoje .toISOString().slice(0,10)) sobrou na Fase 1', [], sobrou);
  }

  // ======================================================================================
  console.log('\n== 4b. D63: o "REF." vem da descrição (coluna J), nunca do mês do envio ==');
  {
    const cen = '4b D63 biblioteca';
    const R = require(path.join(RAIZ, 'scripts', 'lib', 'ref_assunto.js'));
    const pal = (t) => { const w = R.lerPalavrasDescricao(t); return w.job ? 'JOB' : w.diaria ? 'DIARIA' : w.ref ? 'REF' : null; };
    caso(cen, 'palavras inteiras, sem maiúscula/acento: REF, REF., REFERENTE, JOB, DIÁRIA, diaria, DIÁRIAS', ['REF', 'REF', 'REF', 'JOB', 'DIARIA', 'DIARIA', 'DIARIA'],
      ['X - REF 01/08 A 31/08', 'X - ref. 01/08 A 31/08', 'X - Referente 01/08 A 31/08', 'X - job 01/08 A 31/08', 'X - DIÁRIA 01/08 A 01/08', 'X - diaria 01/08 A 01/08', 'X - Diárias 01/08 A 02/08'].map(pal));
    caso(cen, '"REFORÇO" e "REFERÊNCIAS" não são REF; "JOBS" não é JOB', [null, null, null], ['REFORÇO DE EQUIPE - X - 01/08 A 31/08', 'X - REFERÊNCIAS - 01/08 A 31/08', 'X - JOBS - 01/08 A 31/08'].map(pal));
    caso(cen, '"SET" sozinho (set de gravação) não é mês escrito; "REF. SET" e "SETEMBRO" são', [[], ['SET'], ['SET']],
      ['PRODUTOR DE SET - X - 01/08 A 31/08', 'X - REF. SET - 01/09 A 30/09', 'X - SETEMBRO - 01/09 A 30/09'].map((t) => R.lerPalavrasDescricao(t).mesesEscritos));
    caso(cen, 'período invertido vira cronológico; virada de ano 26/12 A 05/01 atravessa meses', ['26/07 A 05/08', ['DEZ', 'JAN']],
      [R.lerPeriodoDescricao('X - 05/08 A 26/07').texto, R.lerPeriodoDescricao('X - 26/12 A 05/01').meses]);
    caso(cen, 'período ilegível: sem período, data só, 32/08, mês 13, dois períodos', [null, null, null, null, null],
      ['X - PARCELA 1/3', 'X - 29/09', 'X - 32/08 A 31/08', 'X - 01/13 A 31/13', 'X - 01/08 A 10/08 E 20/08 A 31/08'].map((t) => R.lerPeriodoDescricao(t)));
    const ref = (j, tipo, extra = {}) => { const d = R.decidirRefAssunto([{ descricao: j, tipoEmissaoIA: tipo || 'NF_NORMAL', linha: 1, ...extra }], null); return d.ok ? d.ref : 'CONFERIR'; };
    caso(cen, 'IA e descrição discordando -> conferir (IA diz JOB sem a palavra; IA diz NF com JOB escrito)', ['CONFERIR', 'CONFERIR'], [ref('X - 01/08 A 31/08', 'JOB'), ref('X - 01/08 A 31/08 (JOB)', 'NF_NORMAL')]);
    caso(cen, 'período da IA diferente do da descrição -> conferir', 'CONFERIR', ref('X - 01/08 A 31/08', 'NF_NORMAL', { periodoIA: '01/09 A 30/09' }));
    caso(cen, '"REF. JOB" escrito é JOB (não REF de mês); JOB e DIÁRIA juntos -> conferir', ['REF. JOB', 'CONFERIR'], [ref('X - 25/08 A 27/08 REF. JOB', 'JOB'), ref('X - JOB DIÁRIA 25/08 A 27/08', 'JOB')]);
    caso(cen, 'PACOTE escrito continua "REF. PACOTE" (como antes)', 'REF. PACOTE', ref('X - PACOTE 01/08 A 05/08', 'PACOTE'));
    const dois = R.decidirRefAssunto([{ descricao: 'X - 27/07 A 31/07', linha: 1 }, { descricao: 'X - 01/08 A 31/08', linha: 2 }], null);
    caso(cen, '2 blocos (mesmo colaborador e vencimento), cada um num mês: "REF. JUL E AGO" (spec 3.2)', 'REF. JUL E AGO', dois.ref);
    const vira = R.decidirRefAssunto([{ descricao: 'X - 01/12 A 31/12', linha: 1 }, { descricao: 'X - 01/01 A 31/01', linha: 2 }], null);
    caso(cen, '2 blocos DEZ + JAN: ordem de aparição, não "JAN E DEZ" (spec 3.2.1)', 'REF. DEZ E JAN', vira.ref);
    const mist = R.decidirRefAssunto([{ descricao: 'X - 01/08 A 31/08', linha: 1 }, { descricao: 'X - 20/08 A 10/09', linha: 2 }], null);
    caso(cen, '2 blocos, um deles atravessando meses sem palavra: o e-mail inteiro vai para conferir', [false, ['L2']], [mist.ok, mist.motivos.map((m) => m.slice(0, 2))]);
    const antigo = (d) => ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'][d.getMonth()];
    caso(cen, '9b (L194, período 01/08 A 31/08, sem palavra): a regra antiga (mês do envio, 08/11) dava NOV; a nova dá AGO', ['NOV', 'REF. AGO'],
      [antigo(new Date('2026-11-08T12:00:00Z')), ref('CARGO - [nome] - 01/08 A 31/08 (VALOR 8K/MÊS)')]);
  }
  {
    // No workflow gerado: a descrição entra pela coluna J; o período e o tipo "da IA" vêm junto.
    const itemRef = (linha, colunaJ, periodo, tipoEmissao = 'NF_NORMAL', extra = {}) => {
      const it = itemPedido(linha, 'rascunho');
      it.json.nota.colunaJ = colunaJ; it.json.periodo = periodo; it.json.tipoEmissao = tipoEmissao;
      Object.assign(it.json, extra);
      return it;
    };
    const D63 = [
      { nome: 'período 01/11 A 30/11 sem palavra, enviado em 08/12', agora: '2026-12-08T13:00:00Z', j: 'CARGO - PESSOA 194 - 01/11 A 30/11', p: '01/11 A 30/11', ref: 'REF. NOV', ate: '08.12' },
      { nome: 'período de agosto, enviado em 07/11', agora: '2026-11-07T13:00:00Z', j: 'CARGO - PESSOA 194 - 01/08 A 31/08', p: '01/08 A 31/08', ref: 'REF. AGO', ate: '07.11' },
      { nome: 'virada de ano: período de dezembro, enviado em janeiro', agora: '2027-01-08T13:00:00Z', j: 'CARGO - PESSOA 194 - 01/12 A 31/12', p: '01/12 A 31/12', ref: 'REF. DEZ', ate: '08.01' },
      { nome: '"JOB" explícito com período de um mês', agora: '2026-11-07T13:00:00Z', j: 'CARGO - PESSOA 194 - 01/08 A 30/08 (JOB)', p: '01/08 A 30/08', t: 'JOB', ref: 'REF. JOB', ate: '07.11' },
      { nome: '"REF" explícito com período de um mês', agora: '2026-11-07T13:00:00Z', j: 'CARGO - PESSOA 194 - REF. 01/08 A 31/08', p: '01/08 A 31/08', ref: 'REF. AGO', ate: '07.11' },
      { nome: '"REFORÇO" não conta como REF (sai o mês do período)', agora: '2026-11-07T13:00:00Z', j: 'REFORÇO DE PRODUÇÃO - PESSOA 194 - 01/08 A 31/08', p: '01/08 A 31/08', ref: 'REF. AGO', ate: '07.11' },
      { nome: 'sem palavra e período 20/08 A 10/09 (spec diz "REF. AGO E SET"; Claudio diz nunca REF)', agora: '2026-11-07T13:00:00Z', j: 'CARGO - PESSOA 194 - 20/08 A 10/09', p: '20/08 A 10/09', conferir: /atravessa meses/ },
      { nome: '"REF" com período que atravessa meses', agora: '2026-11-07T13:00:00Z', j: 'CARGO - PESSOA 194 - REF 20/08 A 10/09', p: '20/08 A 10/09', conferir: /REF com período que atravessa meses/ },
      { nome: 'mês escrito que não bate com as datas', agora: '2026-11-07T13:00:00Z', j: 'CARGO - PESSOA 194 - REF. SETEMBRO - 01/08 A 31/08', p: '01/08 A 31/08', conferir: /não bate/ },
      { nome: 'período ilegível', agora: '2026-11-07T13:00:00Z', j: 'CARGO - PESSOA 194 - 080/08 A 31/08', p: null, conferir: /ilegível/ },
    ];
    for (const c of D63) {
      const cen = '4b D63 ' + c.nome;
      const r = await rodar({ agora: c.agora, inicio: 'Montar e-mail colaborador', entrada: [itemRef(194, c.j, c.p, c.t || 'NF_NORMAL')] });
      caso(cen, 'sem erro na execução', null, r.erro);
      semViolacao(cen, r);
      if (!c.conferir) {
        const assunto = (r.gmail.rascunhos[0] || {}).assunto || '';
        caso(cen, '1 rascunho com "' + c.ref + ' (ENVIAR ATÉ ' + c.ate + ')" (o ENVIAR ATÉ não muda com a D63)', [1, true], [r.gmail.rascunhos.length, assunto.includes(c.ref + ' (ENVIAR ATÉ ' + c.ate + ')')], assunto.replace(/\| PESSOA.*$/, '| …'));
        caso(cen, 'Relatório sem linha de "conferir à mão"', false, /conferir à mão o REF/.test(r.relatorio || ''));
      } else {
        caso(cen, 'NENHUM rascunho criado e o cobrancas não ganha entrada', [0, undefined], [r.gmail.rascunhos.length, r.cobrancas && r.cobrancas['SOFT PRE_S02_L194']]);
        caso(cen, 'Relatório: "Sem rascunho, conferir à mão o REF. do assunto: L194: …" com o motivo', [true, true],
          [/Sem rascunho, conferir à mão o REF\. do assunto: L194: /.test(r.relatorio || ''), c.conferir.test(r.relatorio || '')], r.relatorio);
        caso(cen, 'Relatório: "Rascunhos criados: 0" e 1 mensagem só', [true, 1], [/Rascunhos criados: 0/.test(r.relatorio || ''), r.relatorios]);
      }
    }
    {
      const cen = '4b D63 dois blocos no mesmo e-mail';
      const extra = { nomeColaborador: 'PESSOA DUPLA' };
      const r = await rodar({ limite: 0, agora: '2026-11-07T13:00:00Z', inicio: 'Montar e-mail colaborador', entrada: [itemRef(194, 'CARGO - PESSOA DUPLA - 27/07 A 31/07', '27/07 A 31/07', 'NF_NORMAL', extra), itemRef(195, 'CARGO - PESSOA DUPLA - 01/08 A 31/08', '01/08 A 31/08', 'NF_NORMAL', extra)] });
      const assunto = (r.gmail.rascunhos[0] || {}).assunto || '';
      caso(cen, '1 rascunho só, com "REF. JUL E AGO"', [null, 1, true], [r.erro, r.gmail.rascunhos.length, assunto.includes('REF. JUL E AGO (ENVIAR ATÉ 07.11)')], assunto.replace(/\| PESSOA.*$/, '| …'));
    }
    {
      const cen = '4b D63 conferir à mão no gerado de produção';
      const it = itemRef(194, 'CARGO - PESSOA 194 - 20/08 A 10/09', '20/08 A 10/09');
      it.json.config = { ...it.json.config, ambiente: 'producao' };
      const r = await rodar({ wf: WF_PROD, sufixo: '', fonteId: 'S02', agora: '2026-11-07T13:00:00Z', inicio: 'Montar e-mail colaborador', entrada: [it] });
      caso(cen, 'produção faz o mesmo: 0 rascunhos e a linha no Relatório', [null, 0, true], [r.erro, r.gmail.rascunhos.length, /conferir à mão o REF\. do assunto: L194/.test(r.relatorio || '')]);
    }
  }

  // ======================================================================================
  console.log('\n== 5. D41: SOLICITADA MI sem entrada no cobrancas só relata ==');
  {
    const cen = '5 D41';
    // vencimento 12/11: o fim do ciclo (vencimento - 5) já passou em 08/11 -> hoje a linha seria "encerrada"
    const venc = { colunaG: 'Thu Nov 12 2026 00:00:00 GMT+0000 (Coordinated Universal Time)' };
    const comEntrada = { 'SOFT PRE_S02_L198': { threadId: 't-198', draftId: 'r-198', data_ultima_cobranca: '2026-10-20', contagem_cobrancas: 1, status_ciclo: 'em_andamento' } };
    const r = await rodar({ limite: 0, cobrancas: comEntrada, agora: '2026-11-08T12:00:00Z', inicio: 'Filtrar por Status Box (novo pedido / monitoramento)',
      entrada: [itemFiltro(132, 'SOLICITADA MI', 'rascunho', comEntrada, venc), itemFiltro(198, 'SOLICITADA MI', 'rascunho', comEntrada, venc)] });
    caso(cen, 'sem erro', null, r.erro);
    const av = Object.fromEntries((r.saida('Avaliar cobrança') || []).map((d) => [d.nota.linha, d.acao]));
    caso(cen, 'L132 (sem entrada) -> monitoramento_sem_pedido; L198 (com entrada) -> encerrar_sem_resposta', { 132: 'monitoramento_sem_pedido', 198: 'encerrar_sem_resposta' }, av);
    caso(cen, 'cobrancas: a L132 NÃO foi gravada; a L198 virou encerrado_sem_resposta', [false, 'encerrado_sem_resposta'], ['SOFT PRE_S02_L132' in (r.cobrancas || {}), r.cobrancas && r.cobrancas['SOFT PRE_S02_L198'] && r.cobrancas['SOFT PRE_S02_L198'].status_ciclo]);
    caso(cen, 'nenhum rascunho, nenhum envio, nenhum marcador', [0, 0, 0], [r.gmail.rascunhos.length, r.gmail.envios.length, aplicarChamadas(r).length]);
    caso(cen, 'Relatório: "Linhas SOLICITADA MI sem pedido registrado (conferir à mão): L132" e 1 ciclo encerrado', [true, true], [(r.relatorio || '').includes('Linhas SOLICITADA MI sem pedido registrado (conferir à mão): L132'), /Ciclos encerrados sem resposta: 1/.test(r.relatorio || '')], r.relatorio);
    semViolacao(cen, r);
  }

  // ======================================================================================
  console.log('\n== 6. D17 (PENDENTE nesta rodada): em modo rascunho a cobrança não envia ==');
  {
    const cen = '6 D17 pendente';
    // cobrança devida: contagem 1, última há 6 dias, vencimento longe
    const est = { 'SOFT PRE_S02_L114': { threadId: 't-114', draftId: 'r-114', data_ultima_cobranca: '2026-11-01', contagem_cobrancas: 1, status_ciclo: 'em_andamento' } };
    const r = await rodar({ limite: 0, cobrancas: est, agora: '2026-11-07T15:00:00Z', inicio: 'Filtrar por Status Box (novo pedido / monitoramento)', entrada: [itemFiltro(114, 'SOLICITADA MI', 'rascunho', est)] });
    caso(cen, 'Avaliar cobrança decide "cobrar_rascunho"', 'cobrar_rascunho', ((r.saida('Avaliar cobrança') || [])[0] || {}).acao);
    caso(cen, 'nenhum envio (o node atual "responde" e falha antes: D17 continua pendente)', [0, true], [r.gmail.envios.length, /Cobrança \(rascunho, responde Todos\)/.test(r.erro || '')], r.erro);
  }

  // ======================================================================================
  console.log('\n== 7. D40: Relatório também com 0 candidatas ==');
  {
    const cen = '7 D40 S01 sem candidatas';
    const r = await rodar({ fonteId: 'S01', inicio: 'Filtrar por Status Box (novo pedido / monitoramento)', entrada: [itemFiltro(10, 'ENTREGUE MI', 'rascunho', {}), itemFiltro(11, 'RECEBIDA MI', 'rascunho', {})] });
    caso(cen, 'sem erro; 1 Relatório com "0 candidatas nesta passada (S01)"', [null, 1, true], [r.erro, r.relatorios, (r.relatorio || '').includes('0 candidatas nesta passada (S01)')], r.relatorio);
    caso(cen, '0 gravações: cobrancas e log intactos; caminho normal não rodou', [false, false, false, false], [r.cobrancasGravado, r.logGravado, r.ordem.includes('Aplicar limite de execução (modo assistido)'), r.ordem.includes('Consolidar mudanças e cobrancas.json')]);
    caso(cen, 'nenhuma chamada de Gmail além da listagem de marcadores', ['label/getAll'], r.gmail.chamadas.map((c) => c.op));
  }
  {
    const cen = '7 D40 S02 com candidatas';
    const r = await rodar({ limite: 0, cobrancas: {}, inicio: 'Filtrar por Status Box (novo pedido / monitoramento)', entrada: [itemFiltro(132, 'SOLICITADA MI', 'rascunho', {})] });
    caso(cen, 'segue o caminho normal: 1 Relatório, SEM a linha de 0 candidatas; log gravado', [null, 1, false, true], [r.erro, r.relatorios, (r.relatorio || '').includes('0 candidatas'), r.logGravado], r.relatorio);
    caso(cen, 'o caminho normal rodou uma vez só', [1, 1], [r.ordem.filter((n) => n === 'Aplicar limite de execução (modo assistido)').length, r.ordem.filter((n) => n === 'Consolidar mudanças e cobrancas.json').length]);
  }
  {
    const cen = '7 D40 produção';
    const r = await rodar({ wf: WF_PROD, sufixo: '', fonteId: 'S01', inicio: 'Filtrar por Status Box (novo pedido / monitoramento)', entrada: [itemFiltro(10, 'ENTREGUE MI', 'rascunho', {})] });
    caso(cen, 'o gerado de produção faz o mesmo (1 Relatório de 0 candidatas, 0 gravações)', [null, 1, false, false], [r.erro, r.relatorios, r.cobrancasGravado, r.logGravado]);
  }

  // ======================================================================================
  console.log('\n== 8. Em modo rascunho NUNCA há envio, em nenhum caminho testado ==');
  {
    const cen = '8 nunca envia';
    const est = { 'SOFT PRE_S02_L114': { threadId: 't-114', data_ultima_cobranca: '2026-11-01', contagem_cobrancas: 1, status_ciclo: 'em_andamento' } };
    const r = await rodar({ limite: 0, cobrancas: est, inicio: 'Montar e-mail colaborador', entrada: [itemPedido(194, 'rascunho', est), itemPedido(195, 'rascunho', est)] });
    caso(cen, 'pedidos em modo rascunho: 0 envios e 0 violações', [0, 0], [r.gmail.envios.length, r.gmail.violacoes.length]);
  }

  const falhas = casos.filter((c) => !c.ok);
  const arq = path.join(SAIDA, 'zz-temp-gmail-cobranca-resultado.json');
  fs.writeFileSync(arq, JSON.stringify({ total: casos.length, falhas: falhas.length, casos }, null, 2));
  console.log('\nTOTAL: ' + casos.length + ' casos, ' + falhas.length + ' falha(s). Resultado em ' + path.relative(RAIZ, arq));
  process.exitCode = falhas.length ? 1 : 0;
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exitCode = 2; });
