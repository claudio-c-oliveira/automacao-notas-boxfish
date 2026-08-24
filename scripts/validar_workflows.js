#!/usr/bin/env node
/**
 * Validador de workflows do n8n — confere os PARÂMETROS de cada node contra a
 * definição oficial do node type, extraída do pacote real `n8n-nodes-base`.
 *
 * Motivo de existir: o editor do n8n só sinaliza visualmente campo vazio ou
 * valor fora de uma lista fechada. Ele NÃO avisa quando o JSON usa um nome de
 * parâmetro que o node não conhece — o campo simplesmente aparece vazio na UI,
 * silenciosamente. Foi assim que passaram despercebidos os bugs de `to` (o nome
 * certo é `sendTo`), `operation: "search"` (não existe) e `operation:
 * "uploadVersion"` no Box (não existe).
 *
 * O que ele detecta:
 *   [ERRO]   parâmetro com nome que não existe no node type
 *   [ERRO]   valor de resource/operation fora da lista oficial
 *   [ERRO]   parâmetro obrigatório ausente
 *   [AVISO]  parâmetro presente que o n8n nem exibiria (displayOptions não
 *            satisfeitas) — normalmente indica config morta/errada
 *   [ERRO]   chave desconhecida dentro de collection/fixedCollection
 *            (ex.: options, filters, additionalFields)
 *
 * Uso:
 *   node scripts/validar_workflows.js                 # valida todos em workflows/
 *   node scripts/validar_workflows.js caminho.json    # valida um arquivo
 *
 * As definições ficam em scripts/n8n_node_defs.json (gerado a partir do pacote
 * n8n-nodes-base — ver cabeçalho desse arquivo pra saber a versão).
 * Sai com código 1 se houver qualquer [ERRO].
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFS_PATH = path.join(__dirname, 'n8n_node_defs.json');
const DEFS = JSON.parse(fs.readFileSync(DEFS_PATH, 'utf8')).nodeTypes;

/** Propriedades que o n8n injeta em todo node, fora da definição do node type. */
const PARAMS_UNIVERSAIS = new Set(['notice', 'authentication', 'requestOptions']);

/**
 * Resolve o valor efetivo de um parâmetro: explícito, ou o default da definição.
 *
 * Cuidado: pode existir MAIS DE UMA propriedade com o mesmo nome (ex.: "operation"
 * aparece uma vez por resource, cada uma com seu default). Pegar a primeira levava
 * a falso-positivo — é preciso preferir aquela cujas próprias displayOptions batem
 * com os parâmetros explícitos do node.
 */
function valorEfetivo(chave, params, props, _profundidade = 0) {
  if (Object.prototype.hasOwnProperty.call(params, chave)) return params[chave];
  const candidatas = props.filter((p) => p.name === chave);
  if (candidatas.length === 0) return undefined;
  if (candidatas.length === 1 || _profundidade > 3) return candidatas[0].default;

  const compativel = candidatas.find((p) => {
    const show = p.displayOptions && p.displayOptions.show;
    if (!show) return true;
    return Object.entries(show).every(([k, permitidos]) => {
      if (k.startsWith('@') || !Array.isArray(permitidos)) return true;
      const v = valorEfetivo(k, params, props, _profundidade + 1);
      return permitidos.some((x) => x === v);
    });
  });
  return (compativel || candidatas[0]).default;
}

/** Avalia se as displayOptions de uma propriedade são satisfeitas pelos params do node. */
function displayOptionsSatisfeitas(prop, params, props) {
  const dop = prop.displayOptions;
  if (!dop) return true;

  const condicaoBate = (cond) => {
    for (const [chave, permitidos] of Object.entries(cond)) {
      if (chave.startsWith('@')) continue; // @version etc. — fora do escopo desta checagem
      const atual = valorEfetivo(chave, params, props);
      if (!Array.isArray(permitidos)) continue;
      const bateAlgum = permitidos.some((p) => {
        if (p && typeof p === 'object' && '_cnd' in p) return true; // condição avançada — não avalia
        return p === atual;
      });
      if (!bateAlgum) return false;
    }
    return true;
  };

  if (dop.show && !condicaoBate(dop.show)) return false;
  if (dop.hide && condicaoBate(dop.hide)) return false;
  return true;
}

