'use strict';
// Box FALSO para o simulador (motor_q.js). Nada de rede: guarda arquivos e pastas em memória
// e responde como a API do Box responde aos nodes HTTP Request com neverError (o corpo de erro
// do Box é { type: 'error', status, code, message }).
//
// Trazido do scratchpad (q/teste_q6.js, função criarBox, 22/10/2026) para o repositório no
// passo 6 do C.8 (D27 = (a)). Mudanças em relação ao original, todas para os cenários do C.7
// sobre os nodes gerados do passo 6:
//   - etag separado da versão do conteúdo (o lock pode mudar o etag sem mudar o sha1: D16);
//   - upload de ARQUIVO NOVO (POST upload…/files/content, multipart com attributes), que é o
//     backup por download integral do C.3 passo 7, com 409 quando o nome já existe na pasta;
//   - modified_at de verdade (janela de silêncio), owned_by (portão, D18) e GET /search (D3(b));
//   - listagem de pasta com total_count real e opção de truncar;
//   - DELETE responde 204 SEM corpo (C.5), com opções para não apagar de verdade ou dar 403;
//   - ganchos para os cenários: antes/depois de cada chamada, lock que muda o etag, alguém que
//     salva no meio, upload corrompido, backup corrompido ou de outro tamanho, download que falha;
//   - registro de TODAS as chamadas que escrevem (log) para provar o que foi escrito.
const { sha1 } = require('../../scripts/lib/xlsx_conferencia.js');

const ME_PADRAO = 'michelle.mimiaguia@gmail.com';
const DONO_PADRAO = 'financeiro@novorealitybox.com';
const minutosAtras = (m) => new Date(Date.now() - m * 60000).toISOString().replace(/\.\d+Z$/, '-00:00');

