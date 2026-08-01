// Экспорт: SRT, VTT, ASS (со стилем), JSON-проект.

import { cueText } from './text.js';

function pad(n, len = 2) { return String(Math.floor(n)).padStart(len, '0'); }

export function srtTime(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${pad(ms / 3600000)}:${pad((ms / 60000) % 60)}:${pad((ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}
export function vttTime(t) { return srtTime(t).replace(',', '.'); }
export function assTime(t) {
  const cs = Math.max(0, Math.round(t * 100));
  return `${Math.floor(cs / 360000)}:${pad((cs / 6000) % 60)}:${pad((cs / 100) % 60)}.${pad(cs % 100, 2)}`;
}

function textOf(cue, style, seg) {
  let t = cueText(cue);
  if (style.uppercase) t = t.toLocaleUpperCase('hy-AM');
  return wrapText(t, seg?.maxChars || 26, style.maxLines || 2);
}

// Перенос по словам, чтобы строки в файле совпадали с тем, что видно в превью.
export function wrapText(text, maxChars, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const cand = line ? `${line} ${w}` : w;
    if (line && cand.length > maxChars && lines.length < maxLines - 1) { lines.push(line); line = w; }
    else line = cand;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function toSRT(cues, style, seg) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${textOf(c, style, seg)}\n`).join('\n');
}

export function toVTT(cues, style, seg) {
  return `WEBVTT\n\n${cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${textOf(c, style, seg)}\n`).join('\n')}`;
}

// ASS-цвет: &HAABBGGRR, где AA — прозрачность (00 = непрозрачный).
function assColor(hex, opacityPercent = 100) {
  const h = String(hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = full.slice(0, 2).toUpperCase();
  const g = full.slice(2, 4).toUpperCase();
  const b = full.slice(4, 6).toUpperCase();
  const a = Math.round(255 - (Math.max(0, Math.min(100, opacityPercent)) / 100) * 255)
    .toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${b}${g}${r}`;
}

function firstFamily(css) {
  return String(css).split(',')[0].replace(/["']/g, '').trim();
}

export function toASS(cues, style, seg, W, H) {
  const px = (style.fontSize / 100) * H;
  const bold = style.fontWeight >= 600 ? -1 : 0;
  const borderStyle = style.bgMode === 'block' || style.bgMode === 'line' ? 3 : 1;
  const outline = borderStyle === 3
    ? Math.round((style.bgPadX / 100) * px * 0.5)
    : +(((style.outlineWidth / 100) * px) / 2).toFixed(1);
  const shadow = style.shadowOn ? +(((Math.abs(style.shadowY) + Math.abs(style.shadowX)) / 100) * px / 2).toFixed(1) : 0;
  const spacing = +((style.letterSpacing / 100) * px).toFixed(1);

  const anMap = { left: 4, center: 5, right: 6 };
  const an = anMap[style.align] || 5;
  const posX = style.align === 'left'
    ? Math.round(W / 2 + (style.offsetX / 100) * W - (style.maxWidth / 100) * W / 2)
    : style.align === 'right'
      ? Math.round(W / 2 + (style.offsetX / 100) * W + (style.maxWidth / 100) * W / 2)
      : Math.round(W / 2 + (style.offsetX / 100) * W);
  const posY = Math.round((style.posY / 100) * H);

  // При караоке ASS сам заливает слово из SecondaryColour в PrimaryColour.
  const karaokeOn = style.karaoke !== 'off';
  const primary = karaokeOn ? assColor(style.colorSpoken, style.colorOpacity) : assColor(style.color, style.colorOpacity);
  const secondary = assColor(style.color, style.colorOpacity);

  const head = `[Script Info]
; Создано редактором армянских субтитров
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: ${Math.round(W)}
PlayResY: ${Math.round(H)}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,${firstFamily(style.fontFamily)},${Math.round(px)},${primary},${secondary},${assColor(style.outlineColor, style.outlineOpacity)},${assColor(style.bgMode === 'none' ? style.shadowColor : style.bgColor, style.bgMode === 'none' ? style.shadowOpacity : style.bgOpacity)},${bold},${style.italic ? -1 : 0},0,0,100,100,${spacing},0,${borderStyle},${outline},${shadow},${an},20,20,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const body = cues.map((c) => {
    let text;
    if (karaokeOn) {
      text = c.words.map((w, i) => {
        const prevEnd = i === 0 ? c.start : c.words[i - 1].end;
        const lead = Math.max(0, Math.round((w.start - prevEnd) * 100));
        const dur = Math.max(1, Math.round((w.end - w.start) * 100));
        const t = style.uppercase ? w.text.toLocaleUpperCase('hy-AM') : w.text;
        return `${lead ? `{\\k${lead}}` : ''}{\\k${dur}}${t}`;
      }).join(' ');
    } else {
      text = (style.uppercase ? cueText(c).toLocaleUpperCase('hy-AM') : cueText(c));
    }
    const wrapped = wrapText(text, (seg?.maxChars || 26) * (karaokeOn ? 3 : 1), style.maxLines).replace(/\n/g, '\\N');
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Main,,0,0,0,,{\\an${an}\\pos(${posX},${posY})}${wrapped}`;
  }).join('\n');

  return `${head}${body}\n`;
}

export function toProjectJSON(state) {
  return JSON.stringify({
    version: 1,
    style: state.style,
    seg: state.seg,
    dict: state.dict,
    videoW: state.videoW,
    videoH: state.videoH,
    cues: state.cues.map((c) => ({ start: c.start, end: c.end, words: c.words })),
    words: state.words,
  }, null, 2);
}

export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  // BOM помогает плеерам и монтажкам не спутать кодировку армянского текста
  const blob = content instanceof Blob ? content : new Blob(['﻿', content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
