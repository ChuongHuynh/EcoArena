/* Economics Arena — Version 3 market engine: the Ho Chi Minh City battle map. Plain ES5, no DOM, so the same file can
 * run in the page (host = teacher's device, or the player's own device in practice) and later on a server.
 *
 * Units: price in thousand VND per cup, quantity in cups, profit in thousand VND.
 * District types (one per market structure taught in the course):
 *   comp   — perfect competition: sellers choose QUANTITY; price P = a − b·ΣQ; cost C = (c − edge)·q + e·q²  (MC = c − edge + 2e·q)
 *   mono   — monopoly: only the licence holder sells and chooses PRICE; demand Q = k·(a − P); constant MC c
 *   oligo  — oligopoly, differentiated: sellers choose PRICE; logit market shares; brand level raises appeal
 *   center — District 1: an oligopoly with a bigger market, higher rent and brand counting more
 * Duels (5 questions) change a seller's level in a district: brand (oligo/center), cost edge (comp), or take the licence (mono).
 *
 * moves[pid] (written by each player): {eid, ch, act:[district ids, ≤3], dec:{did:{p|q}}, duels:[{n, d, tgt, sc}]}
 * state (written by the host only): rounds, district results, levels, defences, licences, scores, teams, duel log.
 */
var Market = (function () {
  var T = {
    comp: { pick: 'q', min: 0, max: 50, def: 20, c: 10, e: 0.5, a: 60 },
    mono: { pick: 'p', min: 12, max: 60, def: 45, c: 12, a: 60 },
    oligo: { pick: 'p', min: 14, max: 60, def: 30, c: 12, alpha: 0.12, beta: 0.35, p0: 32 },
    center: { pick: 'p', min: 16, max: 70, def: 34, c: 14, alpha: 0.10, beta: 0.6, p0: 40 }
  };
  var NEED = { comp: 1, mono: 2, oligo: 3, center: 5 };          // chapter a player must have reached (teacher can open all)
  var BOTDEF = { comp: 40, mono: 55, oligo: 50, center: 65 };      // defence score of bot sellers (out of 100)
  // id, short label, Vietnamese name, English name, type, hex column/row (schematic map, north up), market parameter
  var D = [
    ['cc', 'CC', 'Củ Chi', 'Cu Chi', 'mono', 0, 0, { k: 2.5 }], ['hm', 'HM', 'Hóc Môn', 'Hoc Mon', 'mono', 1, 0, { k: 2 }], ['q12', 'Q12', 'Quận 12', 'District 12', 'comp', 2, 0, { b: 0.25 }],
    ['bta', 'BTâ', 'Bình Tân', 'Binh Tan', 'comp', 0, 1, { b: 0.22 }], ['tp', 'TP', 'Tân Phú', 'Tan Phu', 'comp', 1, 1, { b: 0.25 }], ['tb', 'TB', 'Tân Bình', 'Tan Binh', 'oligo', 2, 1, { M: 150 }],
    ['gv', 'GV', 'Gò Vấp', 'Go Vap', 'comp', 3, 1, { b: 0.22 }], ['td', 'TĐ', 'Thủ Đức', 'Thu Duc', 'oligo', 5, 1, { M: 160 }],
    ['q11', 'Q11', 'Quận 11', 'District 11', 'comp', 1, 2, { b: 0.28 }], ['q10', 'Q10', 'Quận 10', 'District 10', 'oligo', 2, 2, { M: 130 }],
    ['pn', 'PN', 'Phú Nhuận', 'Phu Nhuan', 'oligo', 3, 2, { M: 120 }], ['bth', 'BTh', 'Bình Thạnh', 'Binh Thanh', 'oligo', 4, 2, { M: 140 }],
    ['q6', 'Q6', 'Quận 6', 'District 6', 'comp', 0, 3, { b: 0.28 }], ['q5', 'Q5', 'Quận 5', 'District 5', 'comp', 1, 3, { b: 0.2 }],
    ['q3', 'Q3', 'Quận 3', 'District 3', 'oligo', 2, 3, { M: 140 }], ['q1', 'Q1', 'Quận 1', 'District 1', 'center', 3, 3, { M: 220 }],
    ['bc', 'BC', 'Bình Chánh', 'Binh Chanh', 'mono', 0, 4, { k: 2 }], ['q8', 'Q8', 'Quận 8', 'District 8', 'comp', 1, 4, { b: 0.25 }],
    ['q4', 'Q4', 'Quận 4', 'District 4', 'oligo', 3, 4, { M: 110 }], ['q7', 'Q7', 'Quận 7', 'District 7', 'oligo', 3, 5, { M: 150 }],
    ['nb', 'NB', 'Nhà Bè', 'Nha Be', 'mono', 3, 6, { k: 1.8 }], ['cg', 'CG', 'Cần Giờ', 'Can Gio', 'mono', 5, 6, { k: 1.5 }]
  ].map(function (r) { return { id: r[0], short: r[1], vi: r[2], en: r[3], type: r[4], col: r[5], row: r[6], par: r[7], ch: NEED[r[4]] }; });
  var BY = {}; D.forEach(function (d) { BY[d.id] = d; });
  var TEAMS = [{ vi: 'Đội Đỏ', en: 'Red', color: '#d64545' }, { vi: 'Đội Xanh dương', en: 'Blue', color: '#2f6fd6' }, { vi: 'Đội Vàng', en: 'Yellow', color: '#d9a400' },
               { vi: 'Đội Xanh lá', en: 'Green', color: '#2e9e5b' }, { vi: 'Đội Tím', en: 'Purple', color: '#8a4fd0' }, { vi: 'Đội Cam', en: 'Orange', color: '#e0782d' }];
  var BOTNAMES = ['Cà phê Mây', 'Quán Gió', 'Cà phê Nắng', 'Quán Sương', 'Cà phê Phố', 'Quán Ngõ'];
  var MAXACT = 3, MAXLVL = 5, LOGN = 30, TEAM_BOOST = 0.15, TEAM_ROUNDS = 2, TEAM_PASS = 60;

  function rnd(seed) { var t = seed >>> 0; return function () { t += 0x6D2B79F5; var r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function r2(x) { return Math.round(x * 100) / 100; }
  function isBot(id) { return String(id).indexOf('b:') === 0; }
  function botIds(cfg, did) { var n = clamp(cfg.bots === undefined ? 2 : +cfg.bots, 0, 3), out = []; if (BY[did].type === 'mono') n = Math.min(n, 1); if (BY[did].type === 'comp') n = Math.min(6, 2 * n); /* a competitive market has many small sellers */ for (var i = 0; i < n; i++) out.push('b:' + did + ':' + i); return out; }
  function botName(id) { var p = String(id).split(':'); return BOTNAMES[(hash(p[1]) + (+p[2])) % BOTNAMES.length]; }
  function botDef(id) { var p = String(id).split(':'); return BOTDEF[BY[p[1]].type] + (hash(id) % 11) - 5; }
  function allowed(did, ch, cfg) { return !!BY[did] && (!!(cfg && cfg.openAll) || (+ch || 1) >= BY[did].ch); }
  function cost(d, q, edge) { var t = T[d.type]; return (t.c - (edge || 0)) * q + (t.e || 0) * q * q; }
  // shop upgrades a player brings to the map (moves.gear): 'sign' = brand starts at 2, 'solar' = marginal cost 1 lower everywhere
  function gear(mv, id) { return !!(mv && mv.gear && mv.gear.indexOf(id) >= 0); }
  function startLvl(mv) { return gear(mv, 'sign') ? 2 : 1; }
  function mcCut(mv) { return gear(mv, 'solar') ? 1 : 0; }

  function newEvent(cfg, now) {
    var st = { eid: cfg.eid, round: 0, nextAt: now + cfg.roundSec * 1000, d: {}, sc: {}, seen: {}, log: [], status: 'live' };
    D.forEach(function (d) {
      var x = { lvl: {}, def: {}, last: {}, sales: {}, bp: {}, joined: {}, holder: null, P: d.type === 'comp' ? 35 : null };
      botIds(cfg, d.id).forEach(function (b) { x.lvl[b] = d.type === 'center' ? 2 : 1; x.bp[b] = d.type === 'mono' ? 50 : T[d.type].def + (hash(b) % 7) - 3; });
      if (d.type === 'mono') x.holder = botIds(cfg, d.id)[0] || null;
      st.d[d.id] = x;
    });
    return st;
  }
  function teamFor(st, cfg, ch) {
    var n = clamp(+cfg.teams || 2, 2, TEAMS.length), cnt = [], sum = [];
    for (var i = 0; i < n; i++) { cnt.push(0); sum.push(0); }
    Object.keys(st.sc).forEach(function (p) { var t = st.sc[p].team; if (t >= 0 && t < n) { cnt[t]++; sum[t] += st.sc[p].ch || 1; } });
    var best = 0; for (var j = 1; j < n; j++) if (cnt[j] < cnt[best] || (cnt[j] === cnt[best] && sum[j] < sum[best])) best = j;
    return best;
  }
  function register(st, cfg, pid, mv) {
    if (!st.sc[pid]) st.sc[pid] = { pr: 0, w: 0, l: 0, rd: 0, ch: +mv.ch || 1, team: cfg.mode === 'team' ? teamFor(st, cfg, +mv.ch || 1) : -1 };
    st.sc[pid].ch = +mv.ch || st.sc[pid].ch;
    return st.sc[pid];
  }
  // the player's districts this round: in its list, reachable, at most 3
  function activeOf(mv, cfg) { return (mv && mv.act || []).filter(function (d, i, a) { return BY[d] && a.indexOf(d) === i && allowed(d, mv.ch, cfg); }).slice(0, MAXACT); }
  function playersIn(st, cfg, moves, did) {
    var out = [];
    Object.keys(moves).forEach(function (pid) { var mv = moves[pid]; if (mv && mv.eid === st.eid && activeOf(mv, cfg).indexOf(did) >= 0) out.push(pid); });
    var j = st.d[did].joined;
    return out.sort(function (a, b) { return (j[a] || 0) - (j[b] || 0) || (a < b ? -1 : 1); });
  }
  function decision(d, mv) { var t = T[d.type], v = mv && mv.dec && mv.dec[d.id] && mv.dec[d.id][t.pick]; v = +v; return isFinite(v) && v !== 0 || (v === 0 && t.pick === 'q') ? clamp(v, t.min, t.max) : t.def; }

  // ---- one district, one round ----
  function clearDistrict(st, cfg, moves, d, R) {
    var x = st.d[d.id], t = T[d.type], ps = playersIn(st, cfg, moves, d.id), bots = botIds(cfg, d.id), res = {};
    ps.forEach(function (p) { if (x.joined[p] === undefined) x.joined[p] = st.round; if (x.lvl[p] === undefined) x.lvl[p] = startLvl(moves[p]); });
    if (d.type === 'mono') {
      if (x.holder && !isBot(x.holder) && ps.indexOf(x.holder) < 0) x.holder = bots[0] || null;   // the holder left: the licence goes back
      if (!x.holder && ps.length) x.holder = ps[0];                                              // no bot: the first seller in takes it
      var hp = x.holder ? (isBot(x.holder) ? x.bp[x.holder] : decision(d, moves[x.holder])) : null;
      ps.concat(bots).forEach(function (s) { res[s] = { p: s === x.holder ? hp : null, q: 0, pr: 0, sh: 0 }; });
      if (x.holder) { var q = Math.max(0, d.par.k * (t.a - hp)), hc = t.c - (isBot(x.holder) ? 0 : mcCut(moves[x.holder])); res[x.holder] = { p: hp, q: r2(q), pr: r2((hp - hc) * q), sh: 1 }; }
      // a bot holder drifts toward the profit-maximising price (MR = MC), slowly and imperfectly
      if (x.holder && isBot(x.holder)) x.bp[x.holder] = r2(clamp(hp + ((t.a + t.c) / 2 - hp) * 0.15 + (R() - 0.5) * 2, t.min, t.max));
    } else if (d.type === 'comp') {
      var qs = {}, Q = 0;
      ps.forEach(function (p) { qs[p] = decision(d, moves[p]); });
      bots.forEach(function (b) { qs[b] = x.bp[b]; });
      Object.keys(qs).forEach(function (s) { Q += qs[s]; });
      var P = Math.max(0, t.a - d.par.b * Q);
      Object.keys(qs).forEach(function (s) { var q = qs[s], edge = isBot(s) ? 0 : Math.max(0, (x.lvl[s] || 0) - startLvl(moves[s])) + mcCut(moves[s]); res[s] = { p: r2(P), q: r2(q), pr: r2(P * q - cost(d, q, edge)), sh: Q ? r2(q / Q) : 0 }; });
      x.P = r2(P);
      // price-taking bots produce where MC = last price, with noise
      bots.forEach(function (b) { x.bp[b] = r2(clamp((P - t.c) / (2 * t.e) + (R() - 0.5) * 6, t.min, t.max)); });
    } else {
      var pr = {}, u = {}, den = Math.exp(-t.alpha * t.p0), M = d.par.M;
      ps.forEach(function (p) { pr[p] = decision(d, moves[p]); });
      bots.forEach(function (b) { pr[b] = x.bp[b]; });
      Object.keys(pr).forEach(function (s) { u[s] = Math.exp(t.beta * (x.lvl[s] || 0) - t.alpha * pr[s]); den += u[s]; });
      Object.keys(pr).forEach(function (s) { var sh = u[s] / den, q = M * sh, c = t.c - (isBot(s) ? 0 : mcCut(moves[s])); res[s] = { p: pr[s], q: r2(q), pr: r2((pr[s] - c) * q), sh: r2(sh) }; });
      // bots move part of the way toward their best response to this round's prices
      bots.forEach(function (b) { x.bp[b] = r2(clamp(0.5 * x.bp[b] + 0.5 * bestResponse(d, x, pr, b) + (R() - 0.5) * 3, t.min, t.max)); });
    }
    Object.keys(res).forEach(function (s) { x.sales[s] = r2((x.sales[s] || 0) + res[s].q); if (!isBot(s) && st.sc[s]) { st.sc[s].pr = r2(st.sc[s].pr + res[s].pr * (res[s].pr > 0 && st.sc[s].bu >= st.round ? 1 + TEAM_BOOST : 1)); } });   // 4.2: a team bonus adds 15% to positive profit
    x.last = res;
    return ps;
  }
  function bestResponse(d, x, prices, me) {
    var t = T[d.type], best = t.min, bv = -1e9;
    for (var p = t.min; p <= t.max; p += 0.5) {
      var den = Math.exp(-t.alpha * t.p0), mine = 0;
      Object.keys(prices).forEach(function (s) { var v = Math.exp(t.beta * (x.lvl[s] || 0) - t.alpha * (s === me ? p : prices[s])); den += v; if (s === me) mine = v; });
      var prof = (p - t.c) * d.par.M * mine / den; if (prof > bv) { bv = prof; best = p; }
    }
    return best;
  }
  function clear(st, cfg, moves) {
    st.round++;
    var R = rnd(hash(st.eid + '|' + st.round)), seen = {};
    Object.keys(moves).forEach(function (pid) { var mv = moves[pid]; if (mv && mv.eid === st.eid && activeOf(mv, cfg).length) register(st, cfg, pid, mv); });
    D.forEach(function (d) { clearDistrict(st, cfg, moves, d, R).forEach(function (p) { seen[p] = 1; }); });
    Object.keys(seen).forEach(function (p) { st.sc[p].rd++; });
    return st;
  }

  // ---- duels ----
  function defenceOf(st, did, id) { return isBot(id) ? botDef(id) : (st.d[did].def[id] || 50); }
  // can `pid` challenge `tgt` in `did` right now? → '' or a reason code
  function canDuel(st, cfg, moves, pid, did, tgt) {
    var mv = moves[pid], x = st.d[did];
    if (!x || !mv || activeOf(mv, cfg).indexOf(did) < 0) return 'not_in';
    if (tgt === pid) return 'self';
    var inIt = isBot(tgt) ? botIds(cfg, did).indexOf(tgt) >= 0 : playersIn(st, cfg, moves, did).indexOf(tgt) >= 0;
    if (!inIt) return 'no_target';
    if (BY[did].type === 'mono' && tgt !== x.holder) return 'not_holder';
    return '';
  }
  function duelEffect(st, did, pid, tgt, score, mv) {
    var x = st.d[did], def = defenceOf(st, did, tgt), win = score > def;
    if (win) {
      if (BY[did].type === 'mono') x.holder = pid;
      else { x.lvl[pid] = Math.min(MAXLVL, (x.lvl[pid] === undefined ? startLvl(mv) : x.lvl[pid]) + 1); x.lvl[tgt] = Math.max(0, (x.lvl[tgt] === undefined ? 1 : x.lvl[tgt]) - 1); }
      x.def[pid] = Math.max(x.def[pid] || 0, score);
    }
    return { win: win, def: def };
  }
  function applyDuels(st, cfg, moves, now) {
    var out = [];
    Object.keys(moves).forEach(function (pid) {
      var mv = moves[pid]; if (!mv || mv.eid !== st.eid) return;
      (mv.duels || []).forEach(function (du) {
        if (!(du.n > (st.seen[pid] || 0))) return;
        st.seen[pid] = du.n;
        var why = canDuel(st, cfg, moves, pid, du.d, du.tgt), sc = clamp(+du.sc || 0, 0, 100);
        if (why) { out.push({ pid: pid, n: du.n, d: du.d, tgt: du.tgt, ok: false, why: why }); return; }
        var me = register(st, cfg, pid, mv), e = duelEffect(st, du.d, pid, du.tgt, sc, mv);
        if (e.win) me.w++; else { me.l++; if (st.sc[du.tgt]) st.sc[du.tgt].w++; }
        var entry = { r: st.round, n: du.n, d: du.d, a: pid, b: du.tgt, s: sc, def: e.def, w: e.win, t: now };
        st.log.unshift(entry); if (st.log.length > LOGN) st.log.length = LOGN;
        out.push({ pid: pid, n: du.n, d: du.d, tgt: du.tgt, ok: true, win: e.win, def: e.def });
      });
    });
    return out;
  }

  // ---- Version 4.1: Đấu trí (live 1-v-1 case challenges between classmates) ----
  // chals[pid] (written by each student, read by everyone): {eid, res:[{id, opp, pct, ms}], fft:[{id, to}]}.
  // A challenge is applied once, when both players reported (higher % wins, then the faster one) or on a forfeit.
  // Effect: in a district both run → brand +1 / −1 (or the licence changes hands); otherwise the winner takes 10% of the loser's average round profit.
  function applyChals(st, cfg, moves, chals, now) {
    if (!chals) return 0;
    st.cseen = st.cseen || {}; var byId = {}, n = 0;
    Object.keys(chals).forEach(function (pid) {
      var c = chals[pid]; if (!c || c.eid !== st.eid) return;
      (c.res || []).forEach(function (r) { if (r && r.id) (byId[r.id] = byId[r.id] || { r: {} }).r[pid] = r; });
      (c.fft || []).forEach(function (f) { if (f && f.id) (byId[f.id] = byId[f.id] || { r: {} }).fft = { l: pid, w: String(f.to) }; });
    });
    Object.keys(byId).forEach(function (id) {
      if (st.cseen[id]) return;
      var g = byId[id], w = null, l = null, ps = Object.keys(g.r);
      if (g.fft) { w = g.fft.w; l = g.fft.l; }
      else {
        if (ps.length < 2) return;
        var a = g.r[ps[0]], b = g.r[ps[1]]; if (a.opp !== ps[1] || b.opp !== ps[0]) return;
        var pa = clamp(+a.pct || 0, 0, 100), pb = clamp(+b.pct || 0, 0, 100);
        if (pa !== pb) w = pa > pb ? ps[0] : ps[1]; else if ((+a.ms || 0) !== (+b.ms || 0)) w = (+a.ms || 0) < (+b.ms || 0) ? ps[0] : ps[1];
        l = w ? (w === ps[0] ? ps[1] : ps[0]) : null;
      }
      st.cseen[id] = 1; n++;
      if (!w) { st.log.unshift({ k: 'chal', r: st.round, a: ps[0], b: ps[1], draw: true, t: now }); if (st.log.length > LOGN) st.log.length = LOGN; return; }
      var mw = moves[w] || { ch: 1 }, ml = moves[l] || { ch: 1 }, W = register(st, cfg, w, mw), Lo = register(st, cfg, l, ml);
      var shared = activeOf(mw, cfg).filter(function (d) { return activeOf(ml, cfg).indexOf(d) >= 0 && st.d[d]; })[0] || null, amt = 0;
      if (shared) {
        var x = st.d[shared];
        if (BY[shared].type === 'mono') { if (x.holder === l) x.holder = w; }
        else { x.lvl[w] = Math.min(MAXLVL, (x.lvl[w] === undefined ? startLvl(mw) : x.lvl[w]) + 1); x.lvl[l] = Math.max(0, (x.lvl[l] === undefined ? 1 : x.lvl[l]) - 1); }
      } else { amt = r2(0.1 * Math.max(0, Lo.pr) / Math.max(1, Lo.rd)); Lo.pr = r2(Lo.pr - amt); W.pr = r2(W.pr + amt); }
      W.w++; Lo.l++; W.cw = (W.cw || 0) + 1;
      st.log.unshift({ k: 'chal', r: st.round, a: w, b: l, d: shared, amt: amt, fft: !!g.fft, t: now }); if (st.log.length > LOGN) st.log.length = LOGN;
    });
    return n;
  }
  // ---- Version 4.2: Hợp tác (team cases). The team leader's chal doc carries team = {id, members, done:{pct}}.
  // A team that scores ≥ 60% gets +15% on every member's positive profit for the next 2 market rounds.
  function applyTeams(st, cfg, moves, chals, now) {
    if (!chals) return 0;
    st.tseen = st.tseen || {}; var n = 0;
    Object.keys(chals).forEach(function (pid) {
      var c = chals[pid], t = c && c.team; if (!c || c.eid !== st.eid || !t || !t.id || !t.done || st.tseen[t.id]) return;
      st.tseen[t.id] = 1; n++;
      var pct = clamp(+t.done.pct || 0, 0, 100), ms = (t.members || []).filter(function (m, i, a) { return typeof m === 'string' && a.indexOf(m) === i; }).slice(0, 3), ok = pct >= TEAM_PASS;
      if (ok) ms.forEach(function (m) { var sc = register(st, cfg, m, moves[m] || { ch: 1 }); sc.bu = st.round + TEAM_ROUNDS; sc.tw = (sc.tw || 0) + 1; });
      st.log.unshift({ k: 'team', r: st.round, a: pid, m: ms, pct: pct, ok: ok, t: now }); if (st.log.length > LOGN) st.log.length = LOGN;
    });
    return n;
  }

  // ---- the clock: duels at once, a market round every roundSec, the end at cfg.end ----
  function tick(st, cfg, moves, now, chals) {
    if (st.status !== 'live') return { changed: false, ended: st.status === 'ended' };
    var changed = applyDuels(st, cfg, moves, now).length > 0;
    if (applyChals(st, cfg, moves, chals, now)) changed = true;
    if (applyTeams(st, cfg, moves, chals, now)) changed = true;
    if (now >= st.nextAt) { clear(st, cfg, moves); st.nextAt = Math.max(st.nextAt + cfg.roundSec * 1000, now + 1000); changed = true; }
    if (now >= cfg.end) { st.status = 'ended'; return { changed: true, ended: true }; }
    return { changed: changed, ended: false };
  }

  // ---- rewards: XP bonus + champion badges ----
  var XP = { gold: 150, silver: 100, bronze: 70, king: 20, duelist: 30, team: 50, played: 20 };
  function finish(st, cfg) {
    var ids = Object.keys(st.sc).filter(function (p) { return st.sc[p].rd > 0 || st.sc[p].w > 0; });
    ids.sort(function (a, b) { return st.sc[b].pr - st.sc[a].pr || st.sc[b].w - st.sc[a].w || (a < b ? -1 : 1); });
    var xp = {}, badges = {}, kings = {};
    function give(p, code, x, extra) { xp[p] = (xp[p] || 0) + x; (badges[p] = badges[p] || []).push(extra ? code + ':' + extra : code); }
    ids.forEach(function (p, i) { xp[p] = 0; if (st.sc[p].rd >= 3) give(p, 'played', XP.played); if (i === 0) give(p, 'gold', XP.gold); else if (i === 1) give(p, 'silver', XP.silver); else if (i === 2) give(p, 'bronze', XP.bronze); });
    D.forEach(function (d) {
      var s = st.d[d.id].sales, best = null;
      Object.keys(s).forEach(function (k) { if (s[k] > 0 && (best === null || s[k] > s[best])) best = k; });
      if (best && !isBot(best) && ids.indexOf(best) >= 0) { kings[d.id] = best; give(best, 'king', XP.king, d.id); }
    });
    var duel = ids.filter(function (p) { return st.sc[p].w >= 3; }).sort(function (a, b) { return st.sc[b].w - st.sc[a].w; })[0];
    if (duel) give(duel, 'duelist', XP.duelist);
    var teams = [], teamWin = -1;
    if (cfg.mode === 'team') {
      var n = clamp(+cfg.teams || 2, 2, TEAMS.length);
      for (var t = 0; t < n; t++) teams.push({ i: t, pr: 0, n: 0 });
      ids.forEach(function (p) { var tm = st.sc[p].team; if (teams[tm]) { teams[tm].pr = r2(teams[tm].pr + st.sc[p].pr); teams[tm].n++; } });
      var ranked = teams.filter(function (x) { return x.n; }).sort(function (a, b) { return b.pr - a.pr; });
      if (ranked.length) { teamWin = ranked[0].i; ids.forEach(function (p) { if (st.sc[p].team === teamWin) give(p, 'team', XP.team); }); }
    }
    return { rank: ids.map(function (p) { return { id: p, pr: st.sc[p].pr, w: st.sc[p].w, team: st.sc[p].team }; }), teams: teams, teamWin: teamWin, kings: kings, xp: xp, badges: badges };
  }

  // ---- read helpers for the page ----
  function leader(st, did) {                      // the seller with the biggest share in the last round
    var last = st.d[did].last, best = null;
    Object.keys(last).forEach(function (s) { if (last[s].q > 0 && (best === null || last[s].q > last[best].q)) best = s; });
    return best;
  }
  function cityShare(st) {                        // each player's share of all cups sold in the city so far
    var tot = 0, by = {};
    D.forEach(function (d) { var s = st.d[d.id].sales; Object.keys(s).forEach(function (k) { tot += s[k]; if (!isBot(k)) by[k] = (by[k] || 0) + s[k]; }); });
    Object.keys(by).forEach(function (k) { by[k] = tot ? r2(by[k] / tot) : 0; });
    return by;
  }
  // what the player would earn from a decision, given the other sellers' last-round choices (the "preview" under the slider)
  function preview(st, cfg, did, pid, v, mv) {
    var d = BY[did], t = T[d.type], x = st.d[did], last = x.last, lvl = x.lvl[pid] === undefined ? startLvl(mv) : x.lvl[pid], cut = mcCut(mv), c0 = t.c - cut;
    if (d.type === 'mono') { if (x.holder !== pid) return null; var q = Math.max(0, d.par.k * (t.a - v)); return { p: v, q: r2(q), pr: r2((v - c0) * q), sh: 1 }; }
    if (d.type === 'comp') {
      var Q = v; Object.keys(last).forEach(function (s) { if (s !== pid) Q += last[s].q; });
      if (!Object.keys(last).length) botIds(cfg, did).forEach(function (b) { Q += x.bp[b]; });
      var edge = Math.max(0, lvl - startLvl(mv)) + cut, P = Math.max(0, t.a - d.par.b * Q); return { p: r2(P), q: v, pr: r2(P * v - cost(d, v, edge)), sh: Q ? r2(v / Q) : 0, mc: r2(t.c - edge + 2 * t.e * v) };
    }
    var den = Math.exp(-t.alpha * t.p0), mine = Math.exp(t.beta * lvl - t.alpha * v);
    var others = Object.keys(last).filter(function (s) { return s !== pid; });
    if (!others.length) others = botIds(cfg, did);
    others.forEach(function (s) { den += Math.exp(t.beta * (x.lvl[s] || 0) - t.alpha * (last[s] ? last[s].p : x.bp[s])); });
    den += mine; var sh = mine / den, q2 = d.par.M * sh; return { p: v, q: r2(q2), pr: r2((v - c0) * q2), sh: r2(sh) };
  }

  return { TYPES: T, NEED: NEED, DISTRICTS: D, BY: BY, TEAMS: TEAMS, XP: XP, MAXACT: MAXACT, MAXLVL: MAXLVL,
    newEvent: newEvent, clear: clear, tick: tick, applyDuels: applyDuels, finish: finish, register: register,
    allowed: allowed, activeOf: activeOf, playersIn: playersIn, botIds: botIds, botName: botName, botDef: botDef, isBot: isBot,
    defenceOf: defenceOf, canDuel: canDuel, applyChals: applyChals, applyTeams: applyTeams, TEAM_PASS: TEAM_PASS, leader: leader, cityShare: cityShare, preview: preview, bestResponse: bestResponse, decision: decision };
})();
if (typeof module !== 'undefined') module.exports = Market;
