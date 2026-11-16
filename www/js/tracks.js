// محرّر الأشخاص: لكل شخص صفقته ومتى يصفق
'use strict';
const Tracks = (() => {
  const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
  const pat = s => [...s].map(c => c === 'X' ? 2 : c === 'x' ? 1 : 0);
  const T = (name, snd, people, vol, s) => ({ name, snd, people, vol, mute: false, cells: pat(s) });

  // أنماط جاهزة (٤ ضربات × ٤ تقسيمات)
  const STYLES = {
    simple: { name: 'بسيط', desc: 'صفقة على كل ضربة', tracks: () => [
      T('الشخص ١', 'sharp', 6, 100, 'X...x...X...x...')] },
    calm: { name: 'هادئ روحاني', desc: 'عميقة وخفيفة', tracks: () => [
      T('الشخص ١', 'open', 3, 100, 'X.......X.......'),
      T('الشخص ٢', 'soft', 2, 80, '....x.......x...')] },
    mawlid: { name: 'مولد', desc: 'متوسط، مثل المثال', tracks: () => [
      T('الشخص ١', 'open', 4, 100, 'X..x....X..x....'),
      T('الشخص ٢', 'sharp', 4, 90, '....X.......X...'),
      T('الشخص ٣', 'soft', 2, 60, '......x.......x.')] },
    hamasi: { name: 'حماسي', desc: 'فرقة كاملة', tracks: () => [
      T('الشخص ١', 'open', 6, 100, 'X..x....X.xx....'),
      T('الشخص ٢', 'sharp', 6, 95, '....X..x....X...'),
      T('الشخص ٣', 'fingers', 2, 55, '.x.x.x.x.x.x.x.x'),
      T('الشخص ٤', 'chest', 1, 85, 'X.......X.......')] },
  };

  // صفقة تلقائية من المقطع: الثقيلة مكان الضربات المنخفضة، والحادة مكان الضربات الحادة
  function autoTracks(low, hi, perBar, sub, bpm, pulse) {
    const n = perBar * sub, AR2 = AR;
    if (!(pulse > 1.9)) {
      // صوت بدون إيقاع واضح: نختار حسب السرعة
      const k = bpm < 80 ? 'calm' : bpm < 125 ? 'mawlid' : 'hamasi';
      const tr = STYLES[k].tracks(); resize(tr, 4, 4, perBar, sub);
      return { tracks: tr, why: `المقطع ما فيه إيقاع واضح (صوت بس)، فثبّتت السرعة على ${AR2(Math.round(bpm))} ضربة/دقيقة واخترت شكل "${STYLES[k].name}" المناسب لها.` };
    }
    // وزن موسيقي: الضربة أولى، ثم نصف الضربة، ثم الباقي
    const w = i => { const s = i % sub; return s === 0 ? 1 : (sub % 2 === 0 && s === sub / 2) ? .85 : .7; };
    const peak = (pr, i) => pr[i] >= (pr[(i + n - 1) % n] || 0) && pr[i] >= (pr[(i + 1) % n] || 0);
    const pick = (pr, th, max, used) => pr.map((v, i) => ({ i, sc: v * w(i) })).filter(o => o.sc >= th && peak(pr, o.i) && !used.has(o.i)).sort((x, y) => y.sc - x.sc).slice(0, max);
    const open = new Array(n).fill(0), sharp = new Array(n).fill(0), soft = new Array(n).fill(0), used = new Set();
    open[0] = 2; used.add(0);
    // الحادة: على الضربات الضعيفة (الثانية والرابعة في الرباعي) — نحجزها قبل العميقة
    const back = perBar === 4 ? [1, 3] : perBar === 3 ? [1, 2] : perBar === 2 ? [1] : [];
    back.forEach(bt => { const i = bt * sub; sharp[i] = 2; used.add(i); });
    pick(low.prof, .5, perBar, used).forEach(o => { open[o.i] = o.sc >= .75 ? 2 : 1; used.add(o.i); });
    pick(hi.prof, .6, 2, used).forEach(o => { sharp[o.i] = 1; used.add(o.i); });
    const all = low.prof.map((v, i) => Math.max(v, hi.prof[i]));
    pick(all, .35, 2, used).filter(o => o.i % sub !== 0).forEach(o => { soft[o.i] = 1; used.add(o.i); });
    const fast = bpm >= 120;
    const tr = [
      { name: 'الشخص ١', snd: 'open', people: fast ? 5 : 4, vol: 100, mute: false, cells: open },
      { name: 'الشخص ٢', snd: 'sharp', people: fast ? 5 : 4, vol: 90, mute: false, cells: sharp }];
    if (soft.some(Boolean)) tr.push({ name: 'الشخص ٣', snd: 'soft', people: 2, vol: 60, mute: false, cells: soft });
    return { tracks: tr, why: 'بنيت الصفقة من إيقاع المقطع نفسه: العميقة مع الضربات الثقيلة، والحادة على الضربات الخفيفة، والمكتومة زخرفة بينها.' };
  }

  // تحويل نمط إلى عدد ضربات/تقسيمات مختلف
  function resize(tracks, oldB, oldS, newB, newS) {
    for (const t of tracks) {
      const c = new Array(newB * newS).fill(0);
      t.cells.forEach((v, i) => {
        if (!v) return; const beat = Math.floor(i / oldS), s = i % oldS;
        const j = (beat % newB) * newS + Math.round(s * newS / oldS);
        if (j < c.length && beat < newB) c[j] = Math.max(c[j], v);
      });
      if (!c.some(Boolean) && t.cells.some(Boolean)) c[0] = 2;
      t.cells = c;
    }
  }

  // واجهة المحرر
  function editor(root, model, hooks) {
    let cellsByStep = [];
    function render() {
      root.innerHTML = ''; cellsByStep = [];
      const n = model.beats * model.sub;
      model.tracks.forEach((t, ti) => {
        if (t.cells.length !== n) { const c = t.cells.slice(0, n); while (c.length < n) c.push(0); t.cells = c; }
        const el = document.createElement('div'); el.className = 'trk' + (t.mute ? ' muted' : '');
        const top = document.createElement('div'); top.className = 'top';
        const nm = document.createElement('input'); nm.className = 'nm'; nm.value = t.name; nm.setAttribute('aria-label', 'اسم الشخص');
        nm.oninput = () => { t.name = nm.value; hooks.change(); };
        const sel = document.createElement('select'); sel.setAttribute('aria-label', 'نوع الصفقة');
        for (const s of Engine.LIB) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; if (s.id === t.snd) o.selected = true; sel.appendChild(o); }
        sel.onchange = () => { t.snd = sel.value; hooks.change(); hooks.preview(t, ti); };
        const ppl = document.createElement('select'); ppl.setAttribute('aria-label', 'كم شخص');
        for (let k = 1; k <= 12; k++) { const o = document.createElement('option'); o.value = k; o.textContent = k === 1 ? 'شخص واحد' : `× ${AR(k)}`; if (k === t.people) o.selected = true; ppl.appendChild(o); }
        ppl.onchange = () => { t.people = +ppl.value; hooks.change(); };
        const vol = document.createElement('input'); vol.type = 'range'; vol.min = 0; vol.max = 130; vol.value = t.vol; vol.className = 'vol'; vol.setAttribute('aria-label', 'قوة الصوت');
        vol.oninput = () => { t.vol = +vol.value; hooks.change(); };
        const mute = document.createElement('button'); mute.className = 'ib'; mute.textContent = 'كتم'; mute.setAttribute('aria-pressed', t.mute);
        mute.onclick = () => { t.mute = !t.mute; hooks.change(); render(); };
        const del = document.createElement('button'); del.className = 'ib'; del.textContent = 'حذف';
        del.onclick = () => { model.tracks.splice(ti, 1); hooks.change(); render(); };
        top.append(nm, sel, ppl, vol, mute, del);
        const row = document.createElement('div'); row.className = 'steps';
        row.style.gridTemplateColumns = `repeat(${n},minmax(15px,1fr))`;
        t.cells.forEach((v, i) => {
          const c = document.createElement('button'); c.className = 'st' + ((i + 1) % model.sub === 0 && i < n - 1 ? ' b' : '') + (i % model.sub === 0 ? ' beat' : '');
          c.dataset.v = v; c.setAttribute('aria-label', `${t.name} خطوة ${i + 1}`);
          c.onclick = () => { const nv = (t.cells[i] + 1) % 3; t.cells[i] = nv; c.dataset.v = nv; hooks.change(); if (nv) hooks.preview(t, ti, nv); };
          row.appendChild(c); (cellsByStep[i] = cellsByStep[i] || []).push(c);
        });
        el.append(top, row); root.appendChild(el);
      });
      hooks.rendered && hooks.rendered();
    }
    let lit = -1;
    function highlight(step) {
      if (step === lit) return;
      (cellsByStep[lit] || []).forEach(e => e.classList.remove('now'));
      (cellsByStep[step] || []).forEach(e => e.classList.add('now')); lit = step;
    }
    function addTrack() {
      if (model.tracks.length >= 10) return;
      const used = new Set(model.tracks.map(t => t.snd)); const free = Engine.LIB.find(s => !used.has(s.id)) || Engine.LIB[0];
      model.tracks.push({ name: 'الشخص ' + AR(model.tracks.length + 1), snd: free.id, people: 1, vol: 90, mute: false, cells: new Array(model.beats * model.sub).fill(0) });
      hooks.change(); render();
    }
    return { render, highlight, addTrack };
  }

  return { STYLES, resize, editor, autoTracks, AR };
})();
window.Tracks = Tracks;
