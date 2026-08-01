// Извлечение звука из видео прямо в браузере: декодируем дорожку, сводим в моно 16 кГц
// и упаковываем в WAV — так файл для распознавания весит в десятки раз меньше исходного видео.

const TARGET_SR = 16000;

export async function decodeToMono16k(file, onProgress = () => {}) {
  onProgress('Читаю файл…', 0.05);
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  onProgress('Декодирую звуковую дорожку…', 0.15);

  let decoded;
  try {
    decoded = await ctx.decodeAudioData(buf.slice(0));
  } catch (e) {
    ctx.close();
    throw new Error(
      'Браузер не смог декодировать звук из этого файла. ' +
      'Попробуйте MP4/MOV с обычным AAC-звуком или загрузите отдельный аудиофайл (m4a, mp3, wav).'
    );
  }

  onProgress('Привожу к моно 16 кГц…', 0.35);
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SR));
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(1, frames, TARGET_SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const samples = rendered.getChannelData(0);
  const duration = decoded.duration;
  ctx.close();
  return { samples: Float32Array.from(samples), sampleRate: TARGET_SR, duration };
}

export function encodeWav(samples, sampleRate) {
  const len = samples.length;
  const buffer = new ArrayBuffer(44 + len * 2);
  const view = new DataView(buffer);
  const wr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

  wr(0, 'RIFF');
  view.setUint32(4, 36 + len * 2, true);
  wr(8, 'WAVE');
  wr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);         // PCM
  view.setUint16(22, 1, true);         // моно
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  wr(36, 'data');
  view.setUint32(40, len * 2, true);

  let off = 44;
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// Делим длинную дорожку на куски, стараясь резать по тишине, чтобы не рвать слово.
export function planChunks(samples, sampleRate, maxSec) {
  const total = samples.length / sampleRate;
  if (total <= maxSec) return [{ startSample: 0, endSample: samples.length, startSec: 0 }];

  const chunks = [];
  const maxLen = Math.floor(maxSec * sampleRate);
  const searchWin = Math.floor(8 * sampleRate);   // ищем тишину в ±8 сек от границы
  const frame = Math.floor(0.25 * sampleRate);

  let pos = 0;
  while (pos < samples.length) {
    let end = pos + maxLen;
    if (end >= samples.length) { end = samples.length; }
    else {
      let best = end; let bestEnergy = Infinity;
      const from = Math.max(pos + Math.floor(maxLen * 0.5), end - searchWin);
      const to = Math.min(samples.length - frame, end + searchWin);
      for (let s = from; s < to; s += frame) {
        let sum = 0;
        for (let i = s; i < s + frame; i++) sum += samples[i] * samples[i];
        const energy = sum / frame;
        if (energy < bestEnergy) { bestEnergy = energy; best = s + Math.floor(frame / 2); }
      }
      end = best;
    }
    chunks.push({ startSample: pos, endSample: end, startSec: pos / sampleRate });
    pos = end;
  }
  return chunks;
}

export function chunkToWav(samples, sampleRate, chunk) {
  return encodeWav(samples.subarray(chunk.startSample, chunk.endSample), sampleRate);
}
