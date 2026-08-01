// Отрисовка субтитра на canvas. Один и тот же код используется и для превью,
// и для вшивания в видео — то, что видно на экране, попадает в файл 1-в-1.

export function hexToRgba(hex, opacityPercent = 100) {
  const h = String(hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(100, opacityPercent)) / 100})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); return; }
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function fontString(style, px) {
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${px}px ${style.fontFamily}`;
}

function setFont(ctx, style, px) {
  ctx.font = fontString(style, px);
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${(style.letterSpacing / 100) * px}px`;
  }
}

function wordText(style, t) {
  return style.uppercase ? t.toLocaleUpperCase('hy-AM') : t;
}

// Раскладка: разбиваем слова по строкам с учётом максимальной ширины.
function layout(ctx, cue, style, W, H) {
  let px = (style.fontSize / 100) * H;
  const maxW = (style.maxWidth / 100) * W;
  let lines = [];

  for (let attempt = 0; attempt < 14; attempt++) {
    setFont(ctx, style, px);
    const spaceW = ctx.measureText(' ').width * (1 + style.wordSpacing / 100);
    lines = [];
    let line = { words: [], width: 0 };
    for (const w of cue.words) {
      const t = wordText(style, w.text);
      const ww = ctx.measureText(t).width;
      const add = line.words.length ? spaceW + ww : ww;
      if (line.words.length && line.width + add > maxW) {
        lines.push(line);
        line = { words: [], width: 0 };
        line.words.push({ ...w, disp: t, w: ww });
        line.width = ww;
      } else {
        line.words.push({ ...w, disp: t, w: ww });
        line.width += add;
      }
    }
    if (line.words.length) lines.push(line);
    if (!style.autoShrink || lines.length <= style.maxLines || px < H * 0.012) break;
    px *= 0.94;
  }

  const lineH = px * style.lineHeight;
  const spaceW = ctx.measureText(' ').width * (1 + style.wordSpacing / 100);
  return { lines, px, lineH, spaceW, blockH: lines.length * lineH };
}

function activeIndex(cue, time) {
  let idx = -1;
  for (let i = 0; i < cue.words.length; i++) {
    if (time >= cue.words[i].start) idx = i;
    else break;
  }
  return idx;
}

/**
 * Рисует одну реплику.
 * @param {CanvasRenderingContext2D} ctx контекст размером W×H
 * @param {object} cue реплика {start,end,words}
 * @param {number} time текущее время видео, сек
 */
