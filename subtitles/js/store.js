// Хранилище состояния приложения: стиль, разбивка, распознанные слова, реплики.
// Всё, что меняется в интерфейсе, живёт здесь и сохраняется в localStorage.

const LS_KEY = 'hy-subs-v1';

export const FONTS = [
  { id: '"Noto Sans Armenian", "Noto Sans", sans-serif', name: 'Noto Sans Armenian' },
  { id: '"Noto Serif Armenian", serif', name: 'Noto Serif Armenian' },
  { id: '"DejaVu Sans", "Noto Sans Armenian", sans-serif', name: 'DejaVu Sans' },
  { id: '"Arial Armenian", Arial, "Noto Sans Armenian", sans-serif', name: 'Arial / системный' },
  { id: '"Sylfaen", "Noto Serif Armenian", serif', name: 'Sylfaen' },
  { id: 'CustomUploadedFont, "Noto Sans Armenian", sans-serif', name: 'Свой шрифт (загрузить файл)' },
];

export const DEFAULT_STYLE = {
  // Шрифт
  fontFamily: '"Noto Sans Armenian", "Noto Sans", sans-serif',
  fontSize: 6.4,          // % от высоты кадра
  fontWeight: 800,
  italic: false,
  uppercase: false,
  letterSpacing: 0,       // % от кегля
  wordSpacing: 0,         // % к ширине пробела
  lineHeight: 1.18,
  autoShrink: true,       // уменьшать кегль, если не влезает в maxLines

  // Цвет текста
  color: '#FFFFFF',
  colorOpacity: 100,
  colorSpoken: '#FFD54A', // цвет уже произнесённых слов (режим "караоке")
  colorActive: '#FFD54A', // цвет текущего слова

  // Обводка
  outlineWidth: 9,        // % от кегля
  outlineColor: '#000000',
  outlineOpacity: 100,

  // Тень
  shadowOn: true,
  shadowColor: '#000000',
  shadowOpacity: 55,
  shadowBlur: 22,         // % от кегля
  shadowX: 0,
  shadowY: 8,             // % от кегля

  // Плашка
  bgMode: 'none',         // none | block | line | word
  bgColor: '#000000',
  bgOpacity: 55,
  bgPadX: 40,             // % от кегля
  bgPadY: 22,
  bgRadius: 30,

  // Положение
  align: 'center',        // left | center | right
  posY: 76,               // % от высоты кадра — центр блока
  offsetX: 0,             // % от ширины кадра
  maxWidth: 84,           // % от ширины кадра
  maxLines: 2,

  // Анимация
  appear: 'pop',          // none | fade | pop | slideUp | typewriter
  appearMs: 220,
  popScale: 0.82,
  slidePx: 6,             // % от кегля
  karaoke: 'active',      // off | active | progressive
  activeScale: 108,       // % — увеличение текущего слова
  activeBox: false,
  activeBoxColor: '#FF3B6B',
  activeBoxOpacity: 100,
};

export const DEFAULT_SEG = {
  maxChars: 26,       // максимум символов в строке
  maxLines: 2,
  maxWords: 6,        // максимум слов в реплике
  maxDur: 3.2,        // максимальная длительность реплики, сек
  minDur: 0.7,        // минимальная длительность
  gapSplit: 0.45,     // пауза между словами, после которой начинается новая реплика
  splitOnPunct: true, // разрывать по . ! ? , : ;
  padStart: 0.06,     // расширение начала, сек
  padEnd: 0.14,       // расширение конца, сек
  offset: 0,          // общий сдвиг таймкодов, сек
  keepPunct: true,    // оставлять знаки препинания в тексте
};

export const DEFAULT_ASR = {
  provider: 'elevenlabs',      // elevenlabs | openai
  elevenKey: '',
  openaiKey: '',
  elevenModel: 'scribe_v1',
  openaiModel: 'whisper-1',
  language: '',                // '' = авто (нужно для смеси языков)
  prompt: '',                  // подсказка со словарём имён/терминов
  chunkSec: 600,
  endpointEleven: 'https://api.elevenlabs.io/v1/speech-to-text',
  endpointOpenai: 'https://api.openai.com/v1/audio/transcriptions',
};

export const state = {
  file: null,
  videoUrl: '',
  videoW: 1080,
  videoH: 1920,
  duration: 0,
  words: [],          // [{text, start, end}]
  cues: [],           // [{start, end, words:[...], text}]
  selected: -1,
  style: { ...DEFAULT_STYLE },
  seg: { ...DEFAULT_SEG },
  asr: { ...DEFAULT_ASR },
  dict: [],           // [{from, to, regex}] — авто-замены в тексте
  customFontName: '',
};

const listeners = new Set();
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what = 'all') { listeners.forEach((fn) => fn(what)); }

export function saveSettings() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      style: state.style, seg: state.seg, asr: state.asr, dict: state.dict,
    }));
  } catch (e) { /* приватный режим — просто не сохраняем */ }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.style) state.style = { ...DEFAULT_STYLE, ...data.style };
    if (data.seg) state.seg = { ...DEFAULT_SEG, ...data.seg };
    if (data.asr) state.asr = { ...DEFAULT_ASR, ...data.asr };
    if (Array.isArray(data.dict)) state.dict = data.dict;
  } catch (e) { /* повреждённые настройки игнорируем */ }
}

// ---- Пресеты стиля ----
const PRESET_KEY = 'hy-subs-presets-v1';

export function listPresets() {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); } catch (e) { return {}; }
}

export function savePreset(name, style) {
  const all = listPresets();
  all[name] = style;
  localStorage.setItem(PRESET_KEY, JSON.stringify(all));
}

export function deletePreset(name) {
  const all = listPresets();
  delete all[name];
  localStorage.setItem(PRESET_KEY, JSON.stringify(all));
}

// Готовые заготовки под сторис
export const BUILT_IN_PRESETS = {
  'Сторис — крупные жёлтые': {
    ...DEFAULT_STYLE, fontSize: 7.2, fontWeight: 900, uppercase: true,
    color: '#FFFFFF', colorActive: '#FFD54A', outlineWidth: 11, karaoke: 'active',
    appear: 'pop', posY: 74,
  },
  'Минимал — белый с тенью': {
    ...DEFAULT_STYLE, fontSize: 5.4, fontWeight: 600, outlineWidth: 0,
    shadowOn: true, shadowOpacity: 70, shadowBlur: 30, karaoke: 'off', appear: 'fade',
  },
  'Плашка — чёрный бокс': {
    ...DEFAULT_STYLE, fontSize: 5.2, fontWeight: 700, outlineWidth: 0, shadowOn: false,
    bgMode: 'line', bgOpacity: 72, bgRadius: 24, karaoke: 'off', appear: 'fade', posY: 80,
  },
  'Караоке — слово за словом': {
    ...DEFAULT_STYLE, fontSize: 6.8, fontWeight: 900, uppercase: true,
    karaoke: 'progressive', colorSpoken: '#22E0A1', colorActive: '#22E0A1',
    activeScale: 112, appear: 'none', maxLines: 3, outlineWidth: 12,
  },
  'Неон — розовый бокс': {
    ...DEFAULT_STYLE, fontSize: 6.6, fontWeight: 900, uppercase: true, outlineWidth: 8,
    karaoke: 'active', activeBox: true, activeBoxColor: '#FF3B6B', colorActive: '#FFFFFF',
    appear: 'slideUp',
  },
};
