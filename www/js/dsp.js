// تحليل الإيقاع: قوة البدايات، السرعة، تتبّع الضربات، بداية المازورة
'use strict';
const DSP = (() => {
  const AR_SR = 22050, NFFT = 1024, HOP = 256;

  function fft(re, im) { // in-place radix-2
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }

  // إعادة التشكيل لصوت أحادي 22050
  async function toMono22k(buffer) {
    const len = Math.ceil(buffer.duration * AR_SR);
    const oc = new OfflineAudioContext(1, len, AR_SR);
    const s = oc.createBufferSource(); s.buffer = buffer; s.connect(oc.destination); s.start();
    const r = await oc.startRendering(); return r.getChannelData(0);
  }

  // قوة البدايات (spectral flux على نطاقات لوغاريتمية) + طاقة الترددات المنخفضة
  function onsetEnvelope(x, onProgress) {
    const nFrames = Math.max(1, Math.floor((x.length - NFFT) / HOP) + 1);
    const win = new Float32Array(NFFT); for (let i = 0; i < NFFT; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NFFT);
    const nb = 64, edges = [];
    for (let b = 0; b <= nb; b++) edges.push(Math.min(NFFT / 2, Math.max(1, Math.round(Math.exp(Math.log(30) + (Math.log(8000) - Math.log(30)) * b / nb) / AR_SR * NFFT))));
    const lowHi = Math.round(250 / AR_SR * NFFT);
    const env = new Float32Array(nFrames), low = new Float32Array(nFrames), hi = new Float32Array(nFrames);
    const hiLo = Math.round(2000 / AR_SR * NFFT);
    let prev = new Float32Array(nb), cur = new Float32Array(nb);
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT); let gmax = -1e9;
    for (let f = 0; f < nFrames; f++) {
      const o = f * HOP;
      for (let i = 0; i < NFFT; i++) { re[i] = (x[o + i] || 0) * win[i]; im[i] = 0; }
      fft(re, im);
      let lowE = 0;
      for (let k = 1; k < lowHi; k++) lowE += re[k] * re[k] + im[k] * im[k];
      low[f] = lowE;
      let hiE = 0; for (let k = hiLo; k < NFFT / 2; k++) hiE += re[k] * re[k] + im[k] * im[k]; hi[f] = hiE;
      for (let b = 0; b < nb; b++) {
        let s = 0; const a = edges[b], z = Math.max(a + 1, edges[b + 1]);
        for (let k = a; k < z; k++) s += re[k] * re[k] + im[k] * im[k];
        cur[b] = 10 * Math.log10(1e-10 + s / (z - a));
      }
      let fl = 0; if (f > 0) for (let b = 0; b < nb; b++) { const d = Math.max(cur[b], gmax - 80) - Math.max(prev[b], gmax - 80); if (d > 0) fl += d; }
      for (let b = 0; b < nb; b++) if (cur[b] > gmax) gmax = cur[b];
      env[f] = fl; [prev, cur] = [cur, prev];
      if (onProgress && f % 2000 === 0) onProgress(f / nFrames);
    }
    // إزالة الاتجاه البطيء + تطبيع
    const w = Math.round(1.0 * AR_SR / HOP), out = new Float32Array(nFrames);
    let acc = 0; const cs = new Float64Array(nFrames + 1);
    for (let i = 0; i < nFrames; i++) cs[i + 1] = cs[i] + env[i];
    for (let i = 0; i < nFrames; i++) { const a = Math.max(0, i - w), b = Math.min(nFrames, i + w); out[i] = Math.max(0, env[i] - (cs[b] - cs[a]) / (b - a)); acc += out[i] * out[i]; }
    const sd = Math.sqrt(acc / nFrames) || 1; for (let i = 0; i < nFrames; i++) out[i] /= sd;
    return { env: out, low, hi, fps: AR_SR / HOP };
  }

  // السرعة: ارتباط ذاتي بمضاعفات الفترة مع تفضيل لوغاريتمي حول 120 ض/د
  function estimatePeriod(env, fps, lo = 55, hi = 200) {
    const n = env.length, maxL = Math.ceil(fps * 60 / lo) * 4 + 4, ac = new Float64Array(maxL);
    for (let L = 1; L < maxL && L < n; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += env[i] * env[i + L]; ac[L] = s / (n - L); }
    const at = x => { const i = Math.floor(x), f = x - i; return (ac[i] || 0) * (1 - f) + (ac[i + 1] || 0) * f; };
    let best = 0, bs = -Infinity;
    for (let bpm = lo; bpm <= hi; bpm += 0.05) {
      const L = 60 * fps / bpm;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120), 2));
      const sc = (at(L) + 0.5 * at(2 * L) + 0.33 * at(3 * L) + 0.25 * at(4 * L)) * prior;
      if (sc > bs) { bs = sc; best = L; }
    }
    return best;
  }

  // تتبّع الضربات بالبرمجة الديناميكية (Ellis 2007)
  function trackBeats(env, period, tightness = 120) {
    const n = env.length, P = period;
    const gw = Math.max(1, Math.round(P / 16)), local = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0, ws = 0; for (let k = -2 * gw; k <= 2 * gw; k++) { const j = i + k; if (j < 0 || j >= n) continue; const w = Math.exp(-0.5 * (k / gw) ** 2); s += env[j] * w; ws += w; } local[i] = s / ws; }
    const cum = new Float64Array(n), back = new Int32Array(n).fill(-1);
    const lo = Math.round(P / 2), hi = Math.round(P * 2);
    for (let i = 0; i < n; i++) {
      let best = -Infinity, bj = -1;
      for (let j = i - hi; j <= i - lo; j++) { if (j < 0) continue; const pen = -tightness * Math.pow(Math.log((i - j) / P), 2); const v = cum[j] + pen; if (v > best) { best = v; bj = j; } }
      cum[i] = local[i] + (bj >= 0 ? best : 0); back[i] = bj;
    }
    // آخر ضربة: أعلى قيمة قريبة من النهاية
    let end = n - 1, bv = -Infinity; for (let i = Math.max(0, n - Math.round(P * 1.5)); i < n; i++) if (cum[i] > bv) { bv = cum[i]; end = i; }
    const beats = []; for (let i = end; i >= 0; i = back[i]) { beats.push(i); if (back[i] < 0) break; }
    beats.reverse();
    // تحسين موضع كل ضربة لأقرب قمة محلية (±P/8)
    const r = Math.max(1, Math.round(P / 8));
    return beats.map(b => { let m = b, mv = local[b]; for (let k = -r; k <= r; k++) { const j = b + k; if (j >= 0 && j < n && local[j] > mv) { mv = local[j]; m = j; } } return m; });
  }

  // تمديد الشبكة لتغطي كامل المقطع
  function extendBeats(times, dur) {
    if (times.length < 2) return times;
    const ibi = median(times.slice(1).map((t, i) => t - times[i]));
    const out = times.slice();
    while (out[0] - ibi > 0.02) out.unshift(out[0] - ibi);
    while (out[out.length - 1] + ibi < dur - 0.02) out.push(out[out.length - 1] + ibi);
    return out;
  }
  const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

  function downbeatPhase(beatFrames, low, perBar) {
    let bp = 0, bs = -1;
    for (let p = 0; p < perBar; p++) { let s = 0, c = 0; for (let i = p; i < beatFrames.length; i += perBar) { const f = beatFrames[i]; let m = 0; for (let k = -1; k <= 3; k++) m = Math.max(m, low[f + k] || 0); s += m; c++; } if (c && s / c > bs) { bs = s / c; bp = p; } }
    return bp;
  }

  // ثبات الضربات: كلما قلّ التذبذب زادت الثقة
  function confidence(times, env, fps) {
    if (times.length < 4) return 0;
    const ib = times.slice(1).map((t, i) => t - times[i]), m = ib.reduce((a, b) => a + b, 0) / ib.length;
    const cv = Math.sqrt(ib.reduce((a, b) => a + (b - m) ** 2, 0) / ib.length) / m;
    let on = 0; for (const t of times) { const f = Math.round(t * fps); on += Math.max(env[f] || 0, env[f + 1] || 0, env[f - 1] || 0); }
    const strength = on / times.length;
    return Math.max(0, Math.min(1, (strength / 3) * (1 - Math.min(1, cv * 5))));
  }

  // محاذاة دقيقة: نحرّك شبكة الضربات كاملة لأقرب هجمات حادة (دقة 1.5 م.ث)
  function refineOffset(x, beats, sr = AR_SR) {
    const h = 32, n = Math.floor(x.length / h), e = new Float32Array(n);
    let hp = 0, px = 0; // مرشّح تمرير عالٍ بسيط لإبراز الهجمة
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < h; k++) { const v = x[i * h + k]; hp = 0.95 * (hp + v - px); px = v; s += hp * hp; } e[i] = Math.log1p(1e4 * s / h); }
    const d = new Float32Array(n); for (let i = 3; i < n; i++) d[i] = Math.max(0, e[i] - e[i - 3]);
    const W = Math.round(0.07 * sr / h), offs = [], ws = [];
    for (const t of beats) { const c = Math.round(t * sr / h); let bi = 0, bv = 0; for (let k = -W; k <= W; k++) { const v = d[c + k] || 0; if (v > bv) { bv = v; bi = k; } } if (bv > 0) { offs.push(bi * h / sr); ws.push(bv); } }
    if (offs.length < 4) return 0;
    // وسيط موزون
    const idx = offs.map((o, i) => i).sort((a, b) => offs[a] - offs[b]); const tot = ws.reduce((a, b) => a + b, 0); let acc = 0;
    for (const i of idx) { acc += ws[i]; if (acc >= tot / 2) return offs[i]; }
    return 0;
  }
  const LATENCY = -(NFFT / 2) / AR_SR; // زمن مركز النافذة

  // تدفّق الطاقة (للضربات الثقيلة والحادة)
  function flux(e) { const o = new Float32Array(e.length); for (let i = 1; i < e.length; i++) { const d = Math.log1p(e[i] * 1e3) - Math.log1p(e[i - 1] * 1e3); o[i] = d > 0 ? d : 0; } return o; }
  function smooth(env, w) { const n = env.length, o = new Float32Array(n); for (let i = 0; i < n; i++) { let m = 0; for (let k = -w; k <= w; k++) { const v = env[i + k] || 0; if (v > m) m = v; } o[i] = m; } return o; }

  // شبكة ثابتة: سرعة وحدة للمقطع كامل، نختار السرعة والبداية اللي تطابق أكثر ضربات
  function steadyGrid(env, fps, P) {
    const n = env.length, e = smooth(env, 1); let best = { s: -1, p: P, ph: 0 };
    for (let p = P * 0.97; p <= P * 1.03; p += P * 0.0008) {
      for (let ph = 0; ph < p; ph += 0.5) {
        let s = 0, c = 0; for (let t = ph; t < n - 1; t += p) { const i = t | 0, f = t - i; s += e[i] * (1 - f) + e[i + 1] * f; c++; }
        s /= c || 1; if (s > best.s) best = { s, p, ph };
      }
    }
    const out = []; for (let t = best.ph; t < n; t += best.p) out.push(t / fps);
    return { times: out, period: best.p };
  }
  // يتبع المنشد: ضربات التتبع بعد تنعيمها (انحدار خطي متحرك على ٩ ضربات)
  function smoothBeats(t) {
    if (t.length < 5) return t.slice();
    return t.map((_, i) => {
      const a = Math.max(0, i - 4), b = Math.min(t.length - 1, i + 4); let n = 0, sj = 0, st = 0, sjj = 0, sjt = 0;
      for (let j = a; j <= b; j++) { n++; sj += j; st += t[j]; sjj += j * j; sjt += j * t[j]; }
      const k = (n * sjt - sj * st) / (n * sjj - sj * sj), c = (st - k * sj) / n; return c + k * i;
    });
  }
  // نمط المقطع: متوسط قوة الضربات في كل خانة من المازورة
  function foldProfile(fl, fps, beats, phase, perBar, sub) {
    const slots = perBar * sub, acc = new Float64Array(slots), cnt = new Float64Array(slots), ibi = median(beats.slice(1).map((t, i) => t - beats[i])) || .5;
    for (let i = 0; i < beats.length; i++) {
      const bar = ((i - phase) % perBar + perBar) % perBar, nx = beats[i + 1] ?? beats[i] + ibi, d = nx - beats[i];
      for (let s = 0; s < sub; s++) {
        const c = beats[i] + d * s / sub, w = d / sub / 2; let m = 0;
        for (let f = Math.max(0, Math.round((c - w) * fps)); f <= Math.round((c + w) * fps) && f < fl.length; f++) if (fl[f] > m) m = fl[f];
        acc[bar * sub + s] += m; cnt[bar * sub + s]++;
      }
    }
    const prof = Array.from(acc, (v, i) => cnt[i] ? v / cnt[i] : 0), mx = Math.max(...prof, 1e-9), mean = prof.reduce((a, b) => a + b, 0) / slots;
    return { prof: prof.map(v => v / mx), contrast: mx / (mean || 1e-9) };
  }
  // ثلاثي ولا رباعي: أي تقسيم يعطي بداية مازورة أوضح
  function guessMeter(lowFl, fps, beats) {
    const at = beats.map(t => { const f = Math.round(t * fps); let m = 0; for (let k = -2; k <= 3; k++) m = Math.max(m, lowFl[f + k] || 0); return m; });
    const score = per => { let best = 0; for (let p = 0; p < per; p++) { let s = 0, c = 0, o = 0, oc = 0; at.forEach((v, i) => { if ((i - p) % per === 0) { s += v; c++; } else { o += v; oc++; } }); best = Math.max(best, (s / (c || 1)) / ((o / (oc || 1)) || 1e-9)); } return best; };
    const s3 = score(3), s4 = score(4);
    return s3 > s4 * 1.18 ? 3 : 4;
  }

  // قوة النبض: الضربات على الشبكة مقابل بين الضربات (عالية = فيه إيقاع، منخفضة = صوت بس)
  function pulseStrength(a, b, fps, beats) {
    let on = 0, off = 0, n = 0;
    for (let i = 0; i + 1 < beats.length; i++) {
      const f = Math.round(beats[i] * fps), m = Math.round((beats[i] + beats[i + 1]) / 2 * fps);
      const at = k => Math.max(a[k] || 0, a[k + 1] || 0, a[k - 1] || 0) + Math.max(b[k] || 0, b[k + 1] || 0, b[k - 1] || 0);
      const q = Math.round((beats[i] * 3 + beats[i + 1]) / 4 * fps);
      on += at(f); off += (at(q) + at(Math.round((beats[i] + 3 * beats[i + 1]) / 4 * fps))) / 2; n++;
    }
    return n ? on / (off || 1e-9) : 0;
  }
  // الطقّات: نلقط كل طقة (صفقة أو طق على طاولة) بمكانها وقوتها
  function attackEnv(x, sr = AR_SR) {
    const h = 32, n = Math.floor(x.length / h), e = new Float32Array(n); let hp = 0, px = 0;
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < h; k++) { const v = x[i * h + k]; hp = 0.95 * (hp + v - px); px = v; s += hp * hp; } e[i] = Math.log1p(1e4 * s / h); }
    const d = new Float32Array(n); for (let i = 3; i < n; i++) d[i] = Math.max(0, e[i] - e[i - 3]);
    return { d, rate: sr / h };
  }
  function detectTaps(a, sens = 50) {
    const n = a.hiFl.length, fl = new Float32Array(n);
    for (let i = 0; i < n; i++) fl[i] = a.hiFl[i] + 0.5 * a.lowFl[i];
    const srt = Array.from(fl).sort((x, y) => x - y), med = srt[Math.floor(n * .5)], top = srt[Math.floor(n * .985)] || 1;
    const th = med + (top - med) * (0.85 - sens / 100 * 0.7), gap = Math.round(0.09 * a.fps), W = 4;
    const taps = []; let last = -1e9;
    for (let i = W; i < n - W; i++) {
      if (fl[i] < th) continue; let mx = true; for (let k = -W; k <= W; k++) if (fl[i + k] > fl[i]) { mx = false; break; }
      if (!mx || i - last < gap) continue; last = i; taps.push({ f: i, v: fl[i] });
    }
    // مكان دقيق للطقة من الهجمة الحادة
    const A = a.att, W2 = Math.round(0.05 * A.rate), out = [];
    for (const tp of taps) {
      const t0 = tp.f / a.fps - LATENCY, c = Math.round(t0 * A.rate); let bi = c, bv = -1;
      for (let k = -W2; k <= Math.round(W2 * .6); k++) { const v = A.d[c + k] || 0; if (v > bv) { bv = v; bi = c + k; } }
      // قوة الطقة: أعلى قمة حادة (بعد إزالة الترددات المنخفضة للصوت) خلال ٣٠ م.ث
      const t = Math.max(0, bi / A.rate - 0.004), x = a.x, i0 = Math.floor(t * AR_SR); let pk = 0;
      for (let i = Math.max(1, i0); i < Math.min(x.length, i0 + Math.round(.03 * AR_SR)); i++) { const d = Math.abs(x[i] - x[i - 1]); if (d > pk) pk = d; }
      out.push({ t, v: pk });
    }
    const vs = out.map(o => o.v).sort((x, y) => x - y), ref = vs[Math.floor(vs.length * .9)] || 1;
    return out.map(o => ({ t: o.t, s: Math.min(1, o.v / ref) }));
  }
  async function analyze(buffer, onProgress) {
    const x = await toMono22k(buffer);
    const { env, low, hi, fps } = onsetEnvelope(x, p => onProgress && onProgress(0.1 + 0.55 * p));
    onProgress && onProgress(0.7);
    const P = estimatePeriod(env, fps);
    // يتبع المنشد
    const frames = trackBeats(env, P);
    let follow = frames.map(f => f / fps - LATENCY);
    const shift = Math.max(-0.04, Math.min(0.01, refineOffset(x, follow)));
    follow = extendBeats(smoothBeats(follow.map(t => t + shift)), buffer.duration);
    onProgress && onProgress(0.85);
    // ثابت
    const g = steadyGrid(env, fps, P);
    const steady = g.times.map(t => t - LATENCY + shift).filter(t => t >= 0 && t < buffer.duration);
    const lowFl = flux(low), hiFl = flux(hi);
    const meter = guessMeter(lowFl, fps, steady);
    // بداية المازورة: الطور اللي تكون فيه الضربة الثقيلة على أول المازورة أقوى
    const phaseOf = (b, per) => { let bp = 0, bv = -1; for (let ph = 0; ph < per; ph++) { const pr = foldProfile(lowFl, fps, b, ph, per, 4).prof; let o = 0; for (let k = 1; k < per; k++) o += pr[k * 4]; const v = pr[0] - o / Math.max(1, per - 1); if (v > bv) { bv = v; bp = ph; } } return bp; };
    onProgress && onProgress(1);
    return { beats: steady, steady, follow, bpm: 60 * fps / g.period, phase: phaseOf(steady, meter), meter, env, fps, low, lowFl, hiFl, phaseOf,
      att: attackEnv(x), x, conf: confidence(steady, env, fps), pulse: pulseStrength(lowFl, hiFl, fps, steady) };
  }

  // من نقرات المستخدم: سرعة ثابتة وبداية
  function fromTaps(taps, dur) {
    if (taps.length < 4) return null;
    const d = taps.slice(1).map((t, i) => t - taps[i]); let P = median(d);
    const n = taps.map(t => Math.round((t - taps[0]) / P));
    // انحدار خطي t = a + b n
    const N = n.length, sn = n.reduce((a, b) => a + b, 0), st = taps.reduce((a, b) => a + b, 0);
    const snn = n.reduce((a, b) => a + b * b, 0), snt = n.reduce((a, v, i) => a + v * taps[i], 0);
    const b = (N * snt - sn * st) / (N * snn - sn * sn), a = (st - b * sn) / N;
    const out = []; let t = a; while (t - b > 0) t -= b;
    for (; t < dur; t += b) out.push(t);
    return { beats: out, bpm: 60 / b };
  }

  // تغيير السرعة ×2 أو ÷2 مع الحفاظ على المواقع
  function doubleBeats(b) { const o = []; for (let i = 0; i < b.length - 1; i++) { o.push(b[i], (b[i] + b[i + 1]) / 2); } o.push(b[b.length - 1]); return o; }
  function halveBeats(b, offset = 0) { return b.filter((_, i) => i % 2 === offset); }

  return { analyze, detectTaps, foldProfile, steadyGrid, smoothBeats, refineOffset, fromTaps, doubleBeats, halveBeats, downbeatPhase, toMono22k, onsetEnvelope, estimatePeriod, trackBeats, median };
})();
if (typeof window !== 'undefined') window.DSP = DSP;
