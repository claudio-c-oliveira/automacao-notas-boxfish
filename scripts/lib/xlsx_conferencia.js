'use strict';
/**
 * CONFERÊNCIA de .xlsx e de metadados do Box — par do `xlsx_cirurgico.js` (que GRAVA).
 *
 * Tudo aqui só LÊ. Serve à sequência do spec 13.4 (plano da migração da Fase 1, C.1–C.3):
 *   - sha1 em JS puro (o Code node do n8n não libera o módulo crypto);
 *   - impressão digital do pacote e as duas comparações:
 *       comparar()       — estrita, depois de uma escrita nossa: só as células-alvo da aba
 *                          podem ter mudado, todo o resto byte a byte igual;
 *       compararPasso0() — Passo 0 (D1(b) + D15(b)): integridade da FORMATAÇÃO desde a última
 *                          escrita conferida; valores de célula e faixas (sqref) só relatados;
 *   - leitura de células direto do XML (valor bruto, fórmula, estilo);
 *   - preparação dos alvos com as travas: coluna permitida, linha abaixo do cabeçalho,
 *     célula existente com estilo e sem fórmula (D7(b)), regra da coluna Q (13.5, 28/10);
 *   - identidade da linha (D9) e diferença célula a célula;
 *   - portão do Cost (D18: id, nome, situação e dono; pasta pai NÃO), ids proibidos,
 *     identidade da conta do Box e janela de silêncio.
 *
 * Sem require(): o arquivo é pensado para ser embutido no jsCode do workflow (o JSZip vem
 * por parâmetro, como no xlsx_cirurgico.js). Os nomes não colidem com os do xlsx_cirurgico.js.
 */

// ---------------------------------------------------------------------------------------
// sha1 (JS puro). Entrada: Buffer/Uint8Array. Saída: hex minúsculo.
// ---------------------------------------------------------------------------------------
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
function sha1Txt(s) { return sha1(Buffer.from(String(s), 'utf8')); }

