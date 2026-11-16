// الملفات: حفظ ومشاركة على أندرويد، وتنزيل عادي في المتصفح
'use strict';
const IO = (() => {
  const Cap = window.Capacitor;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const FS = native ? Cap.Plugins.Filesystem : null;
  const Share = native ? Cap.Plugins.Share : null;
  const Media = native ? Cap.registerPlugin('MediaTools') : null;

  function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }

  // كتابة بيانات كبيرة على دفعات إلى مجلد الملفات المؤقتة
  async function writeCache(name, data, onProgress) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const CH = 3 * 1024 * 1024; let first = true;
    for (let o = 0; o < blob.size || first; o += CH) {
      const part = new Uint8Array(await blob.slice(o, o + CH).arrayBuffer());
      const args = { path: name, data: b64(part), directory: 'CACHE' };
      if (first) { await FS.writeFile(args); first = false; } else await FS.appendFile(args);
      onProgress && onProgress(Math.min(1, (o + CH) / Math.max(1, blob.size)));
      if (!blob.size) break;
    }
    return (await FS.getUri({ path: name, directory: 'CACHE' })).uri;
  }

  // حفظ ملف للمستخدم: في الجوال يحفظ في الموسيقى/الأفلام ويرجع مسار، وفي المتصفح ينزّله
  async function save(name, data, mime, onProgress) {
    if (!native) {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { uri: null, location: 'التنزيلات' };
    }
    const uri = await writeCache(name, data, onProgress);
    return await publish(uri, name, mime);
  }
  async function publish(uri, name, mime) {
    try { await FS.requestPermissions(); } catch (e) { }
    let location = null;
    try { location = (await Media.saveToPublic({ path: uri, name, mime })).location; } catch (e) { console.warn(e); }
    return { uri, location };
  }
  async function share(uri, title) {
    if (!native || !uri) return false;
    await Share.share({ title, files: [uri], dialogTitle: title }); return true;
  }
  async function mux(videoUri, wavUri, outName) {
    const out = (await FS.getUri({ path: outName, directory: 'CACHE' })).uri;
    await Media.mux({ video: videoUri, audio: wavUri, out });
    return out;
  }
  return { native, Media, writeCache, save, publish, share, mux };
})();
window.IO = IO;
