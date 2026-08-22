/**
 * Fase 1 — Solicitação de nota ao colaborador
 * Lógica determinística usada nos nodes de Code do workflow
 * workflows/fase1_solicitacao_nota.json (e .homolog.json).
 *
 * Cada seção abaixo corresponde a UM node de Code no workflow (nomes citados
 * nos comentários). n8n Code nodes não fazem require() de arquivo externo —
 * o conteúdo de cada função é colado dentro do node correspondente. Este
 * arquivo existe pra manter tudo versionado, legível e testável fora do n8n.
 *
 * Referências de seção são todas de docs/spec.md.
 *
 * ATENÇÃO (spec.md seção 3.2, commit 1ca83a7): o parsing da coluna J e a
 * identificação de linha RECIBO/NOTA FISCAL (seção 3.2.1) usam IA (API da
 * Claude) — NÃO são mais 100% determinísticos. As funções de "montagem"
 * abaixo (templates de e-mail, agrupamento, regra de assunto) continuam
 * determinísticas; quem chama a IA e interpreta o texto semanticamente é um
 * node HTTP Request separado no workflow (ver montarPromptParsingColunaJ /
 * parseRespostaIA abaixo, que só preparam/interpretam a chamada).
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Utilitários gerais
// ─────────────────────────────────────────────────────────────────────────

/** Normaliza texto pra comparação: minúsculas, sem acentos, espaços colapsados. (seção 3.1, "ignorando maiúsc./minúsc. e espaços extras") */
function normalizar(texto) {
  if (!texto) return '';
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Soma dias a uma data (retorna novo Date, não muta o original). */
function somarDias(data, dias) {
  const d = new Date(data);
  d.setDate(d.getDate() + dias);
  return d;
}

/** Diferença em dias inteiros entre duas datas (a - b). */
function diferencaDias(a, b) {
  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  const utc1 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utc2 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utc1 - utc2) / MS_POR_DIA);
}

/** Formata data como dd/mm/aaaa. */
function formatarDataBR(data) {
  const dd = String(data.getDate()).padStart(2, '0');
  const mm = String(data.getMonth() + 1).padStart(2, '0');
  const aaaa = data.getFullYear();
  return `${dd}/${mm}/${aaaa}`;
}

