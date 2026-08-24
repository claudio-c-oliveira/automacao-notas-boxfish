#!/usr/bin/env node
/**
 * Gera os workflows finais (homolog e produção) a partir do ARQUIVO-FONTE único.
 *
 * Por que existe: manter dois arquivos editados à mão vira divergência na certa —
 * um problema corrigido em homolog pode não chegar em produção. Aqui só a FONTE é
 * editada; os dois finais são derivados dela, sempre em par.
 *
 *   workflows/_fonte/<nome>.fonte.json
 *        │
 *        ├── node scripts/gerar_workflows.js ──> workflows/<nome>.homolog.json   (o que se importa e testa)
 *        └──                                 └─> workflows/<nome>.producao.json  (nunca editado à mão)
 *
 * Marcadores entendidos pela fonte:
 *   credentials.<tipo>.__porAmbiente = { homolog: "<nome>", producao: "<nome>" }
 *       -> vira a credencial concreta do ambiente alvo.
 *   node.__ifAmbiente = { saida0: "homolog", saida1: "producao" }
 *       -> o IF é REMOVIDO e só o ramo do ambiente alvo sobrevive; quem apontava
 *          pro IF passa a apontar direto pro primeiro node do ramo escolhido.
 *          Os nodes do ramo descartado somem junto (viram inalcançáveis).
 *
 * O ambiente também é "assado" no node de carga de config, pra que o arquivo seja
 * autoconsistente: mesmo que o config_execucao.json da VM diga outra coisa, o
 * arquivo de homolog se comporta como homolog (evita mandar e-mail real por engano).
 *
 * Uso:
 *   node scripts/gerar_workflows.js            # gera todos os .fonte.json
 *   node scripts/gerar_workflows.js <arquivo>  # gera um só
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DIR_FONTE = path.join(RAIZ, 'workflows', '_fonte');
const DIR_SAIDA = path.join(RAIZ, 'workflows');

const AMBIENTES = ['homolog', 'producao'];

/** ids estáveis por nome de credencial — o n8n casa credencial por id na importação. */
const CRED_IDS = {
  'Gmail account': 'cred-gmail-producao',
  'Gmail - Homolog (Claudio Pessoal)': 'cred-gmail-homolog',
  'Box account': 'cred-box-account',
  'Claude account (dev)': 'cred-claude-dev',
  'Claude account (produção)': 'cred-claude-producao',
  'Google Drive - Produção (financeiro1@novorealitybox.com)': 'cred-gdrive-trabalho',
  'Google Drive - Michelle (michelle.mimiaguia@gmail.com)': 'cred-gdrive-particular-michelle',
  'Google Drive - HML (claudioco70@gmail.com)': 'cred-gdrive-homolog',
  'Telegram account': 'cred-telegram-account',
};

const clonar = (x) => JSON.parse(JSON.stringify(x));

/** Resolve credenciais marcadas com __porAmbiente pro ambiente alvo. */
function resolverCredenciais(wf, ambiente, avisos) {
  for (const node of wf.nodes) {
    if (!node.credentials) continue;
    for (const [tipo, cred] of Object.entries(node.credentials)) {
      if (!cred || !cred.__porAmbiente) continue;
      const nome = cred.__porAmbiente[ambiente];
      if (!nome) {
        avisos.push(`${node.name}: credencial ${tipo} sem valor pra ambiente "${ambiente}"`);
        continue;
      }
      if (!CRED_IDS[nome]) avisos.push(`${node.name}: credencial "${nome}" sem id mapeado em CRED_IDS`);
      node.credentials[tipo] = { id: CRED_IDS[nome] || 'REPLACE', name: nome };
    }
  }
}

/** Remove os IFs de ambiente, preservando só o ramo do ambiente alvo. */
function colapsarIfsDeAmbiente(wf, ambiente, avisos) {
  const ifs = wf.nodes.filter((n) => n.__ifAmbiente);
  for (const noIf of ifs) {
    const saidas = (wf.connections[noIf.name] || {}).main || [];
    const indiceEscolhido = noIf.__ifAmbiente.saida0 === ambiente ? 0 : 1;
    const ramoEscolhido = saidas[indiceEscolhido] || [];

    if (ramoEscolhido.length === 0) {
      avisos.push(`${noIf.name}: ramo de "${ambiente}" está vazio — quem dependia dele ficará solto`);
    }

    // Quem apontava pro IF passa a apontar pros alvos do ramo escolhido.
    for (const spec of Object.values(wf.connections)) {
      for (const saida of spec.main || []) {
        for (let i = saida.length - 1; i >= 0; i--) {
          if (saida[i].node !== noIf.name) continue;
          saida.splice(i, 1, ...ramoEscolhido.map((e) => clonar(e)));
        }
      }
    }

    delete wf.connections[noIf.name];
    wf.nodes = wf.nodes.filter((n) => n.name !== noIf.name);
  }
}

