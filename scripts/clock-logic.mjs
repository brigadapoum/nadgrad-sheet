// Счётчики (часы) Надграда — чистая логика без Foundry, чтобы проверять тестами.
import { MODULE_ID, clampInt } from "./logic.mjs";

/** Тип актёра из module.json → documentTypes.Actor.clock */
export const CLOCK_TYPE = `${MODULE_ID}.clock`;
export const CLOCK_SIZES = [4, 6, 8, 10, 12];
export const CLOCK_THEMES = [
  { id: "tush", label: "Тушь" },
  { id: "smog", label: "Смог" },
];
export const CLOCK_FOLDER = "Счётчики";

/** Размер к ближайшему допустимому (мусор → 8). */
export function clockSize(v) {
  const n = Math.trunc(Number(v));
  return CLOCK_SIZES.includes(n) ? n : 8;
}

/** Данные счётчика с безопасными значениями. */
export function normClock(system = {}) {
  const s = system ?? {};
  const size = clockSize(s.size);
  return {
    size,
    value: clampInt(s.value ?? 0, 0, size),
    theme: s.theme === "smog" ? "smog" : "tush",
    note: String(s.note ?? ""),
  };
}

/** Картинка токена: art/clocks/<тема>/clock<размер>-<заполнено>.webp */
export function clockSrc(system) {
  const s = normClock(system);
  return `modules/${MODULE_ID}/art/clocks/${s.theme}/clock${s.size}-${s.value}.webp`;
}

/** Новое значение после ±delta (упирается в 0 и размер). */
export function clockStep(system, delta) {
  const s = normClock(system);
  return clampInt(s.value + Math.trunc(Number(delta) || 0), 0, s.size);
}

/**
 * Клик по сектору n (1…size). ЛКМ — заполнить до него, повторный клик по последнему
 * заполненному снимает его. ПКМ — снять один сектор.
 */
export function clockSegClick(system, n, button = 0) {
  const s = normClock(system);
  if (button === 2) return clampInt(s.value - 1, 0, s.size);
  const k = clampInt(n, 1, s.size);
  return s.value === k ? k - 1 : k;
}

/**
 * Что дописать в изменения актёра-счётчика перед сохранением:
 * значение под новый размер, картинка актёра и прототипа токена, имя прототипа.
 * current — текущие { name, img, system }, changes — развёрнутые изменения Foundry.
 * Возвращает объект с плоскими путями или null, если трогать нечего.
 */
export function clockUpdateExtras(current, changes = {}) {
  const touchesSystem = changes.system && typeof changes.system === "object";
  const touchesName = typeof changes.name === "string";
  if (!touchesSystem && !touchesName) return null;
  const merged = { ...(current.system ?? {}), ...(changes.system ?? {}) };
  const s = normClock(merged);
  const out = {};
  if (touchesSystem && Number(merged.value) !== s.value) out["system.value"] = s.value;
  const src = clockSrc(s);
  if (src !== current.img) out.img = src;
  out["prototypeToken.texture.src"] = src;
  if (touchesName) out["prototypeToken.name"] = changes.name;
  return out;
}

// ---- геометрия, как у артов (единицы картинки 256×256) ----
const C = 128, R_OUT = 107, R_IN = 65, GAP = 2;
const f = (x) => Number(x.toFixed(2));
const pt = (r, a) => `${f(C + r * Math.cos(a))} ${f(C + r * Math.sin(a))}`;

/** SVG-путь сектора i (0…n−1), первый шов сверху, по часовой стрелке. */
export function sectorPath(n, i) {
  const step = (2 * Math.PI) / n;
  const a0 = -Math.PI / 2 + i * step;
  const a1 = a0 + step;
  const dO = GAP / R_OUT, dI = GAP / R_IN;
  return `M ${pt(R_OUT, a0 + dO)} A ${R_OUT} ${R_OUT} 0 0 1 ${pt(R_OUT, a1 - dO)} ` +
    `L ${pt(R_IN, a1 - dI)} A ${R_IN} ${R_IN} 0 0 0 ${pt(R_IN, a0 + dI)} Z`;
}

/** Всё, что нужно шаблону окна счётчика. */
export function clockView(system) {
  const s = normClock(system);
  return {
    ...s,
    full: s.value >= s.size,
    segments: Array.from({ length: s.size }, (_, i) => ({ n: i + 1, d: sectorPath(s.size, i), on: i < s.value })),
    sizes: CLOCK_SIZES.map((n) => ({ n, on: n === s.size })),
    themes: CLOCK_THEMES.map((t) => ({ ...t, on: t.id === s.theme })),
  };
}
