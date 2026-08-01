// Вшивание субтитров в видео прямо в браузере: рисуем кадр + субтитр на canvas,
// снимаем поток с canvas, звук берём через WebAudio и пишем через MediaRecorder.
// Запись идёт в реальном времени, поэтому ролик на 30 секунд экспортируется ~30 секунд.

import { drawCue, cueAt } from './renderer.js';

export function pickMime() {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

// К одному <video> можно подключить MediaElementSource только один раз за жизнь
// страницы, поэтому граф кешируем и не закрываем.
const graphs = new WeakMap();
function getAudioGraph(video) {
  if (graphs.has(video)) return graphs.get(video);
  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = new AC();
  const source = actx.createMediaElementSource(video);
  const dest = actx.createMediaStreamDestination();
  source.connect(dest);             // дорожка для записи
  source.connect(actx.destination); // и в колонки, чтобы слышать процесс
  const graph = { actx, source, dest };
  graphs.set(video, graph);
  return graph;
}

export function canBurn() {
  return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && pickMime());
}

export async function burnIn({ video, cues, style, width, height, fps = 30, bitrate = 12_000_000, onProgress }) {
  const mime = pickMime();
  if (!mime) throw new Error('Этот браузер не умеет записывать видео (MediaRecorder). Экспортируйте ASS/SRT и вшейте субтитры в монтажке.');

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');

  const { actx, dest } = getAudioGraph(video);
  const stream = canvas.captureStream(fps);
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const parts = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };

  const done = new Promise((resolve) => { rec.onstop = () => resolve(); });

  let raf = 0;
  const tick = () => {
    ctx.drawImage(video, 0, 0, width, height);
    const cue = cueAt(cues, video.currentTime);
    if (cue) drawCue(ctx, cue, video.currentTime, style, width, height);
    if (onProgress) onProgress(video.currentTime / (video.duration || 1));
    raf = requestAnimationFrame(tick);
  };

  video.pause();
  video.currentTime = 0;
  await new Promise((r) => {
    const h = () => { video.removeEventListener('seeked', h); r(); };
    video.addEventListener('seeked', h);
  });
  await actx.resume();

  const stop = () => {
    cancelAnimationFrame(raf);
    if (rec.state !== 'inactive') rec.stop();
    video.removeEventListener('ended', stop);
  };
  video.addEventListener('ended', stop);

  rec.start(250);
  tick();
  await video.play();
  await done;

  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(parts, { type: mime }), ext };
}