/** Remove nodes que ficaram sem caminho a partir de algum trigger. */
function removerInalcancaveis(wf) {
  const ehTrigger = (n) =>
    n.type.endsWith('Trigger') ||
    n.type === 'n8n-nodes-base.manualTrigger' ||
    n.type === 'n8n-nodes-base.executeWorkflowTrigger';

  const alcancados = new Set(wf.nodes.filter(ehTrigger).map((n) => n.name));
  // Nodes lidos só por referência ($('...')) não têm aresta de entrada; preserva-os.
  const referenciadosPorCodigo = new Set();
  for (const n of wf.nodes) {
    const code = (n.parameters && n.parameters.jsCode) || '';
    for (const m of code.matchAll(/\$\('([^']+)'\)/g)) referenciadosPorCodigo.add(m[1]);
  }

  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [src, spec] of Object.entries(wf.connections)) {
      if (!alcancados.has(src)) continue;
      for (const saida of spec.main || []) {
        for (const e of saida) {
          if (!alcancados.has(e.node)) {
            alcancados.add(e.node);
            mudou = true;
          }
        }
      }
    }
  }

  const removidos = wf.nodes.filter((n) => !alcancados.has(n.name) && !referenciadosPorCodigo.has(n.name));
  const nomesRemovidos = new Set(removidos.map((n) => n.name));
  wf.nodes = wf.nodes.filter((n) => !nomesRemovidos.has(n.name));
  for (const nome of nomesRemovidos) delete wf.connections[nome];
  for (const spec of Object.values(wf.connections)) {
    for (const saida of spec.main || []) {
      for (let i = saida.length - 1; i >= 0; i--) {
        if (nomesRemovidos.has(saida[i].node)) saida.splice(i, 1);
      }
    }
  }
  return [...nomesRemovidos];
}

/** "Assa" o ambiente no node de carga de config, pro arquivo ser autoconsistente. */
function assarAmbiente(wf, ambiente, avisos) {
  const alvo = wf.nodes.find((n) => n.name === 'Carregar config + perfis');
  if (!alvo || !alvo.parameters || !alvo.parameters.jsCode) {
    avisos.push('node "Carregar config + perfis" não encontrado — ambiente não foi assado no arquivo');
    return;
  }
  const marca = '// [gerado] ambiente fixado em tempo de geração';
  if (alvo.parameters.jsCode.includes(marca)) return;
  alvo.parameters.jsCode = alvo.parameters.jsCode.replace(
    'return [{ json: { config,',
    `${marca} — este arquivo é "${ambiente}" e se comporta como tal,\n` +
      '// independente do que estiver no config_execucao.json da VM (evita, por exemplo,\n' +
      '// o arquivo de homolog mandar e-mail pra destinatário real por config divergente).\n' +
      `config.ambiente = '${ambiente}';\n\n` +
      'return [{ json: { config,',
  );
}

/** Limpa marcadores que só fazem sentido na fonte. */
function limparMarcadores(wf) {
  for (const n of wf.nodes) delete n.__ifAmbiente;
  if (wf.meta) delete wf.meta.__fonte;
}

function gerar(arquivoFonte) {
  const base = path.basename(arquivoFonte).replace(/\.fonte\.json$/, '');
  const fonte = JSON.parse(fs.readFileSync(arquivoFonte, 'utf8'));

  for (const ambiente of AMBIENTES) {
    const wf = clonar(fonte);
    const avisos = [];

    resolverCredenciais(wf, ambiente, avisos);
    colapsarIfsDeAmbiente(wf, ambiente, avisos);
    const removidos = removerInalcancaveis(wf);
    assarAmbiente(wf, ambiente, avisos);
    limparMarcadores(wf);

    const rotulo = ambiente === 'homolog' ? 'Homolog' : 'Produção';
    wf.name = `${(fonte.name || base).replace(/\s*\((Homolog|Produção)\)\s*$/, '')} (${rotulo})`;
    wf.meta = wf.meta || {};
    wf.meta.description =
      `[GERADO AUTOMATICAMENTE — não edite este arquivo] Ambiente: ${ambiente}. ` +
      `Fonte: workflows/_fonte/${path.basename(arquivoFonte)}. ` +
      `Regerar com: node scripts/gerar_workflows.js. ` +
      (wf.meta.description || '');

    const saida = path.join(DIR_SAIDA, `${base}.${ambiente}.json`);
    fs.writeFileSync(saida, JSON.stringify(wf, null, 2) + '\n');

    console.log(`  ${ambiente.padEnd(9)} -> ${path.relative(RAIZ, saida)}  (${wf.nodes.length} nodes${removidos.length ? `, ${removidos.length} descartados do outro ramo` : ''})`);
    for (const a of avisos) console.log(`      AVISO: ${a}`);
  }
}

const alvos = process.argv.slice(2);
const fontes = alvos.length
  ? alvos
  : fs.existsSync(DIR_FONTE)
    ? fs.readdirSync(DIR_FONTE).filter((f) => f.endsWith('.fonte.json')).map((f) => path.join(DIR_FONTE, f))
    : [];

if (fontes.length === 0) {
  console.error('Nenhum arquivo-fonte encontrado em workflows/_fonte/');
  process.exit(1);
}

for (const f of fontes) {
  console.log(`\n${path.relative(RAIZ, f)}`);
  gerar(f);
}
console.log('\nPronto. Importe no n8n apenas o arquivo .homolog.json para testar.');
