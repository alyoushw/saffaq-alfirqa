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
    $('scrClip').hidden = name !== 'clip'; $('scrStudio').hidden = name !== 'studio'; $('pbar').hidden = name !== 'clip' || !C.buffer;
    $('tabClip').setAttribute('aria-selected', name === 'clip'); $('tabStudio').setAttribute('aria-selected', name === 'studio');
    stopClip(); stopStudio();
    if (name === 'clip') drawWave();
  }
  $('tabClip').onclick = () => showTab('clip'); $('tabStudio').onclick = () => showTab('studio');

  /* ================= صفقة على مقطع ================= */
  const saved = store.get('clip1', {});
  const C = {
    file: null, name: '', isVideo: false, buffer: null, ana: null, beats: [], phase: 0, peaks: null, songRms: .1,
    model: { beats: 4, sub: 4, tracks: Tracks.STYLES.mawlid.tracks() }, style: 'auto', beatMode: 'steady', songVol: 100, taps: [], tapSens: 50, tapQuant: false, fromMic: false,
    nudge: 0, from: 0, to: 1e9, clapDb: saved.clapDb ?? 0, songVolSaved: saved.songVol ?? 100, loose: saved.loose ?? 10, room: saved.room ?? 1.1, wet: saved.wet ?? 22,
    events: [], playing: false, pos: 0, t0: 0, idx: 0, timer: null, src: null, songGain: null, chain: null, solo: false, lastUri: null,
  };
  const clipEd = Tracks.editor($('clipTracks'), C.model, {
    change() { C.style = 'custom'; renderStyles(); rebuild(); },
    preview(t, ti, v) { if (C.playing) return; previewHit(t, v, ti, C.model.tracks.length); },
  });
  // سماع صفقة وحدة: نجهّزها كملف قصير ونشغّلها
  const fx = $('fx'); let fxUrl = null;
  async function previewHit(t, v, ti, n) {
    try {
      const oc = new OfflineAudioContext(2, Math.ceil(Engine.SR * 1.6), Engine.SR); const ch = Engine.makeChain(oc, { room: .35, wet: 15, clapGain: .9 });
      Engine.hit(t, v || 2, .02, oc, ch, ti || 0, n || 1, 0);
      const bytes = Engine.wav(await oc.startRendering());
      if (fxUrl) URL.revokeObjectURL(fxUrl); fxUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      fx.src = fxUrl; await fx.play();
    } catch (e) { console.error(e); }
  }

  function renderStyles() {
    const box = $('styles'); box.innerHTML = '';
    if (C.ana) { const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', C.style === 'taps'); b.innerHTML = `👆 نفس طقّاتي<small>${AR(C.taps.length)} طقة في التسجيل</small>`; b.onclick = () => applyStyle('taps'); box.appendChild(b); }
    { const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', C.style === 'auto'); b.innerHTML = '✨ تلقائي<small>من إيقاع المقطع</small>'; b.onclick = () => applyStyle('auto'); box.appendChild(b); }
    for (const [k, s] of Object.entries(Tracks.STYLES)) {
      const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', C.style === k);
      b.innerHTML = `${s.name}<small>${s.desc}</small>`; b.onclick = () => applyStyle(k); box.appendChild(b);
    }
    if (C.style === 'custom') { const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', 'true'); b.textContent = 'تشكيلك الخاص'; box.appendChild(b); }
  }
  function applyStyle(k) {
    C.style = k; $('tapsPanel').hidden = k !== 'taps'; $('editBox').hidden = k === 'taps';
    if (k === 'taps') {
      const ppl = +$('tapPeople').value || 5;
      C.model.tracks.splice(0, C.model.tracks.length,
        { name: 'الطقة القوية', snd: $('tapStrongSnd').value || 'open', people: ppl, vol: 100, mute: false, cells: [] },
        { name: 'كل الطقات', snd: $('tapAllSnd').value || 'sharp', people: ppl, vol: 90, mute: false, cells: [] });
      $('styleWhy').textContent = C.taps.length
        ? `لقيت ${AR(C.taps.length)} طقة في تسجيلك، وكل طقة صارت صفقة فرقة بنفس مكانها. الطقة القوية تصير صفقة قوية وعميقة، والخفيفة صفقة خفيفة.`
        : 'ما لقيت طقّات واضحة. ارفع "حساسية التقاط الطقّات"، أو سجّل وأنت تطق أوضح.';
      renderStyles(); rebuild(); return;
    }
    if (k === 'auto' && C.ana) {
      const per = C.model.beats, sub = C.model.sub, a = C.ana, bpm = 60 / (median(C.beats.slice(1).map((t, i) => t - C.beats[i])) || .5);
      const r = Tracks.autoTracks(DSP.foldProfile(a.lowFl, a.fps, C.beats, C.phase, per, sub), DSP.foldProfile(a.hiFl, a.fps, C.beats, C.phase, per, sub), per, sub, bpm, a.pulse);
      C.model.tracks.splice(0, C.model.tracks.length, ...r.tracks); $('styleWhy').textContent = r.why;
    } else {
      if (k === 'auto') k = C.style = 'mawlid';
      C.model.tracks.splice(0, C.model.tracks.length, ...Tracks.STYLES[k].tracks());
      Tracks.resize(C.model.tracks, 4, 4, C.model.beats, C.model.sub);
      $('styleWhy').textContent = 'شكل جاهز: نفس النمط لكل المقاطع، والتوقيت من مقطعك.';
    }
    renderStyles(); clipEd.render(); rebuild();
  }
  const reAuto = () => { if (C.style === 'auto') applyStyle('auto'); else rebuild(); };

  // ---- المصدر: ملف أو تسجيل
  $('pickBtn').onclick = () => $('fileIn').click();
  $('fileIn').onchange = e => { const f = e.target.files[0]; C.fromMic = false; if (f) loadSource(f, f.name, (f.type || '').startsWith('video/') || /\.(mp4|mov|3gp|mkv|webm)$/i.test(f.name) && !/audio/.test(f.type)); e.target.value = ''; };
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
        if (blob.size) { C.fromMic = true; loadSource(blob, 'تسجيل ' + new Date().toLocaleTimeString('ar'), false); }
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
    $('fixBox').open = false;
    C.taps = DSP.detectTaps(ana, C.tapSens);
    if (C.fromMic && C.taps.length >= 6) C.style = 'taps';
    $('pbar').hidden = false; C.songVol = C.songVolSaved; syncCtrls();
    if (ana.meter !== C.model.beats) { Tracks.resize(C.model.tracks, C.model.beats, C.model.sub, ana.meter, C.model.sub); C.model.beats = ana.meter; $('meter').value = String(ana.meter); resetBeats(); }
    applyStyle(C.style === 'custom' || (C.style === 'taps' && !C.fromMic && C.taps.length < 6) ? 'auto' : C.style); drawWave();
  }
  function resetBeats() {
    C.beats = (C.beatMode === 'follow' ? C.ana.follow : C.ana.steady).slice(); C.phase = C.ana.phaseOf(C.beats, C.model.beats);
    document.querySelectorAll('#beatMode .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === C.beatMode));
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
    if (C.style === 'taps') {
      // نفس طقّاتك: صفقة مكان كل طقة، والقوية أقوى
      const grid = []; if (C.tapQuant) for (let i = 0; i < b.length; i++) { const nx = b[i + 1] ?? b[i] + ibi; for (let q = 0; q < 4; q++) grid.push(b[i] + (nx - b[i]) * q / 4); }
      for (const tp of C.taps) {
        let t = tp.t; if (grid.length) { let best = grid[0]; for (const g of grid) if (Math.abs(g - t) < Math.abs(best - t)) best = g; t = best; }
        t -= nd; if (t < C.from - .001 || t > C.to || t < 0) continue;
        const strong = tp.s >= .6; const [A, B] = C.model.tracks;
        if (A && !A.mute && strong) ev.push({ t, ti: 0, v: 2, slot: -1 });
        if (B && !B.mute) ev.push({ t, ti: 1, v: strong ? 2 : 1, slot: -1 });
      }
      ev.sort((x, y) => x.t - y.t); C.events = ev; updateDiag(); refreshMix(); saveClip(); drawWave(); return;
    }
    for (let i = 0; i < b.length; i++) {
      const barPos = ((i - C.phase) % per + per) % per, nx = b[i + 1] ?? b[i] + ibi;
      for (let s = 0; s < sub; s++) {
        const t = b[i] + (nx - b[i]) * s / sub - nd; if (t < C.from - .001 || t > C.to || t < 0) continue;
        const slot = barPos * sub + s;
        C.model.tracks.forEach((tr, ti) => { const v = !tr.mute && tr.cells[slot]; if (v) ev.push({ t, ti, v, slot }); });
      }
    }
    ev.sort((x, y) => x.t - y.t); C.events = ev; updateDiag();
    refreshMix();
    saveClip(); drawWave();
  }
  const lowerBound = (ev, t) => { let lo = 0, hi = ev.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t < t) lo = m + 1; else hi = m; } return lo; };
  function saveClip() { store.set('clip1', { clapDb: C.clapDb, loose: C.loose, room: C.room, wet: C.wet, songVol: C.songVol }); }

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
    if (C.style === 'taps') { g.globalAlpha = 1; g.fillStyle = col('--accent'); for (const tp of C.taps) { g.beginPath(); g.arc(X(tp.t), 9, 2.5 + tp.s * 4, 0, 7); g.fill(); } }
    g.globalAlpha = 1;
    const p = C.playing ? curPos() : C.pos; if (p > 0) { g.fillStyle = col('--ink'); g.fillRect(X(p) - 1, 0, 2, H); }
  }
  window.addEventListener('resize', drawWave);
  $('wave').addEventListener('pointerdown', e => {
    if (!C.buffer) return; const r = e.currentTarget.getBoundingClientRect(); const t = (r.right - e.clientX) / r.width * C.buffer.duration;
    C.pos = Math.max(0, Math.min(C.buffer.duration - .1, t)); if (C.playing) { stopClip(); playClip(C.pos); } else drawWave();
  });

  let soundCheck = { ok: true, sounds: 0 };
  function updateDiag() {
    const d = $('diag'); if (!d) return; const active = C.model.tracks.filter(t => !t.mute).length;
    if (!soundCheck.ok) { d.className = 'diag err'; d.textContent = '⚠ ' + soundCheck.msg + ' — صوّر هذي الرسالة وأرسلها.'; return; }
    if (!C.buffer) { d.className = 'diag'; d.textContent = `✓ ${AR(soundCheck.sounds)} صوت صفقة جاهز. اختر مقطع.`; return; }
    if (!C.events.length) { d.className = 'diag err'; d.textContent = '⚠ ما فيه ولا صفقة على المقطع. اختر شكل صفقة من فوق، أو تأكد إن الأشخاص مو مكتومين.'; return; }
    d.className = 'diag'; d.textContent = `✓ ${AR(C.events.length)} صفقة على المقطع · ${AR(active)} أشخاص · ${AR(soundCheck.sounds)} صوت صفقة جاهز`;
  }
  // ---- التشغيل: نجهّز الصوت كامل كملف ونشغّله بمشغّل الجوال العادي (أضمن من التشغيل المباشر)
  const player = $('player');
  let mixUrl = null, mixKey = '', mixBusy = null, refreshT = null;
  const curPos = () => C.playing ? player.currentTime : C.pos;
  function clapGain() { return Math.pow(10, C.clapDb / 20) * Math.max(.6, Math.min(2.5, C.songRms / .08)) * .9; }
  const mixKeyNow = () => JSON.stringify([C.name, C.beats.length, C.beats[0], C.phase, C.model, C.nudge, C.from, C.to, C.clapDb, C.loose, C.room, C.wet, C.songVol, C.style, C.taps.length, C.tapQuant]);
  async function ensureMix() {
    const k = mixKeyNow(); if (mixUrl && k === mixKey) return mixUrl;
    if (mixBusy) await mixBusy;
    if (mixUrl && mixKeyNow() === mixKey) return mixUrl;
    const btn = $('playBtn'); btn.textContent = '⏳'; btn.disabled = true;
    mixBusy = (async () => {
      const buf = await renderClip(true); const bytes = Engine.wav(buf);
      if (mixUrl) URL.revokeObjectURL(mixUrl);
      mixUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); mixKey = k;
    })();
    try { await mixBusy; } finally { mixBusy = null; btn.disabled = false; btn.textContent = C.playing ? '■' : '▶'; }
    return mixUrl;
  }
  async function playClip(from) {
    if (!C.buffer) return;
    try {
      const url = await ensureMix();
      if (player.src !== url) player.src = url;
      player.currentTime = from || 0; await player.play();
    } catch (e) { console.error(e); toast('ما قدرت أشغّل الصوت: ' + (e.message || '')); return; }
    C.playing = true;
    const v = $('vid'); if (C.isVideo) { try { v.muted = true; v.currentTime = from || 0; v.play(); } catch (e) { } }
    requestAnimationFrame(frameClip);
    $('playBtn').textContent = '■'; $('playBtn').classList.add('on');
  }
  player.onended = () => { if (C.playing) stopClip(true); };
  // أي تعديل وقت التشغيل: نجهّز من جديد ونكمل من نفس المكان
  function refreshMix() {
    if (!C.playing) return; clearTimeout(refreshT);
    refreshT = setTimeout(async () => { if (!C.playing) return; const p = player.currentTime; try { const url = await ensureMix(); if (!C.playing) return; player.src = url; player.currentTime = p; await player.play(); } catch (e) { } }, 700);
  }
  function frameClip() {
    if (!C.playing) return; const p = curPos(); $('timeLbl').textContent = fmtT(p) + ' / ' + fmtT(C.buffer.duration);
    const v = $('vid'); if (C.isVideo && !v.paused && Math.abs(v.currentTime - p) > .3) { try { v.currentTime = p; } catch (e) { } }
    // تمييز الخانة الحالية
    const b = C.beats; let lo = 0, hi = b.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= p) lo = m; else hi = m - 1; }
    if (b[lo + 1]) { const per = C.model.beats, s = Math.min(C.model.sub - 1, Math.floor((p - b[lo]) / (b[lo + 1] - b[lo]) * C.model.sub)); clipEd.highlight((((lo - C.phase) % per + per) % per) * C.model.sub + s); }
    drawWave(); requestAnimationFrame(frameClip);
  }
  function stopClip(ended) {
    if (!C.playing) return; C.playing = false; clearTimeout(refreshT);
    C.pos = ended ? 0 : player.currentTime; try { player.pause(); } catch (e) { } const v = $('vid'); try { v.pause(); } catch (e) { }
    clipEd.highlight(-1); $('playBtn').textContent = '▶'; $('playBtn').classList.remove('on'); drawWave();
  }
  $('playBtn').onclick = () => C.playing ? stopClip() : playClip(C.pos >= C.buffer.duration - .2 ? 0 : C.pos);
  $('songVol').oninput = e => { C.songVol = +e.target.value; syncCtrls(); saveClip(); refreshMix(); };

  // ---- إصلاح الإيقاع
  $('dblBtn').onclick = () => { C.beats = DSP.doubleBeats(C.beats); C.phase = (C.phase * 2) % C.model.beats; updateStats(); reAuto(); toast('صارت السرعة الضعف'); };
  $('halfBtn').onclick = () => { if (C.beats.length < 8) return; C.beats = DSP.halveBeats(C.beats, C.phase % 2); C.phase = Math.floor(C.phase / 2); updateStats(); reAuto(); toast('صارت السرعة النص'); };
  $('phaseBtn').onclick = () => { C.phase = (C.phase + 1) % C.model.beats; reAuto(); toast('تحرّكت بداية المازورة ضربة وحدة'); };
  $('reBtn').onclick = () => { if (!C.ana) return; resetBeats(); reAuto(); toast('رجعت للتحليل الأصلي'); };
  $('meter').onchange = e => {
    const nb = +e.target.value; Tracks.resize(C.model.tracks, C.model.beats, C.model.sub, nb, C.model.sub); C.model.beats = nb;
    if (C.ana) C.phase = C.ana.phaseOf(C.beats, nb);
    clipEd.render(); reAuto();
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
    C.phase = i0 % C.model.beats; updateStats(); reAuto(); toast('تم ضبط الإيقاع على نقراتك: ' + AR(Math.round(r.bpm)) + ' ض/د');
  };

  // ---- أدوات التحكم
  function syncCtrls() {
    $('nudge').value = C.nudge; $('nudgeO').textContent = (C.nudge > 0 ? 'أبكر ' : C.nudge < 0 ? 'أبطأ ' : '') + AR(Math.abs(C.nudge)) + ' م.ث';
    $('fromO').textContent = fmtT(C.from); $('toO').textContent = fmtT(Math.min(C.to, C.buffer ? C.buffer.duration : 0));
    $('songVol').value = C.songVol; $('songVolO').textContent = C.songVol ? AR(C.songVol) + '٪' : 'مكتوم'; $('clapLvl').value = C.clapDb; $('clapLvlO').textContent = (C.clapDb > 0 ? '+' : '') + AR(C.clapDb) + ' dB';
    $('loose').value = C.loose; $('looseO').textContent = AR(C.loose) + ' م.ث';
    $('room').value = String(C.room); $('wet').value = C.wet; $('wetO').textContent = AR(C.wet) + '٪';
  }
  $('nudge').oninput = e => { C.nudge = +e.target.value; syncCtrls(); rebuild(); };
  $('fromS').oninput = e => { C.from = Math.min(+e.target.value, C.to - 1); syncCtrls(); rebuild(); };
  $('toS').oninput = e => { C.to = Math.max(+e.target.value, C.from + 1); syncCtrls(); rebuild(); };
  $('clapLvl').oninput = e => { C.clapDb = +e.target.value; syncCtrls(); saveClip(); refreshMix(); };
  $('loose').oninput = e => { C.loose = +e.target.value; syncCtrls(); saveClip(); refreshMix(); };
  $('room').onchange = e => { C.room = +e.target.value; saveClip(); refreshMix(); };
  $('wet').oninput = e => { C.wet = +e.target.value; syncCtrls(); saveClip(); refreshMix(); };
  $('clipAdd').onclick = () => clipEd.addTrack();
  for (const id of ['tapStrongSnd', 'tapAllSnd']) { const sel = $(id); for (const s of Engine.LIB) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); } }
  $('tapStrongSnd').value = 'open'; $('tapAllSnd').value = 'sharp';
  const tapSync = () => { $('tapPeopleO').textContent = AR($('tapPeople').value); $('tapSensO').textContent = AR($('tapSens').value) + '٪'; };
  $('tapStrongSnd').onchange = () => { if (C.model.tracks[0]) C.model.tracks[0].snd = $('tapStrongSnd').value; rebuild(); };
  $('tapAllSnd').onchange = () => { if (C.model.tracks[1]) C.model.tracks[1].snd = $('tapAllSnd').value; rebuild(); };
  $('tapPeople').oninput = () => { tapSync(); C.model.tracks.forEach(t => t.people = +$('tapPeople').value); rebuild(); };
  let sensT = null; $('tapSens').oninput = () => { tapSync(); clearTimeout(sensT); sensT = setTimeout(() => { if (!C.ana) return; C.tapSens = +$('tapSens').value; C.taps = DSP.detectTaps(C.ana, C.tapSens); applyStyle('taps'); }, 300); };
  $('tapQuant').onchange = () => { C.tapQuant = $('tapQuant').checked; rebuild(); };
  tapSync();
  document.querySelectorAll('#beatMode .chip').forEach(b => b.onclick = () => { if (!C.ana) return; C.beatMode = b.dataset.m; resetBeats(); reAuto(); toast(C.beatMode === 'steady' ? 'الإيقاع ثابت طول المقطع' : 'الإيقاع يتبع المنشد'); });

  // ---- التصدير
  async function renderClip(withSong) {
    const dur = C.buffer.duration, oc = new OfflineAudioContext(2, Math.ceil(dur * Engine.SR), Engine.SR);
    if (withSong && C.songVol > 0) { const s = oc.createBufferSource(); s.buffer = C.buffer; const g = oc.createGain(); g.gain.value = C.songVol / 100; s.connect(g).connect(oc.destination); s.start(0); }
    const ch = Engine.makeChain(oc, { room: C.room, wet: C.wet, clapGain: clapGain() });
    for (const e of C.events) Engine.hit(C.model.tracks[e.ti], e.v, e.t, oc, ch, e.ti, C.model.tracks.length, C.loose);
    return oc.startRendering();
  }
  const baseName = () => (C.name || 'مقطع').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
  let busy = false;
  async function doExport(kind) {
    if (!C.buffer) { status($('expStatus'), 'اختر مقطع أول.', 'err'); return; }
    if (busy) { status($('expStatus'), 'فيه تصدير شغال، انتظر شوي.', 'err'); return; } busy = true; stopClip();
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
    change() { S.style = 'custom'; renderSStyles(); sSave(); sMeta(); sRefresh(); },
    preview(t, ti, v) { if (S.playing) return; previewHit(t, v, ti, S.model.tracks.length); },
  });
  function sSave() { const { playing, lastUri, chain, timer, ...rest } = S; rest.model = { beats: S.model.beats, sub: S.model.sub, tracks: S.model.tracks.filter(t => !t.snd.startsWith('u')) }; store.set('studio2', rest); }
  function renderSStyles() {
    const box = $('sStyles'); box.innerHTML = '';
    for (const [k, s] of Object.entries(Tracks.STYLES)) { const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', S.style === k); b.textContent = s.name;
      b.onclick = () => { S.style = k; S.model.tracks.splice(0, S.model.tracks.length, ...Tracks.STYLES[k].tracks()); Tracks.resize(S.model.tracks, 4, 4, S.model.beats, S.model.sub); renderSStyles(); sEd.render(); sSave(); sMeta(); sRefresh(); }; box.appendChild(b); }
  }
  function renderLib() {
    const box = $('lib'); box.innerHTML = '';
    for (const s of Engine.LIB) {
      const b = document.createElement('button'); b.className = 'snd'; b.innerHTML = `<span class="ic">▶</span><span>${s.name}<small>${s.sub}</small></span>`;
      b.onclick = () => { previewHit({ snd: s.id, people: 1, vol: 100 }, 2, 0, 1); b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 220); };
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
  $('sBpm').oninput = e => { S.bpm = +e.target.value; sMeta(); sSave(); sRefresh(); };
  $('sLoose').oninput = e => { S.loose = +e.target.value; sMeta(); sSave(); sRefresh(); };
  $('sRoom').onchange = e => { S.room = +e.target.value; sSave(); sRefresh(); };
  $('sCycles').oninput = e => { S.cycles = +e.target.value; sMeta(); sSave(); };
  $('sBeats').onchange = e => { const nb = +e.target.value; Tracks.resize(S.model.tracks, S.model.beats, S.model.sub, nb, S.model.sub); S.model.beats = nb; S.step = 0; sEd.render(); sSave(); sMeta(); sRefresh(); };
  $('sSub').onchange = e => { const ns = +e.target.value; Tracks.resize(S.model.tracks, S.model.beats, S.model.sub, S.model.beats, ns); S.model.sub = ns; S.step = 0; sEd.render(); sSave(); sMeta(); sRefresh(); };
  $('sAdd').onclick = () => sEd.addTrack();
  $('sClear').onclick = () => { S.model.tracks.forEach(t => t.cells.fill(0)); sEd.render(); sSave(); sRefresh(); };
  // الاستوديو: نجهّز ٨ دورات كملف ونكرره
  const sPlayer = $('splayer'); let sUrl = null, sKey = '', sRefreshT = null;
  const sCycleDur = () => S.model.beats * S.model.sub * sStep();
  async function sEnsure() {
    const k = JSON.stringify([S.model, S.bpm, S.loose, S.room, S.wet]); if (sUrl && k === sKey) return sUrl;
    const n = S.model.beats * S.model.sub, cyc = Math.max(2, Math.ceil(16 / sCycleDur())), len = cyc * sCycleDur();
    const oc = new OfflineAudioContext(2, Math.ceil(len * Engine.SR), Engine.SR); const ch = Engine.makeChain(oc, { room: S.room, wet: S.wet, clapGain: .9 });
    let t = 0.0; for (let k2 = 0; k2 < cyc; k2++) for (let i = 0; i < n; i++) { S.model.tracks.forEach((tr, ti) => { if (!tr.mute && tr.cells[i]) Engine.hit(tr, tr.cells[i], t + .001, oc, ch, ti, S.model.tracks.length, S.loose); }); t += sStep(); }
    const bytes = Engine.wav(await oc.startRendering(), .9);
    if (sUrl) URL.revokeObjectURL(sUrl); sUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); sKey = k; return sUrl;
  }
  function frameStudio() { if (!S.playing) return; const n = S.model.beats * S.model.sub; sEd.highlight(Math.floor((sPlayer.currentTime % sCycleDur()) / sStep()) % n); requestAnimationFrame(frameStudio); }
  function stopStudio() { if (!S.playing) return; S.playing = false; clearTimeout(sRefreshT); try { sPlayer.pause(); } catch (e) { } sEd.highlight(-1); $('sPlay').textContent = '▶ تشغيل الكل'; $('sPlay').classList.remove('on'); }
  function sRefresh() { if (!S.playing) return; clearTimeout(sRefreshT); sRefreshT = setTimeout(async () => { if (!S.playing) return; const p = sPlayer.currentTime % sCycleDur(); const u = await sEnsure(); if (!S.playing) return; sPlayer.src = u; sPlayer.currentTime = p; sPlayer.play().catch(() => { }); }, 600); }
  $('sPlay').onclick = async () => {
    if (S.playing) { stopStudio(); return; }
    $('sPlay').textContent = '⏳ جاري التجهيز…'; $('sPlay').disabled = true;
    try { sPlayer.src = await sEnsure(); sPlayer.loop = true; sPlayer.currentTime = 0; await sPlayer.play(); S.playing = true; requestAnimationFrame(frameStudio); $('sPlay').textContent = '■ إيقاف'; $('sPlay').classList.add('on'); }
    catch (e) { console.error(e); $('sPlay').textContent = '▶ تشغيل الكل'; toast('ما قدرت أشغّل الصوت'); }
    finally { $('sPlay').disabled = false; }
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
    const step = (name, f) => { try { return f(); } catch (e) { window.__showErr && __showErr(name + ': ' + (e.stack || e.message)); } };
    step('styles', renderStyles); step('clipEditor', () => clipEd.render()); step('studioStyles', renderSStyles); step('studioEditor', () => sEd.render()); step('studioMeta', sMeta);
    status($('clipStatus'), 'جاري تحميل أصوات الصفقات…');
    try { await Engine.loadBank(); } catch (e) { window.__showErr && __showErr('loadBank: ' + e.message); }
    try { soundCheck = await Engine.selfTest(); } catch (e) { soundCheck = { ok: false, sounds: 0, msg: 'selfTest: ' + e.message }; }
    status($('clipStatus'), soundCheck.ok ? '' : '⚠ ' + soundCheck.msg, soundCheck.ok ? '' : 'err');
    step('diag', updateDiag); step('lib', renderLib);
    window.__app = { C, S, loadSource, renderClip, rebuild };
  })();
})();