/** Formata data como dd.mm (usado no "ENVIAR ATÉ" do assunto). */
function formatarDataCurta(data) {
  const dd = String(data.getDate()).padStart(2, '0');
  const mm = String(data.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

/**
 * Extrai data de um texto "PROGRAMAR ATÉ dd/mm" ou "PROGRAMAR ATÉ dd/mm/aaaa"
 * (seção 3.1, "Status Box = 'PROGRAMAR ATÉ [data]' (texto exato)").
 * Assume o ano corrente quando não informado.
 */
function extrairDataProgramarAte(statusBox, anoReferencia) {
  const m = /PROGRAMAR AT[ÉE]\s+(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/i.exec(statusBox || '');
  if (!m) return null;
  const dia = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10) - 1;
  const ano = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : anoReferencia;
  return new Date(ano, mes, dia);
}

/** Detecta se o Status Box é uma variante de "SOLICITAR" (seção 3.1, 3º: "SOLICITAR"/"SOLICITAR URG"/qualquer variante). */
function ehVarianteSolicitar(statusBox) {
  return /^SOLICITAR/i.test((statusBox || '').trim());
}

const MESES_ABREV_PT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Separar AREP/Reunion por cor" (exceljs)
// Roda só sobre as linhas do Cost Report S01 (AREP+Reunion compartilhado).
// Regra: Reunion = preenchimento roxo/cinza-arroxeado; AREP = sem preenchimento (seção 5/6).
// ─────────────────────────────────────────────────────────────────────────

function linhaTemPreenchimento(cell) {
  const fill = cell && cell.fill;
  if (!fill || fill.type !== 'pattern' || fill.pattern !== 'solid') return false;
  const argb = fill.fgColor && fill.fgColor.argb;
  if (!argb) return false;
  return argb !== 'FFFFFFFF' && argb !== '00000000';
}

function detectarProjetoPorCor(temPreenchimento) {
  return temPreenchimento ? 'REUNION' : 'AREP';
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Checagem de contrato" (seção 3.1)
// ─────────────────────────────────────────────────────────────────────────

function classificarStatusContrato(statusContrato) {
  const norm = normalizar(statusContrato);
  if (norm.includes('assinado')) return 'ASSINADO';
  return 'PENDENTE_VAZIO';
}

function cruzarComPlanilhaContratos(nota, linhasContratos) {
  const alvoRazao = normalizar(nota.razaoSocial);
  const alvoNome = normalizar(nota.nomeColaborador);
  const encontrada = (linhasContratos || []).find((linha) => {
    const razao = normalizar(linha.razaoSocial);
    const nome = normalizar(linha.nomeColaborador);
    return (alvoRazao && razao === alvoRazao) || (alvoNome && nome === alvoNome);
  });
  if (!encontrada) return { liberado: false };
  const status = classificarStatusContrato(encontrada.status);
  return { liberado: status === 'ASSINADO', statusEncontrado: encontrada.status };
}

function validarFichaCadastral(mensagensDaThread, dominioEmpresa) {
  const dominioNorm = normalizar(dominioEmpresa);
  return (mensagensDaThread || []).some((msg) => {
    const remetenteDominio = normalizar((msg.from || '').split('@')[1] || '');
    const remetenteExterno = remetenteDominio !== '' && remetenteDominio !== dominioNorm;
    return remetenteExterno && !!msg.hasAttachment;
  });
}

function avaliarContratoEtapa1(nota, linhasContratos) {
  const statusN = classificarStatusContrato(nota.statusContrato);
  if (statusN === 'ASSINADO') {
    return { liberado: true, precisaBuscarFichaCadastral: false, motivoLiberacao: 'coluna_n' };
  }
  const cruzamento = cruzarComPlanilhaContratos(nota, linhasContratos);
  if (cruzamento.liberado) {
    return { liberado: true, precisaBuscarFichaCadastral: false, motivoLiberacao: 'planilha_contratos' };
  }
  return { liberado: false, precisaBuscarFichaCadastral: true };
}

function avaliarContratoEtapa2(fichaCadastralValidada) {
  if (fichaCadastralValidada) {
    return { liberado: true, atualizarColunaNPara: 'OK - ASSINADO' };
  }
  return { liberado: false };
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Preparar chamada de IA (parsing coluna J)" — seção 3.2, 3.2.1
//
// A IA (Claude) é usada para interpretar semanticamente a coluna J porque
// não existe um separador de posição confiável entre Cargo e Nome (ex.:
// "AGENCIAMENTO DE FIGURAÇÃO" vs "LARISSA CRISTIANE DO AMARAL GOMES" não têm
// um padrão estrutural que os diferencie — só o conteúdo semântico).
//
// Este node só MONTA o prompt; quem chama a API é o node HTTP Request
// seguinte no workflow (credencial "Claude account (dev)" ou "(produção)",
// modelo Claude Haiku 4.5 — seção 7.1).
// ─────────────────────────────────────────────────────────────────────────

const PROMPT_SISTEMA_PARSING_COLUNA_J = `Você extrai dados estruturados da coluna "Descrição" (coluna J) de uma planilha de controle de notas fiscais da produtora Box Fish.

O texto pode descrever:
(a) um COLABORADOR prestando serviço — geralmente tem um Cargo, um Nome de pessoa, e opcionalmente um período (DD/MM A DD/MM) e uma palavra-chave de tipo entre parênteses (JOB, DIÁRIA, DIÁRIAS, PACOTE, REC, REC+NF); ou
(b) um FORNECEDOR de locação/recibo — geralmente é uma empresa (razão social), sem nome de pessoa física, descrevendo uma locação (equipamento, estúdio, gerador etc.) ou um serviço faturado por fornecedor.

Responda SOMENTE com um objeto JSON (sem markdown, sem texto fora do JSON) no formato:
{
  "tipoLinha": "colaborador" | "fornecedor",
  "periodo": "DD/MM A DD/MM" | null,
  "tipoEmissao": "NF_NORMAL" | "JOB" | "DIARIA" | "PACOTE" | "REC" | "REC_NF" | null,
  "parcela": "P.X/Y" | null,
  "cargo": string | "FALTA INFORMAÇÃO" | null,
  "nomeColaborador": string | "FALTA INFORMAÇÃO" | null,
  "documentoLinha": "RECIBO" | "NOTA_FISCAL" | null,
  "descricaoServicoOuLocacao": string,
  "situacaoNaoMapeada": string | null
}

Regras:
- "tipoEmissao" só se aplica a colaborador (JOB/DIÁRIA/PACOTE) ou é REC/REC_NF pra fornecedor; ausência de palavra-chave em caso de colaborador = "NF_NORMAL".
- "documentoLinha" só se aplica a fornecedor: use o prefixo "(REC)"/"(NF)" quando existir no texto; se não houver marcação inequívoca, infira pelo conteúdo semântico (locação/aluguel = RECIBO; prestação de serviço = NOTA_FISCAL) SOMENTE se estiver claro; caso contrário null.
- "descricaoServicoOuLocacao": o texto do serviço ou da locação, SEM o nome do projeto (REUNION, AREP, SOFT PRE, PNS, PNL etc. — remova essas menções) e SEM o período (que já vai no campo "periodo").
- Se não conseguir preencher cargo e/ou nomeColaborador com confiança (caso colaborador), use "FALTA INFORMAÇÃO" nesse campo — NUNCA invente.
- Se encontrar qualquer situação não coberta por estas regras (ambiguidade real, formato inesperado, impossível decidir RECIBO vs NOTA_FISCAL sem adivinhar), preencha "situacaoNaoMapeada" descrevendo o problema — NUNCA adivinhe um valor pra contornar isso.`;

/**
 * @param {{colunaJ: string, colunaH: string}} nota
 * @returns {{system: string, user: string}} payload pronto pro node HTTP Request (Claude Messages API)
 */
function montarPromptParsingColunaJ(nota) {
  return {
    system: PROMPT_SISTEMA_PARSING_COLUNA_J,
    user: JSON.stringify({ colunaJ: nota.colunaJ || '', colunaH: nota.colunaH || '' }),
  };
}

/**
 * Interpreta a resposta da IA (texto bruto retornado pela API da Claude).
 * Nunca lança exceção — qualquer falha de parsing vira `situacaoNaoMapeada`,
 * seguindo a regra geral de segurança (seção 3.2, item 6): nunca adivinhar,
 * sempre alertar.
 *
 * @param {string} textoResposta
 * @returns {Object} objeto no formato descrito em PROMPT_SISTEMA_PARSING_COLUNA_J
 */
function parseRespostaIA(textoResposta) {
  try {
    const obj = JSON.parse(textoResposta);
    if (!obj || !obj.tipoLinha) {
      return { situacaoNaoMapeada: 'Resposta da IA sem "tipoLinha" — resposta bruta: ' + String(textoResposta).slice(0, 300) };
    }
    return obj;
  } catch (e) {
    return { situacaoNaoMapeada: 'Resposta da IA não é JSON válido: ' + String(textoResposta).slice(0, 300) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Resolver apelido" (seção 6.1) — apelidos.json
// ─────────────────────────────────────────────────────────────────────────

function resolverApelidoAtual(apelidos, projetoId) {
  const lista = (apelidos && apelidos[projetoId]) || [];
  if (lista.length === 0) {
    throw new Error(`Nenhum apelido cadastrado para o projeto ${projetoId} em apelidos.json`);
  }
  return lista[lista.length - 1];
}

function assuntoCorrespondeAoProjeto(assunto, apelidos, projetoId) {
  const lista = (apelidos && apelidos[projetoId]) || [];
  const assuntoNorm = normalizar(assunto);
  return lista.some((apelido) => assuntoNorm.includes(normalizar(apelido)));
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Montar e-mail — colaborador" (seções 3.2, 3.3, 3.4)
// Réplica fiel do template real — mesmo espaçamento, negrito, grifo,
// disclaimer e assinatura. HTML porque o rascunho do Gmail é rich text.
// ─────────────────────────────────────────────────────────────────────────

const TOMADOR_HTML = `Tomador<br>
BOXFISH PRODUTORA DE PROGRAMAS TELEVISIVOS, INTERNET E FILMES PUBLICITÁRIOS LTDA.<br>
Endereço: Rua Butantã, 194, sala 24, Pinheiros.<br>
CEP 05.424-000 - São Paulo, SP<br>
CNPJ: 14.788.649/0001-23<br>
IM: 4.436.095-9<br>
IE: ISENTA`;

const AVISO_DADOS_BANCARIOS_HTML = `<span style="background-color:#FFFF00;">"Os dados bancários considerados para pagamento são os que estão cadastrados.<br>
O cadastro é feito baseado nas informações cedidas pelo contratado através do preenchimento de ficha cadastral da Box.<br>
Qualquer alteração bancária ou mudança na forma de pagamento deve ser notificada por e-mail pelo contratado e se faz necessário atualização da ficha cadastral e envio prévio ao responsável financeiro do projeto."</span>`;

/** Extrai "P.X/Y" (parcela), se houver — usado como fallback quando a IA não retorna `parcela`. */
function extrairParcela(descricao) {
  const m = /\bP\.?\s*(\d+)\s*\/\s*(\d+)\b/i.exec(descricao || '');
  return m ? `P.${m[1]}/${m[2]}` : null;
}

/**
 * Monta o texto "REF. ..." do ASSUNTO pra caso COLABORADOR (não confundir
 * com o "Ref." do corpo do e-mail, que vem do perfil/apelido) — seção 3.2.
 */
function montarRefAssuntoColaborador(tipoEmissao, dataEnvio, parcela) {
  switch (tipoEmissao) {
    case 'JOB':
      return parcela ? `REF. JOB (${parcela})` : 'REF. JOB';
    case 'DIARIA':
      return 'REF. DIÁRIA';
    case 'PACOTE':
      return 'REF. PACOTE';
    case 'NF_NORMAL':
    default:
      // Mês vem do ENVIO, não do vencimento — evidência real (seção 3.2.1,
      // exemplo Media Arts): envio 25/08 -> "REF. LOCAÇÃO - AGO", vencimento
      // 20/09 (seria SET se fosse por vencimento). Mesma convenção aplicada
      // aqui por consistência (não há exemplo NF_NORMAL puro pra confirmar,
      // mas ambos usam o mesmo padrão "REF. [MÊS]").
      return `REF. ${MESES_ABREV_PT[dataEnvio.getMonth()]}`;
  }
}

/**
 * Monta o texto do período pro CORPO do e-mail, com a palavra-chave de tipo
 * entre parênteses logo em seguida quando houver (seção 3.2, item 2: "No
 * corpo do e-mail, ela SEMPRE aparece entre parênteses logo após o período,
 * ex.: 'Período de 25/08 A 27/08 (JOB)'"). NF normal não escreve nada entre
 * parênteses (ausência de palavra-chave).
 *
 * @param {string|null} periodo - "DD/MM A DD/MM" (campo `periodo` retornado pela IA), ou null/vazio se não houver
 * @param {'NF_NORMAL'|'JOB'|'DIARIA'|'PACOTE'} tipoEmissao
 * @returns {string} ex.: "25/08 A 27/08 (JOB)", "" (NF normal sem período)
 */
function montarPeriodoTexto(periodo, tipoEmissao) {
  if (!periodo) return '';
  const PALAVRA_CHAVE = { JOB: 'JOB', DIARIA: 'DIÁRIA', PACOTE: 'PACOTE' };
  const palavra = PALAVRA_CHAVE[tipoEmissao];
  return palavra ? `${periodo} (${palavra})` : periodo;
}

/**
 * @param {Object} params
 * @param {string} params.primeiroNome
 * @param {Date} params.dataEnvio - prazo de envio
 * @param {Date} params.dataVencimento
 * @param {string} params.textoRef - perfil.texto_ref (seção 6, ex.: "SMTC - REUNION")
 * @param {number} params.valor
 * @param {string} params.cargo
 * @param {string} params.nomeColaborador
 * @param {string} params.periodoTexto - já composto via montarPeriodoTexto(), ex.: "25/08 A 27/08 (JOB)" — vazio se NF normal/mensal
 * @returns {string} corpo do e-mail em HTML
 */
function montarCorpoEmailColaborador(params) {
  const { primeiroNome, dataEnvio, dataVencimento, textoRef, valor, cargo, nomeColaborador, periodoTexto } = params;
  const valorFormatado = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return `Olá ${primeiroNome}! Tudo bem?<br><br>
Seguem as instruções para a emissão da sua nota fiscal que deverá ser enviada até o dia ${formatarDataBR(dataEnvio)} com vencimento em ${formatarDataBR(dataVencimento)}.<br><br>
${TOMADOR_HTML}<br><br>
1- Emitir nota fiscal no valor de R$ ${valorFormatado} com os dados abaixo no corpo da nota:<br>
Ref. "${textoRef}"<br>
Serviço Prestado como: ${cargo}<br>
Colaborador: ${nomeColaborador}<br>
${periodoTexto ? `Período de ${periodoTexto}<br>` : ''}
Dados bancários:<br>
Chave pix:<br>
---------------------------------------------------------------------<br><br>
Importante: Peço a gentileza de enviar a sua nota nestes e-mails:<br>
financeiro@novorealitybox.com<br>
financeiro1@novorealitybox.com<br><br>
${AVISO_DADOS_BANCARIOS_HTML}<br><br>
Muito obrigada! Beijo 🌷`;
}

function montarAssuntoColaborador({ apelidoAtual, refAssunto, dataEnvio, nomeColaborador }) {
  const enviarAte = `ENVIAR ATÉ ${formatarDataCurta(dataEnvio)}`;
  return `${apelidoAtual} | EMISSÃO DE NF | ${refAssunto} (${enviarAte}) | ${nomeColaborador}`;
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Agrupar e montar e-mail — fornecedor (REC/REC+NF)" (seção 3.2.1)
//
// Diferente do caso colaborador (1 linha = 1 e-mail), aqui MÚLTIPLAS linhas
// da planilha (mesmo projeto + fornecedor + vencimento) viram UM e-mail com
// blocos numerados — 1 bloco por linha, ordem: todos os RECIBO primeiro,
// depois todas as NOTA_FISCAL (regra confirmada por 2 exemplos reais).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Agrupa linhas classificadas tipoLinha='fornecedor' por (projeto, fornecedor
 * normalizado, vencimento). Preserva a ordem original de aparição na planilha
 * dentro de cada grupo (spec.md: "Numerar os blocos na ordem em que aparecem
 * na planilha").
 *
 * @param {Array<Object>} linhasFornecedor - itens já com `nota` e o resultado da IA (`documentoLinha`, `descricaoServicoOuLocacao`, etc.) anexado
 * @returns {Array<Array<Object>>} lista de grupos (cada grupo é uma lista de itens)
 */
function agruparLinhasFornecedor(linhasFornecedor) {
  const grupos = new Map();
  for (const item of linhasFornecedor) {
    const chave = [item.nota.projetoId, normalizar(item.nota.colunaH), item.nota.colunaG].join('|');
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(item);
  }
  return Array.from(grupos.values());
}

/**
 * Ordena os itens de um grupo: RECIBO primeiro (ordem original), depois
 * NOTA_FISCAL (ordem original). Itens sem classificação clara (`documentoLinha`
 * null/ausente) são separados — não entram no e-mail, viram alerta (regra
 * geral de segurança, seção 3.2 item 6 / 3.2.1: "NÃO adivinhar").
 *
 * @returns {{blocosOrdenados: Array<Object>, semClassificacao: Array<Object>}}
 */
function ordenarBlocosGrupo(grupo) {
  const recibos = grupo.filter((i) => i.documentoLinha === 'RECIBO');
  const notas = grupo.filter((i) => i.documentoLinha === 'NOTA_FISCAL');
  const semClassificacao = grupo.filter((i) => i.documentoLinha !== 'RECIBO' && i.documentoLinha !== 'NOTA_FISCAL');
  return { blocosOrdenados: [...recibos, ...notas], semClassificacao };
}

function montarBlocoRecibo(numero, item, textoRef) {
  const valorFormatado = item.nota.colunaK.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${numero}- Emitir RECIBO no valor de R$ ${valorFormatado} com os dados abaixo no corpo do recibo:<br>
Ref. "${textoRef}"<br>
Fornecedor: ${item.nota.colunaH}<br>
Período de ${item.periodo || ''} - ${item.descricaoServicoOuLocacao}<br>
Dados bancários:<br>
Chave pix:<br>
---------------------------------------------------------------------`;
}

function montarBlocoNotaFiscal(numero, item, textoRef) {
  const valorFormatado = item.nota.colunaK.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${numero}- Emitir NOTA FISCAL no valor de R$ ${valorFormatado} com os dados abaixo no corpo da nota:<br>
Ref. "${textoRef}"<br>
Fornecedor: ${item.nota.colunaH}<br>
Serviço Prestado: ${item.descricaoServicoOuLocacao}<br>
Período de ${item.periodo || ''}<br>
Dados bancários:<br>
Chave pix:<br>
---------------------------------------------------------------------`;
}

/**
 * Monta o corpo completo do e-mail de fornecedor (1 ou mais blocos).
 * ASSUNÇÃO (flagada): normalizei a formatação (espaçamento, "com vencimento
 * em DD/MM/AAAA") pro mesmo padrão usado no template de colaborador — os 2
 * exemplos reais da seção 3.2.1 têm pequenas variações entre si (dia da
 * semana citado só num deles, "para"/"em", ano com 2 ou 4 dígitos) que
 * pareceram inconsistência de digitação manual, não regra confirmada.
 *
 * @param {Object} params
 * @param {Array<Object>} params.blocosOrdenados - itens já ordenados (ordenarBlocosGrupo)
 * @param {boolean} params.temNotaFiscal
 * @param {Date} params.dataEnvio
 * @param {Date} params.dataVencimento
 * @param {string} params.textoRef
 * @returns {string} HTML
 */
function montarCorpoEmailFornecedor(params) {
  const { blocosOrdenados, temNotaFiscal, dataEnvio, dataVencimento, textoRef } = params;

  const abertura = temNotaFiscal
    ? `Seguem as instruções para a emissão do RECIBO e da NOTA FISCAL que deverão ser enviadas até o dia ${formatarDataBR(dataEnvio)} com vencimento em ${formatarDataBR(dataVencimento)}:`
    : `Seguem as instruções para a emissão da sua FATURA que deverá ser enviada até o dia ${formatarDataBR(dataEnvio)} com vencimento em ${formatarDataBR(dataVencimento)}.`; // seção 3.2.1: REC puro sempre fala "FATURA" na abertura, mesmo o bloco dizendo "Emitir RECIBO"

  const blocosHtml = blocosOrdenados
    .map((item, idx) => (item.documentoLinha === 'RECIBO' ? montarBlocoRecibo(idx + 1, item, textoRef) : montarBlocoNotaFiscal(idx + 1, item, textoRef)))
    .join('<br><br>\n');

  return `Olá! Tudo bem?<br><br>
${abertura}<br><br>
${TOMADOR_HTML}<br><br>
${blocosHtml}<br><br>
Importante: Peço a gentileza de enviar a sua nota nestes e-mails:<br>
financeiro@novorealitybox.com<br>
financeiro1@novorealitybox.com<br><br>
${AVISO_DADOS_BANCARIOS_HTML}<br><br>
Muito obrigada! Beijo 🌷`;
}

/**
 * Regra do assunto pra fornecedor (seção 3.2.1) — diferencia REC puro de
 * REC+NF pelo texto do "Ref.", não pela palavra RECIBO/FATURA.
 *
 * @param {Object} params
 * @param {string} params.apelidoAtual
 * @param {boolean} params.temNotaFiscal
 * @param {string|null} params.parcela - "P.X/Y", se a linha (REC puro) indicar locação parcelada
 * @param {Date} params.dataEnvio
 * @param {string} params.fornecedor
 * @returns {string}
 */
function montarAssuntoFornecedor({ apelidoAtual, temNotaFiscal, parcela, dataEnvio, fornecedor }) {
  // Mês vem do ENVIO, não do vencimento — confirmado pelo exemplo real da
  // Media Arts (seção 3.2.1): envio 25/08, vencimento 20/09/2026, assunto
  // real é "REF. LOCAÇÃO - AGO" (mês do envio), não "SET" (mês do vencimento).
  const mes = MESES_ABREV_PT[dataEnvio.getMonth()];
  const palavraDocumento = temNotaFiscal ? 'EMISSÃO DE FATURA' : 'EMISSÃO DE RECIBO'; // REC puro: a palavra é indiferente por spec — fixamos "RECIBO" por padrão determinístico
  const ref = temNotaFiscal
    ? `REF. LOCAÇÃO E SERVIÇOS - ${mes}`
    : `REF. LOCAÇÃO - ${mes}${parcela ? ' - ' + parcela : ''}`;
  return `${apelidoAtual} | ${palavraDocumento} | ${ref} | (ENVIAR ATÉ ${formatarDataCurta(dataEnvio)}) | ${fornecedor}`;
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Marcadores de e-mail" (seção 3.1.2)
// ─────────────────────────────────────────────────────────────────────────

const MARCADOR_PROJETO = {
  REUNION: 'REUNION - PEDIDO DE NOTAS',
  SOFT_PRE: 'SOFT PRE - PEDIDO NOTAS',
  AREP: 'AREP - PEDIDO DE NOTAS',
};

const MARCADOR_IA = 'IA';
const MARCADOR_CONTRATACAO = 'CONTRATAÇÃO';
const MARCADOR_DANILO = 'DANILO FINANCEIRO'; // usado só na Fase 3+4, mantido aqui por ser a mesma tabela

function marcadoresPedidoCobranca(projetoId) {
  return [MARCADOR_IA, MARCADOR_PROJETO[projetoId]];
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Modo de execução" (seção 3.1.3) — config_execucao.json
// ─────────────────────────────────────────────────────────────────────────

function ehModoAutomatico(config) {
  return config && config.modo === 'automatico';
}

function decidirAcaoEnvio(gatilho, modoAutomatico) {
  if (!modoAutomatico) {
    return { acaoGmail: 'criar_rascunho', atualizarColunaL: false };
  }
  if (gatilho === 'SOLICITAR') {
    return { acaoGmail: 'enviar_direto', atualizarColunaL: true, novoValorColunaL: 'SOLICITADA MI' };
  }
  return { acaoGmail: 'agendar_envio', atualizarColunaL: true, novoValorColunaL: 'SOLICITADA MI' };
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Monitoramento e cobrança" (seção 3.1.1) — cobrancas.json
// ─────────────────────────────────────────────────────────────────────────

const INTERVALO_COBRANCA_DIAS = 5;
const MARGEM_FIM_CICLO_DIAS = 5;

function avaliarCobranca({ hoje, dataProgramarAte, dataVencimentoNF, estadoAtual }) {
  if (estadoAtual && estadoAtual.encerrado) {
    return { acao: 'nenhuma' };
  }

  const fimDoCiclo = somarDias(dataVencimentoNF, -MARGEM_FIM_CICLO_DIAS);

  if (diferencaDias(hoje, dataProgramarAte) < 0) {
    return { acao: 'nenhuma' };
  }

  if (diferencaDias(hoje, fimDoCiclo) >= 0) {
    return {
      acao: 'encerrar_sem_resposta',
      novoEstado: {
        dataUltimaCobranca: estadoAtual ? estadoAtual.dataUltimaCobranca : null,
        contagemCiclos: estadoAtual ? estadoAtual.contagemCiclos : 0,
        encerrado: true,
      },
    };
  }

  if (!estadoAtual) {
    const diaDaPrimeiraCobranca = somarDias(dataProgramarAte, 1);
    if (diferencaDias(hoje, diaDaPrimeiraCobranca) >= 0) {
      return {
        acao: 'cobrar',
        novoEstado: { dataUltimaCobranca: hoje.toISOString().slice(0, 10), contagemCiclos: 1, encerrado: false },
      };
    }
    return { acao: 'nenhuma' };
  }

  const dataUltima = new Date(estadoAtual.dataUltimaCobranca);
  if (diferencaDias(hoje, dataUltima) >= INTERVALO_COBRANCA_DIAS) {
    return {
      acao: 'cobrar',
      novoEstado: {
        dataUltimaCobranca: hoje.toISOString().slice(0, 10),
        contagemCiclos: estadoAtual.contagemCiclos + 1,
        encerrado: false,
      },
    };
  }

  return { acao: 'nenhuma' };
}

// ─────────────────────────────────────────────────────────────────────────
// Exports (pra teste local com Node.js fora do n8n; dentro do n8n, cada
// função relevante é colada no Code node correspondente).
// ─────────────────────────────────────────────────────────────────────────

module.exports = {
  normalizar,
  somarDias,
  diferencaDias,
  formatarDataBR,
  formatarDataCurta,
  extrairDataProgramarAte,
  ehVarianteSolicitar,
  linhaTemPreenchimento,
  detectarProjetoPorCor,
  classificarStatusContrato,
  cruzarComPlanilhaContratos,
  validarFichaCadastral,
  avaliarContratoEtapa1,
  avaliarContratoEtapa2,
  montarPromptParsingColunaJ,
  parseRespostaIA,
  resolverApelidoAtual,
  assuntoCorrespondeAoProjeto,
  extrairParcela,
  montarRefAssuntoColaborador,
  montarPeriodoTexto,
  montarCorpoEmailColaborador,
  montarAssuntoColaborador,
  agruparLinhasFornecedor,
  ordenarBlocosGrupo,
  montarBlocoRecibo,
  montarBlocoNotaFiscal,
  montarCorpoEmailFornecedor,
  montarAssuntoFornecedor,
  marcadoresPedidoCobranca,
  ehModoAutomatico,
  decidirAcaoEnvio,
  avaliarCobranca,
  MARCADOR_PROJETO,
  MARCADOR_IA,
  MARCADOR_CONTRATACAO,
  MARCADOR_DANILO,
  MESES_ABREV_PT,
};
