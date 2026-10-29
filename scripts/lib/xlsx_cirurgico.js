'use strict';
/**
 * Escrita CIRÚRGICA em .xlsx — substitui o uso do exceljs para GRAVAR.
 *
 * POR QUE ISTO EXISTE (causa raiz medida em 22/09/2026):
 *   `ExcelJS.Workbook.xlsx.writeBuffer()` não edita o arquivo: ele RECONSTRÓI o pacote
 *   inteiro a partir do modelo interno. Nesta planilha isso destrói a formatação condicional:
 *
 *     - a formatação condicional do Cost está na forma MODERNA, dentro de `<extLst>`
 *       como `x14:cfRule`. O exceljs lê, converte para a forma LEGADA `<cfRule>` e
 *       descarta o `<extLst>` inteiro.
 *         S01/NOTAS: 37.424 `x14:cfRule` -> 0     (viraram 18.712 `<cfRule>` legados)
 *         S02/NOTAS: 11.662 `x14:cfRule` -> 0
 *     - `xl/styles.xml` é regerado, e a tabela `<dxfs>` passa a conter só os formatos que
 *       o exceljs modelou:
 *         S01: 18.894 dxf / 16 distintos  ->  176 dxf / 3 distintos
 *         S02:  6.005 dxf / 15 distintos  ->  174 dxf / 2 distintos
 *
 *   Ou seja: QUALQUER gravação via exceljs repete o estrago, mesmo sem alterar nada.
 *   (Comprovado: um round-trip sem modificação nenhuma já reduz o arquivo.)
 *
 * O QUE ESTE MÓDULO FAZ DIFERENTE:
 *   Abre o .xlsx como o ZIP que ele é, reescreve APENAS o XML da aba-alvo, e copia todas
 *   as outras partes (styles.xml, extLst, tema, mídia, calcChain...) byte a byte.
 *   Nada fora das células pedidas muda.
 *
 * DEPENDÊNCIA: `jszip` precisa estar disponível no Code node do n8n
 *   (imagem da VM + NODE_FUNCTION_ALLOW_EXTERNAL=exceljs,xlsx,jszip).
 *   O jszip já está na imagem n8n-custom da VM, conforme `infra/Dockerfile`.
 *
 * LEITURA continua podendo usar exceljs — ler não altera arquivo nenhum.
 */

