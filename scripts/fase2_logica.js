/**
 * Fase 2 — Recebimento e validação da nota
 * Lógica determinística usada nos nodes de Code dos workflows
 * workflows/fase2_recebimento_validacao.json e
 * workflows/fase2_verificar_pendencias.json.
 *
 * Mesmo padrão do scripts/fase1_logica.js: cada função aqui é colada dentro do
 * node de Code correspondente (n8n Code nodes não fazem require() de arquivo
 * externo). Este arquivo existe pra manter tudo versionado, legível e testável
 * fora do n8n.
 *
 * Referências de seção são todas de docs/spec.md.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Utilitários gerais (cópias das mesmas funções em fase1_logica.js — cada
// script de fase é self-contained, mesmo racional de por que cada node de
// Code também precisa ser self-contained).
// ─────────────────────────────────────────────────────────────────────────

function normalizar(texto) {
  if (!texto) return '';
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function formatarDataCurta(data) {
  const dd = String(data.getDate()).padStart(2, '0');
  const mm = String(data.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

const MESES_ABREV_PT_MAIUSC = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

function diferencaHoras(a, b) {
  return (a.getTime() - b.getTime()) / (1000 * 60 * 60);
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Thread conhecida ou avulso?" (seção 4)
// Uma resposta dentro de uma thread que a automação já monitora tem o MESMO
// threadId gravado em cobrancas.json (seção 3.1.1, "O threadId é gravado
// assim que o e-mail de pedido é criado"). Isso é checagem determinística,
// não precisa de IA.
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {string} threadIdRecebido - threadId do e-mail que chegou
 * @param {Object} cobrancas - conteúdo de cobrancas.json
 * @returns {{ehConhecida: boolean, chaveCobranca?: string, entrada?: Object}}
 */