/** Extrai as chaves internas válidas de uma propriedade collection/fixedCollection. */
function chavesInternasValidas(prop) {
  if (!Array.isArray(prop.options)) return null;
  if (prop.type === 'collection') {
    return new Set(prop.options.map((o) => o && o.name).filter(Boolean));
  }
  if (prop.type === 'fixedCollection') {
    return new Set(prop.options.map((o) => o && o.name).filter(Boolean));
  }
  return null;
}

function validarNode(node, achados) {
  const def = DEFS[node.type];
  const registrar = (nivel, msg) => achados.push({ nivel, node: node.name, msg });

  if (!def) return; // node type sem definição disponível (ex.: manualTrigger, noOp) — ignora
  const props = def.properties;
  const params = node.parameters || {};

  // 1) Todo parâmetro presente precisa existir na definição, e ser exibível.
  for (const chave of Object.keys(params)) {
    if (PARAMS_UNIVERSAIS.has(chave)) continue;

    const candidatas = props.filter((p) => p.name === chave);
    if (candidatas.length === 0) {
      registrar('ERRO', `parâmetro "${chave}" não existe no node type ${node.type}`);
      continue;
    }

    const exibivel = candidatas.find((p) => displayOptionsSatisfeitas(p, params, props));
    if (!exibivel) {
      const ctx = candidatas
        .map((p) => JSON.stringify(p.displayOptions && p.displayOptions.show))
        .filter(Boolean)
        .join(' | ');
      registrar(
        'AVISO',
        `parâmetro "${chave}" existe, mas o n8n não o exibiria com esta combinação de campos (só aparece quando: ${ctx}) — config provavelmente morta`,
      );
      continue;
    }

    // 1a) valor dentro da lista fechada (options/resource/operation)
    if (exibivel.type === 'options' && Array.isArray(exibivel.options)) {
      const valores = exibivel.options.map((o) => (o && typeof o === 'object' ? o.value : o));
      const v = params[chave];
      if (typeof v === 'string' && !v.startsWith('=') && !valores.includes(v)) {
        registrar('ERRO', `"${chave}" = "${v}" não é um valor válido — aceitos: ${valores.join(', ')}`);
      }
    }

    // 1b) chaves internas de collection/fixedCollection
    const internasOk = chavesInternasValidas(exibivel);
    if (internasOk && params[chave] && typeof params[chave] === 'object' && !Array.isArray(params[chave])) {
      for (const interna of Object.keys(params[chave])) {
        if (!internasOk.has(interna)) {
          registrar(
            'ERRO',
            `dentro de "${chave}", a chave "${interna}" não existe — aceitas: ${[...internasOk].join(', ') || '(nenhuma)'}`,
          );
        }
      }
    }
  }

  // 2) Obrigatórios ausentes (só os que seriam exibidos nesta combinação).
  for (const p of props) {
    if (!p.required) continue;
    if (Object.prototype.hasOwnProperty.call(params, p.name)) continue;
    if (!displayOptionsSatisfeitas(p, params, props)) continue;
    const temDefaultUtil = p.default !== undefined && p.default !== '' && p.default !== null;
    registrar(
      temDefaultUtil ? 'AVISO' : 'ERRO',
      `parâmetro obrigatório "${p.name}" (${p.displayName}) ausente${temDefaultUtil ? ` — usaria o default ${JSON.stringify(p.default)}` : ''}`,
    );
  }
}

/**
 * Referências a nodes que não existem no arquivo.
 *
 * Existe por causa de um bug real: o node de parsear planilhas citava
 * 'Box — Download Cost Report S01' como TEXTO, e o gerador remove os nodes do Box no
 * arquivo de homolog. Resultado: "Referenced node doesn't exist" em execução, só em
 * homolog — exatamente a divergência entre ambientes que a fonte única deveria impedir.
 * Nenhuma validação de parâmetro pegava isso, porque o parâmetro estava perfeito.
 *
 * Pega as duas formas: $('Nome') e o nome passado como argumento/string solta.
 *
 * Pro segundo caso é preciso um VOCABULÁRIO de nomes conhecidos: um nome citado como
 * argumento é só uma string qualquer, e o nome que interessa é justamente um que NÃO está
 * mais no arquivo. O vocabulário vem do arquivo-fonte, que tem os nodes dos dois ambientes.
 */
