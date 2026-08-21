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

/** Formata data como dd.mm (usado em retranca/pastas — não usado nesta fase, mas mantido por consistência com Fase 2/3+4). */
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

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Separar AREP/Reunion por cor" (exceljs)
// Roda só sobre as linhas do Cost Report S01 (AREP+Reunion compartilhado).
// Regra: Reunion = preenchimento roxo/cinza-arroxeado; AREP = sem preenchimento (seção 5/6).
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} cell - célula do exceljs (worksheet.getCell(...))
 * @returns {boolean} true se a linha tem preenchimento (não é branco/sem cor)
 */
function linhaTemPreenchimento(cell) {
  const fill = cell && cell.fill;
  if (!fill || fill.type !== 'pattern' || fill.pattern !== 'solid') return false;
  const argb = fill.fgColor && fill.fgColor.argb;
  if (!argb) return false;
  // Branco puro ou sem alpha conta como "sem preenchimento".
  return argb !== 'FFFFFFFF' && argb !== '00000000';
}

/**
 * @param {string} argb - cor ARGB da célula da coluna usada como referência de preenchimento da linha
 * @returns {'AREP'|'REUNION'} projeto detectado pela cor
 */
function detectarProjetoPorCor(temPreenchimento) {
  return temPreenchimento ? 'REUNION' : 'AREP';
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Checagem de contrato" (1ª parte da lógica principal — seção 3.1)
// Decide, pra cada linha, se o contrato está liberado, e se precisa buscar
// ficha cadastral no Gmail antes de decidir.
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {string} statusContrato - valor bruto da coluna N
 * @returns {'ASSINADO'|'PENDENTE_VAZIO'} classificação simples da coluna N
 */
function classificarStatusContrato(statusContrato) {
  const norm = normalizar(statusContrato);
  if (norm.includes('assinado')) return 'ASSINADO';
  return 'PENDENTE_VAZIO'; // cobre "Pendente", vazio, "N/A" e qualquer outro valor não reconhecido
}

/**
 * Cruzamento auxiliar com a planilha de Controle de Contratos do projeto
 * (seção 3.1, linha 30): por Razão Social OU nome do colaborador,
 * normalizado (maiúsc./minúsc. e espaços extras ignorados).
 *
 * @param {{razaoSocial?: string, nomeColaborador?: string}} nota
 * @param {Array<{razaoSocial: string, nomeColaborador: string, status: string}>} linhasContratos
 * @returns {{liberado: boolean, statusEncontrado?: string}}
 */
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

/**
 * Busca/validação de ficha cadastral via Gmail — SEM IA, regra determinística
 * (seção 3.1, corrigida no commit 8a06d6b).
 *
 * O sinal de validação é: dentro de uma thread marcada "CONTRATAÇÃO" e
 * relacionada ao colaborador, existe uma MENSAGEM cujo remetente é de FORA
 * do domínio da empresa (o colaborador/representante, não a Michelle/
 * equipe) e que tem pelo menos 1 anexo — ou seja, a RESPOSTA do colaborador
 * com a documentação, não o pedido original (que só teria o modelo em
 * branco).
 *
 * @param {Array<{from: string, hasAttachment: boolean}>} mensagensDaThread - mensagens de uma thread Gmail já buscada (marcador "CONTRATAÇÃO" + nome do colaborador), na ordem em que foram enviadas
 * @param {string} dominioEmpresa - ex.: "novorealitybox.com"
 * @returns {boolean} true se validado
 */
function validarFichaCadastral(mensagensDaThread, dominioEmpresa) {
  const dominioNorm = normalizar(dominioEmpresa);
  return (mensagensDaThread || []).some((msg) => {
    const remetenteDominio = normalizar((msg.from || '').split('@')[1] || '');
    const remetenteExterno = remetenteDominio !== '' && remetenteDominio !== dominioNorm;
    return remetenteExterno && !!msg.hasAttachment;
  });
}

/**
 * Decide se a nota está liberada pra disparo, seguindo a ordem da seção 3.1:
 * 1) coluna N já "ASSINADO" → libera direto.
 * 2) senão, cruza com planilha de Contratos → libera se achar "ASSINADO".
 * 3) senão, sinaliza que precisa buscar ficha cadastral no Gmail (a busca em
 *    si acontece em outro node, porque exige uma chamada real ao Gmail).
 *
 * @returns {{liberado: boolean, precisaBuscarFichaCadastral: boolean, motivoLiberacao?: string}}
 */
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

/**
 * 2ª parte, depois da busca no Gmail (node "Checagem de contrato — etapa 2").
 * Se validou a ficha cadastral: libera E marca a coluna N pra atualizar
 * pra "OK - ASSINADO" (isso NÃO é bloqueado por MODO_EXECUCAO — seção 3.1,
 * linha 31).
 *
 * @returns {{liberado: boolean, atualizarColunaNPara?: string}}
 */
function avaliarContratoEtapa2(fichaCadastralValidada) {
  if (fichaCadastralValidada) {
    return { liberado: true, atualizarColunaNPara: 'OK - ASSINADO' };
  }
  return { liberado: false };
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Tipo de emissão e Ref." (seção 3.2) — heurística por palavra-chave
// na Descrição (coluna J), já que o spec não define uma coluna dedicada
// pro tipo. ASSUNÇÃO: default = "NF normal" quando nenhuma palavra-chave
// bate; PACOTE só é considerado fora do AREP se explicitamente citado
// (seção 3.2: "não deve se repetir fora do AREP").
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {string} descricao - coluna J
 * @param {string} projetoId - 'AREP' | 'REUNION' | 'SOFT_PRE'
 * @returns {'NF_NORMAL'|'JOB'|'DIARIA'|'PACOTE'|'REC_NF'}
 */
function determinarTipoEmissao(descricao, projetoId) {
  const norm = normalizar(descricao);
  if (projetoId === 'AREP' && /\bpacote\b/.test(norm)) return 'PACOTE';
  if (/\brec\b.*\bnf\b|\bloca[cç][aã]o\b/.test(norm)) return 'REC_NF';
  if (/\bdi[aá]ria\b/.test(norm)) return 'DIARIA';
  if (/\bjob\b/.test(norm)) return 'JOB';
  return 'NF_NORMAL';
}

/** Extrai "P.X/Y" (parcela de JOB), se houver, da Descrição (seção 3.2). */
function extrairParcela(descricao) {
  const m = /\bP\.?\s*(\d+)\s*\/\s*(\d+)\b/i.exec(descricao || '');
  return m ? `P.${m[1]}/${m[2]}` : null;
}

const MESES_ABREV_PT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/**
 * Monta o texto "REF. ..." do ASSUNTO (não confundir com o "Ref." do corpo
 * do e-mail, que vem do perfil/apelido) — seção 3.2.
 */
function montarRefAssunto(tipoEmissao, dataVencimento, descricao) {
  const parcela = extrairParcela(descricao);
  switch (tipoEmissao) {
    case 'JOB':
      return parcela ? `REF. JOB (${parcela})` : 'REF. JOB';
    case 'DIARIA':
      return 'REF. DIÁRIA';
    case 'PACOTE':
      return 'REF. PACOTE';
    case 'REC_NF':
      return `EMISSÃO DE NF E REC | REF. ${MESES_ABREV_PT[dataVencimento.getMonth()]}`;
    case 'NF_NORMAL':
    default:
      return `REF. ${MESES_ABREV_PT[dataVencimento.getMonth()]}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Resolver apelido" (seção 6.1) — apelidos.json
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} apelidos - conteúdo de config/apelidos.json, ex.: {"SOFT_PRE": ["SMTC - S02 | SOFT PRE", "PNS | SOFT PRE"]}
 * @param {string} projetoId
 * @returns {string} apelido mais recente (último do array) — usado em e-mails NOVOS
 */
function resolverApelidoAtual(apelidos, projetoId) {
  const lista = (apelidos && apelidos[projetoId]) || [];
  if (lista.length === 0) {
    throw new Error(`Nenhum apelido cadastrado para o projeto ${projetoId} em apelidos.json`);
  }
  return lista[lista.length - 1];
}

/**
 * @returns {boolean} true se `assunto` bate com QUALQUER apelido cadastrado pro projeto (usado na identificação de e-mails recebidos — Fase 2, mas a função mora aqui por depender só de apelidos.json)
 */
function assuntoCorrespondeAoProjeto(assunto, apelidos, projetoId) {
  const lista = (apelidos && apelidos[projetoId]) || [];
  const assuntoNorm = normalizar(assunto);
  return lista.some((apelido) => assuntoNorm.includes(normalizar(apelido)));
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Montar e-mail de pedido" (seções 3.2, 3.3, 3.4)
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

/**
 * @param {Object} params
 * @param {string} params.primeiroNome - ex.: "GUILHERME" ou apelido curto como "BRU" (seção 3.4 mostra "Olá BRU!" pro nome "BRUNA BORTOLAZO" — ASSUNÇÃO: uso o primeiro nome completo por padrão; apelidos carinhosos tipo "BRU" não têm regra determinística, ficam a cargo de ajuste manual se a Michelle preferir)
 * @param {Date} params.dataEnvio - prazo de envio (data do "PROGRAMAR ATÉ", ou hoje se "SOLICITAR")
 * @param {Date} params.dataVencimento
 * @param {string} params.textoRef - perfil.texto_ref (seção 6, ex.: "SMTC - REUNION")
 * @param {number} params.valor
 * @param {string} params.servicoPrestadoComo - cargo/função (coluna J), ou descrição de locação (nunca "serviço prestado" se REC_NF)
 * @param {string} params.nomeColaborador
 * @param {string} params.periodoTexto - ex.: "25/08 A 27/08 (JOB)" — vazio se NF normal/mensal
 * @param {boolean} params.ehLocacao - seção 3.2, regra crítica: nunca "serviço prestado" em locação
 * @returns {string} corpo do e-mail em HTML
 */
function montarCorpoEmailPedido(params) {
  const {
    primeiroNome, dataEnvio, dataVencimento, textoRef, valor,
    servicoPrestadoComo, nomeColaborador, periodoTexto, ehLocacao,
  } = params;

  const valorFormatado = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const linhaServico = ehLocacao
    ? `Locação: ${servicoPrestadoComo}` // regra crítica (3.2): nunca "Serviço Prestado como" em locação
    : `Serviço Prestado como: ${servicoPrestadoComo}`;

  return `Olá ${primeiroNome}! Tudo bem?<br><br>
Seguem as instruções para a emissão da sua nota fiscal que deverá ser enviada até o dia ${formatarDataBR(dataEnvio)} com vencimento em ${formatarDataBR(dataVencimento)}.<br><br>
${TOMADOR_HTML}<br><br>
1- Emitir nota fiscal no valor de R$ ${valorFormatado} com os dados abaixo no corpo da nota:<br>
Ref. "${textoRef}"<br>
${linhaServico}<br>
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

/**
 * Monta o assunto completo: prefixo do apelido + sufixo fixo + REF. + nome.
 * Ex.: "SMTC - S01 | REUNION | EMISSÃO DE NF | REF. JOB (ENVIAR ATÉ 10.08) | GUILHERME HENRIQUE PORTES SIQUEIRA"
 */
function montarAssuntoPedido({ apelidoAtual, refAssunto, dataEnvio, nomeColaborador }) {
  const enviarAte = `ENVIAR ATÉ ${formatarDataCurta(dataEnvio)}`;
  return `${apelidoAtual} | EMISSÃO DE NF | ${refAssunto} (${enviarAte}) | ${nomeColaborador}`;
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

/** @returns {string[]} marcadores a aplicar num e-mail de pedido/cobrança */
function marcadoresPedidoCobranca(projetoId) {
  return [MARCADOR_IA, MARCADOR_PROJETO[projetoId]];
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Modo de execução" (seção 3.1.3) — config_execucao.json
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {{modo: 'rascunho'|'automatico'}} config
 * @returns {boolean}
 */
function ehModoAutomatico(config) {
  return config && config.modo === 'automatico';
}

/**
 * Decide a ação de envio do e-mail (rascunho/agendar/enviar) e se a coluna L
 * deve ser escrita automaticamente — separado da checagem de contrato
 * (coluna N), que nunca é bloqueada pelo modo (seção 3.1, linha 31).
 *
 * @param {'PROGRAMAR_ATE'|'SOLICITAR'} gatilho
 * @param {boolean} modoAutomatico
 * @returns {{acaoGmail: 'criar_rascunho'|'agendar_envio'|'enviar_direto', atualizarColunaL: boolean, novoValorColunaL?: string}}
 */
function decidirAcaoEnvio(gatilho, modoAutomatico) {
  if (!modoAutomatico) {
    return { acaoGmail: 'criar_rascunho', atualizarColunaL: false };
  }
  if (gatilho === 'SOLICITAR') {
    return { acaoGmail: 'enviar_direto', atualizarColunaL: true, novoValorColunaL: 'SOLICITADA MI' };
  }
  // PROGRAMAR_ATE em modo automático: agenda o disparo pra data do prazo (seção 3.1.3).
  return { acaoGmail: 'agendar_envio', atualizarColunaL: true, novoValorColunaL: 'SOLICITADA MI' };
}

// ─────────────────────────────────────────────────────────────────────────
// NODE: "Monitoramento e cobrança" (seção 3.1.1) — cobrancas.json
// ─────────────────────────────────────────────────────────────────────────

const INTERVALO_COBRANCA_DIAS = 5;
const MARGEM_FIM_CICLO_DIAS = 5; // "até aproximadamente 5 dias antes do vencimento"

/**
 * @typedef {Object} EstadoCobranca
 * @property {string} dataUltimaCobranca - ISO date
 * @property {number} contagemCiclos
 * @property {boolean} encerrado
 */

/**
 * Decide a ação de monitoramento pra uma nota já "SOLICITADA MI" cujo Status
 * Box ainda não é "RECEBIDA MI".
 *
 * @param {Object} params
 * @param {Date} params.hoje
 * @param {Date} params.dataProgramarAte
 * @param {Date} params.dataVencimentoNF
 * @param {EstadoCobranca|undefined} params.estadoAtual - undefined = 1ª checagem
 * @returns {{acao: 'nenhuma'|'cobrar'|'encerrar_sem_resposta', novoEstado?: EstadoCobranca}}
 */
function avaliarCobranca({ hoje, dataProgramarAte, dataVencimentoNF, estadoAtual }) {
  if (estadoAtual && estadoAtual.encerrado) {
    return { acao: 'nenhuma' }; // ciclo já encerrado, sem mais ação automática (seção 3.1.1)
  }

  const fimDoCiclo = somarDias(dataVencimentoNF, -MARGEM_FIM_CICLO_DIAS);

  // Ainda não chegou o dia do prazo original — nada a fazer.
  if (diferencaDias(hoje, dataProgramarAte) < 0) {
    return { acao: 'nenhuma' };
  }

  // Passou do fim do ciclo sem resposta → alerta + encerra.
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

  // 1ª cobrança: dia seguinte ao prazo original (seção 3.1.1, "agendar... para o dia seguinte").
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

  // Cobranças seguintes: a cada ~5 dias desde a última.
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
  determinarTipoEmissao,
  extrairParcela,
  montarRefAssunto,
  resolverApelidoAtual,
  assuntoCorrespondeAoProjeto,
  montarCorpoEmailPedido,
  montarAssuntoPedido,
  marcadoresPedidoCobranca,
  ehModoAutomatico,
  decidirAcaoEnvio,
  avaliarCobranca,
  MARCADOR_PROJETO,
  MARCADOR_IA,
  MARCADOR_CONTRATACAO,
  MARCADOR_DANILO,
};