module.exports = function criarBox(cfg = {}) {
  const ME = cfg.login || ME_PADRAO;
  let seq = 5000;
  const F = {}, D = {};
  const log = [];          // todas as chamadas: 'MÉTODO caminho'
  const escritas = [];     // só as que mudam alguma coisa no Box
  const contagem = {};     // chamadas por rota, para ganchos por ordem

  const meta = (f) => ({
    type: 'file', id: f.id, name: f.name, size: f.buf.length, sha1: sha1(f.buf), etag: String(f.etag),
    file_version: { type: 'file_version', id: 'v' + f.id + '_' + f.ver, sha1: sha1(f.buf) },
    lock: f.lock, item_status: f.lixeira ? 'trashed' : 'active', trashed_at: f.lixeira ? 'agora' : null,
    parent: f.parent ? { type: 'folder', id: f.parent } : null,
    owned_by: { type: 'user', login: f.dono || DONO_PADRAO },
    modified_at: f.modified_at, modified_by: { type: 'user', login: f.modificadoPor || 'financeiro1@novorealitybox.com' },
    permissions: { can_upload: f.podeSubir !== false, can_delete: true },
  });
  function novoArq(name, parent, buf, opcoes = {}) {
    const id = opcoes.id || String(++seq);
    F[id] = { id, name, parent, buf: Buffer.from(buf), ver: 1, etag: 1, lock: null, dono: opcoes.dono, modified_at: opcoes.modified_at || minutosAtras(opcoes.minutosAtras == null ? 60 : opcoes.minutosAtras), podeSubir: opcoes.podeSubir };
    return F[id];
  }
  function novaPasta(name, parent, id) { id = id || String(++seq); D[id] = { id, name, parent }; return D[id]; }
  /** Alguém (fora da automação) salva uma versão nova: conteúdo, etag e modified_at mudam. */
  function salvarPorFora(id, buf) { const f = F[id]; f.buf = Buffer.from(buf); f.ver++; f.etag++; f.modified_at = minutosAtras(0); escritas.push('POR FORA: nova versão de ' + f.name); }
  const erro = (status, code, message) => ({ status, code: code || 'x', message: message || '' });

  function http(method, url, qs, body, headers, arquivo, form) {
    const caminho = url.replace(/^https:\/\/(api|upload)\.box\.com(\/api)?\/2\.0/, '');
    const chave = method + ' ' + caminho;
    log.push(chave);
    contagem[chave] = (contagem[chave] || 0) + 1;
    if (cfg.antes) { const r = cfg.antes({ method, caminho, qs, body, headers, form, n: contagem[chave], box: api }); if (r) return r; }
    const r = rotear(method, caminho, qs || {}, body, headers || {}, arquivo, form || {});
    if (cfg.depois) { const r2 = cfg.depois({ method, caminho, resposta: r, n: contagem[chave], box: api }); if (r2) return r2; }
    return r;
  }

  function rotear(method, caminho, qs, body, headers, arquivo, form) {
    let m;
    if (caminho === '/users/me') return { status: 200, body: { type: 'user', login: ME, name: 'MICHELLE' } };
    if (method === 'GET' && caminho === '/search') {
      const q = String(qs.query || '').toLowerCase();
      const entries = Object.values(F).filter((f) => !f.lixeira && f.name.toLowerCase().includes(q)).map((f) => ({ type: 'file', id: f.id, name: f.name, modified_at: f.modified_at, owned_by: { login: f.dono || DONO_PADRAO } }));
      return { status: 200, body: { total_count: entries.length, entries } };
    }
    if (method === 'GET' && (m = caminho.match(/^\/folders\/([^/]+)\/items$/))) {
      const id = m[1];
      if (!D[id]) return erro(404, 'not_found');
      const todos = [
        ...Object.values(D).filter((x) => x.parent === id).map((x) => ({ type: 'folder', id: x.id, name: x.name })),
        ...Object.values(F).filter((x) => x.parent === id && !x.lixeira).map((x) => ({ type: 'file', id: x.id, name: x.name })),
      ];
      const limite = cfg.truncarListagem ? Math.min(cfg.truncarListagem, todos.length) : todos.length;
      return { status: 200, body: { total_count: todos.length, entries: todos.slice(0, limite), offset: 0, limit: +(qs.limit || 100) } };
    }
    // upload de ARQUIVO NOVO (backup): multipart com attributes = { name, parent: { id } }
    if (method === 'POST' && caminho === '/files/content') {
      let at; try { at = JSON.parse(form.attributes); } catch (e) { return erro(400, 'bad_request', 'attributes inválido'); }
      if (!at || !at.name || !at.parent || !D[at.parent.id]) return erro(404, 'not_found', 'pasta pai');
      if (Object.values(F).some((x) => x.parent === at.parent.id && x.name === at.name && !x.lixeira)) return erro(409, 'item_name_in_use');
      if (!arquivo) return erro(400, 'bad_request', 'sem arquivo');
      const conteudo = cfg.corromperBackup ? cfg.corromperBackup(arquivo) : arquivo;
      const f = novoArq(at.name, at.parent.id, conteudo, { minutosAtras: 0, dono: ME });
      escritas.push('BACKUP NOVO: ' + at.name + ' na pasta ' + at.parent.id + ' (id ' + f.id + ')');
      // a resposta descreve o que o Box guardou (como o Box de verdade)
      return { status: 201, body: { total_count: 1, entries: [meta(f)] } };
    }
    // upload de NOVA VERSÃO, com If-Match
    if (method === 'POST' && (m = caminho.match(/^\/files\/([^/]+)\/content$/))) {
      const f = F[m[1]];
      if (!f || f.lixeira) return erro(404, 'not_found');
      if (f.lock && f.lock.created_by.login !== ME) return erro(423, 'locked');
      if (headers['If-Match'] != null && String(headers['If-Match']) !== String(f.etag)) return erro(412, 'precondition_failed', 'The resource has been modified');
      const conteudo = cfg.corromperUpload ? cfg.corromperUpload(arquivo) : Buffer.from(arquivo);
      cfg.corromperUpload = null; // só a 1ª subida
      f.buf = Buffer.from(conteudo); f.ver++; f.etag++; f.modified_at = minutosAtras(0); f.modificadoPor = ME;
      escritas.push('NOVA VERSÃO: ' + f.name + ' (versão ' + f.ver + ', sha1 ' + sha1(f.buf) + ')');
      return { status: 201, body: { total_count: 1, entries: [meta(f)] } };
    }
    if ((m = caminho.match(/^\/files\/([^/]+)$/))) {
      const f = F[m[1]];
      if (!f || f.lixeira) return erro(404, 'not_found', 'Not Found');
      if (method === 'GET') return { status: 200, body: meta(f) };
      if (method === 'DELETE') {
        if (cfg.deleteProibido) return erro(403, 'access_denied_insufficient_permissions');
        if (cfg.deleteSemEfeito) return { status: 204 }; // responde 204 e não apaga
        f.lixeira = true;
        escritas.push('DELETE: ' + f.name + ' (id ' + f.id + ')');
        return { status: 204 };
      }
      if (method === 'PUT') {
        if (body && body.lock === null) {
          if (f.lock && f.lock.created_by.login !== ME) return erro(403, 'access_denied_insufficient_permissions');
          if (cfg.unlockFalha) return erro(500, 'internal_server_error');
          f.lock = null;
          escritas.push('UNLOCK: ' + f.name);
          return { status: 200, body: meta(f) };
        }
        if (body && body.lock) {
          if (f.lock) return erro(409, 'conflict', 'já travado');
          f.lock = { type: 'lock', id: 'L' + f.id, created_by: { type: 'user', login: ME }, created_at: 'agora', expires_at: body.lock.expires_at, is_download_prevented: !!body.lock.is_download_prevented };
          if (cfg.lockMudaEtag) f.etag++;
          escritas.push('LOCK: ' + f.name + ' (expires_at ' + body.lock.expires_at + ')');
          if (cfg.depoisDoLock) cfg.depoisDoLock(f, api);
          return { status: 200, body: meta(f) };
        }
        return erro(400, 'bad_request', 'PUT não previsto');
      }
    }
    throw new Error('Box falso: rota não prevista ' + method + ' ' + caminho);
  }

  function download(id) {
    contagem['DOWNLOAD ' + id] = (contagem['DOWNLOAD ' + id] || 0) + 1;
    log.push('DOWNLOAD ' + id);
    if (cfg.falharDownload && cfg.falharDownload(id, contagem['DOWNLOAD ' + id])) throw new Error('Box falso: download falhou (' + id + ')');
    const f = F[id];
    if (!f || f.lixeira) throw new Error('Box falso: 404 no download de ' + id);
    const copia = Buffer.from(f.buf);
    if (cfg.depoisDoDownload) cfg.depoisDoDownload(id, contagem['DOWNLOAD ' + id], api); // o gancho roda DEPOIS de o conteúdo sair
    if (cfg.alterarDownload) { const outro = cfg.alterarDownload(id, contagem['DOWNLOAD ' + id], copia, api); if (outro) return outro; }
    return copia;
  }

  const api = { http, download, F, D, log, escritas, novoArq, novaPasta, salvarPorFora, meta, cfg, ME };
  return api;
};
