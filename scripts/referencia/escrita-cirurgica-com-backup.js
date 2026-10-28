#!/usr/bin/env node
// Nome original: zz-temp-escrita.js
// Data: 28/10/2026
// referência provada em 21–22/10/2026 (backup verificado, Passo 0, lock/If-Match/unlock, comparação completa); reaproveitar na Fase 1
/**
 * ZZ-TEMP — ESCRITA do arquivamento por função, Etapa 1 (Reunion + Soft Pré), 19/10/2026.
 *
 * SÓ RODAR DEPOIS DE APROVAR O RELATÓRIO DA SIMULAÇÃO (zz-temp-simulacao-2026-10-19.md).
 *
 * Como o de leitura, este script não toca no Drive. Ele monta, cria e apaga, via API do n8n,
 * um workflow descartável disparado por Manual Trigger (sem webhook) que VOCÊ executa no
 * editor. Lê o plano zz-temp-plano-2026-10-19.json e se recusa a rodar se o plano não estiver
 * "completo" (sem bloqueios).
 *
 * O que o workflow PODE fazer (conferido por uma trava no próprio script antes de criar):
 *   - GET no Drive (credencial Google Drive - Produção, id KdhgMKe2jDDKAhNa);
 *   - POST https://www.googleapis.com/drive/v3/files  -> SÓ criar pasta de função, com
 *     mimeType de pasta, dentro da pasta de destino confirmada do projeto;
 *   - POST https://www.googleapis.com/drive/v3/files/{id}/copy -> copiar a nota;
 *   - gravar em disco SÓ nestes arquivos (pasta /home/node/.n8n-files/box-fish-config/):
 *       arquivamento_registro_2026-10-19.json e .csv  (registro durável, só de adição)
 *       zz-temp-escrita-resultado-<lote>-2026-10-19.json
 *       zz-temp-escrita-ocorrencia-<data-hora>.json  (só se algo der errado)
 * O que NÃO tem: PATCH/PUT/DELETE, mover, renomear, apagar, Box, planilha, Gmail, Telegram,
 * webhook, errorWorkflow.
 * SALVA a execução (mesmo caminho da leitura, autorizado em 20/10): o modo "ler" lê o resultado
 * pela API e o modo "apagar" apaga a(s) execução(ões) e o workflow. Respostas compactas (sem
 * cabeçalho HTTP, só os campos usados).
 *
 * Pastas NOVAS: só são criadas as que estão em PASTAS_NOVAS_APROVADAS (nome exato, aprovado pelo
 * Claudio). Nota cujo destino é pasta nova fora dessa lista fica fora do lote, com aviso.
 *
 * Fluxo do workflow:
 *   1. Confere a identidade da credencial (about = financeiro1). Se não bater, para.
 *   2. Lê o registro em disco. Notas do lote que já estão nele são puladas.
 *   3. UMA NOTA POR VEZ (Loop com lote de 1), parando no PRIMEIRO problema:
 *      a. relista as pastas de função do destino e acha a do código (col. B). Se o estado
 *         mudou desde a simulação (pasta sumiu, apareceu outra com o mesmo código), PARA;
 *      b. cria a pasta "<código> - <FUNÇÃO>" só se ela não existir e o plano mandar criar;
 *      c. relista a pasta alvo e procura o mesmo nome no Drive todo. Se já existe na pasta
 *         alvo (mesmo nome ou MD5) -> JÁ EXISTIA, não copia. Se aparece em OUTRA pasta de
 *         função -> PARA;
 *      d. copia, relê a cópia e confere nome, MD5 e pasta. Divergência -> grava ocorrência
 *         e PARA (a cópia divergente NÃO é apagada; fica para você decidir);
 *      e. acrescenta a linha no registro (JSON + CSV). Antes, confere que o registro em disco
 *         tem exatamente as linhas esperadas; se não tiver, PARA sem gravar.
 *   4. No fim, relê o registro e grava o arquivo de resultado do lote.
 *
 * Uso:
 *   node zz-temp-escrita.js gerar piloto   # grava zz-temp-escrita.workflow.json (sem rede)
 *   node zz-temp-escrita.js criar piloto   # cria INATIVO no n8n: 3 notas
 *   node zz-temp-escrita.js gerar resto
 *   node zz-temp-escrita.js criar resto        # as demais CÓPIAS
 *   node zz-temp-escrita.js criar existentes   # só registra as JÁ EXISTIA (nada é copiado)
 *   node zz-temp-escrita.js ler                # lê a execução salva pela API (resultado compacto)
 *   node zz-temp-escrita.js apagar             # apaga execução(ões) e workflow, e confere
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { carregarEnv, N8nApi } = require('./scripts/lib/n8n_api.js');

const ARQ_PLANO = path.join(__dirname, 'zz-temp-plano-2026-10-19.json');
const ARQ_WF = path.join(__dirname, 'zz-temp-escrita.workflow.json');
const ARQ_ESTADO = path.join(__dirname, 'zz-temp-escrita.estado.json');
// Nomes EXATOS de pastas novas aprovados pelo Claudio (21/10).
const PASTAS_NOVAS_APROVADAS = [
  '3629.R - TAXI - REUNION',
  '3002.R - ELÉTRICA INFRA - REUNION',
  '1420.S - PRODUTOR DE ELENCO',
  '3193.7.R - INGEST_04x Macbook',
];
// Nome que vem do Cost (col. B + col. C) -> nome aprovado para criar. Decidido em 21/10: o "|"
// vira "_", sem espaços em volta.
const NOME_PASTA_APROVADO = {
  '3193.7.R - INGEST | 04x Macbook': '3193.7.R - INGEST_04x Macbook',
};
// Piloto aprovado em 21/10: exatamente estas 3 notas, nesta ordem (alterna Reunion / Soft Pré).
const PILOTO_ORIGENS = [
  '20.10_BR_SMTC_REUNION_S01_GAMBOA AGENCIA DE VIAGENS E TURISMO LTDA_FATURA_#001427.pdf',
  '20.09_BR_SMTC_SOFT PRE_S02_TELEVIZOL PRODUCOES ARTÍSTICAS LTDA_#000049.pdf',
  '05.10_BR_SMTC_REUNION_S01_ALTNET SERVIÇOS DE INFORMÁTICA E TECNOLOGIA LTDA_#09344.pdf',
];

const CRED_DRIVE = { googleDriveOAuth2Api: { id: 'KdhgMKe2jDDKAhNa', name: 'Google Drive - Produção (financeiro1@novorealitybox.com)' } };
const DIR = '/home/node/.n8n-files/box-fish-config/';
const ARQ = {
  registroJson: DIR + 'arquivamento_registro_2026-10-19.json',
  registroCsv: DIR + 'arquivamento_registro_2026-10-19.csv',
  resultado: (lote) => DIR + 'zz-temp-escrita-resultado-' + lote + '-2026-10-19.json',
  ocorrenciaPrefixo: DIR + 'zz-temp-escrita-ocorrencia-',
};
const API = 'https://www.googleapis.com/drive/v3';

// ---------------------------------------------------------------------------------------
// Plano -> itens do lote
// ---------------------------------------------------------------------------------------
function itensDoLote(plano, lote) {
  if (!plano.completo) throw new Error('o plano NÃO está completo (bloqueios: ' + (plano.bloqueios || []).join(' | ') + '). Nada gerado.');
  const porProjeto = {};
  const aguardando = [];
  for (const [pid, pp] of Object.entries(plano.projetos)) {
    const comum = (x) => ({
      projetoId: pid, projeto: x.projeto, mes: x.mes, fonte: x.fonte, linha: x.linha, codigo: x.codigo, funcao: x.funcao,
      origem: { id: x.origem.id, nome: x.origem.nome, md5: x.origem.md5 },
      destinoRaizId: pp.destinoRaizId,
    });
    porProjeto[pid] = {
      copias: pp.copias.map((x) => (x.destino.criar && NOME_PASTA_APROVADO[x.destino.pastaNome]
        ? { ...x, destino: { ...x.destino, pastaNome: NOME_PASTA_APROVADO[x.destino.pastaNome], nomeNoCost: x.destino.pastaNome } }
        : x)).filter((x) => {
        if (!x.destino.criar || PASTAS_NOVAS_APROVADAS.includes(x.destino.pastaNome)) return true;
        aguardando.push(x.origem.nome + ' -> pasta nova "' + x.destino.pastaNome + '" (nome ainda não aprovado)');
        return false;
      }).map((x) => ({ ...comum(x), tipo: 'copiar', destino: x.destino })),
      // JÁ EXISTIA fora da pasta esperada fica de fora: é ponto de atenção, não registro.
      existentes: pp.jaExistiam.filter((x) => x.naPastaCerta).map((x) => {
        const e = x.existente.find((y) => y.id === x.idNoDestino);
        return { ...comum(x), tipo: 'existe', destino: { pastaId: e.pastaId, pastaNome: x.destino.pastaNome, criar: false }, existente: { id: e.id, nome: e.nome, md5: e.md5 } };
      }),
    };
  }
  for (const a of aguardando) console.log('  FORA DO LOTE, aguardando aprovação: ' + a);
  if (lote === 'piloto') {
    // Exatamente as 3 notas aprovadas, na ordem aprovada. Se alguma não estiver no lote, para.
    const todas = Object.values(porProjeto).flatMap((x) => x.copias);
    return PILOTO_ORIGENS.map((nome) => {
      const achadas = todas.filter((x) => x.origem.nome === nome);
      if (achadas.length !== 1) throw new Error('piloto: "' + nome + '" aparece ' + achadas.length + ' vez(es) nas cópias do plano (esperado 1). Nada gerado.');
      return achadas[0];
    });
  }
  // "resto" = as cópias; as do piloto que já estiverem no registro são puladas pelo workflow.
  if (lote === 'resto') return Object.values(porProjeto).flatMap((x) => x.copias);
  // "existentes" = só registrar as JÁ EXISTIA (separado, para a execução salva não ficar grande).
  if (lote === 'existentes') return Object.values(porProjeto).flatMap((x) => x.existentes);
  throw new Error('lote deve ser "piloto", "resto" ou "existentes"');
}

// ---------------------------------------------------------------------------------------
// Fábricas de node
// ---------------------------------------------------------------------------------------
let posX = 0;
const pos = () => { posX += 220; return [posX, 0]; };
const code = (name, js) => ({ id: crypto.randomUUID(), name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(), parameters: { jsCode: js } });
function http(name, method, url, jsonQuery, jsonBody) {
  const parameters = {
    method, url, authentication: 'predefinedCredentialType', nodeCredentialType: 'googleDriveOAuth2Api',
    sendQuery: true, specifyQuery: 'json', jsonQuery,
    // Compacto: sem cabeçalhos HTTP. O status sai do corpo de erro do Drive ({ error: { code } }).
    options: { response: { response: { neverError: true, responseFormat: 'json' } } },
  };
  if (jsonBody) Object.assign(parameters, { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody });
  return { id: crypto.randomUUID(), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos(), parameters, credentials: CRED_DRIVE };
}
const ler = (name, arquivo) => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.readWriteFile', typeVersion: 1, position: pos(), alwaysOutputData: true,
  parameters: { operation: 'read', fileSelector: arquivo, options: {} },
});
const gravar = (name, arquivo, prop) => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.readWriteFile', typeVersion: 1, position: pos(),
  parameters: { operation: 'write', fileName: arquivo, dataPropertyName: prop },
});
const se = (name, expr) => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.if', typeVersion: 2, position: pos(),
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr, rightValue: true, operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' } },
});

// ---------------------------------------------------------------------------------------
// Código dos nodes
// ---------------------------------------------------------------------------------------
const COMUM = String.raw`
const API = '${API}';
const PASTA = 'application/vnd.google-apps.folder';
const ESPERADO = 'financeiro1@novorealitybox.com';
function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
function codigoNorm(s) { return norm(s).replace(/\s+/g, ''); }
function codigoDaPasta(nome) { const m = String(nome).match(/^\s*([0-9]+(?:\.[0-9A-Za-z]+)*)\s*-\s*(.*)$/); return m ? { codigo: codigoNorm(m[1]), funcao: m[2] } : null; }
function status(it) { const j = it && it.json; if (!j) return undefined; if (j.error && typeof j.error === 'object') return j.error.code || 500; return 200; }
function corpo(it) { return status(it) === 200 ? it.json : ((it && it.json) || {}); }
function aspas(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function filhos(id, soPastas) {
  return { url: API + '/files', qs: { q: "'" + id + "' in parents and trashed = false" + (soPastas ? " and mimeType = '" + PASTA + "'" : ''), corpora: 'allDrives', includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 1000, fields: 'nextPageToken,files(id,name,md5Checksum,parents)' } };
}
function exigirLista(it, oQue) {
  if (status(it) !== 200) throw new Error(oQue + ': HTTP ' + status(it) + ' ' + JSON.stringify(corpo(it)).slice(0, 300));
  if (corpo(it).nextPageToken) throw new Error(oQue + ': listagem truncada (mais de 1000 itens)');
  return corpo(it).files || [];
}
async function lerJsonDoInput() {
  const it = $input.first();
  const b = it && it.binary && it.binary.data;
  if (!b) return null; // arquivo não existe
  const buf = b.id ? await this_helpers.getBinaryDataBuffer(0, 'data') : Buffer.from(b.data, 'base64');
  return JSON.parse(buf.toString('utf8'));
}
function binJson(obj, nome) { return { data: Buffer.from(JSON.stringify(obj, null, 2)).toString('base64'), mimeType: 'application/json', fileName: nome }; }
`;

// Só para os nodes de DENTRO do loop.
const LOOP = String.raw`
// Garante que o contexto lido de outro node é desta iteração do loop, não de uma anterior.
function ctxDe(nome) {
  const c = $(nome).first().json;
  const atual = $('Uma nota por vez').first().json.i;
  if (c.i !== atual) throw new Error('contexto fora de sincronia: "' + nome + '" está na nota ' + c.i + ', o loop na ' + atual);
  return c;
}
`;

function jsPlano(lote, itens) {
  return COMUM + String.raw`
const LOTE = ${JSON.stringify(lote)};
const ITENS = ${JSON.stringify(itens)};
return [{ json: { lote: LOTE, itens: ITENS, url: API + '/about', qs: { fields: 'user(emailAddress)' } } }];
`;
}

const JS_CONFERIR = String.raw`const this_helpers = this.helpers;
` + COMUM + String.raw`
const about = $('Drive — identidade (about)').first();
const email = (corpo(about).user || {}).emailAddress;
if (status(about) !== 200 || email !== ESPERADO) throw new Error('IDENTIDADE: a credencial do Drive é ' + email + ' (HTTP ' + status(about) + '), esperado ' + ESPERADO + '. Nada foi escrito.');
const registro = (await lerJsonDoInput()) || [];
if (!Array.isArray(registro)) throw new Error('o registro em disco não é uma lista. Nada foi escrito.');
const { lote, itens } = $('Plano do lote').first().json;
const execucao = 'ZZ-' + lote + '-' + new Date().toISOString();
const chave = (projetoId, origemId) => projetoId + '|' + origemId;
const jaRegistrados = new Set(registro.filter((e) => e.status === 'COPIADO' || e.status === 'JÁ EXISTIA').map((e) => chave(e.projetoId, e.origemId)));
const pulados = itens.filter((x) => jaRegistrados.has(chave(x.projetoId, x.origem.id)));
const fila = itens.filter((x) => !jaRegistrados.has(chave(x.projetoId, x.origem.id)));
if (!fila.length) throw new Error('nada a fazer: as ' + itens.length + ' notas do lote "' + lote + '" já estão no registro.');
return fila.map((x, i) => ({ json: { ...x, i, total: fila.length, lote, execucao, registroInicial: registro.length, puladosNoInicio: pulados.length } }));
`;

const JS_CONTEXTO = COMUM + String.raw`
const c = $input.first().json;
const f = filhos(c.destinoRaizId, true);
f.qs.fields = 'nextPageToken,files(id,name,parents)';
return [{ json: { ...c, ...f } }];
`;

const JS_DECIDIR_PASTA = COMUM + LOOP + String.raw`
const c = ctxDe('Contexto da nota');
const pastas = exigirLista($input.first(), 'listar pastas de função do destino');
if (pastas.some((f) => !(f.parents || []).includes(c.destinoRaizId))) throw new Error('resposta de listagem não é da pasta de destino desta nota (' + c.destinoRaizId + ')');
const cod = codigoNorm(c.codigo);
let mesmas = pastas.filter((f) => { const p = codigoDaPasta(f.name); return p && p.codigo === cod; });
if (mesmas.length > 1) {
  const pelaFuncao = mesmas.filter((f) => norm(codigoDaPasta(f.name).funcao) === norm(c.funcao));
  if (pelaFuncao.length !== 1) throw new Error('COLISÃO: ' + mesmas.length + ' pastas com o código ' + c.codigo + ' (' + mesmas.map((f) => f.name).join(' | ') + '). Parei em ' + c.origem.nome);
  mesmas = pelaFuncao;
}
const achada = mesmas[0] || null;
let pastaId = null;
let precisaCriar = false;
if (c.tipo === 'existe') {
  if (!achada || achada.id !== c.destino.pastaId) throw new Error('ESTADO MUDOU: a pasta de "' + c.origem.nome + '" (JÁ EXISTIA) não é mais a da simulação. Rode a simulação de novo.');
  pastaId = achada.id;
} else if (c.destino.criar) {
  if (achada) {
    if (achada.name !== c.destino.pastaNome) throw new Error('ESTADO MUDOU: já existe "' + achada.name + '" para o código ' + c.codigo + ', e o plano ia criar "' + c.destino.pastaNome + '".');
    pastaId = achada.id; // criada numa nota anterior deste mesmo lote
  } else precisaCriar = true;
} else {
  if (!achada || achada.id !== c.destino.pastaId) throw new Error('ESTADO MUDOU: a pasta "' + c.destino.pastaNome + '" (' + c.destino.pastaId + ') não é mais a única do código ' + c.codigo + '.');
  pastaId = achada.id;
}
return [{ json: { ...c, pastaId, precisaCriar, pastaCriada: false,
  criar: { url: API + '/files', qs: { supportsAllDrives: true, fields: 'id,name,mimeType,parents' }, corpo: { name: c.destino.pastaNome, mimeType: PASTA, parents: [c.destinoRaizId] } } } }];
`;

const JS_PASTA_CRIADA = COMUM + LOOP + String.raw`
const c = ctxDe('Decidir pasta');
const r = $input.first();
const b = corpo(r);
if (status(r) !== 200 || b.mimeType !== PASTA || b.name !== c.destino.pastaNome || !(b.parents || []).includes(c.destinoRaizId)) {
  throw new Error('FALHA AO CRIAR PASTA "' + c.destino.pastaNome + '": HTTP ' + status(r) + ' ' + JSON.stringify(b).slice(0, 300));
}
return [{ json: { ...c, pastaId: b.id, pastaCriada: true } }];
`;

const JS_PREP_ALVO = COMUM + String.raw`
const c = $input.first().json;
if (c.i !== $('Uma nota por vez').first().json.i) throw new Error('contexto fora de sincronia antes de listar a pasta alvo');
return [{ json: { ...c, ...filhos(c.pastaId, false),
  busca: { url: API + '/files', qs: { q: "name = '" + aspas(c.origem.nome) + "' and trashed = false", corpora: 'allDrives', includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 100, fields: 'files(id,name,md5Checksum,parents)' } } } }];
`;

const JS_DECIDIR_COPIA = COMUM + LOOP + String.raw`
const c = ctxDe('Preparar pasta alvo');
const naPasta = exigirLista($('Listar pasta alvo').first(), 'listar pasta alvo');
if (naPasta.some((f) => !(f.parents || []).includes(c.pastaId))) throw new Error('resposta de listagem não é da pasta alvo desta nota (' + c.pastaId + ')');
const r = $input.first();
if (status(r) !== 200) throw new Error('busca por nome: HTTP ' + status(r));
const iguais = naPasta.filter((f) => f.name.normalize('NFC') === c.origem.nome.normalize('NFC') || (f.md5Checksum && f.md5Checksum === c.origem.md5));
// Pastas de função desta iteração (o node de listagem roda uma vez por nota) + a criada agora.
const listaFuncao = exigirLista($('Listar pastas de função').first(), 'pastas de função (rever)');
if (listaFuncao.some((f) => !(f.parents || []).includes(c.destinoRaizId))) throw new Error('listagem de pastas de função não é desta nota');
const funcoes = new Set(listaFuncao.map((f) => f.id).concat(c.destinoRaizId, c.pastaId));
const emOutra = (corpo(r).files || []).filter((f) => (f.parents || []).some((p) => funcoes.has(p) && p !== c.pastaId));
if (emOutra.length) throw new Error('JÁ EXISTE EM OUTRA PASTA DE FUNÇÃO: "' + c.origem.nome + '" (' + emOutra.map((f) => f.id + ' em ' + f.parents.join(',')).join(' | ') + '). Parei.');
if (c.tipo === 'existe') {
  const e = naPasta.find((f) => f.id === c.existente.id);
  if (!e || e.md5Checksum !== c.origem.md5) throw new Error('ESTADO MUDOU: o arquivo já existente ' + c.existente.id + ' não está mais na pasta ou mudou de MD5.');
  return [{ json: { ...c, acao: 'existe', idNoDestino: e.id } }];
}
if (iguais.length) return [{ json: { ...c, acao: 'existe', idNoDestino: iguais[0].id } }];
return [{ json: { ...c, acao: 'copiar', copia: { url: API + '/files/' + c.origem.id + '/copy', qs: { supportsAllDrives: true, fields: 'id,name,md5Checksum,parents' }, corpo: { name: c.origem.nome, parents: [c.pastaId] } } } }];
`;

const JS_CONFERIR_COPIA = COMUM + LOOP + String.raw`
const c = ctxDe('Decidir cópia');
const post = $('Copiar nota').first();
const reler = $input.first();
const idCopia = corpo(post).id || null;
if (status(post) === 200 && corpo(post).name !== c.origem.nome) throw new Error('a resposta da cópia não é desta nota: "' + corpo(post).name + '" ≠ "' + c.origem.nome + '". Cópia ' + idCopia + ' NÃO registrada. Parei.');
if (status(post) !== 200 || !idCopia) throw new Error('FALHA NA CÓPIA de "' + c.origem.nome + '": HTTP ' + status(post) + ' ' + JSON.stringify(corpo(post)).slice(0, 300) + '. Nada foi copiado nesta nota.');
const b = corpo(reler);
const problemas = [];
if (status(reler) !== 200) problemas.push('reler cópia: HTTP ' + status(reler));
if (b.id !== idCopia) problemas.push('releitura devolveu outro arquivo (' + b.id + ')');
if (b.trashed) problemas.push('cópia está na lixeira');
if (b.name !== c.origem.nome) problemas.push('nome da cópia "' + b.name + '" ≠ origem "' + c.origem.nome + '"');
if (b.md5Checksum !== c.origem.md5) problemas.push('MD5 da cópia ' + b.md5Checksum + ' ≠ origem ' + c.origem.md5);
if (!(b.parents || []).includes(c.pastaId)) problemas.push('cópia não está na pasta ' + c.pastaId);
return [{ json: { ...c, idNoDestino: idCopia, ok: problemas.length === 0, problemas } }];
`;

const JS_OCORRENCIA = COMUM + String.raw`
const c = $input.first().json;
return [{ json: { arquivo: '${ARQ.ocorrenciaPrefixo}' + new Date().toISOString().replace(/[:.]/g, '-') + '.json' }, binary: { data: binJson({ quando: new Date().toISOString(), lote: c.lote, nota: c.origem, pastaId: c.pastaId, idCopia: c.idNoDestino, problemas: c.problemas, aviso: 'Cópia criada com divergência. NÃO foi apagada nem registrada. Decisão do Claudio.' }, 'ocorrencia.json') } }];
`;

const JS_PARAR = String.raw`
const c = $('Conferir cópia').first().json;
throw new Error('DIVERGÊNCIA NA CÓPIA de "' + c.origem.nome + '" (cópia ' + c.idNoDestino + '): ' + c.problemas.join('; ') + '. Ocorrência gravada. Parei.');
`;

const JS_ENTRADA = COMUM + String.raw`
const c = $input.first().json;
if (c.i !== $('Uma nota por vez').first().json.i) throw new Error('contexto fora de sincronia ao montar a entrada do registro');
const agora = new Date();
return [{ json: { i: c.i, registroInicial: c.registroInicial, entrada: {
  mes: c.mes, projeto: c.projeto, projetoId: c.projetoId, arquivo: c.origem.nome, origemId: c.origem.id, origemMd5: c.origem.md5,
  fonte: c.fonte, linhaCost: c.linha, codigo: c.codigo, funcao: c.funcao,
  pastaDestinoId: c.pastaId, pastaDestinoNome: c.destino.pastaNome, pastaCriadaAgora: !!c.pastaCriada,
  idNoDestino: c.idNoDestino, status: c.acao === 'copiar' ? 'COPIADO' : 'JÁ EXISTIA',
  dataHora: agora.toISOString(), dataHoraLocal: agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  lote: c.lote, execucao: c.execucao,
} } }];
`;

const COLUNAS = ['mes', 'projeto', 'arquivo', 'origemId', 'origemMd5', 'fonte', 'linhaCost', 'codigo', 'funcao', 'pastaDestinoId', 'pastaDestinoNome', 'idNoDestino', 'status', 'dataHoraLocal', 'dataHora', 'pastaCriadaAgora', 'lote', 'execucao'];
const JS_ANEXAR = String.raw`const this_helpers = this.helpers;
` + COMUM + LOOP + String.raw`
const COLUNAS = ${JSON.stringify(COLUNAS)};
const e = ctxDe('Entrada do registro');
const atual = (await lerJsonDoInput()) || [];
// Registro só de adição: o arquivo em disco tem que ter exatamente as linhas de antes desta
// execução + uma por nota já processada nela. Qualquer outra coisa, paro sem gravar.
const esperado = e.registroInicial + e.i;
if (!Array.isArray(atual) || atual.length !== esperado) throw new Error('REGISTRO INCONSISTENTE: esperava ' + esperado + ' linhas em disco, achei ' + (Array.isArray(atual) ? atual.length : 'não-lista') + '. Nada gravado nesta nota.');
const novo = atual.concat([e.entrada]);
const cel = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
const csv = '﻿' + [COLUNAS.join(';')].concat(novo.map((x) => COLUNAS.map((k) => cel(x[k])).join(';'))).join('\r\n') + '\r\n';
return [{ json: { linhas: novo.length }, binary: {
  data: binJson(novo, 'arquivamento_registro_2026-10-19.json'),
  csv: { data: Buffer.from(csv, 'utf8').toString('base64'), mimeType: 'text/csv', fileName: 'arquivamento_registro_2026-10-19.csv' },
} }];
`;

function jsFinal(lote) {
  return String.raw`const this_helpers = this.helpers;
` + COMUM + String.raw`
const reg = (await lerJsonDoInput()) || [];
const ini = $('Conferir identidade e registro').all();
const c0 = ini[0].json;
const desta = reg.filter((x) => x.execucao === c0.execucao);
if (reg.length !== c0.registroInicial + c0.total || desta.length !== c0.total) throw new Error('CONFERÊNCIA FINAL: registro com ' + reg.length + ' linhas (' + desta.length + ' desta execução); esperado ' + (c0.registroInicial + c0.total) + ' (' + c0.total + ').');
const res = {
  lote: ${JSON.stringify(lote)}, execucao: c0.execucao, terminouEm: new Date().toISOString(),
  puladasPorJaEstaremNoRegistro: c0.puladosNoInicio,
  copiadas: desta.filter((x) => x.status === 'COPIADO').length,
  jaExistiam: desta.filter((x) => x.status === 'JÁ EXISTIA').length,
  pastasCriadas: desta.filter((x) => x.pastaCriadaAgora).map((x) => ({ id: x.pastaDestinoId, nome: x.pastaDestinoNome })),
  linhasNoRegistro: reg.length, entradas: desta,
};
return [{ json: {}, binary: { data: binJson(res, 'resultado.json') } }];
`;
}

// ---------------------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------------------
function montar(lote, itens) {
  posX = 0;
  const nodes = [];
  const conn = {};
  const add = (n) => (nodes.push(n), n);
  const liga = (de, para, saida = 0) => {
    conn[de] = conn[de] || { main: [] };
    while (conn[de].main.length <= saida) conn[de].main.push([]);
    conn[de].main[saida].push({ node: para, type: 'main', index: 0 });
  };
  const cadeia = (...ns) => { for (let i = 0; i + 1 < ns.length; i++) liga(ns[i], ns[i + 1]); };

  add({ id: crypto.randomUUID(), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} });
  add(code('Plano do lote', jsPlano(lote, itens)));
  add(http('Drive — identidade (about)', 'GET', '={{ $json.url }}', '={{ JSON.stringify($json.qs) }}'));
  add(ler('Ler registro (início)', ARQ.registroJson));
  add(code('Conferir identidade e registro', JS_CONFERIR));
  add({ id: crypto.randomUUID(), name: 'Uma nota por vez', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: pos(), parameters: { batchSize: 1, options: {} } });
  cadeia('Manual Trigger', 'Plano do lote', 'Drive — identidade (about)', 'Ler registro (início)', 'Conferir identidade e registro', 'Uma nota por vez');

  // saída 1 do Loop = próxima nota; saída 0 = terminou
  add(code('Contexto da nota', JS_CONTEXTO));
  liga('Uma nota por vez', 'Contexto da nota', 1);
  add(http('Listar pastas de função', 'GET', '={{ $json.url }}', '={{ JSON.stringify($json.qs) }}'));
  add(code('Decidir pasta', JS_DECIDIR_PASTA));
  add(se('Precisa criar pasta?', '={{ $json.precisaCriar }}'));
  cadeia('Contexto da nota', 'Listar pastas de função', 'Decidir pasta', 'Precisa criar pasta?');
  add(http('Criar pasta de função', 'POST', '={{ $json.criar.url }}', '={{ JSON.stringify($json.criar.qs) }}', '={{ JSON.stringify($json.criar.corpo) }}'));
  add(code('Conferir pasta criada', JS_PASTA_CRIADA));
  add(code('Preparar pasta alvo', JS_PREP_ALVO));
  liga('Precisa criar pasta?', 'Criar pasta de função', 0);
  cadeia('Criar pasta de função', 'Conferir pasta criada', 'Preparar pasta alvo');
  liga('Precisa criar pasta?', 'Preparar pasta alvo', 1);
  add(http('Listar pasta alvo', 'GET', '={{ $json.url }}', '={{ JSON.stringify($json.qs) }}'));
  add(http('Buscar mesmo nome no Drive', 'GET', "={{ $('Preparar pasta alvo').first().json.busca.url }}", "={{ JSON.stringify($('Preparar pasta alvo').first().json.busca.qs) }}"));
  add(code('Decidir cópia', JS_DECIDIR_COPIA));
  add(se('Copiar?', "={{ $json.acao === 'copiar' }}"));
  cadeia('Preparar pasta alvo', 'Listar pasta alvo', 'Buscar mesmo nome no Drive', 'Decidir cópia', 'Copiar?');
  add(http('Copiar nota', 'POST', '={{ $json.copia.url }}', '={{ JSON.stringify($json.copia.qs) }}', '={{ JSON.stringify($json.copia.corpo) }}'));
  add(http('Reler cópia', 'GET', '=' + API + "/files/{{ $json.id }}", "={{ JSON.stringify({ supportsAllDrives: true, fields: 'id,name,md5Checksum,parents,trashed' }) }}"));
  add(code('Conferir cópia', JS_CONFERIR_COPIA));
  add(se('Cópia confere?', '={{ $json.ok }}'));
  liga('Copiar?', 'Copiar nota', 0);
  cadeia('Copiar nota', 'Reler cópia', 'Conferir cópia', 'Cópia confere?');
  add(code('Montar ocorrência', JS_OCORRENCIA));
  add(gravar('Gravar ocorrência', '={{ $json.arquivo }}', 'data'));
  add(code('Parar (divergência)', JS_PARAR));
  liga('Cópia confere?', 'Montar ocorrência', 1);
  cadeia('Montar ocorrência', 'Gravar ocorrência', 'Parar (divergência)');

  add(code('Entrada do registro', JS_ENTRADA));
  liga('Cópia confere?', 'Entrada do registro', 0);
  liga('Copiar?', 'Entrada do registro', 1);
  add(ler('Ler registro', ARQ.registroJson));
  add(code('Anexar ao registro', JS_ANEXAR));
  add(gravar('Gravar registro JSON', ARQ.registroJson, 'data'));
  add(code('Recolocar CSV', "return [{ json: {}, binary: { csv: $('Anexar ao registro').first().binary.csv } }];"));
  add(gravar('Gravar registro CSV', ARQ.registroCsv, 'csv'));
  cadeia('Entrada do registro', 'Ler registro', 'Anexar ao registro', 'Gravar registro JSON', 'Recolocar CSV', 'Gravar registro CSV', 'Uma nota por vez');

  add(ler('Ler registro (fim)', ARQ.registroJson));
  add(code('Resultado do lote', jsFinal(lote)));
  add(gravar('Gravar resultado', ARQ.resultado(lote), 'data'));
  liga('Uma nota por vez', 'Ler registro (fim)', 0);
  cadeia('Ler registro (fim)', 'Resultado do lote', 'Gravar resultado');

  return {
    name: 'ZZ-TEMP escrita arquivamento ' + lote + ' 19-10 (apagar)',
    nodes, connections: conn,
    // Salva ESTA execução para o resultado ser lido pela API ("ler"); "apagar" apaga depois.
    settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveManualExecutions: true, saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all', saveExecutionProgress: false },
  };
}

// Trava: confere no JSON gerado que só existem as escritas permitidas.
function conferirEscritas(wf, lote) {
  const erros = [];
  const permitidosDisco = [ARQ.registroJson, ARQ.registroCsv, ARQ.resultado(lote), '={{ $json.arquivo }}'];
  const tipos = ['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.code', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.readWriteFile', 'n8n-nodes-base.if', 'n8n-nodes-base.splitInBatches'];
  for (const n of wf.nodes) {
    if (!tipos.includes(n.type)) erros.push(n.name + ': tipo não permitido ' + n.type);
    if (n.type === 'n8n-nodes-base.httpRequest') {
      const m = n.parameters.method;
      if (m === 'POST') {
        if (n.name === 'Criar pasta de função' && n.parameters.jsonBody === '={{ JSON.stringify($json.criar.corpo) }}') continue;
        if (n.name === 'Copiar nota' && n.parameters.jsonBody === '={{ JSON.stringify($json.copia.corpo) }}') continue;
        erros.push(n.name + ': POST não previsto');
      } else if (m !== 'GET') erros.push(n.name + ': método ' + m);
    }
    if (n.type === 'n8n-nodes-base.readWriteFile' && n.parameters.operation === 'write' && !permitidosDisco.includes(n.parameters.fileName)) erros.push(n.name + ': grava em ' + n.parameters.fileName);
    const js = n.parameters.jsCode || '';
    if (/method\s*:\s*['"](PATCH|PUT|DELETE)/i.test(js) || /\/trash|addParents|removeParents/.test(js)) erros.push(n.name + ': código com operação proibida');
  }
  // Os corpos dos POST são montados só aqui: pasta (mimeType de pasta, pai = raiz do destino) e cópia.
  if (!/mimeType: PASTA, parents: \[c\.destinoRaizId\]/.test(JS_DECIDIR_PASTA)) erros.push('corpo de criação de pasta inesperado');
  if (!/'\/files\/' \+ c\.origem\.id \+ '\/copy'/.test(JS_DECIDIR_COPIA)) erros.push('URL de cópia inesperada');
  if (!JS_OCORRENCIA.includes(ARQ.ocorrenciaPrefixo)) erros.push('ocorrência fora da pasta prevista');
  if (wf.settings.errorWorkflow) erros.push('errorWorkflow definido');
  if (erros.length) throw new Error('trava de escrita falhou:\n  ' + erros.join('\n  '));
}

async function main() {
  const [modo, lote] = process.argv.slice(2);
  if (modo === 'gerar' || modo === 'criar') {
    if (!fs.existsSync(ARQ_PLANO)) throw new Error('não achei ' + path.basename(ARQ_PLANO) + ' (rode a simulação e a análise antes).');
    const plano = JSON.parse(fs.readFileSync(ARQ_PLANO, 'utf8'));
    const itens = itensDoLote(plano, lote);
    if (!itens.length) throw new Error('o lote "' + lote + '" não tem nenhuma nota.');
    const wf = montar(lote, itens);
    conferirEscritas(wf, lote);
    fs.writeFileSync(ARQ_WF, JSON.stringify(wf, null, 2));
    console.log('Gerado ' + path.basename(ARQ_WF) + ': lote ' + lote + ', ' + itens.length + ' notas (' + itens.filter((x) => x.tipo === 'copiar').length + ' a copiar, ' + itens.filter((x) => x.tipo === 'existe').length + ' já existiam). Trava de escrita: ok.');
    for (const x of itens) console.log('  - [' + x.tipo + '] ' + x.projeto + ' · ' + x.origem.nome + ' -> ' + (x.destino.criar ? '(nova) ' : '') + x.destino.pastaNome);
    if (modo === 'gerar') return;
    if (fs.existsSync(ARQ_ESTADO)) throw new Error('já existe ' + path.basename(ARQ_ESTADO) + ': rode "apagar" antes.');
    const env = carregarEnv();
    const api = new N8nApi(env);
    if (((await api.listarWorkflows()) || []).some((w) => w.name === wf.name)) throw new Error('já existe "' + wf.name + '" na instância.');
    const r = await api.criarWorkflow(wf);
    fs.writeFileSync(ARQ_ESTADO, JSON.stringify({ id: r.id, nome: wf.name, lote, criadoEm: new Date().toISOString() }, null, 2));
    console.log('Criado INATIVO: ' + wf.name + ' (id ' + r.id + ')');
    console.log('Abra: ' + env.N8N_BASE_URL.replace(/\/+$/, '') + '/workflow/' + r.id + '  e clique em "Execute workflow".');
    console.log('Depois: node zz-temp-escrita.js ler  (lê a execução salva pela API).');
    return;
  }
  if (modo === 'ler') {
    const { id, lote: loteEst } = JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8'));
    const api = new N8nApi(carregarEnv());
    const lista = (await api.requisitar('GET', '/executions?workflowId=' + encodeURIComponent(id) + '&limit=50')).data || [];
    if (!lista.length) throw new Error('o workflow ' + id + ' ainda não tem execução salva.');
    const ex0 = lista.sort((a, b) => Number(b.id) - Number(a.id))[0];
    const ex = await api.requisitar('GET', '/executions/' + ex0.id + '?includeData=true');
    const rd = (ex.data || {}).resultData || {};
    const runData = rd.runData || {};
    const saidas = (nome) => (runData[nome] || []).map((r) => ((((r.data || {}).main || [])[0] || [])[0] || {}).json || null);
    const entradas = saidas('Entrada do registro').map((j) => j && j.entrada).filter(Boolean);
    const anexadas = saidas('Anexar ao registro').filter(Boolean).length;
    const final = saidas('Resultado do lote');
    const resumo = {
      execucao: ex.id, status: ex.status, inicio: ex.startedAt, fim: ex.stoppedAt, lote: loteEst,
      erro: rd.error ? { mensagem: String(rd.error.message || '').slice(0, 600), node: rd.lastNodeExecuted } : null,
      registradas: anexadas,
      notas: entradas.slice(0, anexadas).map((e) => ({ projeto: e.projeto, arquivo: e.arquivo, status: e.status, pasta: e.pastaDestinoNome, pastaCriadaAgora: e.pastaCriadaAgora, idNoDestino: e.idNoDestino, origemMd5: e.origemMd5 })),
      conferidas: saidas('Conferir cópia').filter(Boolean).map((j) => ({ arquivo: j.origem.nome, idCopia: j.idNoDestino, ok: j.ok, problemas: j.problemas })),
      terminouLote: final.length > 0,
    };
    const est = JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8'));
    est.execucoes = lista.map((x) => x.id);
    fs.writeFileSync(ARQ_ESTADO, JSON.stringify(est, null, 2));
    const arq = path.join(__dirname, 'zz-temp-escrita-resultado-' + loteEst + '.json');
    fs.writeFileSync(arq, JSON.stringify(resumo, null, 2));
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
    await api.requisitar('DELETE', '/workflows/' + encodeURIComponent(id));
    try { await api.obterWorkflow(id); throw new Error('ainda existe depois do DELETE'); } catch (e) { if (e.status !== 404) throw e; }
    fs.unlinkSync(ARQ_ESTADO);
    const restantes = ((await api.listarWorkflows()) || []).filter((w) => w.name.startsWith('ZZ-TEMP'));
    console.log('Apagado: ' + nome + '. Workflows ZZ-TEMP restantes: ' + restantes.length);
    return;
  }
  console.log('uso: node zz-temp-escrita.js gerar|criar piloto|resto|existentes  ·  ler  ·  apagar');
  process.exit(2);
}

main().catch((e) => { console.error('ERRO: ' + e.message); process.exit(1); });
