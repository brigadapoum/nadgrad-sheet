// Чистая логика полей Надграда — без Foundry, чтобы проверять тестами.
import { LIFE_LEVELS, LIFE_TITLE } from "./data.mjs";

export const MODULE_ID = "nadgrad";

export const REP_RANKS = [1, 2, 3, 4, 5];
/** Максимум репутации на ранге: 6 / 8 / 10 / 12 / 14. */
export const repMax = (rank) => 4 + 2 * clampInt(rank, 1, 5);

export const TENSION_STEP = 9;      // 9 очков → +1 уровень, очки с нуля
export const TENSION_MAX_LEVEL = 4; // уровни 1–4 (0 — без напряжения)
export const TENSION_POINTS_MAX = TENSION_STEP - 1; // показатель 0–8

export function clampInt(v, lo, hi) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Добавить (или снять, если delta < 0) очки напряжения с переносом в уровень.
 * 0 уровень, 0 очков, +9 → 1 уровень, 0 очков; +10 → 1 уровень, 1 очко.
 * Снизу упирается в 0/0, сверху — в последний уровень с 8 очками.
 */
export function tensionAdd({ level = 0, points = 0 } = {}, delta = 0) {
  const top = TENSION_MAX_LEVEL * TENSION_STEP + TENSION_POINTS_MAX;
  const start = clampInt(level, 0, TENSION_MAX_LEVEL) * TENSION_STEP + clampInt(points, 0, TENSION_POINTS_MAX);
  const raw = start + Math.trunc(Number(delta) || 0);
  const total = Math.min(top, Math.max(0, raw));
  return {
    level: Math.floor(total / TENSION_STEP),
    points: total % TENSION_STEP,
    overflow: raw > top ? raw - top : 0, // сколько очков «упёрлось в потолок»
  };
}

/** Клик по ячейке шкалы: n — номер ячейки (1…max). Клик по последней заполненной снимает её. */
export function cellClick(current, n) {
  return current === n ? n - 1 : n;
}

/** Данные Надграда из флагов актёра, с безопасными значениями по умолчанию. */
export function readState(flags = {}) {
  const f = flags ?? {};
  const rank = clampInt(f.rep?.rank ?? 1, 1, 5);
  return {
    cheki: clampInt(f.cheki ?? 0, -999999, 999999),
    blocked: clampInt(f.blocked ?? 0, 0, 999999),
    rep: { rank, value: clampInt(f.rep?.value ?? 0, 0, repMax(rank)) },
    tension: {
      level: clampInt(f.tension?.level ?? 0, 0, TENSION_MAX_LEVEL),
      points: clampInt(f.tension?.points ?? 0, 0, TENSION_POINTS_MAX),
    },
    life: { level: f.life?.level ? clampInt(f.life.level, 1, 5) : null, note: String(f.life?.note ?? "") },
    dela: clampInt(f.dela ?? 0, 0, 999999),
  };
}

const cells = (count, filled) =>
  Array.from({ length: count }, (_, i) => ({ n: i + 1, on: i + 1 <= filled }));

/**
 * Всё, что нужно шаблону экрана «Статус».
 * actor: { flags, system, items } — в Foundry это Actor, на стенде — подставной объект.
 */
export function buildStatusContext(actor) {
  const s = readState(actor?.flags?.[MODULE_ID]);
  const max = repMax(s.rep.rank);
  const life = LIFE_LEVELS.map((l) => ({ ...l, active: l.id === s.life.level }));
  const items = Array.from(actor?.items ?? []);
  const dossier = items.find((i) => i.type === "dossier");
  const notes = dossier
    ? { source: "dossier", wrf: dossier.system?.wrf ?? "", html: dossier.system?.desc ?? "" }
    : { source: "angle", wrf: actor?.system?.angle?.for ?? "", html: actor?.system?.angle?.DETAILS ?? "" };
  notes.fromDossier = notes.source === "dossier";
  notes.empty = !String(notes.wrf).trim() && !String(notes.html).replace(/<[^>]*>/g, "").trim();
  return {
    ...s,
    repCells: cells(max, s.rep.value),
    repMax: max,
    repFull: s.rep.value >= max,
    repRanks: REP_RANKS.map((r) => ({ r, on: r === s.rep.rank })),
    tensionLevels: cells(TENSION_MAX_LEVEL, s.tension.level),
    tensionCells: cells(TENSION_POINTS_MAX, s.tension.points),
    tensionStep: TENSION_STEP,
    lifeLevels: life,
    lifeCurrent: life.find((l) => l.active) ?? null,
    lifeTitle: LIFE_TITLE,
    notes,
  };
}