function nomesDaFonte(arquivo) {
  const m = path.basename(arquivo).match(/^(.+?)\.(homolog|producao)\.json$/);
  if (!m) return new Set();
  const fonte = path.join(path.dirname(arquivo), '_fonte', `${m[1]}.fonte.json`);
  if (!fs.existsSync(fonte)) return new Set();
  try {
    return new Set((JSON.parse(fs.readFileSync(fonte, 'utf8')).nodes || []).map((n) => n.name));
  } catch {
    return new Set();
  }
}

/**
 * Remove comentários de linha antes de procurar referências.
 *
 * Sem isto a checagem acusa referência quebrada num $('...') escrito dentro de um
 * comentário explicativo — falso positivo que corrói a confiança no validador. O blob vem
 * de JSON.stringify, então a quebra de linha é o literal \n.
 */
function semComentarios(blob) {
  return blob.replace(/\/\/(?:(?!\\n).)*/g, '');
}

function validarReferenciasANodes(wf, achados, vocabulario = new Set()) {
  const existentes = new Set((wf.nodes || []).map((n) => n.name));
  const conhecidos = new Set([...existentes, ...vocabulario]);

  const comEntrada = new Set();
  for (const spec of Object.values(wf.connections || {})) {
    for (const saida of spec.main || []) for (const e of saida) comEntrada.add(e.node);
  }
  const ehTrigger = (n) =>
    n.type.endsWith('Trigger') ||
    n.type === 'n8n-nodes-base.manualTrigger' ||
    n.type === 'n8n-nodes-base.executeWorkflowTrigger';
  const alcancavel = new Set([...comEntrada, ...(wf.nodes || []).filter(ehTrigger).map((n) => n.name)]);

  for (const node of wf.nodes || []) {
    const blob = semComentarios(JSON.stringify(node.parameters || {}));
    const citados = new Set();

    for (const m of blob.matchAll(/\$\(\\?'([^']+?)\\?'\)/g)) citados.add(m[1]);
    // nome de node passado como argumento — como lerAbaNotas(null, 'Box — Download...', null)
    for (const nome of conhecidos) {
      if (nome !== node.name && blob.includes(`'${nome}'`)) citados.add(nome);
    }

    for (const alvo of citados) {
      if (!existentes.has(alvo)) {
        achados.push({
          nivel: 'ERRO',
          node: node.name,
          msg: `referencia o node "${alvo}", que não existe neste arquivo — em execução vira "Referenced node doesn't exist"`,
        });
      } else if (!alcancavel.has(alvo)) {
        achados.push({
          nivel: 'AVISO',
          node: node.name,
          msg: `referencia o node "${alvo}", que existe mas nada alimenta — nunca executa, então a referência vem vazia`,
        });
      }
    }
  }
}

function validarArquivo(arquivo) {
  const wf = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const achados = [];
  for (const node of wf.nodes || []) validarNode(node, achados);
  validarReferenciasANodes(wf, achados, nomesDaFonte(arquivo));

  const erros = achados.filter((a) => a.nivel === 'ERRO');
  const avisos = achados.filter((a) => a.nivel === 'AVISO');

  console.log(`\n${'='.repeat(78)}\n${arquivo}\n${'='.repeat(78)}`);
  if (achados.length === 0) {
    console.log('  sem problemas de parâmetro');
  } else {
    for (const a of achados) {
      console.log(`  [${a.nivel}] ${a.node}\n          ${a.msg}`);
    }
    console.log(`\n  ${erros.length} erro(s), ${avisos.length} aviso(s)`);
  }
  return erros.length;
}

// ─────────────────────────────────────────────────────────────────────────
// Modo --remoto: puxa o workflow PUBLICADO no n8n e confere se o que está lá
// é mesmo o que deveria estar. Substitui a conferência visual node a node.
// ─────────────────────────────────────────────────────────────────────────

/** Compara só o que importa; ignora ruído que a API acrescenta (ids, datas, webhookId...). */
function compararComPublicado(local, remoto, divergencias, grafiasDiferentes = new Set()) {
  const { prepararPayload } = require('./lib/n8n_api');
  const esperado = prepararPayload(local);

  const mapaEsperado = new Map(esperado.nodes.map((n) => [n.name, n]));
  const mapaPublicado = new Map((remoto.nodes || []).map((n) => [n.name, n]));

  for (const nome of mapaEsperado.keys()) {
    if (!mapaPublicado.has(nome)) divergencias.push(`node faltando no n8n: "${nome}"`);
  }
  for (const nome of mapaPublicado.keys()) {
    if (!mapaEsperado.has(nome)) divergencias.push(`node a mais no n8n (não está no arquivo): "${nome}"`);
  }

  for (const [nome, esp] of mapaEsperado) {
    const pub = mapaPublicado.get(nome);
    if (!pub) continue;

    if (esp.type !== pub.type) divergencias.push(`"${nome}": type ${pub.type} publicado, esperado ${esp.type}`);
    if (String(esp.typeVersion) !== String(pub.typeVersion)) {
      divergencias.push(`"${nome}": typeVersion ${pub.typeVersion} publicado, esperado ${esp.typeVersion}`);
    }
    if (!!esp.disabled !== !!pub.disabled) {
      divergencias.push(`"${nome}": disabled=${!!pub.disabled} publicado, esperado ${!!esp.disabled}`);
    }
    if ((esp.onError || null) !== (pub.onError || null)) {
      divergencias.push(`"${nome}": onError=${pub.onError || 'nenhum'} publicado, esperado ${esp.onError || 'nenhum'}`);
    }

    const paramsEsp = JSON.stringify(esp.parameters || {});
    const paramsPub = JSON.stringify(pub.parameters || {});
    if (paramsEsp !== paramsPub) {
      divergencias.push(`"${nome}": parâmetros diferentes do arquivo (o n8n pode ter normalizado, confira na tela)`);
    }

    // Credencial: compara por NOME (o ID é da instância e por definição difere do
    // marcador do repositório). A comparação ignora maiúsculas/minúsculas e espaço
    // extra, do mesmo jeito que o deploy resolve — senão uma diferença só de
    // grafia viraria uma "divergência" por node, escondendo o que importa.
    const norm = (s) => String(s).toLowerCase().trim().replace(/\s+/g, ' ');
    const credEsp = Object.entries(esp.credentials || {}).map(([t, c]) => `${t}:${norm(c.name)}`).sort().join(',');
    const credPub = Object.entries(pub.credentials || {}).map(([t, c]) => `${t}:${norm(c.name)}`).sort().join(',');
    if (credEsp !== credPub) {
      const legivelEsp = Object.entries(esp.credentials || {}).map(([t, c]) => `${t}:${c.name}`).sort().join(',');
      const legivelPub = Object.entries(pub.credentials || {}).map(([t, c]) => `${t}:${c.name}`).sort().join(',');
      divergencias.push(`"${nome}": credenciais publicadas [${legivelPub || 'nenhuma'}], esperadas [${legivelEsp || 'nenhuma'}]`);
    } else {
      for (const [tipo, c] of Object.entries(pub.credentials || {})) {
        const espCred = (esp.credentials || {})[tipo];
        if (espCred && espCred.name !== c.name) {
          grafiasDiferentes.add(`${tipo}: "${espCred.name}" (arquivo) x "${c.name}" (n8n)`);
        }
      }
    }
    for (const [tipo, c] of Object.entries(pub.credentials || {})) {
      if (!c.id || String(c.id).startsWith('cred-')) {
        divergencias.push(`"${nome}": credencial ${tipo} ("${c.name}") sem ID real no n8n — vai aparecer em branco na tela`);
      }
    }
  }

  if (JSON.stringify(esperado.connections) !== JSON.stringify(remoto.connections || {})) {
    divergencias.push('as ligações entre nodes (connections) diferem do arquivo');
  }
  const errEsp = (esperado.settings || {}).errorWorkflow;
  const errPub = (remoto.settings || {}).errorWorkflow;
  if (errEsp && String(errEsp).startsWith('REPLACE_WITH') && !errPub) {
    divergencias.push('Error Workflow não está definido no workflow publicado');
  }
}

async function validarRemoto(arquivosLocais) {
  const { carregarEnv, N8nApi } = require('./lib/n8n_api');
  const api = new N8nApi(carregarEnv());
  const estadoPath = path.join(__dirname, '..', '.n8n-deploy-state.json');
  const estado = fs.existsSync(estadoPath) ? JSON.parse(fs.readFileSync(estadoPath, 'utf8')) : {};
  const publicados = await api.listarWorkflows();

  console.log(`\nConferindo o que está PUBLICADO em ${api.baseUrl}\n`);
  let totalDivergencias = 0;

  for (const arquivo of arquivosLocais) {
    const nomeArquivo = path.basename(arquivo);
    const local = JSON.parse(fs.readFileSync(arquivo, 'utf8'));

    let id = estado[nomeArquivo];
    if (!id && publicados) {
      const achados = publicados.filter((w) => w.name === local.name);
      if (achados.length === 1) id = achados[0].id;
    }

    console.log(`${'='.repeat(78)}\n${nomeArquivo}\n${'='.repeat(78)}`);
    if (!id) {
      console.log('  ainda não publicado (rode: node scripts/deploy_n8n.js)\n');
      continue;
    }

    let remoto;
    try {
      remoto = await api.obterWorkflow(id);
    } catch (e) {
      console.log(`  ERRO ao buscar do n8n: ${e.message}\n`);
      totalDivergencias++;
      continue;
    }

    // 1) as mesmas checagens de parâmetro, agora contra a versão publicada
    const achados = [];
    for (const node of remoto.nodes || []) validarNode(node, achados);
    const errosParam = achados.filter((a) => a.nivel === 'ERRO');

    // 2) o publicado bate com o arquivo?
    const divergencias = [];
    const grafiasDiferentes = new Set();
    compararComPublicado(local, remoto, divergencias, grafiasDiferentes);

    if (errosParam.length === 0 && divergencias.length === 0) {
      console.log(`  OK — publicado (id ${id}) confere com o arquivo, sem erro de parâmetro`);
    } else {
      for (const a of errosParam) console.log(`  [ERRO PARÂMETRO] ${a.node}\n          ${a.msg}`);
      for (const d of divergencias) console.log(`  [DIVERGÊNCIA] ${d}`);
      console.log(`\n  ${errosParam.length} erro(s) de parâmetro, ${divergencias.length} divergência(s)`);
      totalDivergencias += errosParam.length + divergencias.length;
    }
    // Diferença só de grafia não é divergência (o deploy casa ignorando maiúsculas),
    // mas vale registrar uma vez pra você alinhar o nome quando quiser.
    for (const g of grafiasDiferentes) console.log(`  (nota) grafia diferente, casada mesmo assim — ${g}`);
    console.log('');
  }

  console.log('='.repeat(78));
  console.log(totalDivergencias === 0 ? 'REMOTO: tudo confere' : `REMOTO: ${totalDivergencias} problema(s)`);
  return totalDivergencias;
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const remoto = args.includes('--remoto');
const alvos = args.filter((a) => !a.startsWith('--'));

const arquivos = alvos.length
  ? alvos
  : fs
      .readdirSync(path.join(__dirname, '..', 'workflows'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(__dirname, '..', 'workflows', f))
      // no modo remoto, produção não é publicada — não faz sentido cobrar
      .filter((f) => (remoto ? !f.includes('.producao.') : true));

if (remoto) {
  validarRemoto(arquivos)
    .then((n) => process.exit(n === 0 ? 0 : 1))
    .catch((e) => {
      console.error(`\nFalhou: ${e.message}\n`);
      process.exit(1);
    });
} else {
  let totalErros = 0;
  for (const arq of arquivos) totalErros += validarArquivo(arq);
  console.log(`\n${'='.repeat(78)}`);
  console.log(totalErros === 0 ? 'TOTAL: nenhum erro' : `TOTAL: ${totalErros} erro(s)`);
  process.exit(totalErros === 0 ? 0 : 1);
}
