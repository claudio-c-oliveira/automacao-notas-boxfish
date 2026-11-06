'use strict';
/**
 * Casos da D47 (a) no Passo 0: carimbos de salvamento do Excel Online no xl/workbook.xml
 * (fileVersion@rupBuild, xr:revisionPtr@revIDLastSave e @xr10:uidLastSave).
 *
 * Usa SÓ um .xlsx SINTÉTICO montado aqui com jszip (sem dados reais de pessoas, valores ou
 * nomes). Chamado por tests/xlsx_conferencia.teste.js, que fornece caso().
 */
const JSZip = require('jszip');
const C = require('../scripts/lib/xlsx_conferencia.js');

const ABA = 'NOTAS';

function workbookXml(op = {}) {
  const rup = op.rupBuild || '30619';
  const rev = op.revID || '13';
  const uid = op.uid || '{11111111-1111-1111-1111-111111111111}';
  const faixaAba = op.faixaAba || 'NOTAS!$B$2:$R$10';
  const faixaGlobal = op.faixaGlobal || 'NOTAS!$B$2:$R$9';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x15 xr xr6 xr10" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr6="http://schemas.microsoft.com/office/spreadsheetml/2016/revision6" xmlns:xr10="http://schemas.microsoft.com/office/spreadsheetml/2016/revision10">' +
    '<fileVersion appName="xl" lastEdited="' + (op.lastEdited || '7') + '" lowestEdited="5" rupBuild="' + rup + '"/>' +
    '<workbookPr' + (op.workbookPr || '') + ' defaultThemeVersion="166925"/>' +
    '<xr:revisionPtr revIDLastSave="' + rev + '" documentId="' + (op.documentId || '13_ncr:1_{22222222-2222-2222-2222-222222222222}') + '" xr6:coauthVersionLast="47" xr6:coauthVersionMax="47" xr10:uidLastSave="' + uid + '"/>' +
    '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="' + (op.windowWidth || '28800') + '" windowHeight="12000"/></bookViews>' +
    '<sheets><sheet name="LEIA-ME" sheetId="1" r:id="rId1"/><sheet name="NOTAS" sheetId="2" r:id="rId2"/></sheets>' +
    '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">' + faixaAba + '</definedName>' +
    '<definedName name="_xlnm._FilterDatabase">' + faixaGlobal + '</definedName></definedNames>' +
    '<calcPr calcId="' + (op.calcId || '191029') + '"/></workbook>';
}

// Strings compartilhadas: os títulos do cabeçalho da NOTAS (config cabecalho_notas) e textos neutros.
const SS = ['CONTA NETFLIX', 'Nº DOC FISCAL', 'FORNECEDOR', 'STATUS BOX', 'STATUS CONTRATO', 'CHECK ARQUIVO DRIVE', 'ITEM TESTE', 'FORNECEDOR TESTE', 'DESCRICAO TESTE', 'ENTREGUE'];
function notasXml(op = {}) {
  const linhas = [];
  const cab = [['B', 0], ['E', 1], ['H', 2], ['L', 3], ['N', 4], ['Q', 5]].map(([c, i]) => '<c r="' + c + '2" s="1" t="s"><v>' + i + '</v></c>').join('');
  linhas.push('<row r="2">' + cab + '</row>');
  for (let n = 3; n <= (op.ultima || 10); n++) {
    const oculta = op.ocultas && op.ocultas.includes(n) ? ' hidden="1"' : '';
    linhas.push('<row r="' + n + '"' + oculta + '><c r="B' + n + '" s="2" t="s"><v>6</v></c><c r="G' + n + '" s="2"><v>46000</v></c><c r="H' + n + '" s="2" t="s"><v>7</v></c>' +
      '<c r="J' + n + '" s="2" t="s"><v>8</v></c><c r="K' + n + '" s="2"><v>100</v></c><c r="L' + n + '" s="2" t="s"><v>9</v></c><c r="N' + n + '" s="2"/><c r="Q' + n + '" s="2"/></row>');
  }
  const af = op.autoFilter || '<autoFilter ref="B2:R' + (op.ultima || 10) + '"/>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="2" max="18" width="14" customWidth="1"/></cols>' +
    '<sheetData>' + linhas.join('') + '</sheetData>' + af +
    '<mergeCells count="1"><mergeCell ref="C2:D2"/></mergeCells>' +
    '<conditionalFormatting sqref="L3:L' + (op.ultima || 10) + '"><cfRule type="containsText" dxfId="0" priority="1" operator="containsText" text="X"><formula>NOT(ISERROR(SEARCH("X",L3)))</formula></cfRule></conditionalFormatting>' +
    '</worksheet>';
}

