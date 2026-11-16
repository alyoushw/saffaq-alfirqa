package com.taqweemalzahra.saffaq;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import java.net.HttpURLConnection;
import java.net.URL;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;

/**
 * أدوات الوسائط: دمج صوت WAV مع فيديو، تحويل WAV إلى M4A، وحفظ الملفات في ذاكرة الجوال العامة.
 */
@CapacitorPlugin(name = "MediaTools")
public class MediaToolsPlugin extends Plugin {

    private static String stripScheme(String p) {
        if (p == null) return null;
        if (p.startsWith("file://")) p = p.substring(7);
        return Uri.decode(p);
    }

    @PluginMethod
    public void mux(PluginCall call) {
        final String video = stripScheme(call.getString("video"));
        final String audio = stripScheme(call.getString("audio"));
        final String out = stripScheme(call.getString("out"));
        if (audio == null || out == null) { call.reject("audio and out are required"); return; }
        new Thread(() -> {
            try {
                muxInternal(video, audio, out);
                JSObject r = new JSObject();
                r.put("path", out);
                r.put("uri", "file://" + out);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("mux failed: " + e.getMessage(), e);
            }
        }).start();
    }

    private static class Sample {
        byte[] data; long pts; int flags;
        Sample(byte[] d, long p, int f) { data = d; pts = p; flags = f; }
    }

