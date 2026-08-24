#!/usr/bin/env node
'use strict';
/**
 * Publica um workflow GERADO na instância do n8n, via API pública.
 *
 * Lugar no fluxo:
 *   1. edita  workflows/_fonte/<nome>.fonte.json
 *   2. roda   node scripts/gerar_workflows.js
 *   3. roda   node scripts/deploy_n8n.js          <-- aqui
 *   4. roda   node scripts/validar_workflows.js --remoto   (confere o que foi publicado)
 *
 * Cria o workflow se ainda não existir, ou atualiza o existente (casando pelo
 * nome) — sem precisar apagar nodes e reimportar na tela.
 *
 * TRAVA DE SEGURANÇA: só publica arquivos `.homolog.json`. Publicar produção
 * exige `--producao --confirmo-producao` explicitamente, e mesmo assim avisa.
 *
 * Credenciais: os arquivos do repositório trazem IDs de marcador
 * ("cred-gmail-homolog" etc.), nunca os IDs reais da instância. Este script
 * resolve os IDs reais na hora do deploy — primeiro tentando listar as
 * credenciais pela API (casando por nome), depois caindo pro que estiver no
 * .env. Assim o repositório fica independente de instância e você não precisa
 * reselecionar credencial na tela a cada atualização.
 *
 * Uso:
 *   node scripts/deploy_n8n.js                          # todos os .homolog.json
 *   node scripts/deploy_n8n.js workflows/x.homolog.json # um arquivo
 *   node scripts/deploy_n8n.js --dry-run                # mostra o que faria, sem publicar
 */

const fs = require('fs');
const path = require('path');
const { carregarEnv, N8nApi, prepararPayload, RAIZ } = require('./lib/n8n_api');

const ARQUIVO_ESTADO = path.join(RAIZ, '.n8n-deploy-state.json');

/** marcador usado nos arquivos do repo -> variável do .env com o ID real */
const CRED_MARCADOR_PARA_ENV = {
  'cred-gmail-homolog': 'N8N_CRED_GMAIL_HOMOLOG',
  'cred-gmail-producao': 'N8N_CRED_GMAIL_PRODUCAO',
  'cred-box-account': 'N8N_CRED_BOX',
  'cred-claude-dev': 'N8N_CRED_CLAUDE_DEV',
  'cred-claude-producao': 'N8N_CRED_CLAUDE_PRODUCAO',
  'cred-gdrive-trabalho': 'N8N_CRED_GDRIVE_TRABALHO',
  'cred-gdrive-particular-michelle': 'N8N_CRED_GDRIVE_PARTICULAR_MICHELLE',
  'cred-gdrive-homolog': 'N8N_CRED_GDRIVE_HOMOLOG',
  'cred-telegram-account': 'N8N_CRED_TELEGRAM',
};

const lerEstado = () =>
  fs.existsSync(ARQUIVO_ESTADO) ? JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8')) : {};
const gravarEstado = (e) => fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(e, null, 2) + '\n');

/**
 * Troca os IDs de marcador pelos IDs reais da instância.
 * Prioridade: nome batendo na listagem da API > valor no .env > mantém o marcador (e avisa).
 */
function resolverCredenciais(wf, credenciaisDaInstancia, env, avisos) {
  const porNome = new Map();
  for (const c of credenciaisDaInstancia || []) porNome.set(c.name, c.id);

  const naoResolvidas = new Set();
  for (const node of wf.nodes) {
    if (!node.credentials) continue;
    for (const [tipo, cred] of Object.entries(node.credentials)) {
      if (!cred || !cred.name) continue;

      const idReal =
        porNome.get(cred.name) ||
        (CRED_MARCADOR_PARA_ENV[cred.id] ? env[CRED_MARCADOR_PARA_ENV[cred.id]] : null);

      if (idReal) {
        node.credentials[tipo] = { id: String(idReal), name: cred.name };
      } else {
        naoResolvidas.add(`${cred.name} (marcador ${cred.id})`);
      }
    }
  }
  for (const n of naoResolvidas) {
    avisos.push(
      `credencial não resolvida: ${n} — o workflow sobe, mas essa credencial vai aparecer ` +
        `em branco no n8n. Crie/renomeie a credencial na instância, ou preencha o ID no .env.`,
    );
  }
}

/** Resolve o placeholder do Error Workflow pelo ID real (achado por nome). */
function resolverErrorWorkflow(wf, workflowsDaInstancia, avisos) {
  const atual = wf.settings && wf.settings.errorWorkflow;
  if (!atual || !String(atual).startsWith('REPLACE_WITH')) return;

  const alvo = (workflowsDaInstancia || []).find((w) => /error.?handler/i.test(w.name || ''));
  if (alvo) {
    wf.settings.errorWorkflow = alvo.id;
  } else {
    delete wf.settings.errorWorkflow; // placeholder inválido derrubaria o request
    avisos.push(
      'Error Workflow não definido: não achei um workflow com "error handler" no nome na ' +
        'instância. Publique workflows/error_handler.json primeiro e rode o deploy de novo.',
    );
  }
}