async function montar(op = {}) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file('xl/workbook.xml', workbookXml(op.wb));
  z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
  z.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>');
  z.file('xl/worksheets/sheet2.xml', notasXml(op.notas));
  z.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="3"><xf/><xf/><xf/></cellXfs><dxfs count="1"><dxf><font><b/></font></dxf></dxfs></styleSheet>');
  z.file('xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + SS.length + '" uniqueCount="' + SS.length + '">' + SS.map((t) => '<si><t>' + t + '</t></si>').join('') + '</sst>');
  return z;
}

const imp = async (op) => C.impressao(await montar(op), ABA, []);
/** Estado no formato ANTIGO (antes da D47): sem sha1_mascarado_v2 nem carimbos. */
function formatoAntigo(i) { const c = JSON.parse(JSON.stringify(i)); delete c.workbook.sha1_mascarado_v2; delete c.workbook.carimbos; return c; }

const CARIMBOS_NOVOS = { rupBuild: '30701', revID: '37', uid: '{33333333-3333-3333-3333-333333333333}' };
const FILTRO_ATIVO = '<autoFilter ref="B2:R10"><filterColumn colId="10"><filters><filter val="SOLICITAR"/></filters></filterColumn></autoFilter>';

async function casosCarimbos(caso) {
  console.log('\n== K. Passo 0: carimbos de salvamento do Excel Online no workbook.xml (D47 a), arquivo sintético ==');
  const G = 'K carimbos';
  const ref = await imp({});
  const temWb = (r, trecho) => r.divergencias.some((d) => d.startsWith('xl/workbook.xml') && (!trecho || d.includes(trecho)));

  caso(G, 'a impressão nova guarda o hash v2 e os 3 carimbos', ['fileVersion.rupBuild', 'revisionPtr.revIDLastSave', 'revisionPtr.uidLastSave'], Object.keys(ref.workbook.carimbos || {}).sort());
  caso(G, 'o hash antigo (sha1_mascarado) continua sendo calculado igual (regra D20/D24)', true, typeof ref.workbook.sha1_mascarado === 'string' && ref.workbook.sha1_mascarado !== ref.workbook.sha1_mascarado_v2);
  caso(G, 'mesmo arquivo → passa', [], C.compararPasso0(ref, await imp({})).divergencias);

  // (a) só os carimbos trocados → passa e relata
  const rA = C.compararPasso0(ref, await imp({ wb: CARIMBOS_NOVOS }));
  caso(G, '(a) só os 3 carimbos trocados → passa', [], rA.divergencias, rA.relatados);
  caso(G, '(a) … e relata "ignorado: metadados de salvamento do Excel Online"', true, rA.relatados.some((x) => x.startsWith('ignorado: metadados de salvamento do Excel Online') && x.includes('30701') && x.includes('"37"')), rA.relatados);
  for (const [nome, op] of [['só o rupBuild', { rupBuild: '30701' }], ['só o revIDLastSave', { revID: '99' }], ['só o uidLastSave', { uid: '{44444444-4444-4444-4444-444444444444}' }]]) {
    caso(G, '(a) ' + nome + ' trocado → passa', [], C.compararPasso0(ref, await imp({ wb: op })).divergencias);
  }

  // (b) carimbos trocados MAIS outra mudança no workbook.xml → para
  const outras = [
    ['outro atributo do fileVersion (lastEdited)', { lastEdited: '8' }],
    ['outro atributo do revisionPtr (documentId)', { documentId: '13_ncr:1_{55555555-5555-5555-5555-555555555555}' }],
    ['workbookPr mudado', { workbookPr: ' date1904="1"' }],
    ['bookViews mudado', { windowWidth: '19200' }],
    ['calcPr mudado', { calcId: '191030' }],
  ];
  for (const [nome, op] of outras) {
    const r = C.compararPasso0(ref, await imp({ wb: { ...CARIMBOS_NOVOS, ...op } }));
    caso(G, '(b) carimbos trocados + ' + nome + ' → PARA no workbook.xml', true, temWb(r), r.divergencias);
  }
  {
    const z = await montar({ wb: CARIMBOS_NOVOS });
    const x = await z.file('xl/workbook.xml').async('string');
    z.file('xl/workbook.xml', x.replace('</definedNames>', '<definedName name="_xlnm.Print_Area" localSheetId="1">NOTAS!$B$1:$R$10</definedName></definedNames>'));
    const r = C.compararPasso0(ref, await C.impressao(z, ABA, []));
    caso(G, '(b) carimbos trocados + nome definido novo (área de impressão) → PARA no workbook.xml', true, temWb(r), r.divergencias);
    const z2 = await montar({ wb: CARIMBOS_NOVOS });
    const x2 = await z2.file('xl/workbook.xml').async('string');
    z2.file('xl/workbook.xml', x2.replace('</workbook>', '<extLst><ext uri="{X}"><x15:workbookPr chartTrackingRefBase="1"/></ext></extLst></workbook>'));
    const r2 = C.compararPasso0(ref, await C.impressao(z2, ABA, []));
    caso(G, '(b) carimbos trocados + extLst novo no workbook.xml → PARA no workbook.xml', true, temWb(r2), r2.divergencias);
    const z3 = await montar({ wb: CARIMBOS_NOVOS });
    const x3 = await z3.file('xl/workbook.xml').async('string');
    z3.file('xl/workbook.xml', x3.replace(/(<xr:revisionPtr\b[^>]*\/>)/, '$1$1'));
    const r3 = C.compararPasso0(ref, await C.impressao(z3, ABA, []));
    caso(G, '(b) revisionPtr duplicado (não é carimbo: não mascara) → PARA no workbook.xml', true, temWb(r3), r3.divergencias);
    const z4 = await montar({ wb: CARIMBOS_NOVOS });
    const x4 = await z4.file('xl/workbook.xml').async('string');
    z4.file('xl/workbook.xml', x4.replace(/<xr:revisionPtr\b[^>]*\/>/, ''));
    const r4 = C.compararPasso0(ref, await C.impressao(z4, ABA, []));
    caso(G, '(b) revisionPtr removido → PARA no workbook.xml', true, temWb(r4), r4.divergencias);
  }

  // (c) autoFilter com critério ativo (filterColumn) e linhas ocultas → para (D48 a)
  const rC = C.compararPasso0(ref, await imp({ wb: CARIMBOS_NOVOS, notas: { autoFilter: FILTRO_ATIVO, ocultas: [3, 4, 5, 6, 7, 8, 9] } }));
  caso(G, '(c) filtro ativo na coluna L (filterColumn) + carimbos trocados → PARA no autoFilter', true, rC.divergencias.some((d) => d.includes('autoFilter (sem a ref)')), rC.divergencias);
  caso(G, '(c) … e o workbook.xml (só carimbos) não é a causa', false, temWb(rC), rC.divergencias);
  const rC2 = C.compararPasso0(ref, await imp({ notas: { autoFilter: FILTRO_ATIVO } }));
  caso(G, '(c) filtro ativo sozinho (sem carimbos) → PARA no autoFilter', true, rC2.divergencias.some((d) => d.includes('autoFilter (sem a ref)')), rC2.divergencias);

  // (d) estado no formato ANTIGO: compara pela regra antiga; carimbos trocados → PARA, pedindo impressão nova
  const antigo = formatoAntigo(ref);
  caso(G, '(d) estado antigo + mesmo arquivo → passa (regra antiga)', [], C.compararPasso0(antigo, await imp({})).divergencias);
  const rD = C.compararPasso0(antigo, await imp({ wb: CARIMBOS_NOVOS }));
  caso(G, '(d) estado antigo + só os carimbos trocados → PARA (o hash antigo inclui os carimbos)', true, temWb(rD), rD.divergencias);
  caso(G, '(d) … e a mensagem diz que é preciso uma impressão digital nova', true, rD.divergencias.some((d) => d.includes('formato antigo') && d.includes('impressão digital nova')), rD.divergencias);
  caso(G, '(d) … e não relata os carimbos como ignorados', false, rD.relatados.some((x) => x.startsWith('ignorado:')), rD.relatados);
  const rD2 = C.compararPasso0(antigo, await imp({ wb: { calcId: '191030' } }));
  caso(G, '(d) estado antigo + outra mudança no workbook.xml → PARA', true, temWb(rD2), rD2.divergencias);

  // (e) os casos antigos da D20/D24 continuam como antes, com o estado novo
  const rE1 = C.compararPasso0(ref, await imp({ wb: { ...CARIMBOS_NOVOS, faixaAba: 'NOTAS!$B$2:$R$11', faixaGlobal: 'NOTAS!$B$2:$R$10' }, notas: { ultima: 11 } }));
  caso(G, '(e) linha inserida (faixas do _FilterDatabase e do autoFilter andaram) + carimbos → passa (D20 b, D24 b)', [], rE1.divergencias, rE1.relatados);
  caso(G, '(e) … e as faixas e os carimbos foram relatados', true, rE1.relatados.some((x) => x.startsWith('_FilterDatabase da aba')) && rE1.relatados.some((x) => x.startsWith('_FilterDatabase global')) && rE1.relatados.some((x) => x.startsWith('ignorado:')), rE1.relatados);
  const rE2 = C.compararPasso0(ref, await imp({ notas: { ultima: 11 } }));
  caso(G, '(e) linha inserida SEM atualizar o _FilterDatabase da aba → PARA pela trava da D20', true, rE2.divergencias.some((d) => d.includes('_FilterDatabase')), rE2.divergencias);
  const rE3 = C.compararPasso0(ref, await imp({ wb: { faixaGlobal: "'LEIA-ME'!$B$2:$R$9" } }));
  caso(G, '(e) _FilterDatabase global trocado para outra aba → PARA (D24 b)', true, rE3.divergencias.some((d) => d.includes('_FilterDatabase global')), rE3.divergencias);
  const rE4 = C.compararPasso0(antigo, await imp({ wb: { faixaAba: 'NOTAS!$B$2:$R$11', faixaGlobal: 'NOTAS!$B$2:$R$10' }, notas: { ultima: 11 } }));
  caso(G, '(e) estado antigo + linha inserida (sem carimbos trocados) → passa como antes', [], rE4.divergencias, rE4.relatados);
};

/** .xlsx sintético em buffer, para os cenários do simulador (tests/fase1_ciclo_cost.teste.js). */
async function montarSintetico(op) { return (await montar(op)).generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }); }

module.exports = casosCarimbos;
module.exports.montarSintetico = montarSintetico;
module.exports.CARIMBOS_NOVOS = CARIMBOS_NOVOS;
module.exports.FILTRO_ATIVO = FILTRO_ATIVO;