// ---------------------------------------------------------------------------------------
// XML: abas, sharedStrings, células e linhas
// ---------------------------------------------------------------------------------------
function desescapar(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
function textoDosT(trecho) { return (trecho.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => desescapar(t.replace(/<[^>]+>/g, ''))).join(''); }

/** Lista de abas na ordem do workbook: [{ nome, parte }]. */
async function abasDoPacote(zip) {
  const wb = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const alvoDe = (rid) => {
    for (const r of rels.match(/<Relationship\b[^>]*\/?>/g) || []) {
      if ((r.match(/\bId="([^"]*)"/) || [])[1] !== rid) continue;
      const t = (r.match(/\bTarget="([^"]*)"/) || [])[1];
      if (!t) return null;
      const limpo = t.replace(/^\/+/, '').replace(/^\.\//, '');
      return limpo.startsWith('xl/') ? limpo : 'xl/' + limpo;
    }
    return null;
  };
  return (wb.match(/<sheet\b[^>]*?\/>/g) || []).map((tag) => ({
    nome: desescapar((tag.match(/\bname="([^"]*)"/) || [])[1] || ''),
    parte: alvoDe((tag.match(/\br:id="([^"]*)"/) || [])[1]),
  }));
}
/** Parte interna de uma aba pelo nome exato (sensível a maiúsculas, sem fallback). */
async function parteDaAba(zip, nomeAba) {
  const a = (await abasDoPacote(zip)).find((x) => x.nome === nomeAba);
  if (!a || !a.parte || !zip.file(a.parte)) throw new Error('aba não encontrada no workbook: ' + nomeAba);
  return a.parte;
}
async function sharedStrings(zip) {
  const f = zip.file('xl/sharedStrings.xml');
  if (!f) return [];
  const xml = await f.async('string');
  return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map(textoDosT);
}
const RE_CELULA = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
function refDaCelula(bruta) { return (bruta.match(/^<c\b[^>]*?\br="([A-Z]+\d+)"/) || [])[1] || null; }
/** Interpreta o XML bruto de uma célula. */
function lerCelulaBruta(bruta, ss) {
  if (!bruta) return { existe: false, valor: '', formula: false, estilo: null, tipo: null };
  const abre = bruta.match(/^<c\b([^>]*?)\/?>/)[1];
  const dentro = bruta.endsWith('/>') && !/<\/c>$/.test(bruta) ? '' : (bruta.match(/^<c\b[^>]*>([\s\S]*)<\/c>$/) || [])[1] || '';
  const estilo = (abre.match(/\bs="(\d+)"/) || [])[1] || null;
  const tipo = (abre.match(/\bt="([^"]*)"/) || [])[1] || null;
  const formula = /<f[\s>\/]/.test(dentro);
  let valor = '';
  if (tipo === 's') { const v = (dentro.match(/<v>([^<]*)<\/v>/) || [])[1]; valor = v != null && ss[+v] != null ? ss[+v] : ''; }
  else if (tipo === 'inlineStr') valor = textoDosT(dentro);
  else { const v = (dentro.match(/<v>([^<]*)<\/v>/) || [])[1]; valor = v != null ? desescapar(v) : ''; }
  return { existe: true, valor, formula, estilo, tipo };
}
/** Mapa ref -> XML bruto de todas as células da aba. */
function mapaCelulas(xml) {
  const m = new Map();
  for (const c of xml.match(RE_CELULA) || []) { const r = refDaCelula(c); if (r) m.set(r, c); }
  return m;
}
function celulaXml(xml, ref, ss) {
  const m = xml.match(new RegExp('<c\\b[^>]*?\\br="' + ref + '"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)'));
  return lerCelulaBruta(m ? m[0] : null, ss);
}
/** Linhas da aba: [{ numero, celulas: { COL: XML bruto } }], na ordem do XML. */
function linhasDaAba(xml) {
  const out = [];
  for (const m of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const numero = parseInt((m[1].match(/\br="(\d+)"/) || [])[1], 10);
    const celulas = {};
    for (const c of (m[2] || '').match(RE_CELULA) || []) { const r = refDaCelula(c); if (r) celulas[r.replace(/\d+$/, '')] = c; }
    out.push({ numero, celulas });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Cabeçalho da aba e identidade da linha
// ---------------------------------------------------------------------------------------
/**
 * Acha a linha de cabeçalho pelos títulos esperados (config `cabecalho_notas`, ex.:
 * { B: 'CONTA NETFLIX', N: 'STATUS CONTRATO', Q: 'CHECK ARQUIVO DRIVE' }). Tem de existir
 * EXATAMENTE uma linha com todos os títulos; senão, erro. Linhas acima (título do S02, B1:R1)
 * e a própria linha do cabeçalho nunca são linhas de nota.
 */
function linhaDoCabecalho(xml, ss, titulos) {
  const cols = Object.keys(titulos || {});
  if (!cols.length) throw new Error('cabeçalho esperado não configurado');
  const achadas = linhasDaAba(xml).filter((l) => cols.every((c) => lerCelulaBruta(l.celulas[c], ss).valor.trim() === titulos[c]));
  if (achadas.length !== 1) throw new Error('cabeçalho da aba: esperado exatamente 1 linha com ' + JSON.stringify(titulos) + ', achadas ' + achadas.length + (achadas.length ? ' (' + achadas.map((l) => l.numero).join(', ') + ')' : ''));
  return achadas[0].numero;
}
/** Valores brutos (como estão no XML) das colunas pedidas numa linha. */
function identidadeLinha(xml, ss, linha, colunas) {
  const out = {};
  for (const c of colunas) out[c] = celulaXml(xml, c + linha, ss).valor.trim();
  return out;
}
/** Diferenças entre duas identidades. Lista vazia = mesma linha. */
function compararIdentidade(antes, agora) {
  return Object.keys(antes).filter((c) => antes[c] !== agora[c]).map((c) => c + ': "' + antes[c] + '" -> "' + agora[c] + '"');
}

// ---------------------------------------------------------------------------------------
// Regra da coluna Q (spec 13.5 com a mudança do Claudio de 28/10)
// ---------------------------------------------------------------------------------------
function normalizarQ(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
/**
 * Decide o que fazer com a célula Q, dado o valor atual. regra = config `coluna_q`.
 * Devolve { acao: 'gravar' | 'ja_ok' | 'intocavel' | 'desconhecido', motivo }.
 * Lista BRANCA: só grava sobre os valores de `gravaveis`. Os intocáveis servem só para o motivo.
 */
function avaliarQ(valorAtual, regra) {
  const v = normalizarQ(valorAtual);
  if (regra.gravaveis.map(normalizarQ).includes(v)) return { acao: 'gravar', motivo: v === '' ? 'vazio' : v };
  if (v === normalizarQ(regra.valor_ok)) return { acao: 'ja_ok', motivo: 'já está ' + regra.valor_ok };
  if (regra.intocaveis.map(normalizarQ).includes(v)) return { acao: 'intocavel', motivo: 'intocável: "' + String(valorAtual).trim() + '"' };
  return { acao: 'desconhecido', motivo: 'valor desconhecido: "' + String(valorAtual).trim() + '"' };
}

// ---------------------------------------------------------------------------------------
// Preparação dos alvos (as travas antes de chamar gravarPreservando)
// ---------------------------------------------------------------------------------------
/**
 * p = {
 *   xml, ss,                    XML da aba e sharedStrings
 *   alvos: [{ ref, valor, arquivamentoConferido? }],
 *   colunas: ['N'] | ['L'] | ['Q'] ...   colunas desta cadeia (trava de colunas)
 *   cabecalho: { COL: 'título' },        config `cabecalho_notas`
 *   regraQ, estiloOkQ, totalEstilos      só para a coluna Q
 * }
 * Lança erro (= ABORTA A FONTE) em: coluna fora da cadeia, ref repetida, linha no cabeçalho
 * ou acima, célula inexistente (D7(b)), célula sem estilo, célula com fórmula, valor vazio,
 * Q com valor ≠ valor_ok, estilo do OK inexistente.
 * Recusa SÓ AQUELA célula (sem abortar) na coluna Q: arquivamento não conferido, já OK,
 * intocável, valor desconhecido — "na dúvida, não escreve".
 * Devolve { gravar: [{ ref, valor, estiloIndice }], recusados: [{ ref, motivo }], linhaCabecalho }.
 */
function prepararAlvos(p) {
  const colunas = p.colunas || [];
  if (!colunas.length) throw new Error('ABORTADO: cadeia sem colunas permitidas');
  const reCol = new RegExp('^(' + colunas.join('|') + ')(\\d+)$');
  const linhaCab = linhaDoCabecalho(p.xml, p.ss, p.cabecalho);
  const vistos = new Set();
  const gravar = [], recusados = [];
  for (const a of p.alvos || []) {
    const ref = String(a.ref || '');
    const m = ref.match(reCol);
    if (!m) throw new Error('ABORTADO (trava de colunas): "' + ref + '" fora das colunas ' + colunas.join(', '));
    if (vistos.has(ref)) throw new Error('ABORTADO: alvo repetido ' + ref);
    vistos.add(ref);
    const col = m[1], linha = parseInt(m[2], 10);
    if (linha <= linhaCab) throw new Error('ABORTADO: ' + ref + ' está no cabeçalho ou acima dele (cabeçalho na linha ' + linhaCab + ')');
    const cel = celulaXml(p.xml, ref, p.ss);
    if (!cel.existe) throw new Error('ABORTADO (D7): a célula ' + ref + ' não existe no XML — gravaria sem estilo');
    if (!cel.estilo) throw new Error('ABORTADO: a célula ' + ref + ' não tem estilo (s=)');
    if (cel.formula) throw new Error('ABORTADO: a célula ' + ref + ' tem fórmula');
    const valor = String(a.valor == null ? '' : a.valor);
    if (!valor.trim()) throw new Error('ABORTADO: valor vazio para ' + ref);
    if (col === 'Q') {
      if (!p.regraQ) throw new Error('ABORTADO: regra da coluna Q não configurada');
      if (valor !== p.regraQ.valor_ok) throw new Error('ABORTADO: a coluna Q só recebe "' + p.regraQ.valor_ok + '" (pedido: "' + valor + '")');
      const est = String(p.estiloOkQ == null ? '' : p.estiloOkQ);
      if (!/^\d+$/.test(est) || (p.totalEstilos != null && +est >= p.totalEstilos)) throw new Error('ABORTADO: estilo do OK da coluna Q inválido: ' + est);
      if (a.arquivamentoConferido !== true) { recusados.push({ ref, motivo: 'arquivamento não conferido', valorAtual: cel.valor }); continue; }
      const av = avaliarQ(cel.valor, p.regraQ);
      if (av.acao !== 'gravar') { recusados.push({ ref, motivo: av.motivo, acao: av.acao, valorAtual: cel.valor }); continue; }
      gravar.push({ ref, valor, estiloIndice: est, valorAnterior: cel.valor, estiloAnterior: cel.estilo });
    } else {
      gravar.push({ ref, valor, estiloIndice: cel.estilo, valorAnterior: cel.valor, estiloAnterior: cel.estilo });
    }
  }
  return { gravar, recusados, linhaCabecalho: linhaCab };
}

// ---------------------------------------------------------------------------------------
// Impressão digital e comparações
// ---------------------------------------------------------------------------------------
const RE_EXCECOES_PASSO0 = [/^xl\/worksheets\/sheet\d+\.xml$/, /^xl\/styles\.xml$/, /^xl\/sharedStrings\.xml$/, /^xl\/calcChain\.xml$/, /^docProps\//];
function semFaixas(trecho) { return trecho.replace(/\s+sqref="[^"]*"/g, '').replace(/<xm:sqref>[\s\S]*?<\/xm:sqref>/g, ''); }

function secoesDaAba(xml) {
  const todos = (re) => xml.match(re) || [];
  const cfLeg = todos(/<conditionalFormatting\b[\s\S]*?<\/conditionalFormatting>/g);
  const cfX14 = todos(/<x14:conditionalFormatting\b[\s\S]*?<\/x14:conditionalFormatting>/g);
  const ext = todos(/<extLst\b[\s\S]*?<\/extLst>/g);
  const cols = todos(/<cols>[\s\S]*?<\/cols>/g);
  const af = todos(/<autoFilter\b[^>]*\/>|<autoFilter\b[^>]*>[\s\S]*?<\/autoFilter>/g);
  const merges = todos(/<mergeCell\b[^>]*\/>/g).map((m) => (m.match(/\bref="([^"]*)"/) || [])[1]).filter(Boolean);
  const ordenado = (lista) => lista.slice().sort().join('\n');
  return {
    cf_legado: { blocos: cfLeg.length, regras: (cfLeg.join('').match(/<cfRule\b/g) || []).length, sha1: sha1Txt(cfLeg.join('\n')), sha1_sem_faixa: sha1Txt(ordenado(cfLeg.map(semFaixas))) },
    cf_x14: { blocos: cfX14.length, regras: (cfX14.join('').match(/<x14:cfRule\b/g) || []).length, sha1: sha1Txt(cfX14.join('\n')), sha1_sem_faixa: sha1Txt(ordenado(cfX14.map(semFaixas))) },
    extLst: { n: ext.length, sha1: sha1Txt(ext.join('\n')), sha1_sem_faixa: sha1Txt(ext.map(semFaixas).join('\n')) },
    cols: { n: (cols.join('').match(/<col\b/g) || []).length, sha1: sha1Txt(cols.join('\n')) },
    autoFilter: { n: af.length, ref: af.map((a) => (a.match(/\bref="([^"]*)"/) || [])[1] || null), sha1: sha1Txt(af.join('\n')), sha1_sem_ref: sha1Txt(af.map((a) => a.replace(/\s+ref="[^"]*"/, '')).join('\n')) },
    mesclagens: { n: merges.length, sha1_conjunto: sha1Txt(ordenado(merges)) },
    linhas: (xml.match(/<row\b/g) || []).length,
    celulas: (xml.match(/<c\b/g) || []).length,
  };
}

/**
 * Impressão digital do pacote. refsMascarar = células-alvo da aba `abaAlvo` (para o sha1
 * "NOTAS mascarada"). Compacta: só contagens e sha1, cabe no arquivo de estado da VM (C.3.1).
 */
async function impressao(zip, abaAlvo, refsMascarar) {
  const partes = {};
  for (const nome of Object.keys(zip.files).sort()) { if (zip.files[nome].dir) continue; partes[nome] = sha1(await zip.file(nome).async('uint8array')); }
  const abas = await abasDoPacote(zip);
  const porAba = {};
  let notasMascarada = null;
  for (const a of abas) {
    const xml = await zip.file(a.parte).async('string');
    porAba[a.nome] = { parte: a.parte, ...secoesDaAba(xml) };
    if (a.nome === abaAlvo) {
      let m = xml;
      for (const ref of refsMascarar || []) m = m.replace(new RegExp('<c\\b[^>]*?\\br="' + ref + '"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)'), '');
      notasMascarada = sha1Txt(m);
    }
  }
  const st = await zip.file('xl/styles.xml').async('string');
  const bloco = (st.match(/<dxfs\b[^>]*>([\s\S]*?)<\/dxfs>/) || [])[1] || '';
  const dxfs = bloco.match(/<dxf>[\s\S]*?<\/dxf>/g) || [];
  const xfs = ((st.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '').match(/<xf\b/g) || [];
  const wb = mascararFilterDatabase(await zip.file('xl/workbook.xml').async('string'), abas.findIndex((a) => a.nome === abaAlvo));
  return {
    partes, abas: abas.map((a) => a.nome), porAba,
    workbook: { sha1_mascarado: sha1Txt(wb.mascarado), filterDatabase_aba: wb.faixas },
    styles: { sha1: partes['xl/styles.xml'], cellXfs: xfs.length, dxfs: { total: dxfs.length, distintos: new Set(dxfs).size, sha1_bloco: sha1Txt(bloco) } },
    abaAlvo, notasMascarada,
  };
}

/**
 * D20 (b): o nome oculto `_xlnm._FilterDatabase` DA ABA (localSheetId = índice da aba no
 * workbook) tem a faixa do filtro, que o Excel atualiza quando alguém insere uma linha.
 * Devolve o workbook.xml com SÓ a faixa desse nome mascarada, e as faixas encontradas.
 * Qualquer outro nome definido (inclusive um `_xlnm._FilterDatabase` global, sem localSheetId)
 * fica como está e continua sendo comparado.
 */
function mascararFilterDatabase(wbXml, indiceAba) {
  const faixas = [];
  const mascarado = wbXml.replace(/(<definedName\b([^>]*)>)([^<]*)(<\/definedName>)/g, (m, abre, attrs, texto, fecha) => {
    const nome = (attrs.match(/\bname="([^"]*)"/) || [])[1];
    const local = (attrs.match(/\blocalSheetId="(\d+)"/) || [])[1];
    const oculto = /\bhidden="(1|true)"/.test(attrs);
    if (nome !== '_xlnm._FilterDatabase' || local == null || +local !== indiceAba || !oculto) return m;
    faixas.push(desescapar(texto));
    return abre + '\u0000FAIXA\u0000' + fecha;
  });
  return { mascarado, faixas };
}
/** 'NOTAS'!$B$4:$R$3724  ->  B4:R3724 (só a parte da faixa, sem a aba e sem $). */
function faixaSemAba(t) { return String(t).replace(/^.*!/, '').replace(/\$/g, ''); }

function registrador() {
  const itens = [], divergencias = [], relatados = [];
  const j = (x) => JSON.stringify(x);
  return {
    itens, divergencias, relatados,
    item(nome, a, b, igual) { itens.push({ item: nome, antes: a, depois: b, igual }); if (!igual) divergencias.push(nome + ': ' + j(a) + ' -> ' + j(b)); },
    relato(nome, a, b) { if (j(a) !== j(b)) relatados.push(nome + ': ' + j(a) + ' -> ' + j(b)); },
  };
}

/**
 * Comparação ESTRITA, depois de uma escrita nossa (C.2): tudo igual, menos o XML da aba-alvo,
 * e dentro dele só as células-alvo (conferido pelo sha1 mascarado).
 */
function comparar(A, B) {
  const r = registrador();
  const j = (x) => JSON.stringify(x);
  const nA = Object.keys(A.partes), nB = Object.keys(B.partes);
  r.item('lista de partes do pacote', nA.length, nB.length, j(nA) === j(nB));
  const parteAlvo = (A.porAba[A.abaAlvo] || {}).parte;
  const dif = nA.filter((p) => p !== parteAlvo && A.partes[p] !== B.partes[p]);
  r.item('partes byte a byte iguais (fora a aba ' + A.abaAlvo + ')', nA.length - 1, nA.length - 1 - dif.length, dif.length === 0);
  if (dif.length) r.divergencias.push('partes diferentes: ' + dif.join(', '));
  r.item('styles.xml', A.styles.sha1, B.styles.sha1, A.styles.sha1 === B.styles.sha1);
  r.item('sharedStrings.xml', A.partes['xl/sharedStrings.xml'] || null, B.partes['xl/sharedStrings.xml'] || null, A.partes['xl/sharedStrings.xml'] === B.partes['xl/sharedStrings.xml']);
  r.item('calcChain.xml', A.partes['xl/calcChain.xml'] || null, B.partes['xl/calcChain.xml'] || null, A.partes['xl/calcChain.xml'] === B.partes['xl/calcChain.xml']);
  r.item('dxfs (total / distintos / bloco)', A.styles.dxfs, B.styles.dxfs, j(A.styles.dxfs) === j(B.styles.dxfs));
  r.item('lista de abas', A.abas, B.abas, j(A.abas) === j(B.abas));
  for (const aba of A.abas) {
    const a = A.porAba[aba], b = B.porAba[aba] || {};
    for (const k of ['cf_legado', 'cf_x14', 'extLst', 'cols', 'autoFilter', 'mesclagens']) r.item(aba + ' · ' + k, a[k], b[k], j(a[k]) === j(b[k]));
    r.item(aba + ' · nº de linhas', a.linhas, b.linhas, a.linhas === b.linhas);
    r.item(aba + ' · nº de células', a.celulas, b.celulas, a.celulas === b.celulas);
  }
  r.item(A.abaAlvo + ' com as células-alvo mascaradas', A.notasMascarada, B.notasMascarada, A.notasMascarada === B.notasMascarada);
  return { itens: r.itens, divergencias: r.divergencias };
}

/**
 * Passo 0 (C.3.1, D1(b) + D15(b)): `ref` = impressão guardada na última escrita conferida;
 * `atual` = impressão do arquivo baixado agora. PARA (divergencias) se mudar:
 *   - parte fora das exceções (abas, styles.xml, sharedStrings, calcChain, docProps): mudou,
 *     apareceu ou sumiu; o workbook.xml é comparado com SÓ a faixa do `_xlnm._FilterDatabase`
 *     da aba-alvo mascarada (D20 (b)), e essa faixa tem de ser igual à ref do autoFilter;  - lista ou ordem das abas;  - dxfs (total, distintos, bloco);
 *   - em qualquer aba: formatação condicional legada e x14 (contagens à parte + regras SEM as
 *     faixas), extLst (sem as faixas), cols, autoFilter (sem a ref) e o conjunto de mesclagens.
 * SÓ RELATA: styles.xml, cellXfs, faixas (sqref), ref do autoFilter, nº de linhas e células.
 */
function compararPasso0(ref, atual) {
  const r = registrador();
  const j = (x) => JSON.stringify(x);
  const excecao = (p) => RE_EXCECOES_PASSO0.some((re) => re.test(p));
  const todas = [...new Set([...Object.keys(ref.partes), ...Object.keys(atual.partes)])].sort();
  // o workbook.xml sai da comparação byte a byte e entra pela versão mascarada (D20 (b))
  const dif = todas.filter((p) => !excecao(p) && p !== 'xl/workbook.xml' && ref.partes[p] !== atual.partes[p]);
  r.item('partes fora das exceções', 'iguais', dif.length ? dif : 'iguais', dif.length === 0);
  const wa = ref.workbook || {}, wbAt = atual.workbook || {};
  r.item('xl/workbook.xml (só a faixa do _FilterDatabase da aba ' + atual.abaAlvo + ' mascarada)', wa.sha1_mascarado, wbAt.sha1_mascarado, !!wa.sha1_mascarado && wa.sha1_mascarado === wbAt.sha1_mascarado);
  // TRAVA da D20: a faixa mascarada (no arquivo atual) tem de ser igual à ref do autoFilter da aba
  const fd = wbAt.filterDatabase_aba || [];
  const afRef = ((atual.porAba[atual.abaAlvo] || {}).autoFilter || {}).ref || [];
  const travaOk = fd.length === 1 && afRef.length === 1 && faixaSemAba(fd[0]) === afRef[0] && (wa.filterDatabase_aba || []).length === 1;
  r.item('_FilterDatabase da aba ' + atual.abaAlvo + ' = ref do autoFilter (arquivo atual)', { filterDatabase: fd.map(faixaSemAba), autoFilter: afRef }, travaOk ? 'iguais' : { filterDatabase: fd.map(faixaSemAba), autoFilter: afRef }, travaOk);
  r.relato('_FilterDatabase da aba ' + atual.abaAlvo + ' (faixa)', wa.filterDatabase_aba, wbAt.filterDatabase_aba);
  r.item('lista e ordem das abas', ref.abas, atual.abas, j(ref.abas) === j(atual.abas));
  r.item('dxfs', ref.styles.dxfs, atual.styles.dxfs, j(ref.styles.dxfs) === j(atual.styles.dxfs));
  r.relato('styles.xml (sha1)', ref.styles.sha1, atual.styles.sha1);
  r.relato('cellXfs', ref.styles.cellXfs, atual.styles.cellXfs);
  for (const aba of ref.abas) {
    const a = ref.porAba[aba], b = atual.porAba[aba];
    if (!b) continue; // já acusado na lista de abas
    for (const k of ['cf_legado', 'cf_x14']) {
      const pa = { blocos: a[k].blocos, regras: a[k].regras, regras_sem_faixa: a[k].sha1_sem_faixa };
      const pb = { blocos: b[k].blocos, regras: b[k].regras, regras_sem_faixa: b[k].sha1_sem_faixa };
      r.item(aba + ' · ' + k, pa, pb, j(pa) === j(pb));
      r.relato(aba + ' · ' + k + ' (faixas)', a[k].sha1, b[k].sha1);
    }
    r.item(aba + ' · extLst (sem faixas)', { n: a.extLst.n, sha1: a.extLst.sha1_sem_faixa }, { n: b.extLst.n, sha1: b.extLst.sha1_sem_faixa }, a.extLst.n === b.extLst.n && a.extLst.sha1_sem_faixa === b.extLst.sha1_sem_faixa);
    r.item(aba + ' · cols', a.cols, b.cols, j(a.cols) === j(b.cols));
    r.item(aba + ' · autoFilter (sem a ref)', { n: a.autoFilter.n, sha1: a.autoFilter.sha1_sem_ref }, { n: b.autoFilter.n, sha1: b.autoFilter.sha1_sem_ref }, a.autoFilter.n === b.autoFilter.n && a.autoFilter.sha1_sem_ref === b.autoFilter.sha1_sem_ref);
    r.relato(aba + ' · autoFilter (ref)', a.autoFilter.ref, b.autoFilter.ref);
    r.item(aba + ' · mesclagens (conjunto)', a.mesclagens, b.mesclagens, j(a.mesclagens) === j(b.mesclagens));
    r.relato(aba + ' · nº de linhas', a.linhas, b.linhas);
    r.relato(aba + ' · nº de células', a.celulas, b.celulas);
  }
  return { itens: r.itens, divergencias: r.divergencias, relatados: r.relatados };
}

/**
 * Diferença célula a célula entre dois XML da mesma aba. Devolve as refs cujo XML bruto mudou,
 * apareceu ou sumiu.
 */
function diferencaCelulas(xmlA, xmlB) {
  const a = mapaCelulas(xmlA), b = mapaCelulas(xmlB);
  const out = [];
  for (const [ref, c] of a) if (b.get(ref) !== c) out.push(ref);
  for (const ref of b.keys()) if (!a.has(ref)) out.push(ref);
  return out.sort();
}

/**
 * Conferência completa de uma escrita: buffers antes e depois (zip já carregados), os alvos
 * gravados ({ ref, valor, estiloIndice }) e a aba. Junta comparar() + diferença célula a célula
 * + valor e estilo de cada alvo. ok = nenhuma divergência.
 */
async function conferirEscrita(zipAntes, zipDepois, aba, gravados) {
  const refs = gravados.map((g) => g.ref);
  const A = await impressao(zipAntes, aba, refs), B = await impressao(zipDepois, aba, refs);
  const cmp = comparar(A, B);
  const parte = await parteDaAba(zipAntes, aba);
  const xA = await zipAntes.file(parte).async('string'), xB = await zipDepois.file(parte).async('string');
  const mudaram = diferencaCelulas(xA, xB);
  const fora = mudaram.filter((r) => !refs.includes(r));
  if (fora.length) cmp.divergencias.push('células fora dos alvos mudaram: ' + fora.slice(0, 20).join(', ') + (fora.length > 20 ? ' …(+' + (fora.length - 20) + ')' : ''));
  cmp.itens.push({ item: 'células que mudaram = só os alvos', antes: refs.length, depois: mudaram.length, igual: fora.length === 0 && mudaram.length <= refs.length });
  const ssB = await sharedStrings(zipDepois);
  const alvos = gravados.map((g) => {
    const c = celulaXml(xB, g.ref, ssB);
    const ok = c.existe && c.valor === g.valor && c.estilo === String(g.estiloIndice) && !c.formula;
    if (!ok) cmp.divergencias.push('alvo ' + g.ref + ': esperado "' + g.valor + '" s=' + g.estiloIndice + ', achado "' + c.valor + '" s=' + c.estilo);
    return { ref: g.ref, valor: c.valor, estilo: c.estilo, ok };
  });
  return { ok: cmp.divergencias.length === 0, itens: cmp.itens, divergencias: cmp.divergencias, alvos, celulasQueMudaram: mudaram };
}

// ---------------------------------------------------------------------------------------
// Box: portão do Cost, identidade da conta e janela de silêncio
// ---------------------------------------------------------------------------------------
function idsProibidos(cfg) { return (cfg.ids_proibidos || []).map((x) => String(typeof x === 'object' ? x.box_id : x)); }
function semXlsx(n) { return String(n).replace(/\.xlsx$/i, ''); }
/**
 * Portão do Cost (C.1 + D18). meta = corpo de GET /files/{id} (type 'error' se falhou).
 * Confere: resposta ok; id = box_id da config; id fora dos proibidos; nome = nome_esperado
 * (com ou sem .xlsx); item_status 'active' e fora da lixeira; dono = dono_esperado.
 * A pasta pai NÃO é conferida (vem null para a conta da automação).
 * Devolve { ok, problemas }. Nunca troca de arquivo: quem chama para a fonte se ok = false.
 */
function conferirPortao(meta, fonteCfg, cfg) {
  const problemas = [];
  const proibidos = idsProibidos(cfg);
  if (!fonteCfg || !fonteCfg.box_id) return { ok: false, problemas: ['config sem box_id para esta fonte'] };
  if (proibidos.includes(String(fonteCfg.box_id))) problemas.push('a config aponta para um id PROIBIDO: ' + fonteCfg.box_id);
  if (!meta || meta.type === 'error') {
    problemas.push('o Box não respondeu ao GET do arquivo ' + fonteCfg.box_id + (meta && meta.status ? ' (HTTP ' + meta.status + (meta.code ? ' ' + meta.code : '') + ')' : ''));
    return { ok: false, problemas };
  }
  const id = String(meta.id);
  if (proibidos.includes(id)) problemas.push('id PROIBIDO: ' + id);
  if (id !== String(fonteCfg.box_id)) problemas.push('id ' + id + ' ≠ ' + fonteCfg.box_id);
  if (meta.type !== 'file') problemas.push('não é arquivo: ' + meta.type);
  if (!meta.name || semXlsx(meta.name) !== fonteCfg.nome_esperado) problemas.push('nome "' + meta.name + '" ≠ esperado "' + fonteCfg.nome_esperado + '"');
  if (meta.item_status !== 'active') problemas.push('situação ' + meta.item_status + ' (esperado active)');
  if (meta.trashed_at) problemas.push('na lixeira desde ' + meta.trashed_at);
  const dono = meta.owned_by && meta.owned_by.login;
  if (dono !== fonteCfg.dono_esperado) problemas.push('dono ' + dono + ' ≠ ' + fonteCfg.dono_esperado);
  return { ok: problemas.length === 0, problemas };
}
/** GET /users/me: a conta do Box é a esperada? */
function conferirContaBox(me, cfg) {
  if (!cfg.login_box_esperado) return { ok: false, problema: 'login_box_esperado não configurado' };
  if (!me || me.type === 'error') return { ok: false, problema: 'GET /users/me falhou' + (me && me.status ? ' (HTTP ' + me.status + ')' : '') };
  return me.login === cfg.login_box_esperado ? { ok: true } : { ok: false, problema: 'conta ' + me.login + ' ≠ ' + cfg.login_box_esperado };
}
/**
 * Janela de silêncio: se o Cost foi modificado há MENOS de `minutos` (config
 * janela_silencio_minutos), não escreve nesta execução. modified_at no futuro (relógio) ou
 * inválido também param: na dúvida, não escreve.
 */
function janelaDeSilencio(modifiedAt, agora, minutos) {
  if (!(typeof minutos === 'number' && minutos > 0)) return { ok: false, motivo: 'janela_silencio_minutos inválida: ' + minutos };
  const t = Date.parse(modifiedAt);
  if (isNaN(t)) return { ok: false, motivo: 'modified_at inválido: ' + modifiedAt };
  const desde = (new Date(agora).getTime() - t) / 60000;
  if (desde < 0) return { ok: false, motivo: 'modified_at no futuro (' + modifiedAt + ')', minutosDesde: desde };
  if (desde < minutos) return { ok: false, motivo: 'modificado há ' + desde.toFixed(1) + ' min (< ' + minutos + ')', minutosDesde: desde };
  return { ok: true, minutosDesde: desde };
}

/** Conferência da própria config (cost_reports*.json). Devolve a lista de problemas. */
function validarConfig(cfg, opcoes) {
  const p = [];
  const pendenteOk = opcoes && opcoes.aceitarPendente;
  if (!cfg || typeof cfg !== 'object') return ['config não é objeto'];
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(String(cfg.versao))) p.push('versao inválida: ' + cfg.versao);
  if (cfg.aba !== 'NOTAS') p.push('aba ≠ NOTAS');
  if (cfg.retencao_backups !== 30) p.push('retencao_backups ≠ 30: ' + cfg.retencao_backups);
  if (cfg.janela_silencio_minutos !== 10) p.push('janela_silencio_minutos ≠ 10: ' + cfg.janela_silencio_minutos);
  if (!cfg.login_box_esperado && !pendenteOk) p.push('login_box_esperado vazio');
  const proib = idsProibidos(cfg);
  if (!proib.length) p.push('ids_proibidos vazio');
  if (!cfg.cabecalho_notas || !Object.keys(cfg.cabecalho_notas).length) p.push('cabecalho_notas vazio');
  const q = cfg.coluna_q || {};
  if (q.valor_ok !== 'OK') p.push('coluna_q.valor_ok ≠ OK');
  if (JSON.stringify((q.gravaveis || []).map(normalizarQ).sort()) !== JSON.stringify(['', 'N/A', 'PENDENTE'])) p.push('coluna_q.gravaveis ≠ ["", "PENDENTE", "N/A"]');
  for (const f of ['S01', 'S02']) {
    const s = cfg[f];
    if (!s) { p.push(f + ' ausente'); continue; }
    const pend = (campo, v) => { if (v == null || v === '') { if (!pendenteOk) p.push(f + '.' + campo + ' vazio'); return true; } return false; };
    if (!pend('box_id', s.box_id)) {
      if (!/^\d{10,16}$/.test(String(s.box_id))) p.push(f + '.box_id inválido');
      if (proib.includes(String(s.box_id))) p.push(f + '.box_id está na lista de PROIBIDOS');
    }
    pend('nome_esperado', s.nome_esperado);
    if (s.nome_esperado && /\.xlsx$/i.test(s.nome_esperado)) p.push(f + '.nome_esperado deve vir sem .xlsx');
    pend('dono_esperado', s.dono_esperado);
    if (!Array.isArray(s.projetos) || !s.projetos.length) p.push(f + '.projetos vazio');
    if (!/^\d+$/.test(String(s.estilo_ok_coluna_q))) p.push(f + '.estilo_ok_coluna_q inválido');
    const b = s.backup || {};
    pend('backup.subpasta_id', b.subpasta_id);
    if (b.subpasta_nome !== f) p.push(f + '.backup.subpasta_nome ≠ ' + f);
    if (!b.pasta_raiz_id && !pendenteOk) p.push(f + '.backup.pasta_raiz_id vazio');
  }
  return p;
}

module.exports = {
  sha1, sha1Txt, desescapar,
  abasDoPacote, parteDaAba, sharedStrings, mapaCelulas, celulaXml, lerCelulaBruta, linhasDaAba,
  linhaDoCabecalho, identidadeLinha, compararIdentidade,
  normalizarQ, avaliarQ, prepararAlvos,
  secoesDaAba, impressao, comparar, compararPasso0, diferencaCelulas, conferirEscrita, mascararFilterDatabase, faixaSemAba,
  conferirPortao, conferirContaBox, janelaDeSilencio, validarConfig, idsProibidos,
};
