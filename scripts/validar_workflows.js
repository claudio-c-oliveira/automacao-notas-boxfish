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

function validarArquivo(arquivo) {
  const wf = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const achados = [];
  for (const node of wf.nodes || []) validarNode(node, achados);

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

const alvos = process.argv.slice(2);
const arquivos = alvos.length
  ? alvos
  : fs
      .readdirSync(path.join(__dirname, '..', 'workflows'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(__dirname, '..', 'workflows', f));

let totalErros = 0;
for (const arq of arquivos) totalErros += validarArquivo(arq);

console.log(`\n${'='.repeat(78)}`);
console.log(totalErros === 0 ? 'TOTAL: nenhum erro' : `TOTAL: ${totalErros} erro(s)`);
process.exit(totalErros === 0 ? 0 : 1);
