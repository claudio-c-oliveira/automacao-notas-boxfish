'use strict';
/**
 * Cliente mínimo da API pública do n8n + leitura do .env.
 * Usado por scripts/deploy_n8n.js e scripts/validar_workflows.js (--remoto).
 *
 * Referência: OpenAPI oficial do n8n (packages/cli/src/public-api/v1/openapi.yml).
 *   - autenticação por header  X-N8N-API-KEY
 *   - base                     <N8N_BASE_URL>/api/v1
 *   - workflows                GET/POST /workflows, GET/PUT/DELETE /workflows/{id}
 *   - credenciais              GET /credentials  (lista sem os segredos)
 *
 * Sem dependências externas de propósito: roda com o Node puro da máquina.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');

/** Lê o .env da raiz do projeto (formato CHAVE=valor, # para comentário). */
function carregarEnv() {
  const arquivo = path.join(RAIZ, '.env');
  if (!fs.existsSync(arquivo)) {
    throw new Error(
      'Arquivo .env não encontrado na raiz do projeto.\n' +
        'Crie a partir do modelo:  cp .env.example .env  — e preencha N8N_BASE_URL e N8N_API_KEY.',
    );
  }
  const env = {};
  for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const i = limpa.indexOf('=');
    if (i === -1) continue;
    const chave = limpa.slice(0, i).trim();
    let valor = limpa.slice(i + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    env[chave] = valor;
  }
  return env;
}

/** Esconde a chave em qualquer mensagem/log, pra não vazar em stack trace. */
function mascarar(texto, chave) {
  if (!chave || !texto) return texto;
  return String(texto).split(chave).join('***CHAVE-OCULTA***');
}

class N8nApi {
  constructor(env) {
    this.baseUrl = (env.N8N_BASE_URL || '').replace(/\/+$/, '');
    this.apiKey = env.N8N_API_KEY || '';
    this.env = env;

    if (!this.baseUrl) throw new Error('N8N_BASE_URL não definida no .env');
    if (!this.apiKey || this.apiKey.startsWith('cole-a-chave')) {
      throw new Error('N8N_API_KEY não preenchida no .env (ainda está com o texto do modelo).');
    }
  }

  async requisitar(metodo, caminho, corpo) {
    const url = `${this.baseUrl}/api/v1${caminho}`;
    let resposta;
    try {
      resposta = await fetch(url, {
        method: metodo,
        headers: {
          'X-N8N-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch (e) {
      throw new Error(`Falha de rede em ${metodo} ${caminho}: ${mascarar(e.message, this.apiKey)}`);
    }

    const texto = await resposta.text();
    let dados = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = texto;
    }

    if (!resposta.ok) {
      const detalhe = typeof dados === 'string' ? dados : JSON.stringify(dados);
      const erro = new Error(
        `${metodo} ${caminho} -> HTTP ${resposta.status}\n        ${mascarar(detalhe, this.apiKey).slice(0, 800)}`,
      );
      erro.status = resposta.status;
      erro.dados = dados;
      throw erro;
    }
    return dados;
  }

  /** Lista todos os workflows, paginando pelo cursor. Devolve null se a instância não suportar. */
  async listarWorkflows() {
    const todos = [];
    let cursor;
    try {
      do {
        const q = new URLSearchParams({ limit: '250' });
        if (cursor) q.set('cursor', cursor);
        const r = await this.requisitar('GET', `/workflows?${q}`);
        todos.push(...(r.data || []));
        cursor = r.nextCursor || null;
      } while (cursor);
      return todos;
    } catch (e) {
      if (e.status === 404 || e.status === 405) return null; // versão sem listagem
      throw e;
    }
  }

  async obterWorkflow(id) {
    return this.requisitar('GET', `/workflows/${encodeURIComponent(id)}`);
  }

  async criarWorkflow(payload) {
    return this.requisitar('POST', '/workflows', payload);
  }

  async atualizarWorkflow(id, payload) {
    return this.requisitar('PUT', `/workflows/${encodeURIComponent(id)}`, payload);
  }

  /** Lista credenciais (a API não devolve os segredos). Null se a instância não suportar. */
  async listarCredenciais() {
    const todas = [];
    let cursor;
    try {
      do {
        const q = new URLSearchParams({ limit: '250' });
        if (cursor) q.set('cursor', cursor);
        const r = await this.requisitar('GET', `/credentials?${q}`);
        todas.push(...(r.data || []));
        cursor = r.nextCursor || null;
      } while (cursor);
      return todas;
    } catch (e) {
      if (e.status === 404 || e.status === 405) return null; // versão sem listagem de credenciais
      throw e;
    }
  }
}

/**
 * Campos que a API marca como readOnly (ou nem aceita) num POST/PUT de workflow.
 * Mandar qualquer um deles derruba a requisição com 400, porque o schema é
 * `additionalProperties: false`.
 */
const CAMPOS_SO_LEITURA_WORKFLOW = [
  'id', 'active', 'createdAt', 'updatedAt', 'isArchived', 'versionId',
  'triggerCount', 'meta', 'tags', 'shared', 'activeVersion', 'homeProject',
  'sharedWithProjects', 'scopes', 'usedCredentials', 'pinData',
];

/** Campos aceitos em cada node (schema node.yml). Extras derrubam o request. */
const CAMPOS_ACEITOS_NODE = new Set([
  'id', 'name', 'webhookId', 'disabled', 'notesInFlow', 'notes', 'type', 'typeVersion',
  'executeOnce', 'alwaysOutputData', 'retryOnFail', 'maxTries', 'waitBetweenTries',
  'continueOnFail', 'onError', 'position', 'parameters', 'credentials', 'customTelemetryTags',
]);

/**
 * Prepara o JSON local pra virar payload aceito pela API:
 * tira o que é readOnly, limpa campos estranhos dos nodes e preserva a descrição
 * (que no arquivo local mora em `meta.description`, campo readOnly na API — o
 * equivalente gravável é `description`, no nível do workflow).
 */
function prepararPayload(workflowLocal) {
  const wf = JSON.parse(JSON.stringify(workflowLocal));
  const descricao = wf.meta && wf.meta.description;

  for (const campo of CAMPOS_SO_LEITURA_WORKFLOW) delete wf[campo];

  wf.nodes = (wf.nodes || []).map((node) => {
    const limpo = {};
    for (const [k, v] of Object.entries(node)) {
      if (CAMPOS_ACEITOS_NODE.has(k)) limpo[k] = v;
    }
    return limpo;
  });

  wf.connections = wf.connections || {};
  wf.settings = wf.settings || { executionOrder: 'v1' };
  if (descricao) wf.description = String(descricao).slice(0, 500);

  return wf;
}

module.exports = { carregarEnv, mascarar, N8nApi, prepararPayload, CAMPOS_ACEITOS_NODE, RAIZ };
