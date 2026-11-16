// التحديثات: يتأكد من آخر إصدار على GitHub وينبّه المستخدم
'use strict';
(() => {
  const REPO = 'alyoushw/saffaq-alfirqa', ASSET = 'saffaq-alfirqa.apk';
  const DIRECT = `https://github.com/${REPO}/releases/latest/download/${ASSET}`;
  const $ = id => document.getElementById(id);
  const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
  const cur = window.APP_VERSION || { code: 0, name: '?' };
  const Cap = window.Capacitor, native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const Media = native ? Cap.registerPlugin('MediaTools') : null;
  let latest = null, snoozed = false, checking = false;

  $('verLbl').textContent = 'الإصدار ' + cur.name;

  async function check(manual) {
    if (checking) return; checking = true;
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const code = parseInt((j.tag_name || '').split('-c')[1] || '0', 10);
      const asset = (j.assets || []).find(a => a.name === ASSET);
      latest = { code, name: (j.name || j.tag_name || '').replace(/^v/, ''), notes: (j.body || '').trim(), url: asset ? asset.browser_download_url : DIRECT };
      if (code > cur.code) { if (!snoozed || manual) show(); }
      else if (manual) toast('عندك آخر إصدار (' + cur.name + ')');
    } catch (e) {
      if (manual) toast('ما قدرت أتحقق من التحديثات. تأكد من الإنترنت.');
    } finally { checking = false; }
  }
  function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); }
  function show() {
    $('updTitle').textContent = 'تحديث جديد: الإصدار ' + latest.name;
    $('updNotes').textContent = latest.notes ? latest.notes.split('\n').filter(l => l && !/^(Co-Authored-By|Claude-Session)/i.test(l)).slice(0, 6).join('\n') : '';
    $('updBar').hidden = false; $('updStatus').textContent = '';
  }
  $('updLater').onclick = () => { snoozed = true; $('updBar').hidden = true; };
  $('updNow').onclick = async () => {
    if (!latest) return;
    if (!native) { window.open(latest.url, '_blank'); return; }
    const st = $('updStatus'); st.textContent = 'جاري تنزيل التحديث…'; $('updNow').disabled = true;
    const h = await Media.addListener('updateProgress', e => { st.textContent = 'جاري تنزيل التحديث… ' + AR(Math.round(e.progress * 100)) + '٪'; });
    try { await Media.installUpdate({ url: latest.url }); st.textContent = 'اضغط "تثبيت" في الشاشة اللي طلعت.'; }
    catch (e) {
      if (e && e.code === 'NEED_PERMISSION') st.textContent = 'فعّل "السماح من هذا المصدر" في الشاشة اللي طلعت، ثم ارجع واضغط "حدّث الحين".';
      else { st.textContent = 'ما تم التنزيل داخل التطبيق، بفتح الرابط في المتصفح.'; window.open(latest.url, '_blank'); }
    } finally { $('updNow').disabled = false; h && h.remove && h.remove(); }
  };
  $('verBtn').onclick = () => check(true);

  // يتحقق عند الفتح، وكل ما رجعت للتطبيق (مرة كل ٣٠ دقيقة كحد أقصى)
  let last = 0;
  const maybe = () => { if (Date.now() - last > 30 * 60 * 1000) { last = Date.now(); check(false); } };
  setTimeout(maybe, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) maybe(); });
  window.Updater = { check, DIRECT };
})();
