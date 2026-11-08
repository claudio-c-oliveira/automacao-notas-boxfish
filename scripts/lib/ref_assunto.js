'use strict';
/**
 * "REF." do ASSUNTO do pedido de COLABORADOR (D63, 32ª rodada, 08/11/2026).
 *
 * O "REF." é o MÊS TRABALHADO, lido da DESCRIÇÃO da linha (coluna J): o período "dd/mm A dd/mm" e,
 * se houver, a palavra REF, JOB ou DIÁRIA. Nunca o mês do envio (o "REF. NOV" do rascunho do 9b,
 * para um período de agosto, saiu do mês do envio).
 *
 * Regra (Claudio e Michelle; 32ª rodada e D63'' da 33ª), na ordem:
 *   (i)   palavra explícita manda: JOB -> "REF. JOB"; DIÁRIA/DIÁRIAS -> "REF. DIÁRIA" (qualquer
 *         número de dias); PACOTE -> "REF. PACOTE"; REF -> "REF. [MÊS]". Um JOB de um mês só
 *         continua JOB.
 *   (ii)  sem palavra e período dentro de UM mês -> "REF. [MÊS do período]".
 *   (iii) sem palavra e período que ATRAVESSA meses -> "REF. JOB", sempre (D63'', Michelle; corrige
 *         o spec 3.2.1, que dizia "REF. [MÊS1] E [MÊS2]" para uma linha só). DIÁRIA só com a
 *         palavra escrita.
 *   (iv)  contradição (REF com período que atravessa meses, mês escrito que não bate com as datas,
 *         JOB e DIÁRIA juntos, IA e descrição discordando) -> "conferir à mão".
 *   Período ilegível -> "conferir à mão", inclusive para JOB e DIÁRIA.
 *   Parcela ("P.X/Y", spec 3.2): vai no JOB COMO ESTÁ ESCRITA na descrição ("P. 1/5" -> "REF. JOB
 *   (P. 1/5)"); a Michelle ajusta no rascunho, se precisar. Um "X/Y" solto fora do período, sem o
 *   "P", é ambíguo (parcela ou data?) -> "conferir à mão".
 *
 * "Conferir à mão" = não cria rascunho e a linha vai para o Relatório (spec 3.2, item 6: nunca
 * inventar um valor).
 *
 * Palavras inteiras, sem diferenciar maiúscula, minúscula nem acento: REF, REF., REFERENTE; JOB;
 * DIÁRIA, DIARIA, DIÁRIAS. "REFORÇO" não é REF.
 *
 * Embutido no Code node "Montar e-mail colaborador" pelo marcador de inclusão do gerador.
 */
