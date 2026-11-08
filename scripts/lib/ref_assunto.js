'use strict';
/**
 * "REF." do ASSUNTO do pedido de COLABORADOR (D63, 32ª rodada, 08/11/2026).
 *
 * O "REF." é o MÊS TRABALHADO, lido da DESCRIÇÃO da linha (coluna J): o período "dd/mm A dd/mm" e,
 * se houver, a palavra REF, JOB ou DIÁRIA. Nunca o mês do envio (o "REF. NOV" do rascunho do 9b,
 * para um período de agosto, saiu do mês do envio).
 *
 * Regra (Claudio e Michelle, 32ª rodada), conferida contra o spec (fase-1.md, 3.2 e 3.2.1):
 *   (i)   palavra explícita manda: JOB -> "REF. JOB"; DIÁRIA -> "REF. DIÁRIA"; REF -> "REF. [MÊS]".
 *         Um JOB de um mês só continua JOB.
 *   (ii)  sem palavra e período dentro de UM mês -> "REF. [MÊS do período]".
 *   (iii) sem palavra e período que ATRAVESSA meses -> o spec (3.2.1) diz "REF. [MÊS1] E [MÊS2]";
 *         o Claudio diz "nunca REF, só JOB ou diária". DIVERGÊNCIA (D63'): até ela ser resolvida,
 *         "conferir à mão".
 *   (iv)  contradição (REF com período que atravessa meses, mês escrito que não bate com as datas,
 *         JOB e DIÁRIA juntos, IA e descrição discordando) -> "conferir à mão".
 *   Período ilegível -> "conferir à mão".
 *   PACOTE (spec 3.2, só AREP) continua "REF. PACOTE", como antes, se a palavra estiver escrita.
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

  const tipoDescricao = pal.job ? 'JOB' : pal.diaria ? 'DIARIA' : pal.pacote ? 'PACOTE' : 'NF_NORMAL';
  const tipoIA = p.tipoEmissaoIA || 'NF_NORMAL';
  if (['NF_NORMAL', 'JOB', 'DIARIA', 'PACOTE'].indexOf(tipoIA) === -1) return nao('tipo de emissão da IA inesperado para colaborador: ' + tipoIA);
  if (tipoIA !== tipoDescricao) return nao('IA diz ' + tipoIA + ' e a descrição diz ' + tipoDescricao);

  if (tipoDescricao !== 'NF_NORMAL') return { ok: true, tipo: tipoDescricao, meses: periodo.meses, periodo, palavra };

  if (periodo.atravessaMeses) {
    return nao(pal.ref
      ? 'REF com período que atravessa meses (' + periodo.texto + ')'
      : 'sem palavra e período que atravessa meses (' + periodo.texto + '): spec diz "REF. ' + periodo.meses.join(' E ') + '", regra do Claudio diz nunca REF (D63\')');
  }
  return { ok: true, tipo: 'NF_NORMAL', meses: periodo.meses, periodo, palavra };
}

/**
 * "REF." do assunto de um e-mail (1 ou mais blocos do mesmo colaborador e vencimento).
 * @param {Array<{descricao, tipoEmissaoIA, periodoIA, linha}>} blocos  na ordem da planilha
 * @param {string|null} parcela  "P.X/Y" (JOB parcelado)
 * @returns {{ok: true, ref: string} | {ok: false, motivos: string[]}}
 */
function decidirRefAssunto(blocos, parcela) {
  const decisoes = blocos.map((b) => ({ linha: b.linha, d: decidirRefLinha(b) }));
  const ruins = decisoes.filter((x) => !x.d.ok);
  if (ruins.length) return { ok: false, motivos: ruins.map((x) => (x.linha != null ? 'L' + x.linha + ': ' : '') + x.d.motivo), decisoes };
  const tipos = [...new Set(decisoes.map((x) => x.d.tipo))];
  if (tipos.length > 1) return { ok: false, motivos: ['blocos de tipos diferentes no mesmo e-mail (' + tipos.join(', ') + ')'], decisoes };
  const tipo = tipos[0];
  if (tipo === 'JOB') return { ok: true, ref: parcela ? 'REF. JOB (' + parcela + ')' : 'REF. JOB', decisoes };
  if (tipo === 'DIARIA') return { ok: true, ref: 'REF. DIÁRIA', decisoes };
  if (tipo === 'PACOTE') return { ok: true, ref: 'REF. PACOTE', decisoes };
  // Mais de um bloco com meses diferentes: cita todos, na ordem de aparição (spec 3.2 e 3.2.1).
  const meses = [];
  for (const x of decisoes) for (const m of x.d.meses) if (meses.indexOf(m) === -1) meses.push(m);
  return { ok: true, ref: 'REF. ' + meses.join(' E '), decisoes };
}

module.exports = { MESES_REF, lerPeriodoDescricao, lerPalavrasDescricao, decidirRefLinha, decidirRefAssunto };