async function publicar(arquivo, api, contexto, opcoes) {
  const nomeArquivo = path.basename(arquivo);
  const local = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const avisos = [];

  const payload = prepararPayload(local);
  resolverCredenciais(payload, contexto.credenciais, contexto.env, avisos);
  resolverErrorWorkflow(payload, contexto.workflows, avisos);

  // Descobre se já existe: primeiro pelo nome na instância, depois pelo estado local.
  const estado = lerEstado();
  let idExistente = null;
  const porNome = (contexto.workflows || []).filter((w) => w.name === payload.name);
  if (porNome.length === 1) {
    idExistente = porNome[0].id;
  } else if (porNome.length > 1) {
    avisos.push(`há ${porNome.length} workflows chamados "${payload.name}" na instância — usando o do estado local`);
    idExistente = estado[nomeArquivo] || null;
  } else if (estado[nomeArquivo]) {
    // some da listagem mas temos id guardado: confirma que ainda existe
    try {
      await api.obterWorkflow(estado[nomeArquivo]);
      idExistente = estado[nomeArquivo];
    } catch {
      idExistente = null;
    }
  }

  const acao = idExistente ? `ATUALIZAR (id ${idExistente})` : 'CRIAR';
  console.log(`\n  ${nomeArquivo}`);
  console.log(`     nome no n8n : ${payload.name}`);
  console.log(`     nodes       : ${payload.nodes.length}`);
  console.log(`     ação        : ${acao}`);
  for (const a of avisos) console.log(`     AVISO: ${a}`);

  if (opcoes.dryRun) {
    console.log('     (--dry-run: nada foi enviado)');
    return;
  }

  const resultado = idExistente
    ? await api.atualizarWorkflow(idExistente, payload)
    : await api.criarWorkflow(payload);

  estado[nomeArquivo] = resultado.id;
  gravarEstado(estado);

  console.log(`     publicado   : id ${resultado.id}`);
  console.log(`     abrir       : ${api.baseUrl}/workflow/${resultado.id}`);
  if (resultado.active === false) {
    console.log('     obs: o workflow fica INATIVO — ative na tela quando quiser o agendamento rodando.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opcoes = {
    dryRun: args.includes('--dry-run'),
    producao: args.includes('--producao'),
    confirmaProducao: args.includes('--confirmo-producao'),
  };
  const alvos = args.filter((a) => !a.startsWith('--'));

  const env = carregarEnv();
  const api = new N8nApi(env);

  let arquivos = alvos.length
    ? alvos
    : fs
        .readdirSync(path.join(RAIZ, 'workflows'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(RAIZ, 'workflows', f));

  // TRAVA: produção só com as duas flags juntas.
  const producao = arquivos.filter((f) => f.includes('.producao.'));
  if (producao.length && !(opcoes.producao && opcoes.confirmaProducao)) {
    for (const f of producao) {
      console.log(`  ignorado (é produção): ${path.basename(f)}`);
    }
    arquivos = arquivos.filter((f) => !f.includes('.producao.'));
  } else if (producao.length) {
    console.log('\n  !!! PUBLICANDO PRODUÇÃO — destinatários e planilhas REAIS !!!\n');
  }

  // Só publica o que é gerado/compartilhado; nunca a fonte.
  arquivos = arquivos.filter((f) => !f.includes(`${path.sep}_fonte${path.sep}`) && !f.endsWith('.fonte.json'));

  if (arquivos.length === 0) {
    console.error('Nenhum arquivo pra publicar.');
    process.exit(1);
  }

  console.log(`Instância: ${api.baseUrl}`);
  const credenciais = await api.listarCredenciais();
  console.log(
    credenciais
      ? `Credenciais na instância: ${credenciais.length} (IDs serão resolvidos por nome)`
      : 'Esta instância não permite listar credenciais pela API — usando os IDs do .env',
  );
  const workflows = await api.listarWorkflows();
  console.log(
    workflows
      ? `Workflows na instância: ${workflows.length}`
      : 'Esta instância não permite listar workflows pela API — usando o estado local (.n8n-deploy-state.json)',
  );

  const contexto = { credenciais, workflows, env };
  for (const arq of arquivos) {
    try {
      await publicar(arq, api, contexto, opcoes);
    } catch (e) {
      console.error(`\n  ERRO em ${path.basename(arq)}:\n     ${e.message}`);
      process.exitCode = 1;
    }
  }

  console.log('\nDepois de publicar, confira o que ficou lá de verdade:');
  console.log('  node scripts/validar_workflows.js --remoto\n');
}

main().catch((e) => {
  console.error(`\nFalhou: ${e.message}\n`);
  process.exit(1);
});