    private void muxInternal(String videoPath, String wavPath, String outPath) throws Exception {
        // ١) ترميز الصوت إلى AAC
        RandomAccessFile wav = new RandomAccessFile(wavPath, "r");
        int[] fmt = new int[3]; // sampleRate, channels, bits
        long[] data = new long[2]; // offset, length
        readWavHeader(wav, fmt, data);
        int sampleRate = fmt[0], channels = fmt[1];
        if (fmt[2] != 16) throw new IOException("WAV must be 16-bit");

        MediaFormat aFmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels);
        aFmt.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        aFmt.setInteger(MediaFormat.KEY_BIT_RATE, 192000);
        aFmt.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);
        MediaCodec enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
        enc.configure(aFmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        enc.start();

        List<Sample> aSamples = new ArrayList<>();
        MediaFormat aOutFmt = null;
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        wav.seek(data[0]);
        long remaining = data[1], framesRead = 0;
        int frameBytes = 2 * channels;
        boolean inputDone = false, outputDone = false;
        byte[] chunk = new byte[8192];
        while (!outputDone) {
            if (!inputDone) {
                int inIdx = enc.dequeueInputBuffer(10000);
                if (inIdx >= 0) {
                    ByteBuffer inBuf = enc.getInputBuffer(inIdx);
                    inBuf.clear();
                    int toRead = (int) Math.min(Math.min(chunk.length, inBuf.remaining()), remaining);
                    toRead -= toRead % frameBytes;
                    long pts = framesRead * 1000000L / sampleRate;
                    if (toRead <= 0) {
                        enc.queueInputBuffer(inIdx, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                        inputDone = true;
                    } else {
                        wav.readFully(chunk, 0, toRead);
                        inBuf.put(chunk, 0, toRead);
                        enc.queueInputBuffer(inIdx, 0, toRead, pts, 0);
                        remaining -= toRead;
                        framesRead += toRead / frameBytes;
                    }
                }
            }
            int outIdx = enc.dequeueOutputBuffer(info, 10000);
            if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                aOutFmt = enc.getOutputFormat();
            } else if (outIdx >= 0) {
                ByteBuffer ob = enc.getOutputBuffer(outIdx);
                if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && info.size > 0) {
                    byte[] b = new byte[info.size];
                    ob.position(info.offset); ob.limit(info.offset + info.size); ob.get(b);
                    aSamples.add(new Sample(b, info.presentationTimeUs, info.flags));
                }
                enc.releaseOutputBuffer(outIdx, false);
                if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
            }
        }
        enc.stop(); enc.release(); wav.close();
        if (aOutFmt == null) throw new IOException("encoder produced no format");

        // ٢) الفيديو (اختياري) ثم الدمج
        MediaMuxer muxer = new MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        MediaExtractor vEx = null; int vTrackOut = -1;
        if (videoPath != null) {
            vEx = new MediaExtractor();
            vEx.setDataSource(videoPath);
            for (int i = 0; i < vEx.getTrackCount(); i++) {
                MediaFormat f = vEx.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("video/")) {
                    vEx.selectTrack(i);
                    vTrackOut = muxer.addTrack(f);
                    break;
                }
            }
            try {
                MediaMetadataRetriever mmr = new MediaMetadataRetriever();
                mmr.setDataSource(videoPath);
                String rot = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
                if (rot != null) muxer.setOrientationHint(Integer.parseInt(rot));
                mmr.release();
            } catch (Exception ignored) { }
        }
        int aTrackOut = muxer.addTrack(aOutFmt);
        muxer.start();

        long audioEndUs = aSamples.isEmpty() ? 0 : aSamples.get(aSamples.size() - 1).pts;
        if (vTrackOut >= 0) {
            ByteBuffer buf = ByteBuffer.allocate(8 * 1024 * 1024);
            MediaCodec.BufferInfo vi = new MediaCodec.BufferInfo();
            while (true) {
                int size = vEx.readSampleData(buf, 0);
                if (size < 0) break;
                long t = vEx.getSampleTime();
                if (t > audioEndUs + 100000) break;
                vi.offset = 0; vi.size = size; vi.presentationTimeUs = t;
                vi.flags = (vEx.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0 ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;
                muxer.writeSampleData(vTrackOut, buf, vi);
                vEx.advance();
            }
            vEx.release();
        }
        MediaCodec.BufferInfo ai = new MediaCodec.BufferInfo();
        for (Sample s : aSamples) {
            ByteBuffer b = ByteBuffer.wrap(s.data);
            ai.offset = 0; ai.size = s.data.length; ai.presentationTimeUs = s.pts; ai.flags = s.flags & ~MediaCodec.BUFFER_FLAG_END_OF_STREAM;
            muxer.writeSampleData(aTrackOut, b, ai);
        }
        muxer.stop(); muxer.release();
    }

    private static void readWavHeader(RandomAccessFile f, int[] fmt, long[] data) throws IOException {
        byte[] h = new byte[12]; f.readFully(h);
        if (h[0] != 'R' || h[1] != 'I' || h[8] != 'W') throw new IOException("not a WAV file");
        byte[] ch = new byte[8];
        while (f.getFilePointer() < f.length()) {
            f.readFully(ch);
            ByteBuffer bb = ByteBuffer.wrap(ch).order(ByteOrder.LITTLE_ENDIAN);
            String id = new String(ch, 0, 4, "US-ASCII");
            long len = bb.getInt(4) & 0xffffffffL;
            if (id.equals("fmt ")) {
                byte[] b = new byte[(int) len]; f.readFully(b);
                ByteBuffer fb = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN);
                fmt[1] = fb.getShort(2); fmt[0] = fb.getInt(4); fmt[2] = fb.getShort(14);
            } else if (id.equals("data")) {
                data[0] = f.getFilePointer(); data[1] = Math.min(len, f.length() - data[0]);
                return;
            } else {
                f.seek(f.getFilePointer() + len + (len & 1));
            }
        }
        throw new IOException("WAV has no data chunk");
    }

    /** حفظ ملف في ذاكرة الجوال العامة (موسيقى / أفلام / تنزيلات) داخل مجلد "صفاق الفرقة". */
    @PluginMethod
    public void saveToPublic(PluginCall call) {
        final String path = stripScheme(call.getString("path"));
        final String name = call.getString("name");
        final String mime = call.getString("mime", "application/octet-stream");
        new Thread(() -> {
            try {
                String folder = "صفاق الفرقة";
                boolean isVideo = mime.startsWith("video/");
                boolean isAudio = mime.startsWith("audio/");
                String location;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    String rel = (isVideo ? Environment.DIRECTORY_MOVIES : isAudio ? Environment.DIRECTORY_MUSIC : Environment.DIRECTORY_DOWNLOADS) + "/" + folder;
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, rel);
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri coll = isVideo ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                            : isAudio ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                            : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                    Uri uri = cr.insert(coll, v);
                    if (uri == null) throw new IOException("could not create file");
                    try (InputStream in = new FileInputStream(path); OutputStream os = cr.openOutputStream(uri)) { copy(in, os); }
                    v.clear(); v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    cr.update(uri, v, null, null);
                    location = rel;
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(
                            isVideo ? Environment.DIRECTORY_MOVIES : isAudio ? Environment.DIRECTORY_MUSIC : Environment.DIRECTORY_DOWNLOADS), folder);
                    if (!dir.exists() && !dir.mkdirs()) throw new IOException("could not create folder");
                    File dst = new File(dir, name);
                    try (InputStream in = new FileInputStream(path); OutputStream os = new FileOutputStream(dst)) { copy(in, os); }
                    location = dst.getAbsolutePath();
                }
                JSObject r = new JSObject(); r.put("location", location); call.resolve(r);
            } catch (Exception e) {
                call.reject("save failed: " + e.getMessage(), e);
            }
        }).start();
    }

    /** تنزيل نسخة جديدة من التطبيق وفتح شاشة التثبيت. */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        final String url = call.getString("url");
        if (url == null) { call.reject("url is required"); return; }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.reject("اسمح للتطبيق بتثبيت التحديثات ثم اضغط حدّث مرة ثانية", "NEED_PERMISSION");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists()) dir.mkdirs();
                File apk = new File(dir, "saffaq-update.apk");
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000); c.setReadTimeout(60000);
                int code = c.getResponseCode();
                // متابعة التحويل يدوياً إذا لزم
                for (int hops = 0; (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) && hops < 5; hops++) {
                    String loc = c.getHeaderField("Location"); c.disconnect();
                    c = (HttpURLConnection) new URL(loc).openConnection(); c.setConnectTimeout(20000); c.setReadTimeout(60000);
                    code = c.getResponseCode();
                }
                if (code != 200) throw new IOException("HTTP " + code);
                long total = c.getContentLengthLong(), got = 0; long lastEmit = 0;
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] b = new byte[65536]; int n;
                    while ((n = in.read(b)) > 0) {
                        out.write(b, 0, n); got += n;
                        long now = System.currentTimeMillis();
                        if (total > 0 && now - lastEmit > 250) { lastEmit = now; JSObject ev = new JSObject(); ev.put("progress", (double) got / total); notifyListeners("updateProgress", ev); }
                    }
                }
                c.disconnect();
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject("update failed: " + e.getMessage(), e);
            }
        }).start();
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] b = new byte[65536]; int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
    }
}
