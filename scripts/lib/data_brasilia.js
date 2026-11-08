'use strict';
/**
 * Data do calendário de Brasília (D59, 32ª rodada, 07/11/2026).
 *
 * O container do n8n roda em UTC: `new Date().toISOString().slice(0, 10)` e `getDate()` dão o dia
 * UTC, que depois das 21:00 de Brasília já é o dia seguinte (o rascunho da execução 682, às 22:13
 * de 07/11, saiu "ENVIAR ATÉ 08.11" e o cobrancas com "2026-11-08"). Aqui o fuso é explícito
 * (America/Sao_Paulo), qualquer que seja o fuso da máquina.
 *
 * Embutido nos Code nodes da Fase 1 pelo marcador de inclusão do scripts/gerar_workflows.js.
 *   hojeBrasilia(agora)      -> 'AAAA-MM-DD' (o dia em Brasília no instante `agora`; padrão: agora)
 *   dataBrasilia(agora)      -> Date ao MEIO-DIA LOCAL do dia de Brasília: getDate()/getMonth()/
 *                               getFullYear() e setDate(+n) dão o calendário de Brasília em
 *                               qualquer fuso de máquina (o meio-dia evita virar o dia por fuso).
 *   ymdBrasilia(d)           -> 'AAAA-MM-DD' de um Date criado pelo dataBrasilia (campos locais).
 */
const FUSO_BRASILIA = 'America/Sao_Paulo';

function partesBrasilia(agora) {
  const d = agora === undefined ? new Date() : new Date(agora);
  if (isNaN(d.getTime())) throw new Error('data inválida para o calendário de Brasília: ' + agora);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_BRASILIA, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
    const ano = Number(p.year), mes = Number(p.month), dia = Number(p.day);
    if (ano > 2000 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) return { ano, mes, dia };
  } catch (e) { /* sem Intl com fuso: cai no deslocamento fixo abaixo */ }
  // Brasília não tem horário de verão desde 2019: UTC-3 fixo.
  const b = new Date(d.getTime() - 3 * 3600000);
  return { ano: b.getUTCFullYear(), mes: b.getUTCMonth() + 1, dia: b.getUTCDate() };
}

function hojeBrasilia(agora) {
  const { ano, mes, dia } = partesBrasilia(agora);
  return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
}

function dataBrasilia(agora) {
  const { ano, mes, dia } = partesBrasilia(agora);
  return new Date(ano, mes - 1, dia, 12, 0, 0, 0);
}

function ymdBrasilia(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

module.exports = { FUSO_BRASILIA, hojeBrasilia, dataBrasilia, ymdBrasilia };