function identificarThreadConhecida(threadIdRecebido, cobrancas) {
  if (!threadIdRecebido || !cobrancas) return { ehConhecida: false };
  const chave = Object.keys(cobrancas).find((k) => cobrancas[k].threadId === threadIdRecebido);
  if (!chave) return { ehConhecida: false };
  return { ehConhecida: true, chaveCobranca: chave, entrada: cobrancas[chave] };
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Preparar IA — extração do anexo" e "Preparar IA — casar com a planilha"
// (seção 4). Extração: nome do colaborador, razão social, projeto (Ref.),
// valor, competência a partir do PDF/imagem anexado. Casamento: compara o
// nome/razão social extraído contra a lista de nomes/razões sociais da
// planilha — via IA (não string exata, não algoritmo fonético — seção 4).
// ─────────────────────────────────────────────────────────────────────────

const PROMPT_SISTEMA_EXTRACAO_NF = `Você extrai dados de identificação de uma nota fiscal ou recibo (PDF ou imagem) recebido por e-mail de um colaborador/fornecedor da produtora Box Fish.

Responda SOMENTE com um objeto JSON (sem markdown, sem texto fora do JSON):
{"nomeOuRazaoSocial": string|null, "projetoRef": string|null, "valor": number|null, "competencia": string|null, "numeroNota": string|null, "dataEmissao": "DD/MM/AAAA"|null, "tipoDocumento": "NF"|"RECIBO"|"FATURA"|null, "situacaoNaoMapeada": string|null}

Regras: "nomeOuRazaoSocial" é o nome do colaborador OU a razão social do fornecedor emissor do documento (quem está emitindo, não a Box Fish, que é sempre a tomadora). "projetoRef" é o texto "Ref." que aparece no documento, se houver. "numeroNota" só os dígitos, sem zeros à esquerda desnecessários (a formatação de 6 dígitos é feita depois, fora da IA). Se não conseguir ler algum campo com confiança, deixe null nesse campo específico — nunca invente. Se o documento for ilegível ou não for reconhecível como nota/recibo, preencha "situacaoNaoMapeada" descrevendo o problema.`;

/** @returns {{system: string}} prompt fixo — o node HTTP Request anexa o PDF/imagem como conteúdo multimodal da mensagem */
function montarPromptExtracaoNF() {
  return { system: PROMPT_SISTEMA_EXTRACAO_NF };
}

const PROMPT_SISTEMA_CASAR_PLANILHA = `Você recebe um nome de colaborador ou razão social extraído de uma nota fiscal, e uma lista de nomes/razões sociais candidatos vindos de uma planilha (cada um com um identificador de linha).

Responda SOMENTE com um objeto JSON (sem markdown, sem texto fora do JSON):
{"linhaEncontrada": <identificador da linha, do jeito que veio na lista>|null, "confiavel": boolean, "situacaoNaoMapeada": string|null}

Regras: considere variações de acentuação, maiúsculas/minúsculas, abreviações e pequena diferença de escrita como o MESMO nome (ex.: "J. Silva" e "João Silva" podem ser a mesma pessoa se não houver outro candidato parecido). "confiavel" só é true se você tiver certeza razoável — se houver ambiguidade real entre 2+ candidatos parecidos, ou nenhum candidato parecido, use confiavel=false e linhaEncontrada=null. Nunca invente uma linha que não esteja na lista de candidatos.`;

/**
 * @param {string} nomeExtraido
 * @param {Array<{chave: string, nome: string}>} candidatos - linhas candidatas (nome/razão social + identificador de linha) do mesmo projeto
 * @returns {{system: string, user: string}}
 */
function montarPromptCasarPlanilha(nomeExtraido, candidatos) {
  return {
    system: PROMPT_SISTEMA_CASAR_PLANILHA,
    user: JSON.stringify({ nomeExtraido, candidatos }),
  };
}

/** Mesmo racional de parseRespostaIA em fase1_logica.js — nunca lança exceção, falha vira situacaoNaoMapeada. */
function parseRespostaIA(textoResposta) {
  try {
    const obj = JSON.parse(textoResposta);
    if (!obj) return { situacaoNaoMapeada: 'Resposta da IA vazia' };
    return obj;
  } catch (e) {
    return { situacaoNaoMapeada: 'Resposta da IA não é JSON válido: ' + String(textoResposta).slice(0, 300) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Atualizar planilha" (seção 4) — colunas D/E/F + Status Box
// ─────────────────────────────────────────────────────────────────────────

/** Formata o número da nota com 6 dígitos, zero-padded (seção 4.1). */
function formatarNumeroNota(numero) {
  const digitos = String(numero).replace(/\D/g, '');
  return digitos.padStart(6, '0').slice(-6);
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Gerar retranca" (seção 4.1)
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} params
 * @param {Date} params.dataVencimento
 * @param {string} params.identificadorProjeto - perfil.retranca (ex.: "REUNION_S01")
 * @param {string} params.razaoSocial
 * @param {string|number} params.numeroNota
 * @returns {string} ex.: "10.09_BR_SMTC_REUNION_S01_BARLAVENTO FILMES LTDA_#000000"
 */
function gerarRetranca({ dataVencimento, identificadorProjeto, razaoSocial, numeroNota }) {
  const dataCurta = formatarDataCurta(dataVencimento);
  const numeroFormatado = formatarNumeroNota(numeroNota);
  return `${dataCurta}_BR_SMTC_${identificadorProjeto}_${razaoSocial}_#${numeroFormatado}`;
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Salvamento 1 — pasta de vencimento" (seção 4.4)
// ─────────────────────────────────────────────────────────────────────────

/** @returns {string} ex.: "VENC_SET_10.09" */
function montarNomePastaVencimento(dataVencimento) {
  return `VENC_${MESES_ABREV_PT_MAIUSC[dataVencimento.getMonth()]}_${formatarDataCurta(dataVencimento)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Salvamento 2 — pasta por função" (seção 4.2)
// Código = coluna B ("CONTA NETFLIX"), cargo = coluna C ("ÍTEM") — confirmado.
// AREP e Soft Pré usam "[código] - [CARGO]"; Reunion usa "[código].R - [CARGO]".
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {string} codigo - coluna B ("CONTA NETFLIX")
 * @param {string} cargo - coluna C ("ÍTEM")
 * @param {'AREP'|'REUNION'|'SOFT_PRE'} projetoId
 * @returns {string} ex.: "1301 - DIRETOR GERAL" (AREP/Soft Pré) ou "1301.R - DIRETOR GERAL" (Reunion)
 */
function montarNomePastaFuncao(codigo, cargo, projetoId) {
  const sufixoProjeto = projetoId === 'REUNION' ? '.R' : '';
  return `${codigo}${sufixoProjeto} - ${cargo}`;
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Avaliar pendência de identificação" (seção 4, ciclo 8h/18h)
// Roda no workflow separado fase2_verificar_pendencias.json, agendado de
// hora em hora. Cada pendência tem o timestamp da 1ª pergunta enviada.
// ─────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PendenciaIdentificacao
 * @property {string} primeiraPerguntaEm - ISO datetime
 * @property {boolean} lembreteEnviado
 * @property {string} mensagemIdOriginal - pra correlacionar a resposta da Michelle (reply_to_message_id)
 */

/**
 * @param {Object} params
 * @param {Date} params.agora
 * @param {PendenciaIdentificacao} params.pendencia
 * @returns {{acao: 'nenhuma'|'reenviar_lembrete'|'encerrar_sem_resposta'}}
 */
function avaliarPendenciaIdentificacao({ agora, pendencia }) {
  const primeiraPergunta = new Date(pendencia.primeiraPerguntaEm);
  const horasDecorridas = diferencaHoras(agora, primeiraPergunta);

  if (!pendencia.lembreteEnviado) {
    if (horasDecorridas >= 8) return { acao: 'reenviar_lembrete' };
    return { acao: 'nenhuma' };
  }
  // Lembrete já enviado — conta as 18h adicionais a partir das 8h (26h desde a 1ª pergunta, seção 4).
  if (horasDecorridas >= 26) return { acao: 'encerrar_sem_resposta' };
  return { acao: 'nenhuma' };
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Correlacionar resposta da Michelle" (Telegram) — seção 4, CORRIGIDO
// (commit 3db5653): reply é a forma principal de identificar a pergunta.
// Sem reply E com 2+ pendências abertas ao mesmo tempo → NUNCA adivinhar
// (rejeitado o fallback "mais antiga primeiro" que eu tinha proposto) —
// reenvia a pergunta pedindo explicitamente que ela use "responder".
// Sem reply E só 1 pendência aberta → sem ambiguidade, correlaciona direto.
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {{replyToMessageId?: number}} mensagemRecebida
 * @param {Object} pendencias - conteúdo de pendencias_identificacao.json (chave -> PendenciaIdentificacao)
 * @returns {{resultado: 'correlacionada', chaveCobranca: string} | {resultado: 'ambiguo_pedir_reply', chavesAbertas: string[]} | {resultado: 'nenhuma_pendencia'}}
 */
function correlacionarRespostaMichelle(mensagemRecebida, pendencias) {
  const abertas = Object.entries(pendencias || {}).filter(([, p]) => !p.resolvida);

  if (mensagemRecebida.replyToMessageId) {
    const chave = abertas
      .map(([k]) => k)
      .find(
        (k) => pendencias[k].mensagemIdOriginal === mensagemRecebida.replyToMessageId || pendencias[k].mensagemIdLembrete === mensagemRecebida.replyToMessageId
      );
    if (chave) return { resultado: 'correlacionada', chaveCobranca: chave };
    // reply não bateu com nenhuma pendência conhecida — cai pro tratamento "sem reply" abaixo.
  }

  if (abertas.length === 0) return { resultado: 'nenhuma_pendencia' };
  if (abertas.length === 1) return { resultado: 'correlacionada', chaveCobranca: abertas[0][0] };

  // 2+ pendências abertas, sem reply válido — NUNCA adivinhar (seção 4, correção).
  return { resultado: 'ambiguo_pedir_reply', chavesAbertas: abertas.map(([k]) => k) };
}

// ─────────────────────────────────────────────────────────────────────────
// Exports (pra teste local com Node.js fora do n8n).
// ─────────────────────────────────────────────────────────────────────────

module.exports = {
  normalizar,
  formatarDataCurta,
  diferencaHoras,
  identificarThreadConhecida,
  montarPromptExtracaoNF,
  montarPromptCasarPlanilha,
  parseRespostaIA,
  formatarNumeroNota,
  gerarRetranca,
  montarNomePastaVencimento,
  montarNomePastaFuncao,
  avaliarPendenciaIdentificacao,
  correlacionarRespostaMichelle,
  MESES_ABREV_PT_MAIUSC,
};