export function drawCue(ctx, cue, time, style, W, H) {
  if (!cue || !cue.words.length) return;

  const L = layout(ctx, cue, style, W, H);
  const { lines, px, lineH } = L;

  // --- Анимация появления ---
  const t = time - cue.start;
  const dur = Math.max(1, style.appearMs) / 1000;
  const p = Math.max(0, Math.min(1, t / dur));
  const ease = 1 - Math.pow(1 - p, 3);
  let alpha = 1; let scale = 1; let dy = 0;
  if (style.appear === 'fade') alpha = ease;
  else if (style.appear === 'pop') { alpha = ease; scale = style.popScale + (1 - style.popScale) * ease; }
  else if (style.appear === 'slideUp') { alpha = ease; dy = (1 - ease) * (style.slidePx / 100) * px * 6; }

  const centerY = (style.posY / 100) * H;
  const centerX = W / 2 + (style.offsetX / 100) * W;
  const top = centerY - L.blockH / 2 + dy;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (scale !== 1) {
    ctx.translate(centerX, centerY);
    ctx.scale(scale, scale);
    ctx.translate(-centerX, -centerY);
  }
  setFont(ctx, style, px);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const padX = (style.bgPadX / 100) * px;
  const padY = (style.bgPadY / 100) * px;
  const radius = (style.bgRadius / 100) * px;
  const maxLineW = Math.max(...lines.map((l) => l.width), 0);

  const lineX = (line) => {
    if (style.align === 'left') return centerX - (style.maxWidth / 100) * W / 2;
    if (style.align === 'right') return centerX + (style.maxWidth / 100) * W / 2 - line.width;
    return centerX - line.width / 2;
  };

  // --- Плашка ---
  if (style.bgMode === 'block') {
    const x = style.align === 'left' ? centerX - (style.maxWidth / 100) * W / 2
      : style.align === 'right' ? centerX + (style.maxWidth / 100) * W / 2 - maxLineW
        : centerX - maxLineW / 2;
    ctx.fillStyle = hexToRgba(style.bgColor, style.bgOpacity);
    roundRect(ctx, x - padX, top - padY, maxLineW + padX * 2, L.blockH + padY * 2, radius);
    ctx.fill();
  } else if (style.bgMode === 'line') {
    ctx.fillStyle = hexToRgba(style.bgColor, style.bgOpacity);
    lines.forEach((line, i) => {
      const x = lineX(line);
      roundRect(ctx, x - padX, top + i * lineH + lineH * 0.04, line.width + padX * 2, lineH * 0.92 + padY, radius);
      ctx.fill();
    });
  }

  const ai = style.karaoke === 'off' ? -1 : activeIndex(cue, time);
  let globalIdx = 0;

  const drawPass = (pass) => {
    globalIdx = 0;
    lines.forEach((line, li) => {
      let x = lineX(line);
      const baseline = top + li * lineH + lineH * 0.5 + px * 0.35;
      for (const w of line.words) {
        const idx = globalIdx++;
        const isActive = idx === ai;
        const isSpoken = ai >= 0 && idx <= ai;

        // Пословное появление (печатная машинка)
        if (style.appear === 'typewriter' && time < w.start) { x += w.w + L.spaceW; continue; }

        let fill = hexToRgba(style.color, style.colorOpacity);
        if (style.karaoke === 'progressive' && isSpoken) fill = hexToRgba(style.colorSpoken, style.colorOpacity);
        if (isActive && style.karaoke !== 'off') fill = hexToRgba(style.colorActive, style.colorOpacity);

        const grow = isActive && style.karaoke !== 'off' ? style.activeScale / 100 : 1;

        ctx.save();
        if (grow !== 1) {
          const cxw = x + w.w / 2;
          ctx.translate(cxw, baseline);
          ctx.scale(grow, grow);
          ctx.translate(-cxw, -baseline);
        }

        if (pass === 'bg') {
          if (style.bgMode === 'word') {
            ctx.fillStyle = hexToRgba(style.bgColor, style.bgOpacity);
            roundRect(ctx, x - padX * 0.5, baseline - px * 0.86, w.w + padX, px * 1.16 + padY * 0.5, radius);
            ctx.fill();
          }
          if (isActive && style.activeBox) {
            ctx.fillStyle = hexToRgba(style.activeBoxColor, style.activeBoxOpacity);
            roundRect(ctx, x - padX * 0.5, baseline - px * 0.86, w.w + padX, px * 1.16 + padY * 0.5, radius);
            ctx.fill();
          }
        } else {
          if (style.shadowOn) {
            ctx.shadowColor = hexToRgba(style.shadowColor, style.shadowOpacity);
            ctx.shadowBlur = (style.shadowBlur / 100) * px;
            ctx.shadowOffsetX = (style.shadowX / 100) * px;
            ctx.shadowOffsetY = (style.shadowY / 100) * px;
          } else {
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
          }
          if (style.outlineWidth > 0) {
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.miterLimit = 2;
            ctx.strokeStyle = hexToRgba(style.outlineColor, style.outlineOpacity);
            ctx.lineWidth = (style.outlineWidth / 100) * px;
            ctx.strokeText(w.disp, x, baseline);
          }
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
          ctx.fillStyle = fill;
          ctx.fillText(w.disp, x, baseline);
        }
        ctx.restore();
        x += w.w + L.spaceW;
      }
    });
  };

  drawPass('bg');
  drawPass('text');
  ctx.restore();
}

export function cueAt(cues, time) {
  for (const c of cues) if (time >= c.start && time <= c.end) return c;
  return null;
}