const MESES_REF = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const MESES_EXTENSO_REF = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const DIAS_NO_MES_REF = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function normalizarTextoRef(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function palavrasRef(t) {
  return normalizarTextoRef(t).split(/[^A-Z0-9]+/).filter(Boolean);
}

/** Período "dd/mm A dd/mm" da descrição, em ordem cronológica. null se não houver exatamente um, legível. */
function lerPeriodoDescricao(descricao) {
  const txt = normalizarTextoRef(descricao);
  const re = /(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*\d{2,4})?\s+(?:A|ATE)\s+(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*\d{2,4})?/g;
  const achados = [];
  let m;
  while ((m = re.exec(txt))) achados.push(m);
  if (achados.length !== 1) return null;
  const [, d1, m1, d2, m2] = achados[0].map((x) => parseInt(x, 10));
  const valida = (d, mm) => mm >= 1 && mm <= 12 && d >= 1 && d <= DIAS_NO_MES_REF[mm - 1];
  if (!valida(d1, m1) || !valida(d2, m2)) return null;
  // Ordem cronológica (spec 3.2.1): das duas leituras, a de período mais curto ("05/08 A 26/07"
  // vira "26/07 A 05/08"; "26/12 A 05/01" é virada de ano legítima).
  const dias = (da, ma, db, mb) => {
    const ini = Date.UTC(2001, ma - 1, da);
    let fim = Date.UTC(2001, mb - 1, db);
    if (fim < ini) fim = Date.UTC(2002, mb - 1, db);
    return (fim - ini) / 86400000;
  };
  const inverter = dias(d2, m2, d1, m1) < dias(d1, m1, d2, m2);
  const ini = inverter ? { dia: d2, mes: m2 } : { dia: d1, mes: m1 };
  const fim = inverter ? { dia: d1, mes: m1 } : { dia: d2, mes: m2 };
  const meses = ini.mes === fim.mes && dias(ini.dia, ini.mes, fim.dia, fim.mes) < 32
    ? [MESES_REF[ini.mes - 1]]
    : [MESES_REF[ini.mes - 1], MESES_REF[fim.mes - 1]];
  const dd = (x) => String(x.dia).padStart(2, '0') + '/' + String(x.mes).padStart(2, '0');
  return { inicio: ini, fim, texto: dd(ini) + ' A ' + dd(fim), meses, atravessaMeses: meses.length > 1 };
}

/**
 * Parcela "P.X/Y" escrita na descrição, COMO ESTÁ (D63''). Tira antes o período, para a data não
 * passar por parcela. Devolve { parcela: string|null, ambigua: boolean }.
 */
function lerParcelaDescricao(descricao) {
  const semPeriodo = String(descricao || '').replace(/\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?\s+(?:A|AT[ÉE])\s+\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?/gi, ' ');
  const comP = semPeriodo.match(/\bP\.?\s*\d{1,2}\s*\/\s*\d{1,2}\b/gi) || [];
  const resto = semPeriodo.replace(/\bP\.?\s*\d{1,2}\s*\/\s*\d{1,2}\b/gi, ' ');
  const soltos = resto.match(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g) || [];
  if (comP.length > 1 || soltos.length) return { parcela: null, ambigua: true };
  return { parcela: comP.length ? comP[0].trim() : null, ambigua: false };
}

/** Palavras de tipo e meses escritos na descrição. */
function lerPalavrasDescricao(descricao) {
  const p = palavrasRef(descricao);
  const ehRef = (w) => w === 'REF' || w === 'REFERENTE';
  const LIGACAO = new Set(['A', 'AO', 'DE', 'DO', 'MES']);
  let job = false, diaria = false, ref = false, pacote = false;
  const mesesEscritos = [];
  const anotarMes = (w) => {
    let i = MESES_EXTENSO_REF.indexOf(w);
    if (i === -1) i = MESES_REF.indexOf(w);
    if (i !== -1 && mesesEscritos.indexOf(MESES_REF[i]) === -1) mesesEscritos.push(MESES_REF[i]);
  };
  for (let i = 0; i < p.length; i++) {
    const w = p[i];
    if (w === 'JOB') job = true;
    else if (w === 'DIARIA' || w === 'DIARIAS') diaria = true;
    else if (w === 'PACOTE') pacote = true;
    else if (ehRef(w)) {
      // "REF. JOB" / "REF. DIÁRIA" é o tipo, não um REF de mês.
      let j = i + 1;
      while (j < p.length && LIGACAO.has(p[j])) j++;
      const prox = p[j];
      if (prox === 'JOB' || prox === 'DIARIA' || prox === 'DIARIAS' || prox === 'PACOTE') continue;
      ref = true;
      // Abreviação de mês só conta logo depois do REF ("REF. AGO"): sozinha, "SET" é o set de gravação.
      if (prox && MESES_REF.indexOf(prox) !== -1) anotarMes(prox);
    }
    // Mês por extenso conta em qualquer posição.
    if (MESES_EXTENSO_REF.indexOf(w) !== -1) anotarMes(w);
  }
  return { job, diaria, ref, pacote, mesesEscritos };
}

/**
 * Decide o "REF." de UMA linha.
 * @param {{descricao: string, tipoEmissaoIA?: string|null, periodoIA?: string|null}} p
 * @returns {{ok: true, tipo: string, meses: string[], periodo: object, palavra: string|null}
 *          | {ok: false, motivo: string, periodo: object|null, palavra: string|null}}
 */
function decidirRefLinha(p) {
  const pal = lerPalavrasDescricao(p.descricao);
  const palavra = pal.job ? 'JOB' : pal.diaria ? 'DIÁRIA' : pal.pacote ? 'PACOTE' : pal.ref ? 'REF' : null;
  const periodo = lerPeriodoDescricao(p.descricao);
  const nao = (motivo) => ({ ok: false, motivo, periodo, palavra });

  if ((pal.job ? 1 : 0) + (pal.diaria ? 1 : 0) + (pal.pacote ? 1 : 0) > 1) return nao('mais de uma palavra de tipo (JOB/DIÁRIA/PACOTE) na descrição');
  if (pal.ref && (pal.job || pal.diaria || pal.pacote)) return nao('REF e ' + palavra + ' juntos na descrição');
  if (!periodo) return nao('período ilegível na descrição');
  const fora = pal.mesesEscritos.filter((m) => periodo.meses.indexOf(m) === -1);
  if (fora.length) return nao('mês escrito na descrição (' + fora.join(', ') + ') não bate com o período ' + periodo.texto);

  // O período que a IA leu tem de ser o mesmo da descrição (o corpo do e-mail usa o da IA).
  if (p.periodoIA) {
    const daIA = lerPeriodoDescricao(p.periodoIA);
    if (!daIA || daIA.texto !== periodo.texto) return nao('período lido pela IA (' + (p.periodoIA || '') + ') difere do da descrição (' + periodo.texto + ')');
  }

  const tipoIA = p.tipoEmissaoIA || 'NF_NORMAL';
  if (['NF_NORMAL', 'JOB', 'DIARIA', 'PACOTE'].indexOf(tipoIA) === -1) return nao('tipo de emissão da IA inesperado para colaborador: ' + tipoIA);
  const par = lerParcelaDescricao(p.descricao);
  if (par.ambigua) return nao('número "X/Y" fora do período sem o "P." (parcela ou data?) ou mais de uma parcela');

  // (i) palavra escrita manda; a IA tem de concordar.
  const tipoPalavra = pal.job ? 'JOB' : pal.diaria ? 'DIARIA' : pal.pacote ? 'PACOTE' : null;
  if (tipoPalavra) {
    if (tipoIA !== tipoPalavra) return nao('IA diz ' + tipoIA + ' e a descrição diz ' + tipoPalavra);
    return { ok: true, tipo: tipoPalavra, meses: periodo.meses, periodo, palavra, parcela: par.parcela };
  }
  if (periodo.atravessaMeses) {
    // (iv) REF escrito com período que atravessa meses: contradição.
    if (pal.ref) return nao('REF com período que atravessa meses (' + periodo.texto + ')');
    // (iii) D63'': sem palavra e atravessando meses = JOB, sempre. A IA pode ter lido NF normal
    // (não há palavra) ou JOB; DIÁRIA ou PACOTE sem a palavra é contradição.
    if (tipoIA !== 'NF_NORMAL' && tipoIA !== 'JOB') return nao('IA diz ' + tipoIA + ' sem a palavra escrita na descrição');
    return { ok: true, tipo: 'JOB', meses: periodo.meses, periodo, palavra, parcela: par.parcela, jobPorPeriodo: true };
  }
  // (ii) sem palavra e um mês só: REF. do mês.
  if (tipoIA !== 'NF_NORMAL') return nao('IA diz ' + tipoIA + ' e a descrição diz NF_NORMAL');
  return { ok: true, tipo: 'NF_NORMAL', meses: periodo.meses, periodo, palavra, parcela: null };
}

/**
 * "REF." do assunto de um e-mail (1 ou mais blocos do mesmo colaborador e vencimento).
 * @param {Array<{descricao, tipoEmissaoIA, periodoIA, linha}>} blocos  na ordem da planilha
 * @returns {{ok: true, ref: string} | {ok: false, motivos: string[]}}
 * A parcela é a escrita na descrição (D63''); a que a IA leu não é usada.
 */
function decidirRefAssunto(blocos) {
  const decisoes = blocos.map((b) => ({ linha: b.linha, d: decidirRefLinha(b) }));
  const ruins = decisoes.filter((x) => !x.d.ok);
  if (ruins.length) return { ok: false, motivos: ruins.map((x) => (x.linha != null ? 'L' + x.linha + ': ' : '') + x.d.motivo), decisoes };
  const tipos = [...new Set(decisoes.map((x) => x.d.tipo))];
  if (tipos.length > 1) return { ok: false, motivos: ['blocos de tipos diferentes no mesmo e-mail (' + tipos.join(', ') + ')'], decisoes };
  const tipo = tipos[0];
  if (tipo === 'JOB') {
    const parcela = decisoes[0].d.parcela;
    return { ok: true, ref: parcela ? 'REF. JOB (' + parcela + ')' : 'REF. JOB', decisoes };
  }
  if (tipo === 'DIARIA') return { ok: true, ref: 'REF. DIÁRIA', decisoes };
  if (tipo === 'PACOTE') return { ok: true, ref: 'REF. PACOTE', decisoes };
  // Mais de um bloco com meses diferentes: cita todos, na ordem de aparição (spec 3.2 e 3.2.1).
  const meses = [];
  for (const x of decisoes) for (const m of x.d.meses) if (meses.indexOf(m) === -1) meses.push(m);
  return { ok: true, ref: 'REF. ' + meses.join(' E '), decisoes };
}

module.exports = { MESES_REF, lerPeriodoDescricao, lerPalavrasDescricao, lerParcelaDescricao, decidirRefLinha, decidirRefAssunto };
