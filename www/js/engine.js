// محرّك الصوت: مكتبة الصفقات، الأشخاص، الصدى، التصيير، ملفات WAV
'use strict';
const Engine = (() => {
  const SR = 44100;
  const LIB = [
    { id: 'open', name: 'مفتوحة عميقة', sub: 'كف مقعّر' },
    { id: 'sharp', name: 'حادة', sub: 'كف مسطّح' },
    { id: 'soft', name: 'مكتومة', sub: 'خفيفة للزخرفة' },
    { id: 'fingers', name: 'أصابع على الكف', sub: 'رفيعة وخفيفة' },
    { id: 'heavy', name: 'قوية ثقيلة', sub: 'بكل القوة' },
    { id: 'hall', name: 'في قاعة', sub: 'معها صدى طبيعي' },
    { id: 'gopen', name: 'جماعية عميقة', sub: 'مجموعة مع بعض' },
    { id: 'gsharp', name: 'جماعية حادة', sub: 'مجموعة مع بعض' },
    { id: 'thigh', name: 'ضربة على الفخذ', sub: 'إيقاع جسدي' },
    { id: 'chest', name: 'ضربة على الصدر', sub: 'عميقة جداً' },
  ];
  const bank = {};
  let ctx = null;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const gauss = () => { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); };
  // كل شخص له يد مختلفة
  const MAXP = 64;
  const profiles = [...Array(MAXP)].map(() => ({ rate: rnd(.94, 1.06), gain: rnd(.65, 1), pan: rnd(-.85, .85), off: gauss() * .8 }));

  function audio() {
    // نستخدم تردد الجوال نفسه: فرض تردد مختلف يطلع صوت صامت في بعض أجهزة أندرويد
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    if (ctx.state !== 'running') ctx.resume().catch(() => { });
    return ctx;
  }

  // تشغيل المحرّك والتأكد إنه يشتغل فعلاً
  async function ready() {
    const c = audio();
    if (c.state !== 'running') { try { await c.resume(); } catch (e) { } }
    // نبضة صامتة قصيرة تفتح مخرج الصوت في أندرويد
    const b = c.createBuffer(1, 256, c.sampleRate), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start();
    return c;
  }

  // قراءة WAV مباشرة بدون فك تشفير من الجوال
  function parseWav(u8) {
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let p = 12, ch = 1, rate = 44100, bits = 16, off = -1, len = 0;
    while (p + 8 <= u8.length) {
      const id = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]), sz = v.getUint32(p + 4, true);
      if (id === 'fmt ') { ch = v.getUint16(p + 10, true); rate = v.getUint32(p + 12, true); bits = v.getUint16(p + 22, true); }
      else if (id === 'data') { off = p + 8; len = Math.min(sz, u8.length - off); break; }
      p += 8 + sz + (sz & 1);
    }
    if (off < 0 || bits !== 16) throw new Error('bad wav');
    const frames = Math.floor(len / (2 * ch));
    const buf = new AudioBuffer({ length: Math.max(1, frames), sampleRate: rate, numberOfChannels: 1 });
    const out = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < ch; c++) s += v.getInt16(off + (i * ch + c) * 2, true); out[i] = s / ch / 32768; }
    return buf;
  }
  const b64u8 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  let bankError = '';
  async function loadBank(onProgress) {
    const src = window.SOUND_DATA || {}; const ids = Object.keys(src); let done = 0;
    if (!ids.length) { bankError = 'ملف الأصوات ما تحمّل'; throw new Error(bankError); }
    for (const id of ids) {
      bank[id] = src[id].map(b => { try { return parseWav(b64u8(b)); } catch (e) { bankError = e.message; return null; } }).filter(Boolean);
      onProgress && onProgress(++done / ids.length);
    }
  }
  // فحص ذاتي: نصيّر صفقة وحدة ونقيس إنها فعلاً تطلع صوت
  async function selfTest() {
    const n = Object.values(bank).reduce((a, x) => a + x.length, 0);
    if (!n) return { ok: false, sounds: 0, msg: 'أصوات الصفقة ما تحمّلت' + (bankError ? ' (' + bankError + ')' : '') };
    try {
      const oc = new OfflineAudioContext(2, SR, SR); const ch = makeChain(oc, { room: 0, wet: 0, clapGain: 1 });
      hit({ snd: 'open', people: 1, vol: 100 }, 2, .05, oc, ch, 0, 1, 0);
      const r = await oc.startRendering(); const d = r.getChannelData(0); let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
      return pk > .01 ? { ok: true, sounds: n, peak: pk } : { ok: false, sounds: n, msg: 'الصفقة طلعت صامتة في الفحص (' + pk.toFixed(4) + ')' };
    } catch (e) { return { ok: false, sounds: n, msg: 'خطأ في الفحص: ' + e.message }; }
  }

  function makeIR(c, sec) {
    sec = Math.max(sec, .05);
    const len = Math.floor(SR * sec), ir = c.createBuffer(2, len, SR);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch); let s = 0;
      for (let i = 0; i < len; i++) { const t = i / SR; s += .35 * ((Math.random() * 2 - 1) - s); d[i] = s * Math.exp(-t * 6.9 / sec) * (t < .006 ? t / .006 : 1); }
      for (let j = 0; j < 10; j++) { const i = Math.floor(SR * rnd(.004, .07)); if (i < len) d[i] += rnd(-.6, .6) * Math.exp(-i / SR * 20); }
    }
    return ir;
  }

  // سلسلة الصفقات: جاف + صدى → حجم الصفقات → الخرج
  function makeChain(c, opts, dest) {
    const bus = c.createGain(); bus.gain.value = opts.clapGain ?? 1;
    const dry = c.createGain(), cv = c.createConvolver(), wg = c.createGain();
    cv.buffer = makeIR(c, opts.room || .05);
    wg.gain.value = opts.room ? (opts.wet ?? 25) / 100 * 1.4 : 0;
    dry.connect(bus); cv.connect(wg).connect(bus); bus.connect(dest || c.destination);
    return { dry, cv, wg, bus, set(o) { if (o.room !== undefined) { cv.buffer = makeIR(c, o.room || .05); } wg.gain.value = (o.room ?? opts.room) ? (o.wet ?? opts.wet) / 100 * 1.4 : 0; Object.assign(opts, o); } };
  }

  // صفقة "شخص" في السطر (أو مجموعة أشخاص يسوون نفس الصفقة)
  function hit(track, vel, at, c, chain, ti, nTracks, loose) {
    const arr = bank[track.snd] || []; if (!arr.length) return;
    const n = Math.max(1, track.people | 0), L = (loose ?? 10) / 1000, norm = 1 / Math.pow(n, .55);
    const basePan = nTracks > 1 ? (ti / (nTracks - 1) - .5) * .9 : 0;
    for (let k = 0; k < n; k++) {
      const p = profiles[(ti * 7 + k * 3) % MAXP];
      const s = c.createBufferSource(); s.buffer = arr[Math.floor(Math.random() * arr.length)];
      s.playbackRate.value = (k === 0 ? 1 : p.rate) * rnd(.985, 1.015);
      const g = c.createGain();
      g.gain.value = ((track.vol ?? 100) / 100) * (vel === 2 ? 1 : .68) * (k === 0 ? 1 : p.gain) * rnd(.88, 1.05) * norm * (track.snd[0] === 'g' ? .8 : 1);
      const pan = c.createStereoPanner(); pan.pan.value = n === 1 ? basePan : Math.max(-1, Math.min(1, basePan * .5 + p.pan * .6));
      s.connect(g).connect(pan); pan.connect(chain.dry); pan.connect(chain.cv);
      const dt = gauss() * L * (k === 0 ? .3 : .5) + (k === 0 ? 0 : p.off * L * .6);
      s.start(Math.max(c.currentTime, at + Math.max(-L, Math.min(L, dt))));
    }
  }

  // ترميز WAV ستيريو 16 بت
  function wav(buf, normalizeTo) {
    const n = buf.length, chs = buf.numberOfChannels, ab = new ArrayBuffer(44 + n * chs * 2), v = new DataView(ab);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * chs * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, chs, true);
    v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * chs * 2, true); v.setUint16(32, chs * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * chs * 2, true);
    const d = [...Array(chs)].map((_, c) => buf.getChannelData(c));
    let pk = 0; for (const c of d) for (let i = 0; i < n; i++) { const a = Math.abs(c[i]); if (a > pk) pk = a; }
    const g = normalizeTo ? (pk > 0 ? normalizeTo / pk : 1) : (pk > .98 ? .98 / pk : 1);
    let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < chs; c++) { v.setInt16(o, Math.max(-1, Math.min(1, d[c][i] * g)) * 32767, true); o += 2; }
    return new Uint8Array(ab);
  }

  return { SR, LIB, bank, profiles, audio, ready, loadBank, selfTest, parseWav, makeChain, makeIR, hit, wav, rnd, gauss, ctx: () => ctx };
})();
window.Engine = Engine;