/** Descobre o caminho interno da aba pelo nome (ex.: 'NOTAS' -> 'xl/worksheets/sheet5.xml'). */
async function caminhoDaAba(zip, nomeAba) {
  const wb = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const re = /<sheet[^>]*?\/>/g;
  let m;
  while ((m = re.exec(wb))) {
    const tag = m[0];
    const nome = (tag.match(/name="([^"]*)"/) || [])[1];
    if (nome !== nomeAba) continue;
    const rid = (tag.match(/r:id="([^"]*)"/) || [])[1];
    const alvo = (rels.match(new RegExp('Id="' + rid + '"[^>]*Target="([^"]*)"')) || [])[1];
    if (!alvo) break;
    return 'xl/' + alvo.replace(/^\/+/, '').replace(/^\.\//, '');
  }
  throw new Error('aba não encontrada no workbook: ' + nomeAba);
}

/** Índice da string na sharedStrings, ou null se não existir. */
async function indiceSharedString(zip, texto) {
  const f = zip.file('xl/sharedStrings.xml');
  if (!f) return null;
  const xml = await f.async('string');
  const itens = xml.match(/<si>[\s\S]*?<\/si>/g) || [];
  for (let i = 0; i < itens.length; i++) {
    const partes = itens[i].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    const txt = partes.map((p) => p.replace(/<[^>]+>/g, '')).join('');
    if (txt === texto) return i;
  }
  return null;
}

/** Lê o atributo `s` (índice de estilo) de uma célula de referência, ex.: 'Q22'. */
function estiloDaCelula(xmlAba, ref) {
  const re = new RegExp('<c[^>]*\\br="' + ref + '"[^>]*>', '');
  const m = xmlAba.match(re);
  if (!m) return null;
  const s = m[0].match(/\bs="(\d+)"/);
  return s ? s[1] : null;
}

function linhaDaRef(ref) { return parseInt(ref.replace(/[^0-9]/g, ''), 10); }
function colunaDaRef(ref) { return ref.replace(/[0-9]/g, ''); }
function colunaParaNumero(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * Aplica as edições no XML da aba.
 * edicoes: [{ ref, valorTexto, estiloIndice, indiceSS }]
 * Se a célula existir, troca-a; se não existir, insere na posição correta dentro da <row>.
 */
function aplicarNoXml(xmlAba, edicoes) {
  let xml = xmlAba;
  const relatorio = [];
  const contar = (s) => ({ linhas: (s.match(/<row[ >]/g) || []).length, celulas: (s.match(/<c[ >]/g) || []).length });
  const antes = contar(xmlAba);
  for (const e of edicoes) {
    const attrS = e.estiloIndice != null ? ' s="' + e.estiloIndice + '"' : '';
    const nova = e.indiceSS != null
      ? '<c r="' + e.ref + '"' + attrS + ' t="s"><v>' + e.indiceSS + '</v></c>'
      : '<c r="' + e.ref + '"' + attrS + ' t="inlineStr"><is><t>' + e.valorTexto.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</t></is></c>';

    const reExistente = new RegExp('<c\\b[^>]*?\\br="' + e.ref + '"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)');
    if (reExistente.test(xml)) {
      xml = xml.replace(reExistente, () => nova);
      relatorio.push({ ref: e.ref, acao: 'substituída' });
      continue;
    }
    // não existe: inserir dentro da <row> correspondente, na ordem de coluna
    const nLinha = linhaDaRef(e.ref);
    const reLinha = new RegExp('<row[^>]*\\br="' + nLinha + '"[^>]*>([\\s\\S]*?)<\\/row>');
    const mL = xml.match(reLinha);
    if (!mL) { relatorio.push({ ref: e.ref, acao: 'ERRO: linha inexistente' }); continue; }
    const conteudo = mL[1];
    const celulas = conteudo.match(/<c[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) || [];
    const alvoNum = colunaParaNumero(colunaDaRef(e.ref));
    let pos = celulas.length;
    for (let i = 0; i < celulas.length; i++) {
      const r = (celulas[i].match(/\br="([A-Z]+)\d+"/) || [])[1];
      if (r && colunaParaNumero(r) > alvoNum) { pos = i; break; }
    }
    celulas.splice(pos, 0, nova);
    const linhaNova = mL[0].replace(conteudo, () => celulas.join(''));
    xml = xml.replace(reLinha, () => linhaNova);
    relatorio.push({ ref: e.ref, acao: 'inserida' });
  }
  // TRAVA: a reescrita não pode perder linha nem célula. Se perder, houve over-match
  // da regex (foi assim que um bug real engoliu 3 linhas inteiras em 22/09) — aborta.
  const depois = contar(xml);
  const inseridas = relatorio.filter((r) => r.acao === 'inserida').length;
  if (depois.linhas !== antes.linhas) {
    throw new Error('ABORTADO: nº de linhas mudou (' + antes.linhas + ' -> ' + depois.linhas + ')');
  }
  if (depois.celulas !== antes.celulas + inseridas) {
    throw new Error('ABORTADO: nº de células inconsistente (' + antes.celulas + ' + ' + inseridas +
                    ' esperado, ' + depois.celulas + ' obtido)');
  }
  return { xml, relatorio, integridade: { linhas: antes.linhas, celulasAntes: antes.celulas, celulasDepois: depois.celulas, inseridas } };
}

/**
 * Grava valores preservando tudo o mais. Devolve { buffer, relatorio }.
 *
 * @param {Buffer} buffer      .xlsx de entrada
 * @param {string} aba         nome da aba (ex.: 'NOTAS')
 * @param {Array}  alvos       [{ ref:'Q110', valor:'OK', estiloDe:'Q22' }]
 * @param {object} JSZip       construtor do jszip (require('jszip') no Code node)
 */
async function gravarPreservando(buffer, aba, alvos, JSZip, opcoes) {
  const zip = await JSZip.loadAsync(buffer);
  const caminho = await caminhoDaAba(zip, aba);
  const xmlAba = await zip.file(caminho).async('string');

  // se o arquivo não tem nenhuma célula com o formato desejado, cria um estilo novo
  // (só ANEXA em styles.xml — nenhum índice existente muda)
  let indicePadrao = null;
  if (opcoes && opcoes.estiloNovo) indicePadrao = String(await acrescentarEstilo(zip, opcoes.estiloNovo));

  const edicoes = [];
  for (const a of alvos) {
    const estiloIndice = a.estiloIndice != null ? String(a.estiloIndice)
      : (a.estiloDe ? estiloDaCelula(xmlAba, a.estiloDe) : indicePadrao);
    const indiceSS = await indiceSharedString(zip, a.valor);
    edicoes.push({ ref: a.ref, valorTexto: a.valor, estiloIndice, indiceSS });
  }
  const { xml, relatorio, integridade } = aplicarNoXml(xmlAba, edicoes);

  // substitui SÓ o XML da aba; todo o resto do pacote fica como estava
  zip.file(caminho, xml);
  const saida = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return { buffer: saida, caminhoAba: caminho, relatorio, integridade };
}

/** Conferência barata: conta o que costuma ser destruído por reescrita completa. */
async function inventario(buffer, JSZip) {
  const zip = await JSZip.loadAsync(buffer);
  const styles = await zip.file('xl/styles.xml').async('string');
  const bloco = styles.match(/<dxfs[^>]*>([\s\S]*?)<\/dxfs>/);
  const dxfs = bloco ? (bloco[1].match(/<dxf>[\s\S]*?<\/dxf>/g) || []) : [];
  let x14 = 0, extLst = 0;
  const nomes = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  for (const n of nomes) {
    const s = await zip.file(n).async('string');
    x14 += (s.match(/x14:cfRule/g) || []).length;
    extLst += (s.match(/<extLst[ >]/g) || []).length;
  }
  return { partes: Object.keys(zip.files).length, dxfTotal: dxfs.length, dxfDistintos: new Set(dxfs).size, x14cfRule: x14, extLst };
}

/**
 * Acrescenta um estilo novo ao `xl/styles.xml` SEM mexer nos existentes.
 * Só ANEXA (font/fill/border/numFmt/cellXf ao fim das respectivas listas), então
 * nenhum índice já usado pelas células muda. Devolve o índice do novo cellXf.
 *
 * Serve para o caso em que o arquivo-alvo ainda não tem nenhuma célula com o
 * formato desejado para servir de referência (ex.: a planilha S02, que não tinha
 * nenhum "OK" verde antes da primeira marcação).
 *
 * esp = { numFmt, fonte:{nome,tam,negrito,corTheme|corArgb}, preenchimentoArgb,
 *         alinhamento:{horizontal,vertical,wrapText}, bordaFina:{theme,tint} }
 */
async function acrescentarEstilo(zip, esp) {
  const caminho = 'xl/styles.xml';
  let xml = await zip.file(caminho).async('string');

  const anexar = (lista, conteudo) => {
    const re = new RegExp('<' + lista + '([^>]*)count="(\\d+)"([^>]*)>');
    const m = xml.match(re);
    if (!m) throw new Error('lista não encontrada em styles.xml: ' + lista);
    const n = parseInt(m[2], 10);
    xml = xml.replace(re, '<' + lista + m[1] + 'count="' + (n + 1) + '"' + m[3] + '>');
    const fim = '</' + lista + '>';
    const pos = xml.indexOf(fim);
    xml = xml.slice(0, pos) + conteudo + xml.slice(pos);
    return n; // índice do novo item
  };

  const f = esp.fonte || {};
  const cor = f.corArgb ? '<color rgb="' + f.corArgb + '"/>' : '<color theme="' + (f.corTheme != null ? f.corTheme : 1) + '"/>';
  const idFonte = anexar('fonts',
    '<font>' + (f.negrito ? '<b/>' : '') + '<sz val="' + (f.tam || 11) + '"/>' + cor +
    '<name val="' + (f.nome || 'Calibri') + '"/></font>');

  const idPreench = anexar('fills',
    '<fill><patternFill patternType="solid"><fgColor rgb="' + esp.preenchimentoArgb +
    '"/><bgColor indexed="64"/></patternFill></fill>');

  const b = esp.bordaFina;
  const idBorda = b
    ? anexar('borders', '<border>' +
        ['left', 'right', 'top', 'bottom'].map((l) =>
          '<' + l + ' style="thin"><color theme="' + b.theme + '" tint="' + b.tint + '"/></' + l + '>').join('') +
        '<diagonal/></border>')
    : 0;

  let idNumFmt = 0;
  if (esp.numFmt && esp.numFmt !== 'General') {
    const existente = xml.match(new RegExp('<numFmt numFmtId="(\\d+)" formatCode="' + esp.numFmt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'));
    if (existente) idNumFmt = parseInt(existente[1], 10);
    else {
      const usados = [...xml.matchAll(/<numFmt numFmtId="(\d+)"/g)].map((x) => parseInt(x[1], 10));
      idNumFmt = Math.max(164, ...usados.map((u) => u + 1));
      if (/<numFmts[^>]*>/.test(xml)) anexar('numFmts', '<numFmt numFmtId="' + idNumFmt + '" formatCode="' + esp.numFmt + '"/>');
      else {
        const pos = xml.indexOf('<fonts');
        xml = xml.slice(0, pos) + '<numFmts count="1"><numFmt numFmtId="' + idNumFmt + '" formatCode="' + esp.numFmt + '"/></numFmts>' + xml.slice(pos);
      }
    }
  }

  const al = esp.alinhamento || {};
  const alinhamento = '<alignment horizontal="' + (al.horizontal || 'center') + '" vertical="' + (al.vertical || 'middle') + '"' + (al.wrapText ? ' wrapText="1"' : '') + '/>';
  const idXf = anexar('cellXfs',
    '<xf numFmtId="' + idNumFmt + '" fontId="' + idFonte + '" fillId="' + idPreench + '" borderId="' + idBorda + '" xfId="0"' +
    (idNumFmt ? ' applyNumberFormat="1"' : '') + ' applyFont="1" applyFill="1"' + (b ? ' applyBorder="1"' : '') +
    ' applyAlignment="1">' + alinhamento + '</xf>');

  zip.file(caminho, xml);
  return idXf;
}

module.exports = { gravarPreservando, acrescentarEstilo, inventario, caminhoDaAba, estiloDaCelula, aplicarNoXml, indiceSharedString };
