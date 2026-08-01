// Работа с текстом: словарь автозамен, сборка слов в реплики, парсинг SRT/VTT.

const PUNCT_END = /[.!?…։]$/;      // ։ — армянская точка (verjaket)
const PUNCT_SOFT = /[,;:—–՝՜՞]$/;  // армянские знаки тоже учитываем

export function applyDictionary(words, dict) {
  if (!dict || !dict.length) return words;
  return words.map((w) => {
    let t = w.text;
    for (const rule of dict) {
      if (!rule.from) continue;
      try {
        if (rule.regex) {
          t = t.replace(new RegExp(rule.from, 'gi'), rule.to || '');
        } else if (t.toLocaleLowerCase() === rule.from.toLocaleLowerCase()) {
          t = rule.to || '';
        }
      } catch (e) { /* кривое регулярное выражение — пропускаем правило */ }
    }
    return { ...w, text: t };
  }).filter((w) => w.text.trim() !== '');
}

function stripPunct(t) {
  return t.replace(/[.,!?;:…«»"“”„()]/g, '').replace(/[։՝՜՞]/g, '').trim();
}

export function buildCues(words, seg) {
  const out = [];
  if (!words.length) return out;

  const src = words.map((w) => ({
    text: seg.keepPunct ? w.text : (stripPunct(w.text) || w.text),
    start: w.start, end: w.end,
  }));

  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    out.push(makeCue(cur, seg));
    cur = [];
  };

  const lineFits = (arr) => {
    // грубая проверка: помещается ли набор слов в maxLines строк по maxChars символов
    let lines = 1; let len = 0;
    for (const w of arr) {
      const add = (len ? 1 : 0) + w.text.length;
      if (len + add > seg.maxChars) { lines++; len = w.text.length; } else { len += add; }
    }
    return lines <= seg.maxLines;
  };

  for (let i = 0; i < src.length; i++) {
    const w = src[i];
    const prev = src[i - 1];
    const gap = prev ? w.start - prev.end : 0;

    if (cur.length) {
      const cand = cur.concat([w]);
      const dur = w.end - cur[0].start;
      const tooLong = dur > seg.maxDur || cand.length > seg.maxWords || !lineFits(cand);
      const bigPause = gap >= seg.gapSplit;
      const hardPunct = seg.splitOnPunct && prev && PUNCT_END.test(prev.text);
      const softPunct = seg.splitOnPunct && prev && PUNCT_SOFT.test(prev.text) && cand.length > seg.maxWords - 1;
      if (tooLong || bigPause || hardPunct || softPunct) flush();
    }
    cur.push(w);
  }
  flush();

  // Подтягиваем слишком короткие реплики к соседям и приводим тайминги в порядок
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const next = out[i + 1];
    if (c.end - c.start < seg.minDur) {
      const want = c.start + seg.minDur;
      c.end = next ? Math.min(want, next.start - 0.02) : want;
      if (c.end < c.start + 0.2) c.end = c.start + 0.2;
    }
    if (next && c.end > next.start) c.end = Math.max(c.start + 0.15, next.start - 0.02);
  }
  return out;
}

export function makeCue(wordArr, seg) {
  const start = Math.max(0, wordArr[0].start - (seg?.padStart || 0)) + (seg?.offset || 0);
  const end = wordArr[wordArr.length - 1].end + (seg?.padEnd || 0) + (seg?.offset || 0);
  return {
    start,
    end: Math.max(end, start + 0.15),
    words: wordArr.map((w) => ({
      text: w.text,
      start: w.start + (seg?.offset || 0),
      end: w.end + (seg?.offset || 0),
    })),
  };
}

// Пересобрать текст реплики из строки, сохранив тайминги (равномерно по словам).
export function retimeCueText(cue, newText) {
  const parts = newText.split(/\s+/).filter(Boolean);
  if (!parts.length) return cue;
  const total = cue.end - cue.start;
  const words = parts.map((t, i) => ({
    text: t,
    start: cue.start + (total * i) / parts.length,
    end: cue.start + (total * (i + 1)) / parts.length,
  }));
  // если количество слов не изменилось — сохраняем исходные тайминги
  if (parts.length === cue.words.length) {
    cue.words.forEach((w, i) => { w.text = parts[i]; });
    return cue;
  }
  cue.words = words;
  return cue;
}

export function cueText(cue) {
  return cue.words.map((w) => w.text).join(' ');
}

export function splitCue(cue, wordIndex) {
  if (wordIndex <= 0 || wordIndex >= cue.words.length) return null;
  const a = cue.words.slice(0, wordIndex);
  const b = cue.words.slice(wordIndex);
  const c1 = { start: cue.start, end: a[a.length - 1].end, words: a };
  const c2 = { start: b[0].start, end: cue.end, words: b };
  return [c1, c2];
}

export function mergeCues(a, b) {
  return { start: a.start, end: b.end, words: a.words.concat(b.words) };
}

// ---- Импорт готовых субтитров ----
function parseTime(str) {
  const m = str.trim().match(/(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
  const m2 = str.trim().match(/(\d{1,2}):(\d{2})[,.](\d{1,3})/);
  if (m2) return (+m2[1]) * 60 + (+m2[2]) + (+m2[3]) / 1000;
  return NaN;
}

export function parseSubtitleFile(content) {
  const cues = [];
  const blocks = content.replace(/\r/g, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() && !/^WEBVTT/i.test(l));
    const tl = lines.find((l) => l.includes('-->'));
    if (!tl) continue;
    const [a, b] = tl.split('-->');
    const start = parseTime(a); const end = parseTime(b);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const text = lines.slice(lines.indexOf(tl) + 1).join(' ').trim();
    if (!text) continue;
    const parts = text.split(/\s+/);
    const dur = end - start;
    cues.push({
      start, end,
      words: parts.map((t, i) => ({
        text: t,
        start: start + (dur * i) / parts.length,
        end: start + (dur * (i + 1)) / parts.length,
      })),
    });
  }
  return cues;
}
