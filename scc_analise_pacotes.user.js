// ==UserScript==

// @name         SCC — Análise de Pacotes

// @namespace    https://logistics.amazon.com

// @version      2.7.0

// @description  Análise de TBRs no SCC: Missing, Lost, Ageing e Geral

// @author       EDSP Team

// @match        https://logistics.amazon.com/station/dashboard/*

// @grant        none

// @run-at       document-idle

//

// Para distribuir atualizações automáticas via GitHub:

// 1. Suba este arquivo em um repositório GitHub

// 2. Substitua as URLs abaixo pela URL raw do seu repositório

// 3. Ao incrementar @version e subir no GitHub, todos os usuários recebem a atualização

//

// @updateURL    https://raw.githubusercontent.com/joaoitalowork-cmyk/scc-analise-pacotes/main/scc_analise_pacotes.user.js

// @downloadURL  https://raw.githubusercontent.com/joaoitalowork-cmyk/scc-analise-pacotes/main/scc_analise_pacotes.user.js

// ==/UserScript==



(function () {

  'use strict';



  // Garante execução única — evita conflito se outro script recarregar o DOM

  if (window.__sccAnaliseLoaded) return;

  window.__sccAnaliseLoaded = true;



  // ══════════════════════════════════════════════════════════

  // 1. CAPTURA DO x-api-usage-key VIA INTERCEPTAÇÃO

  // ══════════════════════════════════════════════════════════

  let apiKey = '';

  const URL_GW = 'https://logistics.amazon.com/station/proxyapigateway/data';



  const _fetch = window.fetch;

  window.fetch = function (...args) {

    try {

      const opts = args[1] || {};

      const h = opts.headers || {};

      const k = (h instanceof Headers ? h.get('x-api-usage-key') : null)

              || h['x-api-usage-key'] || h['X-Api-Usage-Key'];

      if (k) apiKey = k;

    } catch (_) {}

    return _fetch.apply(this, args);

  };



  const _setHdr = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.setRequestHeader = function (n, v) {

    if (n && n.toLowerCase() === 'x-api-usage-key' && v) apiKey = v;

    return _setHdr.apply(this, arguments);

  };



  // ══════════════════════════════════════════════════════════

  // 2. HELPERS GERAIS

  // ══════════════════════════════════════════════════════════

  function fmtDate(ms) {

    if (!ms) return '-';

    try {

      const d = new Date(ms);

      return d.toLocaleDateString('pt-BR') + ' ' +

             d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    } catch (_) { return '-'; }

  }



  function clean(v) {

    if (v == null || v === '' || String(v).toLowerCase() === 'null') return '-';

    return String(v).trim();

  }



  function mapOp(op) {

    if (!Array.isArray(op) || !op.length) return '-';

    const m = {

      PACKAGE_STATE_UPDATE: 'Package Scan',

      DRIVER_ASSIGNMENT: 'Driver Assignment',

      TRANSPORT_REQUEST_UPDATE: 'Transport Request Update',

      PACKAGE_INJECTION: 'Package Injection',

    };

    return m[op[0]] || op[0].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  }



  // ── SISTEMA DE CORES ──────────────────────────────────────────

  // Checa packageState, reasonCode E operation — qualquer campo

  // contendo a palavra-chave aciona a cor (regra "não exclusiva").

  const COLOR_RULES = [

    // Vermelho — Missing / Lost (maior prioridade)

    {

      color: { bg: '#fce8e6', bgAlt: '#f5c6cb', fg: '#c0392b' },

      keys: ['OBJECT MISSING','MARKED AS MISSING','MARKED AS LOST','DELIVERY REJECTED','MISSING','LOST'],

    },

    // Laranja — Dano / Clima / Mudança de endereço

    {

      color: { bg: '#ffe0b2', bgAlt: '#ffcc80', fg: '#e65100' },

      keys: ['CUSTOMER MOVED','MOVED','BAD WEATHER','WEATHER','DAMAGED','DAMAGE'],

    },

    // Amarelo — Tentativas de entrega sem sucesso

    {

      color: { bg: '#fffde7', bgAlt: '#fff9c4', fg: '#f57f17' },

      keys: [

        'ADDRESS NOT FOUND','CUSTOMER UNAVAILABLE','NO SECURE LOCATION',

        'BUSINESS CLOSED','NO ITEMS DELIVERED','RESCHEDULED BY CUSTOMER',

        'INACCESSIBLE DELIVERY LOCATION','OTP NOT AVAILABLE',

      ],

    },

    // Azul — Em trânsito

    {

      color: { bg: '#e3f2fd', bgAlt: '#bbdefb', fg: '#1565c0' },

      keys: ['IN TRANSIT'],

    },

  ];



  // Cor base para status genéricos (sem regra específica)

  function sColor(state) {

    if (!state) return '#f5f5f5';

    const s = state.toLowerCase();

    if (s.includes('delivered'))                                        return '#e6f4ea';

    if (s.includes('return') || s.includes('undeliverable'))           return '#fce8e6';

    if (s.includes('out_for') || s.includes('arrived') || s.includes('loaded')) return '#fff8e1';

    return '#f5f5f5';

  }



  function altColor(c) {

    return { '#f5f5f5':'#ebebeb','#e6f4ea':'#d4edda','#fce8e6':'#f5c6cb','#fff8e1':'#fff3cd' }[c] || c;

  }



  // Retorna { bg, bgAlt, fg } verificando TODOS os campos do evento

  function getEventColor(ev) {

    const norm = v => String(v || '').toUpperCase().replace(/_/g, ' ').trim();

    const fields = [

      norm(ev.packageState),

      norm(ev.reasonCode),

      ...(Array.isArray(ev.operation) ? ev.operation.map(norm) : [norm(ev.operation)]),

    ];

    const has = kw => fields.some(f => f.includes(kw));

    for (const rule of COLOR_RULES) {

      if (rule.keys.some(k => has(k))) return rule.color;

    }

    const bg = sColor(ev.packageState);

    return { bg, bgAlt: altColor(bg), fg: null };

  }



  function badge(state) {

    const bg = sColor(state);

    const fg = bg === '#e6f4ea' ? '#1e7e34' : bg === '#fce8e6' ? '#c0392b' : bg === '#fff8e1' ? '#856404' : '#555';

    const lbl = clean(state).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">${lbl}</span>`;

  }



  // ══════════════════════════════════════════════════════════

  // 3. CHAMADAS DE API

  // ══════════════════════════════════════════════════════════

  async function gw(payload) {

    const hdrs = {

      'accept': 'application/json',

      'content-type': 'application/json',

      'x-requested-with': 'XMLHttpRequest',

    };

    if (apiKey) hdrs['x-api-usage-key'] = apiKey;

    const r = await _fetch(URL_GW, {

      method: 'POST', headers: hdrs,

      body: JSON.stringify(payload), credentials: 'include'

    });

    if (!r.ok) throw new Error('HTTP ' + r.status);

    return r.json();

  }



  async function fetchHistory(tbr) {

    return gw({ resourcePath: '/os/getPackageHistoryData', httpMethod: 'post', processName: 'oculus',

                 requestBody: { packageId: tbr, pageSize: 100 } });

  }



  async function fetchDetail(tbr) {

    return gw({ resourcePath: '/os/getPackageDetailData', httpMethod: 'get', processName: 'oculus',

                 requestParams: { trackingId: [tbr], nodeId: ['SLS9'] } });

  }



  async function fetchTBR(tbr) {

    const [hist, det] = await Promise.all([

      fetchHistory(tbr).catch(() => null),

      fetchDetail(tbr).catch(() => null),

    ]);

    const events = hist?.packageHistory || hist?.responseBody?.packageHistory || [];

    const linked = det?.packageDetail?.packageData?.linkedTrackingIds || [];



    // Busca histórico de TODOS os linked TBRs (pode ser múltiplos originals ou RTOs)

    const linkedHistArr = await Promise.all(

      linked.map(id => fetchHistory(id).catch(() => null))

    );

    const linkedTBRs = linked.map((id, i) => ({

      id,

      isRTO:  isRTO(id),

      events: linkedHistArr[i]?.packageHistory || linkedHistArr[i]?.responseBody?.packageHistory || [],

    }));



    // Mantém rtoId/rtoEvents para compatibilidade com classifyMissing

    const firstLinked = linkedTBRs[0] || null;

    return { tbr, events, linkedTBRs, rtoId: firstLinked?.id || null, rtoEvents: firstLinked?.events || [] };

  }



  // ══════════════════════════════════════════════════════════

  // 4. LÓGICA MISSING

  // ══════════════════════════════════════════════════════════

  function isBaseLogin(v) {

    return v && String(v).toLowerCase().includes('@amazon.com');

  }



  // Bases EDSP: mãe = iniciam com S (SCE9, SSB9, SPH9, STS9, SIM9...)

  //             filho = iniciam com P (PPI1, PPC1, PRU2, PCM2, PSG2, PFI1, PCS2...)

  // Externos (ESA8, ESJ8...) e outros NÃO são EDSP

  function isEDSPBase(loc) {

    if (!loc || loc === '-') return false;

    const s = String(loc).trim().toUpperCase();

    return /^[SP][A-Z]{1,3}\d/.test(s);

  }



  // Movimentação válida = login Amazon (@amazon.com) EM base EDSP

  // Checa scanLocation (Local) e source (Origem) como fallback

  function isEdspEvent(ev) {

    if (!isBaseLogin(ev.scanAssociate)) return false;

    return isEDSPBase(ev.scanLocation) || isEDSPBase(ev.source);

  }



  // TBR com 12 dígitos numéricos (após prefixo) = RTO (retorno à origem)

  // TBR com 9 dígitos = TBR original (envio ao cliente)

  function isRTO(tbr) {

    const digits = String(tbr || '').replace(/^[A-Z]+/i, '').replace(/\D/g, '');

    return digits.length >= 12;

  }



  function tbrLabel(tbr) {

    return isRTO(tbr) ? 'RTO' : 'TBR Original';

  }



  function classifyMissing(result) {

    const { events } = result;

    if (!events.length) return { type: 'MNR', rule: 0, reason: 'Sem eventos para analisar' };



    // Ordena cronologicamente (mais antigo primeiro) usando stateTime

    const sorted = [...events].sort((a, b) => (a.stateTime || 0) - (b.stateTime || 0));



    // Regra 3 — base: só restringe a janela se MARKED_AS_MISSING for o TERMINAL

    // (último evento ou bloco final de eventos). Se houver eventos DEPOIS do missing,

    // analisa tudo normalmente — o pacote seguiu o fluxo após o missing.

    const endsWithMissing = (sorted[sorted.length - 1]?.packageState || '').toUpperCase() === 'MARKED_AS_MISSING';

    const hasMissingAnywhere = sorted.some(e => (e.packageState || '').toUpperCase() === 'MARKED_AS_MISSING');



    let analysisPart, hasMissing;

    if (endsWithMissing) {

      // Encontra o início do bloco terminal de MARKED_AS_MISSING (podem ser vários consecutivos)

      let cutIdx = sorted.length - 1;

      while (cutIdx > 0 && (sorted[cutIdx - 1]?.packageState || '').toUpperCase() === 'MARKED_AS_MISSING') {

        cutIdx--;

      }

      analysisPart = cutIdx > 0 ? sorted.slice(0, cutIdx) : sorted;

      hasMissing   = true; // Terminal missing — janela restrita

    } else {

      // Missing existe no histórico mas NÃO é o último evento: analisa tudo

      analysisPart = sorted;

      hasMissing   = false; // Não restringe — há eventos posteriores ao missing

    }



    // Último evento relevante na janela de análise

    const lastEvt = analysisPart.length ? analysisPart[analysisPart.length - 1] : null;



    // ─── REGRA 1 ────────────────────────────────────────────────

    // Último evento da janela tem packageState OU reasonCode = EOD_SCRUB / PAPERWORK_RECEIVED → MNR

    // (descarta se houver eventos DEPOIS deles dentro da janela)

    const MNR_TRIGGERS = ['EOD_SCRUB', 'PAPERWORK_RECEIVED'];

    if (lastEvt) {

      const evState  = (lastEvt.packageState || '').toUpperCase();

      const evReason = (lastEvt.reasonCode   || '').toUpperCase();

      const trigger  = MNR_TRIGGERS.find(t => t === evState || t === evReason);

      if (trigger) {

        const field = MNR_TRIGGERS.includes(evState) ? 'Status' : 'Motivo';

        return {

          type: 'MNR', rule: 1,

          reason: `Último evento${hasMissing ? ' (anterior ao MARKED AS MISSING)' : ''} — ${field}: ${trigger.replace(/_/g, ' ')}`,

          triggerEvt: lastEvt,

          analysisPart, hasMissing, sorted,

        };

      }

    }



    // ─── REGRA 2 ────────────────────────────────────────────────

    // MARKED FOR REPROCESS com origem diferente do destino do MANIFESTED → MNR

    const manifestedEvt = sorted.find(e => (e.packageState || '').toUpperCase() === 'MANIFESTED') || sorted[0];

    const reprocessEvt  = sorted.find(e => {

      const s = (e.packageState || '').toUpperCase().replace(/[\s\-]+/g, '_');

      return s.includes('MARKED_FOR_REPROCESS') || s.includes('FOR_REPROCESS');

    });



    if (reprocessEvt && manifestedEvt) {

      const mDest = clean(manifestedEvt.destination);

      const rSrc  = clean(reprocessEvt.source);

      if (mDest !== '-' && rSrc !== '-' && mDest.toLowerCase() !== rSrc.toLowerCase()) {

        return {

          type: 'MNR', rule: 2,

          reason: `MARKED FOR REPROCESS: origem "${rSrc}" ≠ destino do MANIFESTED "${mDest}"`,

          manifestedEvt, reprocessEvt,

          analysisPart, hasMissing, sorted,

        };

      }

    }



    // ─── REGRA 3 (LOGIN EDSP) ───────────────────────────────────

    // Login @amazon.com em base EDSP (inicia com S ou P) → VÁLIDO

    // Bases externas (ESA8, ESJ8...) não contabilizam

    const loginEvts = analysisPart.filter(e => isEdspEvent(e));

    if (loginEvts.length > 0) {

      return {

        type: 'VALIDO', rule: 3,

        reason: loginEvts.length + ' movimentação(ões) em base EDSP detectada(s)',

        loginEvts, analysisPart, hasMissing, sorted,

      };

    }



    // Verifica se há logins Amazon mas todos em bases não-EDSP (informativo)

    const nonEdspLogins = analysisPart.filter(e => isBaseLogin(e.scanAssociate) && !isEdspEvent(e));

    const nonEdspNote = nonEdspLogins.length

      ? ' (' + nonEdspLogins.length + ' login(s) em base não-EDSP desconsiderado(s))'

      : '';



    return {

      type: 'MNR', rule: 3,

      reason: 'Nenhuma movimentação em base EDSP detectada' + nonEdspNote,

      nonEdspLogins,

      analysisPart, hasMissing, sorted,

    };

  }



  // ══════════════════════════════════════════════════════════

  // 5. RENDER: TABELA

  // ══════════════════════════════════════════════════════════



  // Ordena para exibição: mais recente no topo (como era antes da análise cronológica)

  function displayOrder(evts) {

    return [...evts].sort((a, b) => (b.stateTime || 0) - (a.stateTime || 0));

  }




  // ══════════════════════════════════════════════════════════
  // classifyLost — Regras de negócio para análise LOST
  // ══════════════════════════════════════════════════════════
  function classifyLost(result) {
    const { tbr, events, linkedTBRs = [] } = result;
    const allTBRs   = [{ id: tbr, isRTO: isRTO(tbr), events }, ...linkedTBRs];
    const allEvents = allTBRs.flatMap(t => t.events);
    const normState = e => (e.packageState || '').toUpperCase().replace(/\s+/g, '_');

    // Regra 1 — LOST em qualquer TBR → INDEVIDO
    const lostEvts = allEvents.filter(e => ['MARKED_AS_LOST','LOST'].includes(normState(e)));
    const hasLost  = lostEvts.length > 0;

    // Regra 4 — RTO com STOWED → Possível Reversa
    const possibleReversa = allTBRs
      .filter(t => t.isRTO)
      .some(t => t.events.some(e => normState(e) === 'STOWED'));

    // Regra 2 — movimentação em base EDSP
    const edspEvts = allEvents.filter(e => isEDSPBase(e.scanLocation) || isEDSPBase(e.source));
    const hasEDSP  = edspEvts.length > 0;

    if (hasLost) return { type: 'INDEVIDO', possibleReversa, lostEvts, hasEDSP, edspEvts };
    if (hasEDSP) return { type: 'DEVIDO',   possibleReversa: false, lostEvts: [], hasEDSP: true, edspEvts };
    return         { type: 'INDEVIDO',       possibleReversa, lostEvts: [], hasEDSP: false, edspEvts: [] };
  }

  function buildTable(events, tid, isRTO, hlLogins, labelOverride, hlLostRows) {

    if (!events.length)

      return `<p style="color:#888;font-style:italic;margin:8px 0">Nenhum evento encontrado para ${tid}.</p>`;

    const rtoLbl = labelOverride != null ? labelOverride + ' ' : (isRTO ? `<strong style="color:#6c3483">&#8617; RTO:</strong> ` : '');

    const cols   = ['Data/Hora','Status','Operação','Origem','Destino','Motivo','Local','Ciclo','Event Processed By'];

    const th     = cols.map(c => `<th style="padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap;font-size:11px">${c}</th>`).join('');

    const td     = v => `<td style="padding:6px 10px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis">${v}</td>`;

    const rows   = events.map((ev, i) => {

      const evColor = getEventColor(ev);

      const bg      = i % 2 === 0 ? evColor.bg : (evColor.bgAlt || evColor.bg);

      const aso = clean(ev.scanAssociate);

      // Verde = login EDSP (válido), Laranja = login Amazon não-EDSP (desconsiderado)

      const isEdsp    = hlLogins && isEdspEvent(ev);

      const isAmazon  = hlLogins && !isEdsp && isBaseLogin(ev.scanAssociate);

      const assocCell = isEdsp

        ? `<td style="padding:6px 10px;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;background:#c8f5d7;font-weight:700;color:#155724" title="Base EDSP ✔">${aso}</td>`

        : isAmazon

          ? `<td style="padding:6px 10px;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;background:#fff3cd;font-weight:600;color:#856404" title="Amazon login — base não-EDSP">${aso}</td>`

          : td(aso);

      const isLostRow = hlLostRows && ['MARKED_AS_LOST','LOST'].includes((ev.packageState||'').toUpperCase().replace(/\s+/g,'_'));
      const rowStyle  = isLostRow
        ? 'background:#ffcdd2;border-left:5px solid #c0392b;border-bottom:2px solid #e88;font-weight:700'
        : `background:${bg};border-bottom:1px solid #e0e0e0`;
      return `<tr style="${rowStyle}">

        ${td(fmtDate(ev.stateTime))}${td(badge(ev.packageState))}${td(mapOp(ev.operation))}

        ${td(clean(ev.source))}${td(clean(ev.destination))}${td(clean(ev.reasonCode).replace(/_/g,' '))}

        ${td(clean(ev.scanLocation))}${td(clean(ev.cycle))}${assocCell}</tr>`;

    }).join('');

    return `

      <div style="font-size:12px;color:#555;margin-bottom:4px">${rtoLbl}<strong>${tid}</strong> &nbsp;·&nbsp; ${events.length} evento(s)</div>

      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">

        <thead><tr style="background:#1a3c5e;color:#fff;position:sticky;top:0">${th}</tr></thead>

        <tbody>${rows}</tbody></table></div>`;

  }



  // ══════════════════════════════════════════════════════════

  // 6. RENDER: CARDS

  // ══════════════════════════════════════════════════════════

  function renderMissingCard(result, container) {

    const { tbr } = result;

    const c       = classifyMissing(result);

    const isVal   = c.type === 'VALIDO';

    const sorted  = c.sorted || [...result.events].sort((a,b) => (a.stateTime||0)-(b.stateTime||0));

    const last    = sorted[sorted.length - 1];

    const hdrBg   = isVal ? '#e8f0fe' : '#fff0f0';

    const hdrFg   = isVal ? '#1a3c5e' : '#8b0000';

    const typeBdg = isVal

      ? `<span style="background:#1a7a4a;color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700">&#10004; VÁLIDO</span>`

      : `<span style="background:#c0392b;color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700">&#10006; MNR</span>`;

    const mainIsRTO = isRTO(tbr);

    const mainBadgeM = mainIsRTO

      ? `<span style="background:#6c3483;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:6px;font-weight:700">RTO</span>`

      : `<span style="background:#1a7a4a;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:6px;font-weight:700">TBR Original</span>`;

    const linkedBadgesM = (result.linkedTBRs || []).map(lt =>

      lt.isRTO

        ? `<span style="background:#6c3483;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:4px">RTO: ${lt.id}</span>`

        : `<span style="background:#1a7a4a;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:4px">Original: ${lt.id}</span>`

    ).join('');

    const rtoTag = mainBadgeM + linkedBadgesM;



    // Nota sobre janela de análise

    const allSorted = c.sorted || [];

    const hasMissingInHistory = allSorted.some(e => (e.packageState || '').toUpperCase() === 'MARKED_AS_MISSING');

    const windowNote = c.hasMissing

      // Missing é TERMINAL → avisa que a análise considera apenas os eventos anteriores

      ? `<div style="font-size:11px;background:#fff8e1;border-left:3px solid #f0ad4e;padding:5px 10px;border-radius:3px;margin-bottom:8px;color:#856404">

           &#128270; <strong>MARKED AS MISSING</strong> é o último evento — análise realizada nos eventos <strong>anteriores</strong> a ele

         </div>`

      // Missing existe no histórico mas NÃO é terminal → informa, mas analisa tudo

      : hasMissingInHistory

        ? `<div style="font-size:11px;background:#e8f5e9;border-left:3px solid #1a7a4a;padding:5px 10px;border-radius:3px;margin-bottom:8px;color:#155724">

             &#9989; Existem eventos <strong>MARKED AS MISSING</strong> no histórico, mas há movimentações <strong>posteriores</strong> — análise realizada em todos os eventos

           </div>`

        : '';



    // Eventos posteriores ao bloco terminal de MARKED_AS_MISSING (só quando é terminal)

    const postMissingEvts = (c.hasMissing && c.sorted)

      ? (() => {

          const cutIdx = c.sorted.findIndex(e => (e.packageState||'').toUpperCase() === 'MARKED_AS_MISSING');

          return cutIdx >= 0 ? c.sorted.slice(cutIdx) : [];

        })()

      : [];

    const postMissingSection = postMissingEvts.length

      ? `<div style="margin-top:12px">

           <div style="font-size:11px;color:#9b59b6;font-weight:600;margin-bottom:4px;padding:4px 8px;background:#f5effe;border-radius:4px;display:inline-block">

             &#8627; Eventos a partir do MARKED AS MISSING (${postMissingEvts.length})

           </div>

           ${buildTable(displayOrder(postMissingEvts), tbr + ' (pós-missing)', false, false)}

         </div>` : '';



    let bodyContent = '';



    if (isVal) {

      // VÁLIDO — mostra janela de análise com logins destacados

      bodyContent = `

        ${windowNote}

        <div style="font-size:12px;padding:6px 10px;background:#e8f5e9;border-left:4px solid #1a7a4a;border-radius:4px;margin-bottom:8px">

          &#10003; ${c.reason} — logins de base destacados em <strong style="color:#155724">verde</strong>

        </div>

        ${buildTable(displayOrder(c.analysisPart), tbr, false, true)}

        ${postMissingSection}

        ${(result.linkedTBRs || []).filter(lt => lt.events.length).map(lt =>
          `<div style="margin-top:14px;border-top:2px dashed ${lt.isRTO ? '#6c3483' : '#1a7a4a'};padding-top:12px">${buildTable(displayOrder(lt.events), lt.id + (lt.isRTO ? ' (RTO)' : ' (TBR Original)'), true, true)}</div>`
        ).join('')}`;



    } else if (c.rule === 1) {

      // MNR Regra 1 — EOD_SCRUB / PAPERWORK_RECEIVED como último evento

      const ev = c.triggerEvt;

      const evState = (ev?.packageState || '').replace(/_/g,' ');

      bodyContent = `

        ${windowNote}

        <div style="padding:10px 14px;background:#fff5f5;border-left:4px solid #c0392b;border-radius:4px;margin-bottom:8px">

          <div style="font-size:13px;color:#8b0000;font-weight:700;margin-bottom:4px">&#9888; MNR — Regra 1: Último evento inválido</div>

          <div style="font-size:12px;color:#555">${c.reason}</div>

          ${ev ? `<table style="margin-top:8px;font-size:12px;border-collapse:collapse;width:100%">

            <tr style="background:#fce8e6">

              <td style="padding:5px 8px;border:1px solid #f5c6cb;font-weight:600;white-space:nowrap">Evento gatilho</td>

              <td style="padding:5px 8px;border:1px solid #f5c6cb">${fmtDate(ev.stateTime)}</td>

              <td style="padding:5px 8px;border:1px solid #f5c6cb"><strong>${evState}</strong></td>

              <td style="padding:5px 8px;border:1px solid #f5c6cb">${clean(ev.source)}</td>

              <td style="padding:5px 8px;border:1px solid #f5c6cb">${clean(ev.destination)}</td>

            </tr></table>` : ''}

        </div>

        ${postMissingSection}`;



    } else if (c.rule === 2) {

      // MNR Regra 2 — MARKED FOR REPROCESS com origem diferente

      const mEv = c.manifestedEvt;

      const rEv = c.reprocessEvt;

      bodyContent = `

        ${windowNote}

        <div style="padding:10px 14px;background:#fff5f5;border-left:4px solid #c0392b;border-radius:4px;margin-bottom:8px">

          <div style="font-size:13px;color:#8b0000;font-weight:700;margin-bottom:4px">&#9888; MNR — Regra 2: Reprocessamento em local incorreto</div>

          <div style="font-size:12px;color:#555;margin-bottom:8px">${c.reason}</div>

          <table style="font-size:12px;border-collapse:collapse;width:auto">

            <tr style="background:#e8f0fe">

              <th style="padding:5px 10px;border:1px solid #c5d5f5;text-align:left">Evento</th>

              <th style="padding:5px 10px;border:1px solid #c5d5f5;text-align:left">Data/Hora</th>

              <th style="padding:5px 10px;border:1px solid #c5d5f5;text-align:left">Origem</th>

              <th style="padding:5px 10px;border:1px solid #c5d5f5;text-align:left">Destino</th>

            </tr>

            ${mEv ? `<tr style="background:#f8f9fa">

              <td style="padding:5px 10px;border:1px solid #dee2e6;white-space:nowrap"><strong>MANIFESTED</strong></td>

              <td style="padding:5px 10px;border:1px solid #dee2e6">${fmtDate(mEv.stateTime)}</td>

              <td style="padding:5px 10px;border:1px solid #dee2e6">${clean(mEv.source)}</td>

              <td style="padding:5px 10px;border:1px solid #dee2e6;background:#fff3cd;font-weight:700">${clean(mEv.destination)}</td>

            </tr>` : ''}

            ${rEv ? `<tr style="background:#fff5f5">

              <td style="padding:5px 10px;border:1px solid #dee2e6;white-space:nowrap"><strong>MARKED FOR REPROCESS</strong></td>

              <td style="padding:5px 10px;border:1px solid #dee2e6">${fmtDate(rEv.stateTime)}</td>

              <td style="padding:5px 10px;border:1px solid #dee2e6;background:#fce8e6;font-weight:700">${clean(rEv.source)}</td>

              <td style="padding:5px 10px;border:1px solid #dee2e6">${clean(rEv.destination)}</td>

            </tr>` : ''}

          </table>

        </div>

        ${postMissingSection}`;



    } else {

      // MNR Regra 3 — sem login em base EDSP

      const nonEdspNote = (c.nonEdspLogins && c.nonEdspLogins.length)

        ? `<div style="font-size:11px;margin-top:8px;padding:5px 10px;background:#fff8e1;border-left:3px solid #f0ad4e;border-radius:3px;color:#856404">

             &#9888; ${c.nonEdspLogins.length} login(s) Amazon detectado(s) em base não-EDSP (desconsiderado):

             <strong>${[...new Set(c.nonEdspLogins.map(e => clean(e.scanLocation) !== '-' ? clean(e.scanLocation) : clean(e.source)))].join(', ')}</strong>

           </div>` : '';

      bodyContent = `

        ${windowNote}

        <div style="padding:10px 14px;background:#fff5f5;border-left:4px solid #c0392b;border-radius:4px">

          <div style="display:flex;align-items:center;gap:10px">

            <span style="font-size:20px">&#9888;</span>

            <div><strong style="font-size:13px;color:#8b0000">MNR — Sem movimentação em base EDSP</strong><br>

              <span style="font-size:12px;color:#666">${c.reason}</span></div>

          </div>

          ${nonEdspNote}

        </div>

        ${postMissingSection}`;

    }



    const card = document.createElement('div');

    card.className = 'scc-card';

    card.innerHTML = `

      <div class="scc-chdr" style="background:${hdrBg};color:${hdrFg}"

           onclick="(function(el){var b=el.nextElementSibling;b.style.display=b.style.display==='none'?'':'none';})(this)">

        <span style="display:flex;align-items:center;gap:8px">

          ${typeBdg} <strong>${tbr}</strong> ${last ? badge(last.packageState) : ''} ${mainBadgeM} ${linkedBadgesM}

          <span style="font-size:10px;background:rgba(0,0,0,.08);padding:2px 6px;border-radius:8px">Regra ${c.rule}</span>

        </span>

        <span style="font-size:11px;color:#888">${isVal ? (c.analysisPart||[]).length + ' evento(s)' : 'MNR'} &#9662;</span>

      </div>

      <div class="scc-cbody">${bodyContent}</div>`;

    container.appendChild(card);

  }




  // ══════════════════════════════════════════════════════════
  // renderLostCard
  // ══════════════════════════════════════════════════════════
  function renderLostCard(result, container) {
    const { tbr } = result;
    const c        = classifyLost(result);
    const isIndev  = c.type === 'INDEVIDO';

    const hdrBg  = isIndev ? '#fff0f0' : '#e8f5e9';
    const hdrFg  = isIndev ? '#8b0000' : '#1a3c5e';
    const border = isIndev ? '#c0392b' : '#1a7a4a';

    const typeBadge = isIndev
      ? `<span style="background:#c0392b;color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700">&#10006; INDEVIDO</span>`
      : `<span style="background:#1a7a4a;color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700">&#10004; DEVIDO</span>`;

    const reversaBadge = c.possibleReversa
      ? `<span style="background:#e67e22;color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;margin-left:6px">&#9654; Poss\u00edvel Reversa</span>`
      : '';

    const mainIsRTO = isRTO(tbr);
    const mainBadge = mainIsRTO
      ? `<span style="background:#6c3483;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:6px;font-weight:700">RTO</span>`
      : `<span style="background:#1a7a4a;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:6px;font-weight:700">TBR Original</span>`;

    const linkedBadges = (result.linkedTBRs || []).map(lt =>
      lt.isRTO
        ? `<span style="background:#6c3483;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:4px">RTO: ${lt.id}</span>`
        : `<span style="background:#1a7a4a;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:4px">Original: ${lt.id}</span>`
    ).join('');

    const edspNote = (isIndev && c.hasEDSP)
      ? `<div style="font-size:11px;background:#fff8e1;border-left:3px solid #f0ad4e;padding:5px 10px;border-radius:3px;margin-bottom:8px;color:#856404">
           &#9889; Aten\u00e7\u00e3o: h\u00e1 movimenta\u00e7\u00e3o em base EDSP mesmo com marca\u00e7\u00e3o LOST
         </div>`
      : '';

    const edspDueNote = (!isIndev && c.hasEDSP)
      ? `<div style="font-size:11px;background:#e8f5e9;border-left:3px solid #1a7a4a;padding:5px 10px;border-radius:3px;margin-bottom:8px;color:#155724">
           &#10003; Movimenta\u00e7\u00e3o confirmada em base EDSP \u2014 classifica\u00e7\u00e3o DEVIDO
         </div>`
      : '';

    const sorted = [...result.events].sort((a,b) => (a.stateTime||0)-(b.stateTime||0));

    const linkedSections = (result.linkedTBRs || []).filter(lt => lt.events.length).map(lt => {
      const color = lt.isRTO ? '#6c3483' : '#1a7a4a';
      const label = lt.isRTO
        ? `<strong style="color:#6c3483">&#8617; RTO:</strong> ${lt.id}`
        : `<strong style="color:#1a7a4a">&#128230; TBR Original:</strong> ${lt.id}`;
      return `<div style="margin-top:14px;border-top:2px dashed ${color};padding-top:12px">
        ${buildTable(displayOrder(lt.events), lt.id, lt.isRTO, false, label, true)}
      </div>`;
    }).join('');

    const body = `${edspNote}${edspDueNote}
      ${buildTable(displayOrder(sorted), tbr, mainIsRTO, false, null, true)}
      ${linkedSections}`;

    container.insertAdjacentHTML('beforeend', `
      <div style="border:2px solid ${border};border-radius:8px;margin-bottom:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.12)">
        <div style="background:${hdrBg};padding:10px 14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-bottom:2px solid ${border}">
          ${typeBadge}${reversaBadge}
          <span style="font-weight:700;font-size:13px;color:${hdrFg}">${tbr}</span>
          ${mainBadge}${linkedBadges}
        </div>
        <div style="padding:12px 14px">${body}</div>
      </div>`);
  }

  function renderGeralCard(result, container) {

    const { tbr, events, linkedTBRs = [] } = result;

    const mainIsRTO = isRTO(tbr);

    const last      = events[events.length - 1];



    // Badge do TBR principal

    const mainBadge = mainIsRTO

      ? `<span style="background:#6c3483;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:6px;font-weight:700">RTO</span>`

      : `<span style="background:#1a7a4a;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:6px;font-weight:700">TBR Original</span>`;



    // Badges dos linked TBRs no cabeçalho

    const linkedBadges = linkedTBRs.map(lt =>

      lt.isRTO

        ? `<span style="background:#6c3483;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:4px">RTO: ${lt.id}</span>`

        : `<span style="background:#1a7a4a;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:4px">Original: ${lt.id}</span>`

    ).join('');



    // Seções dos linked TBRs

    const linkedSections = linkedTBRs.filter(lt => lt.events.length).map(lt => {

      const color  = lt.isRTO ? '#6c3483' : '#1a7a4a';

      const label  = lt.isRTO

        ? `<strong style="color:#6c3483">&#8617; RTO:</strong> ${lt.id}`

        : `<strong style="color:#1a7a4a">&#128230; TBR Original:</strong> ${lt.id}`;

      return `<div style="margin-top:14px;border-top:2px dashed ${color};padding-top:12px">

        ${buildTable(displayOrder(lt.events), lt.id, false, false, label)}

      </div>`;

    }).join('');



    const card = document.createElement('div');

    card.className = 'scc-card';

    card.innerHTML = `

      <div class="scc-chdr"

           onclick="(function(el){var b=el.nextElementSibling;b.style.display=b.style.display==='none'?'':'none';})(this)">

        <span style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">

          ${mainBadge} <strong>${tbr}</strong> ${last ? badge(last.packageState) : ''} ${linkedBadges}

        </span>

        <span style="font-size:11px;color:#555">${events.length} evento(s) &#9662;</span>

      </div>

      <div class="scc-cbody">

        ${buildTable(displayOrder(events), tbr, false, false)}

        ${linkedSections}

      </div>`;

    container.appendChild(card);

  }



  function renderErrCard(tbr, msg, container) {

    const card = document.createElement('div');

    card.className = 'scc-card';

    card.innerHTML = `

      <div class="scc-chdr" style="background:#fce8e6;color:#c0392b">

        <span>${tbr}</span><span style="font-size:11px">Erro ao buscar</span>

      </div>

      <div class="scc-cbody" style="color:#c0392b;font-size:12px">&#9888; ${msg || 'Falha na requisição'}</div>`;

    container.appendChild(card);

  }



  // ══════════════════════════════════════════════════════════

  // 7. DOWNLOAD CSV

  // ══════════════════════════════════════════════════════════

  function toCSVRows(events, tid) {

    return events.map(ev => [

      tid, fmtDate(ev.stateTime), clean(ev.source),

      clean(ev.packageState).replace(/_/g,' '), mapOp(ev.operation),

      clean(ev.destination), clean(ev.reasonCode).replace(/_/g,' '),

      clean(ev.scanAssociate), clean(ev.scanLocation), clean(ev.sortZone), clean(ev.cycle),

    ]);

  }



  // ── DOWNLOAD EXCEL COM CORES ──────────────────────────────────

  // Usa HTML table exportado como .xls (Excel abre nativamente com cores)

  function cellXL(val, bg, fg, bold) {

    const s = ['border:1px solid #ccc','padding:4px 8px','white-space:nowrap',

      bg ? 'background:'+bg : '', fg ? 'color:'+fg : '', bold ? 'font-weight:700' : '',

    ].filter(Boolean).join(';');

    return '<td style="'+s+'">' + String(val).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</td>';

  }



  function buildXLRows(events, tid, tipo, classifInfo) {

    const H = '#1a3c5e';

    const rows = [];

    if (tipo === 'MISSING') {

      const hdrs = ['Tracking ID','Classificacao','Regra','Motivo Classificacao',

        'Data/Hora','Origem','Status','Operacao','Destino','Motivo Evento',

        'Event Processed By','Local','Sort Zone','Ciclo'];

      rows.push('<tr>'+hdrs.map(h=>cellXL(h,H,'#fff',true)).join('')+'</tr>');

      if (classifInfo && classifInfo.type === 'MNR') {

        const b = '#fce8e6';

        rows.push('<tr>'

          +cellXL(tid,b,'#c0392b',true)+cellXL('MNR',b,'#c0392b',true)

          +cellXL('Regra '+(classifInfo.rule||''),b,'',false)

          +cellXL(classifInfo.reason||'',b,'',false)

          +Array(10).fill(cellXL('-',b,'',false)).join('')+'</tr>');

      } else {

        events.forEach(ev => {

          const c = getEventColor(ev);

          const edsp = isEdspEvent(ev);

          rows.push('<tr>'

            +cellXL(tid,c.bg,c.fg||'',true)

            +cellXL('VALIDO','#e6f4ea','#1e7e34',true)

            +cellXL('Regra '+(classifInfo?classifInfo.rule:''),c.bg,'',false)

            +cellXL(classifInfo?classifInfo.reason:'',c.bg,'',false)

            +cellXL(fmtDate(ev.stateTime),c.bg,c.fg||'',false)

            +cellXL(clean(ev.source),c.bg,c.fg||'',false)

            +cellXL(clean(ev.packageState).replace(/_/g,' '),c.bg,c.fg||'',false)

            +cellXL(mapOp(ev.operation),c.bg,c.fg||'',false)

            +cellXL(clean(ev.destination),c.bg,c.fg||'',false)

            +cellXL(clean(ev.reasonCode).replace(/_/g,' '),c.bg,c.fg||'',false)

            +cellXL(clean(ev.scanAssociate),edsp?'#c8f5d7':c.bg,edsp?'#155724':c.fg||'',edsp)

            +cellXL(clean(ev.scanLocation),c.bg,c.fg||'',false)

            +cellXL(clean(ev.sortZone),c.bg,c.fg||'',false)

            +cellXL(clean(ev.cycle),c.bg,c.fg||'',false)+'</tr>');

        });

      }

    } else {

      const hdrs = ['Tracking ID','Data/Hora','Origem','Status','Operacao','Destino',

        'Motivo','Event Processed By','Local','Sort Zone','Ciclo'];

      rows.push('<tr>'+hdrs.map(h=>cellXL(h,H,'#fff',true)).join('')+'</tr>');

      events.forEach(ev => {

        const c = getEventColor(ev);

        rows.push('<tr>'

          +cellXL(tid,c.bg,c.fg||'',true)

          +cellXL(fmtDate(ev.stateTime),c.bg,c.fg||'',false)

          +cellXL(clean(ev.source),c.bg,c.fg||'',false)

          +cellXL(clean(ev.packageState).replace(/_/g,' '),c.bg,c.fg||'',false)

          +cellXL(mapOp(ev.operation),c.bg,c.fg||'',false)

          +cellXL(clean(ev.destination),c.bg,c.fg||'',false)

          +cellXL(clean(ev.reasonCode).replace(/_/g,' '),c.bg,c.fg||'',false)

          +cellXL(clean(ev.scanAssociate),c.bg,c.fg||'',false)

          +cellXL(clean(ev.scanLocation),c.bg,c.fg||'',false)

          +cellXL(clean(ev.sortZone),c.bg,c.fg||'',false)

          +cellXL(clean(ev.cycle),c.bg,c.fg||'',false)+'</tr>');

      });

    }

    return rows;

  }



  function downloadCSV(data, tipo) {

    const date    = new Date().toLocaleDateString('pt-BR').replace(/\//g,'-');

    // Linha em branco — número de colunas varia por tipo

    const nCols   = tipo === 'MISSING' ? 14 : 11;

    const blankRow = '<tr>' + Array(nCols).fill('<td style="border:none;padding:6px"></td>').join('') + '</tr>';

    const sep     = blankRow + blankRow; // duas linhas em branco entre TBRs



    let body = ''; let first = true;

    data.forEach(r => {

      const ci = tipo === 'MISSING' ? classifyMissing(r) : null;

      const evs = (ci && ci.type === 'VALIDO')

        ? displayOrder(ci.analysisPart || r.events)

        : displayOrder(r.events);

      const rows = buildXLRows(evs, r.tbr, tipo, ci);

      if (first) {

        body += rows[0]; // cabeçalho só na primeira TBR

        first = false;

      } else {

        body += sep; // duas linhas em branco antes de cada nova TBR

      }

      rows.slice(1).forEach(row => { body += row; });

      if (tipo !== 'MISSING') {
        (r.linkedTBRs || []).filter(lt => lt.events.length).forEach(lt => {
          buildXLRows(displayOrder(lt.events), lt.id + (lt.isRTO ? ' (RTO)' : ' (TBR Original)'), tipo, null)
            .slice(1).forEach(row => { body += row; });
        });
      }

    });

    const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" '

      +'xmlns:x="urn:schemas-microsoft-com:office:excel" '

      +'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8">'

      +'</head><body><table border="0" cellspacing="0" cellpadding="0">'+body+'</table></body></html>';

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;

    a.download = 'SCC_'+tipo+'_'+date+'.xls';

    document.body.appendChild(a); a.click();

    document.body.removeChild(a); URL.revokeObjectURL(url);

  }





  function injectCSS() {

    const s = document.createElement('style');

    s.id = 'scc-analise-styles';

    s.textContent = `

      #scc-fab{position:fixed;bottom:24px;right:24px;z-index:2147483640;background:#1a3c5e;color:#fff;

        border:none;border-radius:8px;padding:10px 22px;font-size:14px;font-weight:700;cursor:pointer;

        box-shadow:0 4px 12px rgba(0,0,0,.3);letter-spacing:.5px;font-family:sans-serif;transition:background .2s}

      #scc-fab:hover{background:#245a8c}



      /* Overlays — começam FECHADOS via inline style, CSS só controla quando .open */

      #scc-type-ov,#scc-analysis-ov{

        position:fixed;inset:0;background:rgba(0,0,0,.55);

        z-index:2147483641;justify-content:center;align-items:center}

      #scc-type-ov.open,#scc-analysis-ov.open{display:flex}



      /* Modal seleção de tipo */

      #scc-type-modal{background:#fff;border-radius:14px;width:500px;max-width:95vw;

        box-shadow:0 8px 40px rgba(0,0,0,.35);overflow:hidden;font-family:sans-serif}

      #scc-type-hdr{background:#1a3c5e;color:#fff;padding:16px 22px;display:flex;justify-content:space-between;align-items:center}

      #scc-type-hdr h2{margin:0;font-size:16px;font-weight:700}

      #scc-type-body{padding:24px 22px;display:grid;grid-template-columns:1fr 1fr;gap:14px}

      .scc-tc{border:2px solid #e0e0e0;border-radius:10px;padding:18px 14px;cursor:pointer;

        text-align:center;transition:all .2s;background:#fafafa;user-select:none}

      .scc-tc:hover{border-color:#1a3c5e;background:#e8f0fe;transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.1)}

      .scc-tc-icon{font-size:28px;margin-bottom:8px}

      .scc-tc-name{font-size:15px;font-weight:700;color:#1a3c5e}

      .scc-tc-desc{font-size:11px;color:#888;margin-top:4px}

      .scc-tc-soon{opacity:.4;cursor:not-allowed;pointer-events:none}

      .scc-soon-tag{background:#aaa;color:#fff;font-size:9px;padding:1px 6px;border-radius:8px;margin-left:4px}



      /* Modal de análise */

      #scc-amodal{background:#fff;border-radius:12px;width:93vw;max-width:1300px;max-height:90vh;

        display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.35);overflow:hidden;font-family:sans-serif}

      #scc-ahdr{background:#1a3c5e;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}

      #scc-ahdr h2{margin:0;font-size:16px;font-weight:700}

      #scc-ainp{padding:14px 20px;border-bottom:1px solid #e0e0e0;flex-shrink:0;

        display:flex;gap:12px;align-items:flex-end;background:#f8f9fa}

      #scc-ta{flex:1;min-height:64px;max-height:130px;resize:vertical;border:1px solid #ccc;

        border-radius:6px;padding:8px 10px;font-size:13px;font-family:monospace;outline:none}

      #scc-ta:focus{border-color:#1a3c5e}

      .scc-abtn{border:none;border-radius:6px;padding:10px 18px;font-size:13px;font-weight:700;

        cursor:pointer;white-space:nowrap;transition:background .2s;font-family:sans-serif}

      #scc-btn-back{background:#f0f0f0;color:#444;border:1px solid #ccc}

      #scc-btn-back:hover{background:#e0e0e0}

      #scc-btn-run{background:#1a7a4a;color:#fff}

      #scc-btn-run:hover{background:#15653d}

      #scc-btn-run:disabled{background:#aaa;cursor:not-allowed}

      #scc-btn-dl{background:#d68910;color:#fff}

      #scc-btn-dl:hover{background:#b7770d}

      #scc-ares{overflow-y:auto;flex:1;padding:16px 20px}

      #scc-asb{padding:8px 20px;font-size:12px;color:#555;border-top:1px solid #e0e0e0;

        flex-shrink:0;background:#fafafa;min-height:30px}

      #scc-summary{margin-bottom:14px;padding:12px 16px;background:#f0f4ff;border-radius:8px;

        border:1px solid #c5d5f5;font-size:13px;display:flex;gap:24px;flex-wrap:wrap;align-items:center}

      .scc-sum-item{display:flex;flex-direction:column;align-items:center;gap:2px}

      .scc-sum-num{font-size:22px;font-weight:700;color:#1a3c5e}

      .scc-sum-lbl{font-size:11px;color:#888}

      .scc-card{margin-bottom:16px;border:1px solid #ddd;border-radius:8px;overflow:hidden}

      .scc-chdr{background:#e8f0fe;padding:10px 14px;font-weight:700;font-size:13px;color:#1a3c5e;

        cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none}

      .scc-chdr:hover{background:#d2e3fc}

      .scc-cbody{padding:12px 14px}

      .scc-xbtn{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;

        line-height:1;padding:0 4px;font-family:sans-serif}

      .scc-xbtn:hover{color:#f1c40f}

    `;

    document.head.appendChild(s);

  }



  // ══════════════════════════════════════════════════════════

  // 9. UI — MODAL SELEÇÃO DE TIPO

  // ══════════════════════════════════════════════════════════

  let currentType = '';



  function openTypeModal() {

    document.getElementById('scc-type-ov').style.display = 'flex';

  }

  function closeTypeModal() {

    document.getElementById('scc-type-ov').style.display = 'none';

  }

  function openAnalysisModal(type) {

    currentType = type;

    const titles = {

      MISSING: '&#128269; Missing — Validação de Movimentação em Base',

      GERAL:   '&#128200; Geral — Histórico Completo',

    };

    document.getElementById('scc-modal-title').innerHTML = titles[type] || '&#128230; Análise';

    document.getElementById('scc-ta').value = '';

    document.getElementById('scc-ares').innerHTML = '';

    document.getElementById('scc-asb').textContent = 'Pronto. Insira os TBRs e clique em Analisar.';

    document.getElementById('scc-btn-dl').style.display = 'none';

    window._sccData = [];

    // Mostra legenda de cores relevante para o tipo de análise

    const legendEl = document.getElementById('scc-legend');

    if (legendEl) {

      legendEl.style.display = '';

    }

    document.getElementById('scc-analysis-ov').style.display = 'flex';

  }

  function closeAnalysisModal() {

    document.getElementById('scc-analysis-ov').style.display = 'none';

  }



  function buildTypeSelector() {

    const ov = document.createElement('div');

    ov.id = 'scc-type-ov';

    // Começa FECHADO via inline style — CSS não interfere no estado inicial

    ov.style.display = 'none';

    ov.innerHTML = `

      <div id="scc-type-modal" role="dialog" aria-modal="true">

        <div id="scc-type-hdr">

          <h2>&#128230; Selecione o Tipo de Análise</h2>

          <button class="scc-xbtn" id="scc-type-close" title="Fechar">&#10005;</button>

        </div>

        <div id="scc-type-body">

          <div class="scc-tc" data-type="MISSING">

            <div class="scc-tc-icon">&#128269;</div>

            <div class="scc-tc-name">Missing</div>

            <div class="scc-tc-desc">Classifica TBRs como Válido ou MNR com base em movimentações em base</div>

          </div>

          <div class="scc-tc" data-type="LOST">

            <div class="scc-tc-icon">&#128683;</div>

            <div class="scc-tc-name">Lost</div>

            <div class="scc-tc-desc">Classifica TBRs como Indevido ou Devido com base em eventos LOST e movimentação EDSP</div>

          </div>

          <div class="scc-tc scc-tc-soon" data-type="AGEING">

            <div class="scc-tc-icon">&#128336;</div>

            <div class="scc-tc-name">Ageing <span class="scc-soon-tag">Em breve</span></div>

            <div class="scc-tc-desc">Análise de pacotes com tempo elevado</div>

          </div>

          <div class="scc-tc" data-type="GERAL">

            <div class="scc-tc-icon">&#128200;</div>

            <div class="scc-tc-name">Geral</div>

            <div class="scc-tc-desc">Histórico completo de eventos sem filtros específicos</div>

          </div>

        </div>

      </div>`;

    document.body.appendChild(ov);



    // Fechar pelo X

    document.getElementById('scc-type-close').addEventListener('click', function (e) {

      e.stopPropagation();

      closeTypeModal();

    });



    // Fechar clicando fora do modal (no overlay escuro)

    ov.addEventListener('click', function (e) {

      if (e.target === ov) closeTypeModal();

    });



    // Clique nos cards disponíveis

    ov.querySelectorAll('.scc-tc:not(.scc-tc-soon)').forEach(card => {

      card.addEventListener('click', function (e) {

        e.stopPropagation();

        closeTypeModal();

        openAnalysisModal(card.dataset.type);

      });

    });

  }



  // ══════════════════════════════════════════════════════════

  // 10. UI — MODAL DE ANÁLISE

  // ══════════════════════════════════════════════════════════

  function buildAnalysisModal() {

    const ov = document.createElement('div');

    ov.id = 'scc-analysis-ov';

    // Começa FECHADO via inline style

    ov.style.display = 'none';

    ov.innerHTML = `

      <div id="scc-amodal" role="dialog" aria-modal="true">

        <div id="scc-ahdr">

          <h2 id="scc-modal-title">&#128230; Análise</h2>

          <button class="scc-xbtn" id="scc-aclose" title="Fechar">&#10005;</button>

        </div>

        <div id="scc-ainp">

          <button class="scc-abtn" id="scc-btn-back">&#9664; Voltar</button>

          <textarea id="scc-ta" placeholder="Cole os TBRs aqui, um por linha:&#10;TBA123456789000&#10;TBA987654321000"></textarea>

          <button class="scc-abtn" id="scc-btn-run">&#9654; Analisar</button>

          <button class="scc-abtn" id="scc-btn-dl" style="display:none">&#11015; Baixar Excel</button>

        </div>

        <div id="scc-legend" style="padding:8px 20px;border-bottom:1px solid #e0e0e0;background:#fafafa;display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:11px;color:#555">

          <strong style="margin-right:4px">Legenda:</strong>

          <span style="background:#fce8e6;color:#c0392b;padding:2px 8px;border-radius:10px;font-weight:600">&#9632; Missing / Lost</span>

          <span style="background:#ffe0b2;color:#e65100;padding:2px 8px;border-radius:10px;font-weight:600">&#9632; Dano / Clima / Mudança</span>

          <span style="background:#fffde7;color:#f57f17;padding:2px 8px;border-radius:10px;font-weight:600">&#9632; Tentativa de Entrega</span>

          <span style="background:#e3f2fd;color:#1565c0;padding:2px 8px;border-radius:10px;font-weight:600">&#9632; In-Transit</span>

          <span style="background:#e6f4ea;color:#1e7e34;padding:2px 8px;border-radius:10px;font-weight:600">&#9632; Entregue</span>

          <span style="background:#f5f5f5;color:#555;padding:2px 8px;border-radius:10px">&#9632; Outros</span>

        </div>

        <div id="scc-ares"></div>

        <div id="scc-asb">Pronto. Insira os TBRs e clique em Analisar.</div>

      </div>`;

    document.body.appendChild(ov);



    // Fechar pelo X

    document.getElementById('scc-aclose').addEventListener('click', function (e) {

      e.stopPropagation();

      closeAnalysisModal();

    });



    // Fechar clicando fora do modal

    ov.addEventListener('click', function (e) {

      if (e.target === ov) closeAnalysisModal();

    });



    // Botão Voltar → reabre seleção de tipo

    document.getElementById('scc-btn-back').addEventListener('click', function (e) {

      e.stopPropagation();

      closeAnalysisModal();

      openTypeModal();

    });



    document.getElementById('scc-btn-run').addEventListener('click', runAnalysis);



    document.getElementById('scc-btn-dl').addEventListener('click', function (e) {

      e.stopPropagation();

      if (window._sccData && window._sccData.length) downloadCSV(window._sccData, currentType);

    });

  }



  // ══════════════════════════════════════════════════════════

  // 11. EXECUÇÃO DE ANÁLISE

  // ══════════════════════════════════════════════════════════

  async function runAnalysis() {

    const ta    = document.getElementById('scc-ta');

    const res   = document.getElementById('scc-ares');

    const sb    = document.getElementById('scc-asb');

    const btnR  = document.getElementById('scc-btn-run');

    const btnDl = document.getElementById('scc-btn-dl');



    const tbrs = [...new Set((ta.value || '').trim().split(/\n/).map(t => t.trim()).filter(Boolean))];

    if (!tbrs.length) { sb.textContent = '⚠ Insira pelo menos um TBR.'; return; }



    if (!apiKey) {

      sb.innerHTML = '⚠ Token não capturado ainda. Faça uma busca normal no SCC e tente novamente.';

      return;

    }



    btnR.disabled  = true;

    btnDl.style.display = 'none';

    res.innerHTML  = '';

    window._sccData = [];

    let done = 0;



    sb.textContent = `Analisando ${tbrs.length} TBR(s)...`;



    for (let i = 0; i < tbrs.length; i += 10) {

      await Promise.all(tbrs.slice(i, i + 10).map(tbr =>

        fetchTBR(tbr)

          .then(r => {

            window._sccData.push(r);

            done++;

            sb.textContent = `Progresso: ${done}/${tbrs.length}`;

            currentType === 'MISSING' ? renderMissingCard(r, res)
              : currentType === 'LOST'    ? renderLostCard(r, res)
              : renderGeralCard(r, res);

          })

          .catch(err => { done++; renderErrCard(tbr, err.message, res); })

      ));

    }



    // Resumo topo para Missing

    if (currentType === 'MISSING' && window._sccData.length) {

      const validos = window._sccData.filter(r => classifyMissing(r).type === 'VALIDO').length;

      const mnr     = window._sccData.filter(r => classifyMissing(r).type === 'MNR').length;

      const sum = document.createElement('div');

      sum.id = 'scc-summary';

      sum.innerHTML = `

        <div class="scc-sum-item"><span class="scc-sum-num" style="color:#1a7a4a">${validos}</span><span class="scc-sum-lbl">&#10004; Válidos</span></div>

        <div class="scc-sum-item"><span class="scc-sum-num" style="color:#c0392b">${mnr}</span><span class="scc-sum-lbl">&#10006; MNR</span></div>

        <div class="scc-sum-item"><span class="scc-sum-num">${tbrs.length}</span><span class="scc-sum-lbl">Total</span></div>`;

      res.insertBefore(sum, res.firstChild);

    }


    if (currentType === 'LOST' && window._sccData.length) {

      const indevido = window._sccData.filter(r => classifyLost(r).type === 'INDEVIDO').length;

      const devido   = window._sccData.filter(r => classifyLost(r).type === 'DEVIDO').length;

      const reversa  = window._sccData.filter(r => classifyLost(r).possibleReversa).length;

      const sum = document.createElement('div');

      sum.id = 'scc-summary';

      sum.innerHTML = `

        <div class="scc-sum-item"><span class="scc-sum-num" style="color:#c0392b">${indevido}</span><span class="scc-sum-lbl">&#10006; Indevido</span></div>

        <div class="scc-sum-item"><span class="scc-sum-num" style="color:#1a7a4a">${devido}</span><span class="scc-sum-lbl">&#10004; Devido</span></div>

        ${reversa ? `<div class="scc-sum-item"><span class="scc-sum-num" style="color:#e67e22">${reversa}</span><span class="scc-sum-lbl">&#9654; Poss\u00edvel Reversa</span></div>` : ''}

        <div class="scc-sum-item"><span class="scc-sum-num">${tbrs.length}</span><span class="scc-sum-lbl">Total</span></div>`;

      res.insertBefore(sum, res.firstChild);

    }

    sb.textContent = `✅ Concluído — ${done} TBR(s) analisados.`;

    btnR.disabled = false;

    if (window._sccData.length) btnDl.style.display = '';

  }



  // ══════════════════════════════════════════════════════════

  // 12. INIT

  // ══════════════════════════════════════════════════════════

  function init() {

    // Remove instância antiga se existir (ex: hot-reload da página)

    ['scc-fab','scc-type-ov','scc-analysis-ov','scc-analise-styles'].forEach(id => {

      const el = document.getElementById(id);

      if (el) el.remove();

    });



    injectCSS();

    buildTypeSelector();

    buildAnalysisModal();



    const fab = document.createElement('button');

    fab.id = 'scc-fab';

    fab.innerHTML = '&#128269; Analise';

    fab.addEventListener('click', function (e) {

      e.stopPropagation();

      openTypeModal();

    });

    document.body.appendChild(fab);



    console.log('[SCC Analise v2.1] Carregado. Token: ' + (apiKey ? 'capturado' : 'aguardando...'));

  }



  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);

  else init();

})();

