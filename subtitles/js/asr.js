// Распознавание речи с пословными таймкодами.
// Оба движка вызываются из браузера напрямую; ключ хранится только в localStorage.
//
// Для смешанной речи (армянский + русский + английский в одном ролике) язык
// НЕ фиксируем: и Scribe, и Whisper пишут каждое слово так, как оно звучит,
// только если им не навязать один язык.

import { decodeToMono16k, planChunks, chunkToWav } from './audio.js';

function fail(status, body, provider) {
  let hint = '';
  if (status === 401 || status === 403) hint = 'Проверьте API-ключ.';
  else if (status === 429) hint = 'Слишком много запросов или закончились кредиты на аккаунте.';
  else if (status === 413) hint = 'Файл слишком большой — уменьшите длину куска в настройках.';
  else if (status === 0) hint = 'Похоже, запрос заблокирован сетью или CORS. Укажите свой прокси-адрес в настройках.';
  throw new Error(`${provider}: ошибка ${status}. ${hint}\n${String(body).slice(0, 400)}`);
}

async function elevenlabs(blob, asr) {
  const fd = new FormData();
  fd.append('file', blob, 'audio.wav');
  fd.append('model_id', asr.elevenModel || 'scribe_v1');
  fd.append('timestamps_granularity', 'word');
  fd.append('diarize', 'false');
  if (asr.language) fd.append('language_code', asr.language);

  let res;
  try {
    res = await fetch(asr.endpointEleven, { method: 'POST', headers: { 'xi-api-key': asr.elevenKey }, body: fd });
  } catch (e) { fail(0, e.message, 'ElevenLabs'); }
  if (!res.ok) fail(res.status, await res.text(), 'ElevenLabs');

  const data = await res.json();
  const words = (data.words || [])
    .filter((w) => w.type === 'word' || w.type === undefined)
    .map((w) => ({ text: String(w.text || '').trim(), start: +w.start, end: +w.end }))
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end));
  return { words, text: data.text || '' };
}

async function openai(blob, asr) {
  const fd = new FormData();
  fd.append('file', blob, 'audio.wav');
  fd.append('model', asr.openaiModel || 'whisper-1');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  if (asr.language) fd.append('language', asr.language);
  if (asr.prompt) fd.append('prompt', asr.prompt);

  let res;
  try {
    res = await fetch(asr.endpointOpenai, {
      method: 'POST', headers: { Authorization: `Bearer ${asr.openaiKey}` }, body: fd,
    });
  } catch (e) { fail(0, e.message, 'OpenAI'); }
  if (!res.ok) fail(res.status, await res.text(), 'OpenAI');

  const data = await res.json();
  const words = (data.words || [])
    .map((w) => ({ text: String(w.word || w.text || '').trim(), start: +w.start, end: +w.end }))
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end));
  return { words, text: data.text || '' };
}

export async function transcribe(file, asr, onProgress = () => {}) {
  if (asr.provider === 'elevenlabs' && !asr.elevenKey) throw new Error('Не указан ключ ElevenLabs.');
  if (asr.provider === 'openai' && !asr.openaiKey) throw new Error('Не указан ключ OpenAI.');

  const { samples, sampleRate } = await decodeToMono16k(file, onProgress);
  const chunks = planChunks(samples, sampleRate, Math.max(30, asr.chunkSec || 600));

  const all = [];
  for (let i = 0; i < chunks.length; i++) {
    const base = 0.4 + 0.6 * (i / chunks.length);
    onProgress(`Распознаю${chunks.length > 1 ? ` часть ${i + 1} из ${chunks.length}` : ''}…`, base);
    const wav = chunkToWav(samples, sampleRate, chunks[i]);
    const out = asr.provider === 'openai' ? await openai(wav, asr) : await elevenlabs(wav, asr);
    for (const w of out.words) {
      all.push({ text: w.text, start: w.start + chunks[i].startSec, end: w.end + chunks[i].startSec });
    }
  }

  all.sort((a, b) => a.start - b.start);
  // Убираем нулевые и отрицательные длительности после склейки кусков
  for (let i = 0; i < all.length; i++) {
    if (all[i].end <= all[i].start) {
      const next = all[i + 1];
      all[i].end = Math.min(all[i].start + 0.28, next ? next.start : all[i].start + 0.28);
    }
  }
  onProgress('Готово', 1);
  return all;
}
