// صفّاق الفرقة — منطق الشاشات
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const AR = Tracks.AR;
  const fmtT = s => { s = Math.max(0, s); const m = Math.floor(s / 60), x = Math.floor(s % 60); return AR(m) + ':' + AR(String(x).padStart(2, '0')); };
  const median = DSP.median;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  let toastT = null;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
  function setProg(el, p) { el.hidden = p === null; if (p !== null) el.firstElementChild.style.width = Math.round(p * 100) + '%'; }
  function status(el, msg, cls) { el.className = 'status' + (cls ? ' ' + cls : ''); el.textContent = msg; }

  /* ================= التبويبات ================= */
  function showTab(name) {
    $('scrClip').hidden = name !== 'clip'; $('scrStudio').hidden = name !== 'studio';
    $('tabClip').setAttribute('aria-selected', name === 'clip'); $('tabStudio').setAttribute('aria-selected', name === 'studio');
    stopClip(); stopStudio();
    if (name === 'clip') drawWave();
  }
  $('tabClip').onclick = () => showTab('clip'); $('tabStudio').onclick = () => showTab('studio');

  /* ================= صفقة على مقطع ================= */
  const saved = store.get('clip1', {});
  const C = {
    file: null, name: '', isVideo: false, buffer: null, ana: null, beats: [], phase: 0, peaks: null, songRms: .1,
    model: { beats: 4, sub: 4, tracks: Tracks.STYLES.mawlid.tracks() }, style: 'mawlid',
    nudge: 0, from: 0, to: 1e9, clapDb: saved.clapDb ?? 0, loose: saved.loose ?? 10, room: saved.room ?? 1.1, wet: saved.wet ?? 22,
    events: [], playing: false, pos: 0, t0: 0, idx: 0, timer: null, src: null, songGain: null, chain: null, solo: false, lastUri: null,
  };
  const clipEd = Tracks.editor($('clipTracks'), C.model, {
    change() { C.style = 'custom'; renderStyles(); rebuild(); },
    preview(t, ti, v) { if (C.playing) return; const c = Engine.audio(); const ch = previewChain(c); Engine.hit(t, v || 2, c.currentTime + .02, c, ch, ti, C.model.tracks.length, 0); },
  });
  let pChain = null;
  function previewChain(c) { if (!pChain) pChain = Engine.makeChain(c, { room: .35, wet: 15, clapGain: .9 }); return pChain; }

  function renderStyles() {
    const box = $('styles'); box.innerHTML = '';
    for (const [k, s] of Object.entries(Tracks.STYLES)) {
      const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', C.style === k);
      b.innerHTML = `${s.name}<small>${s.desc}</small>`; b.onclick = () => applyStyle(k); box.appendChild(b);
    }
    if (C.style === 'custom') { const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', 'true'); b.textContent = 'تشكيلك الخاص'; box.appendChild(b); }
  }
  function applyStyle(k) {
    C.style = k; C.model.tracks.splice(0, C.model.tracks.length, ...Tracks.STYLES[k].tracks());
    Tracks.resize(C.model.tracks, 4, 4, C.model.beats, C.model.sub);
    renderStyles(); clipEd.render(); rebuild();
  }

  // ---- المصدر: ملف أو تسجيل
  $('pickBtn').onclick = () => $('fileIn').click();
  $('fileIn').onchange = e => { const f = e.target.files[0]; if (f) loadSource(f, f.name, (f.type || '').startsWith('video/') || /\.(mp4|mov|3gp|mkv|webm)$/i.test(f.name) && !/audio/.test(f.type)); e.target.value = ''; };
  let rec = null;
  $('recBtn').onclick = async () => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const mr = new MediaRecorder(stream); const chunks = []; const started = Date.now();
      mr.ondataavailable = e => e.data.size && chunks.push(e.data);
      const tick = setInterval(() => { $('recTime').textContent = fmtT((Date.now() - started) / 1000) + ' — اضغط للإيقاف'; }, 250);
      mr.onstop = () => {
        clearInterval(tick); stream.getTracks().forEach(t => t.stop()); rec = null;
        $('recBtn').classList.remove('on'); $('recLbl').textContent = 'سجّل الحين'; $('recTime').textContent = 'بالمايك';
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (blob.size) loadSource(blob, 'تسجيل ' + new Date().toLocaleTimeString('ar'), false);
      };
      mr.start(500); rec = mr; $('recBtn').classList.add('on'); $('recLbl').textContent = 'جاري التسجيل…';
    } catch (err) { status($('clipStatus'), 'ما قدرت أفتح المايك. اسمح للتطبيق باستخدام المايكروفون من إعدادات الجوال.', 'err'); }
  };

  async function loadSource(file, name, isVideo) {
    stopClip();
    C.file = file; C.name = name; C.isVideo = isVideo; C.lastUri = null;
    $('fileName').textContent = (isVideo ? '🎬 ' : '🎵 ') + name;
    const v = $('vid'); if (v.src) URL.revokeObjectURL(v.src);
    v.hidden = !isVideo; if (isVideo) v.src = URL.createObjectURL(file); else v.removeAttribute('src');
    status($('clipStatus'), 'جاري قراءة المقطع…'); setProg($('prog'), .03);
    try {
      const ab = await file.arrayBuffer();
      const dc = new OfflineAudioContext(2, 1, Engine.SR);
      C.buffer = await dc.decodeAudioData(ab);
    } catch (e) {
      setProg($('prog'), null); status($('clipStatus'), 'ما قدرت أقرأ الصوت من هذا الملف. جرّب ملف ثاني (mp3، m4a، mp4).', 'err'); return;
    }
    status($('clipStatus'), 'جاري تحليل الإيقاع…');
    await new Promise(r => setTimeout(r, 30));
    const ana = await DSP.analyze(C.buffer, p => setProg($('prog'), .1 + p * .9));
    C.ana = ana; resetBeats();
    // مستوى الصوت ونقاط الرسم
    const d = C.buffer.getChannelData(0), N = 1600, step = d.length / N, pk = new Float32Array(N * 2); let ss = 0, cnt = 0;
    for (let i = 0; i < N; i++) { let mn = 0, mx = 0; const a = Math.floor(i * step), b = Math.floor((i + 1) * step); for (let j = a; j < b; j++) { const x = d[j]; if (x < mn) mn = x; if (x > mx) mx = x; } pk[2 * i] = mn; pk[2 * i + 1] = mx; }
    for (let i = 0; i < d.length; i += 64) { ss += d[i] * d[i]; cnt++; }
    C.songRms = Math.sqrt(ss / cnt) || .1; C.peaks = pk;
    const dur = C.buffer.duration;
    for (const id of ['fromS', 'toS']) { $(id).max = dur.toFixed(1); }
    $('fromS').value = 0; $('toS').value = dur.toFixed(1); C.from = 0; C.to = dur; C.nudge = 0; $('nudge').value = 0;
    syncCtrls();
    setProg($('prog'), null);
    status($('clipStatus'), `المدة ${fmtT(dur)}.` + (ana.conf < .35 ? ' الإيقاع مو واضح في هذا المقطع، اسمع وإذا ما ضبط استخدم "اضبط بالنقر".' : ''), ana.conf < .35 ? 'err' : 'ok');
    for (const id of ['anaCard', 'styleCard', 'playCard', 'expCard']) $(id).hidden = false;
    $('expVideo').hidden = !isVideo || !IO.native; $('shareBtn').hidden = true; status($('expStatus'), '');
    $('fixBox').open = ana.conf < .35;
    rebuild(); drawWave();
  }
  function resetBeats() {
    C.beats = C.ana.beats.slice(); C.phase = DSP.downbeatPhase(C.beats.map(t => Math.round(t * C.ana.fps)), C.ana.low, C.model.beats);
    updateStats();
  }
  function updateStats() {
    const ib = C.beats.slice(1).map((t, i) => t - C.beats[i]);
    const bpm = ib.length ? 60 / median(ib) : 0;
    $('stBpm').textContent = AR(Math.round(bpm)); $('stBeats').textContent = AR(C.beats.length);
    const c = C.ana ? C.ana.conf : 0, el = $('stConf');
    el.textContent = c >= .6 ? 'عالية' : c >= .35 ? 'متوسطة' : 'ضعيفة'; el.className = c >= .6 ? 'conf-hi' : c >= .35 ? 'conf-mid' : 'conf-lo';
  }

  // ---- بناء أحداث الصفقة على الضربات
  function rebuild() {
    const ev = [], per = C.model.beats, sub = C.model.sub, b = C.beats; if (!b.length) { C.events = ev; return; }
    const ibi = median(b.slice(1).map((t, i) => t - b[i])) || .5, nd = C.nudge / 1000;
    for (let i = 0; i < b.length; i++) {
      const barPos = ((i - C.phase) % per + per) % per, nx = b[i + 1] ?? b[i] + ibi;
      for (let s = 0; s < sub; s++) {
        const t = b[i] + (nx - b[i]) * s / sub - nd; if (t < C.from - .001 || t > C.to || t < 0) continue;
        const slot = barPos * sub + s;
        C.model.tracks.forEach((tr, ti) => { const v = !tr.mute && tr.cells[slot]; if (v) ev.push({ t, ti, v, slot }); });
      }
    }
    ev.sort((x, y) => x.t - y.t); C.events = ev;
    if (C.playing) { const p = curPos() + .25; C.idx = lowerBound(ev, p); }
    saveClip(); drawWave();
  }
  const lowerBound = (ev, t) => { let lo = 0, hi = ev.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t < t) lo = m + 1; else hi = m; } return lo; };
  function saveClip() { store.set('clip1', { clapDb: C.clapDb, loose: C.loose, room: C.room, wet: C.wet }); }

  // ---- الرسم
  function drawWave() {
    const cv = $('wave'); if (!C.buffer || cv.offsetParent === null) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement), col = n => cs.getPropertyValue(n).trim();
    const dur = C.buffer.duration, X = t => W - t / dur * W, pk = C.peaks, N = pk.length / 2;
    let mx = 1e-6; for (let i = 0; i < pk.length; i++) mx = Math.max(mx, Math.abs(pk[i]));
    // نطاق الصفقة
    g.fillStyle = col('--cell'); g.globalAlpha = .6; g.fillRect(X(Math.min(C.to, dur)), 0, X(C.from) - X(Math.min(C.to, dur)), H); g.globalAlpha = 1;
    g.fillStyle = col('--wave');
    for (let i = 0; i < N; i++) { const x = W - (i + 1) / N * W; const a = pk[2 * i] / mx, b = pk[2 * i + 1] / mx; g.fillRect(x, H / 2 - b * H * .42, Math.max(1, W / N), Math.max(1, (b - a) * H * .42)); }
    const per = C.model.beats;
    C.beats.forEach((t, i) => { const down = ((i - C.phase) % per + per) % per === 0; g.fillStyle = col(down ? '--down' : '--beat'); g.globalAlpha = down ? .95 : .55; g.fillRect(X(t) - (down ? 1 : .5), down ? 0 : H * .78, down ? 2 : 1, down ? H : H * .22); });
    g.globalAlpha = 1;
    const p = C.playing ? curPos() : C.pos; if (p > 0) { g.fillStyle = col('--ink'); g.fillRect(X(p) - 1, 0, 2, H); }
  }
  window.addEventListener('resize', drawWave);
  $('wave').addEventListener('pointerdown', e => {
    if (!C.buffer) return; const r = e.currentTarget.getBoundingClientRect(); const t = (r.right - e.clientX) / r.width * C.buffer.duration;
    C.pos = Math.max(0, Math.min(C.buffer.duration - .1, t)); if (C.playing) { stopClip(); playClip(C.pos); } else drawWave();
  });

  // ---- التشغيل
  const curPos = () => C.playing ? C.pos + (Engine.ctx().currentTime - C.t0) : C.pos;
  function clapGain() { return Math.pow(10, C.clapDb / 20) * Math.max(.6, Math.min(2.5, C.songRms / .08)) * .9; }
  async function playClip(from) {
    if (!C.buffer) return; const c = await Engine.ready();
    if (c.state !== 'running') { toast('الصوت مقفل. اضغط تشغيل مرة ثانية.'); return; }
    if (!Object.keys(Engine.bank).length || !(Engine.bank.open || []).length) { try { await Engine.loadBank(); } catch (e) { toast('أصوات الصفقة ما تحمّلت'); } }
    C.chain = Engine.makeChain(c, { room: C.room, wet: C.wet, clapGain: clapGain() });
    const src = c.createBufferSource(); src.buffer = C.buffer; const sg = c.createGain(); sg.gain.value = C.solo ? 0 : 1; src.connect(sg).connect(c.destination);
    C.t0 = c.currentTime + .08; C.pos = from || 0; src.start(C.t0, C.pos); C.src = src; C.songGain = sg; C.playing = true;
    C.idx = lowerBound(C.events, C.pos);
    src.onended = () => { if (C.src === src) stopClip(true); };
    const v = $('vid'); if (C.isVideo) { try { v.currentTime = C.pos; v.play(); } catch (e) { } }
    C.timer = setInterval(schedClip, 25); schedClip(); requestAnimationFrame(frameClip);
    $('playBtn').textContent = '■ إيقاف'; $('playBtn').classList.add('on');
  }
  function schedClip() {
    const c = Engine.ctx(), horizon = c.currentTime + .2;
    while (C.idx < C.events.length) {
      const e = C.events[C.idx], at = C.t0 + (e.t - C.pos); if (at > horizon) break;
      if (at >= c.currentTime - .01) Engine.hit(C.model.tracks[e.ti] || { snd: 'open', people: 1 }, e.v, at, c, C.chain, e.ti, C.model.tracks.length, C.loose);
      C.idx++;
    }
  }
  function frameClip() {
    if (!C.playing) return; const p = curPos(); $('timeLbl').textContent = fmtT(p) + ' / ' + fmtT(C.buffer.duration);
    // تمييز الخانة الحالية
    const b = C.beats; let lo = 0, hi = b.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= p) lo = m; else hi = m - 1; }
    if (b[lo + 1]) { const per = C.model.beats, s = Math.min(C.model.sub - 1, Math.floor((p - b[lo]) / (b[lo + 1] - b[lo]) * C.model.sub)); clipEd.highlight((((lo - C.phase) % per + per) % per) * C.model.sub + s); }
    drawWave(); requestAnimationFrame(frameClip);
  }
  function stopClip(ended) {
    if (!C.playing) return; C.playing = false; clearInterval(C.timer);
    try { C.src.stop(); } catch (e) { } C.pos = ended ? 0 : curPosFrozen(); const v = $('vid'); try { v.pause(); } catch (e) { }
    const ch = C.chain; setTimeout(() => { try { ch.bus.disconnect(); } catch (e) { } }, 1500);
    clipEd.highlight(-1); $('playBtn').textContent = '▶ تشغيل'; $('playBtn').classList.remove('on'); drawWave();
  }
  function curPosFrozen() { const c = Engine.ctx(); return c ? Math.max(0, C.pos + (c.currentTime - C.t0)) : 0; }
  $('playBtn').onclick = () => C.playing ? stopClip() : playClip(C.pos >= C.buffer.duration - .2 ? 0 : C.pos);
  $('soloBtn').onclick = () => { C.solo = !C.solo; $('soloBtn').setAttribute('aria-pressed', C.solo); $('soloBtn').textContent = C.solo ? '🔇 المقطع مكتوم (اضغط ترجّعه)' : 'الصفقة لحالها'; if (C.songGain) C.songGain.gain.value = C.solo ? 0 : 1; if (C.isVideo) $('vid').muted = true; };

  // ---- إصلاح الإيقاع
  $('dblBtn').onclick = () => { C.beats = DSP.doubleBeats(C.beats); C.phase = (C.phase * 2) % C.model.beats; updateStats(); rebuild(); toast('صارت السرعة الضعف'); };
  $('halfBtn').onclick = () => { if (C.beats.length < 8) return; C.beats = DSP.halveBeats(C.beats, C.phase % 2); C.phase = Math.floor(C.phase / 2); updateStats(); rebuild(); toast('صارت السرعة النص'); };
  $('phaseBtn').onclick = () => { C.phase = (C.phase + 1) % C.model.beats; rebuild(); toast('تحرّكت بداية المازورة ضربة وحدة'); };
  $('reBtn').onclick = () => { if (!C.ana) return; resetBeats(); rebuild(); toast('رجعت للتحليل الأصلي'); };
  $('meter').onchange = e => {
    const nb = +e.target.value; Tracks.resize(C.model.tracks, C.model.beats, C.model.sub, nb, C.model.sub); C.model.beats = nb;
    if (C.ana) C.phase = DSP.downbeatPhase(C.beats.map(t => Math.round(t * C.ana.fps)), C.ana.low, nb);
    clipEd.render(); rebuild();
  };
  let taps = [];
  $('tapBtn').onclick = () => { taps = []; $('tapInfo').textContent = '٠ نقرات'; $('tapDone').disabled = true; $('tapLayer').hidden = false; stopClip(); playClip(C.pos > 1 ? C.pos : 0); };
  $('tapPad').addEventListener('pointerdown', e => {
    e.preventDefault(); if (!C.playing) return; taps.push(curPos()); const p = $('tapPad'); p.classList.add('flash'); setTimeout(() => p.classList.remove('flash'), 90);
    $('tapInfo').textContent = AR(taps.length) + ' نقرات'; $('tapDone').disabled = taps.length < 8;
  });
  $('tapCancel').onclick = () => { $('tapLayer').hidden = true; stopClip(); };
  $('tapDone').onclick = () => {
    const r = DSP.fromTaps(taps, C.buffer.duration); $('tapLayer').hidden = true; stopClip(); if (!r) return;
    C.beats = r.beats; let i0 = 0, best = 1e9; r.beats.forEach((t, i) => { if (Math.abs(t - taps[0]) < best) { best = Math.abs(t - taps[0]); i0 = i; } });
    C.phase = i0 % C.model.beats; updateStats(); rebuild(); toast('تم ضبط الإيقاع على نقراتك: ' + AR(Math.round(r.bpm)) + ' ض/د');
  };

  // ---- أدوات التحكم
  function syncCtrls() {
    $('nudge').value = C.nudge; $('nudgeO').textContent = (C.nudge > 0 ? 'أبكر ' : C.nudge < 0 ? 'أبطأ ' : '') + AR(Math.abs(C.nudge)) + ' م.ث';
    $('fromO').textContent = fmtT(C.from); $('toO').textContent = fmtT(Math.min(C.to, C.buffer ? C.buffer.duration : 0));
    $('clapLvl').value = C.clapDb; $('clapLvlO').textContent = (C.clapDb > 0 ? '+' : '') + AR(C.clapDb) + ' dB';
    $('loose').value = C.loose; $('looseO').textContent = AR(C.loose) + ' م.ث';
    $('room').value = String(C.room); $('wet').value = C.wet; $('wetO').textContent = AR(C.wet) + '٪';
  }
  $('nudge').oninput = e => { C.nudge = +e.target.value; syncCtrls(); rebuild(); };
  $('fromS').oninput = e => { C.from = Math.min(+e.target.value, C.to - 1); syncCtrls(); rebuild(); };
  $('toS').oninput = e => { C.to = Math.max(+e.target.value, C.from + 1); syncCtrls(); rebuild(); };
  $('clapLvl').oninput = e => { C.clapDb = +e.target.value; syncCtrls(); saveClip(); if (C.chain) C.chain.bus.gain.value = clapGain(); };
  $('loose').oninput = e => { C.loose = +e.target.value; syncCtrls(); saveClip(); };
  $('room').onchange = e => { C.room = +e.target.value; saveClip(); if (C.chain) C.chain.set({ room: C.room, wet: C.wet }); };
  $('wet').oninput = e => { C.wet = +e.target.value; syncCtrls(); saveClip(); if (C.chain) C.chain.set({ wet: C.wet }); };
  $('clipAdd').onclick = () => clipEd.addTrack();

  // ---- التصدير
  async function renderClip(withSong) {
    const dur = C.buffer.duration, oc = new OfflineAudioContext(2, Math.ceil(dur * Engine.SR), Engine.SR);
    if (withSong) { const s = oc.createBufferSource(); s.buffer = C.buffer; s.connect(oc.destination); s.start(0); }
    const ch = Engine.makeChain(oc, { room: C.room, wet: C.wet, clapGain: clapGain() });
    for (const e of C.events) Engine.hit(C.model.tracks[e.ti], e.v, e.t, oc, ch, e.ti, C.model.tracks.length, C.loose);
    return oc.startRendering();
  }
  const baseName = () => (C.name || 'مقطع').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
  let busy = false;
  async function doExport(kind) {
    if (busy || !C.buffer) return; busy = true; stopClip();
    const st = $('expStatus'), pr = $('expProg'); $('shareBtn').hidden = true;
    const fmt = IO.native ? $('fmt').value : 'wav';
    try {
      status(st, 'جاري تجهيز الصوت…'); setProg(pr, .05); await new Promise(r => setTimeout(r, 30));
      const buf = await renderClip(kind !== 'claps'); setProg(pr, .35);
      const bytes = Engine.wav(buf); const stamp = Date.now();
      let res, label;
      if (kind === 'video') {
        status(st, 'جاري تجهيز الفيديو…');
        const vUri = await IO.writeCache('src_' + stamp + '.mp4', C.file, p => setProg(pr, .35 + p * .3));
        const aUri = await IO.writeCache('mix_' + stamp + '.wav', bytes, p => setProg(pr, .65 + p * .1));
        status(st, 'جاري دمج الصفقة مع الفيديو…'); setProg(pr, .8);
        const out = await IO.mux(vUri, aUri, 'out_' + stamp + '.mp4');
        res = await IO.publish(out, baseName() + ' - مع الصفقة.mp4', 'video/mp4'); label = 'الفيديو';
      } else {
        const nm = baseName() + (kind === 'claps' ? ' - الصفقة لحالها' : ' - مع الصفقة');
        if (fmt === 'm4a') {
          const aUri = await IO.writeCache('a_' + stamp + '.wav', bytes, p => setProg(pr, .35 + p * .35));
          status(st, 'جاري الضغط…'); setProg(pr, .8);
          const out = await IO.mux(null, aUri, 'out_' + stamp + '.m4a');
          res = await IO.publish(out, nm + '.m4a', 'audio/mp4');
        } else res = await IO.save(nm + '.wav', bytes, 'audio/wav', p => setProg(pr, .35 + p * .6));
        label = kind === 'claps' ? 'الصفقة' : 'الصوت';
      }
      setProg(pr, null); C.lastUri = res.uri;
      status(st, res.location ? `تم حفظ ${label} في: ${res.location}` : `تم تجهيز ${label}. اضغط مشاركة عشان تحفظه أو ترسله.`, 'ok');
      $('shareBtn').hidden = !IO.native;
    } catch (err) {
      console.error(err); setProg(pr, null); status(st, 'ما تم التصدير: ' + (err && err.message ? err.message : 'خطأ غير معروف'), 'err');
    } finally { busy = false; }
  }
  $('expMix').onclick = () => doExport('mix'); $('expClaps').onclick = () => doExport('claps'); $('expVideo').onclick = () => doExport('video');
  $('shareBtn').onclick = () => IO.share(C.lastUri, 'صفّاق الفرقة').catch(() => { });
  if (!IO.native) { $('fmt').closest('.row').hidden = true; }

  /* ================= الاستوديو ================= */
  const sSaved = store.get('studio2', null);
  const S = Object.assign({ bpm: 96, loose: 10, room: 1.1, wet: 22, cycles: 16, style: 'mawlid', model: { beats: 4, sub: 4, tracks: Tracks.STYLES.mawlid.tracks() } }, sSaved || {});
  S.playing = false; S.lastUri = null;
  const sEd = Tracks.editor($('sTracks'), S.model, {
    change() { S.style = 'custom'; renderSStyles(); sSave(); sMeta(); },
    preview(t, ti, v) { if (S.playing) return; const c = Engine.audio(); Engine.hit(t, v || 2, c.currentTime + .02, c, previewChain(c), ti, S.model.tracks.length, 0); },
  });
  function sSave() { const { playing, lastUri, chain, timer, ...rest } = S; rest.model = { beats: S.model.beats, sub: S.model.sub, tracks: S.model.tracks.filter(t => !t.snd.startsWith('u')) }; store.set('studio2', rest); }
  function renderSStyles() {
    const box = $('sStyles'); box.innerHTML = '';
    for (const [k, s] of Object.entries(Tracks.STYLES)) { const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', S.style === k); b.textContent = s.name;
      b.onclick = () => { S.style = k; S.model.tracks.splice(0, S.model.tracks.length, ...Tracks.STYLES[k].tracks()); Tracks.resize(S.model.tracks, 4, 4, S.model.beats, S.model.sub); renderSStyles(); sEd.render(); sSave(); sMeta(); }; box.appendChild(b); }
  }
  function renderLib() {
    const box = $('lib'); box.innerHTML = '';
    for (const s of Engine.LIB) {
      const b = document.createElement('button'); b.className = 'snd'; b.innerHTML = `<span class="ic">▶</span><span>${s.name}<small>${s.sub}</small></span>`;
      b.onclick = () => { const c = Engine.audio(); Engine.hit({ snd: s.id, people: 1, vol: 100 }, 2, c.currentTime + .02, c, previewChain(c), 0, 1, 0); b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 220); };
      box.appendChild(b);
    }
  }
  const sStep = () => 60 / S.bpm / S.model.sub;
  function sMeta() {
    $('sBpm').value = S.bpm; $('sBpmO').textContent = AR(S.bpm); $('sLoose').value = S.loose; $('sLooseO').textContent = AR(S.loose) + ' م.ث';
    $('sRoom').value = String(S.room); $('sCycles').value = S.cycles; $('sBeats').value = String(S.model.beats); $('sSub').value = String(S.model.sub);
    const sec = S.cycles * S.model.beats * 60 / S.bpm; $('sDur').textContent = AR(S.cycles) + ' ≈ ' + fmtT(sec);
    $('sMeta').textContent = `${AR(S.model.tracks.length)} أشخاص · ${AR(S.bpm)} ض/د`;
  }
  $('sBpm').oninput = e => { S.bpm = +e.target.value; sMeta(); sSave(); };
  $('sLoose').oninput = e => { S.loose = +e.target.value; sMeta(); sSave(); };
  $('sRoom').onchange = e => { S.room = +e.target.value; sSave(); if (S.chain) S.chain.set({ room: S.room, wet: S.wet }); };
  $('sCycles').oninput = e => { S.cycles = +e.target.value; sMeta(); sSave(); };
  $('sBeats').onchange = e => { const nb = +e.target.value; Tracks.resize(S.model.tracks, S.model.beats, S.model.sub, nb, S.model.sub); S.model.beats = nb; S.step = 0; sEd.render(); sSave(); sMeta(); };
  $('sSub').onchange = e => { const ns = +e.target.value; Tracks.resize(S.model.tracks, S.model.beats, S.model.sub, S.model.beats, ns); S.model.sub = ns; S.step = 0; sEd.render(); sSave(); sMeta(); };
  $('sAdd').onclick = () => sEd.addTrack();
  $('sClear').onclick = () => { S.model.tracks.forEach(t => t.cells.fill(0)); sEd.render(); sSave(); };
  function schedStudio() {
    const c = Engine.ctx(), n = S.model.beats * S.model.sub;
    while (S.nextT < c.currentTime + .15) {
      const i = S.step % n; S.model.tracks.forEach((t, ti) => { if (!t.mute && t.cells[i]) Engine.hit(t, t.cells[i], S.nextT, c, S.chain, ti, S.model.tracks.length, S.loose); });
      S.queue.push({ s: i, t: S.nextT }); S.nextT += sStep(); S.step = (S.step + 1) % n;
    }
  }
  function frameStudio() { if (!S.playing) return; const c = Engine.ctx(); let cur = null; while (S.queue.length && S.queue[0].t <= c.currentTime) cur = S.queue.shift(); if (cur) sEd.highlight(cur.s); requestAnimationFrame(frameStudio); }
  function stopStudio() { if (!S.playing) return; S.playing = false; clearInterval(S.timer); S.queue = []; sEd.highlight(-1); $('sPlay').textContent = '▶ تشغيل الكل'; $('sPlay').classList.remove('on'); const ch = S.chain; setTimeout(() => { try { ch.bus.disconnect(); } catch (e) { } }, 1500); }
  $('sPlay').onclick = async () => {
    if (S.playing) { stopStudio(); return; }
    const c = await Engine.ready(); S.chain = Engine.makeChain(c, { room: S.room, wet: S.wet, clapGain: .9 });
    S.playing = true; S.step = 0; S.queue = []; S.nextT = c.currentTime + .06; S.timer = setInterval(schedStudio, 25); schedStudio(); requestAnimationFrame(frameStudio);
    $('sPlay').textContent = '■ إيقاف'; $('sPlay').classList.add('on');
  };
  $('sExport').onclick = async () => {
    if (busy) return; busy = true; stopStudio(); const st = $('sStatus'); $('sShare').hidden = true;
    try {
      status(st, 'جاري التجهيز…');
      const n = S.model.beats * S.model.sub, len = S.cycles * n * sStep() + Math.max(S.room, .3) + .5;
      const oc = new OfflineAudioContext(2, Math.ceil(len * Engine.SR), Engine.SR); const ch = Engine.makeChain(oc, { room: S.room, wet: S.wet, clapGain: .9 });
      let t = .05; for (let k = 0; k < S.cycles; k++) for (let i = 0; i < n; i++) { S.model.tracks.forEach((tr, ti) => { if (!tr.mute && tr.cells[i]) Engine.hit(tr, tr.cells[i], t, oc, ch, ti, S.model.tracks.length, S.loose); }); t += sStep(); }
      const buf = await oc.startRendering(); const bytes = Engine.wav(buf, .9); const nm = `إيقاع ${S.bpm} - ${S.model.tracks.length} أشخاص`;
      let res;
      if (IO.native && $('fmt').value === 'm4a') { const a = await IO.writeCache('s_' + Date.now() + '.wav', bytes); const out = await IO.mux(null, a, 's_' + Date.now() + '.m4a'); res = await IO.publish(out, nm + '.m4a', 'audio/mp4'); }
      else res = await IO.save(nm + '.wav', bytes, 'audio/wav');
      S.lastUri = res.uri; status(st, res.location ? 'تم الحفظ في: ' + res.location : 'تم تجهيز الملف.', 'ok'); $('sShare').hidden = !IO.native;
    } catch (err) { console.error(err); status(st, 'ما تم التصدير: ' + (err.message || ''), 'err'); } finally { busy = false; }
  };
  $('sShare').onclick = () => IO.share(S.lastUri, 'صفّاق الفرقة').catch(() => { });

  // صفقة خاصة من ملف أو تسجيل
  let uCount = 0;
  async function addCustom(blob, label) {
    const st = $('libStatus'); status(st, 'جاري قراءة الصفقة…');
    try {
      const raw = await new OfflineAudioContext(1, 1, Engine.SR).decodeAudioData(await blob.arrayBuffer());
      const sr = raw.sampleRate, n = raw.length, d = new Float32Array(n);
      for (let c = 0; c < raw.numberOfChannels; c++) { const x = raw.getChannelData(c); for (let i = 0; i < n; i++) d[i] += x[i] / raw.numberOfChannels; }
      let mx = 0; for (const v of d) mx = Math.max(mx, Math.abs(v)); if (mx < 1e-4) throw new Error('silent');
      const sil = mx * .03; let a = 0, z = n - 1; while (a < n && Math.abs(d[a]) < sil) a++; while (z > a && Math.abs(d[z]) < sil * .5) z--;
      a = Math.max(0, a - Math.floor(sr * .005)); z = Math.min(n, z + Math.floor(sr * .15));
      const len = Math.max(64, Math.min(z - a, sr * 6)), b = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 }), o = b.getChannelData(0), fl = Math.min(Math.floor(sr * .05), len >> 2);
      for (let i = 0; i < len; i++) o[i] = d[a + i] / mx * .95 * (i > len - fl ? (len - i) / fl : 1);
      uCount++; const id = 'u' + uCount; Engine.bank[id] = [b]; Engine.LIB.push({ id, name: 'صفقتي ' + AR(uCount), sub: label + ' · ' + AR(b.duration.toFixed(2)) + ' ث' });
      renderLib(); sEd.render(); clipEd.render();
      status(st, `تمت إضافة "صفقتي ${AR(uCount)}" (${AR(b.duration.toFixed(2))} ثانية). تلقاها في قائمة الصفقات عند كل شخص.`, 'ok');
    } catch (e) { status(st, 'ما لقيت صوت واضح في الملف. سجّل أقرب من الجوال.', 'err'); }
  }
  $('libFileBtn').onclick = () => $('libFile').click();
  $('libFile').onchange = e => { const f = e.target.files[0]; if (f) addCustom(f, f.name.slice(0, 20)); e.target.value = ''; };
  let libRec = null;
  $('libRecBtn').onclick = async () => {
    if (libRec) { libRec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const mr = new MediaRecorder(stream), chunks = []; mr.ondataavailable = e => e.data.size && chunks.push(e.data);
      mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); libRec = null; $('libRecBtn').textContent = '🎙 سجّل صفقة'; addCustom(new Blob(chunks, { type: mr.mimeType }), 'تسجيل'); };
      mr.start(); libRec = mr; $('libRecBtn').textContent = '■ إيقاف التسجيل'; status($('libStatus'), 'صفّق صفقة وحدة، ثم اضغط إيقاف.');
    } catch (e) { status($('libStatus'), 'ما قدرت أفتح المايك. اسمح للتطبيق باستخدام المايكروفون.', 'err'); }
  };

  /* ================= البداية ================= */
  (async () => {
    renderStyles(); clipEd.render(); renderSStyles(); sEd.render(); sMeta();
    status($('clipStatus'), 'جاري تحميل أصوات الصفقات…');
    try { await Engine.loadBank(); status($('clipStatus'), ''); } catch (e) { status($('clipStatus'), 'ما قدرت أحمّل أصوات الصفقات.', 'err'); }
    renderLib();
    window.__app = { C, S, loadSource, renderClip, rebuild };
  })();
})();
