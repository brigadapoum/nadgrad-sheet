// Чистая логика полей Надграда — без Foundry, чтобы проверять тестами.
import { LIFE_LEVELS, LIFE_TITLE } from "./data.mjs";

export const MODULE_ID = "nadgrad";

export const REP_RANKS = [0, 1, 2, 3, 4, 5]; // рискари стартуют с 0 ранга (автор, 2026-10-15)
/** Максимум репутации на ранге: 0 ранг — 6, каждый следующий +2 (автор, 2026-10-16): 6 / 8 / 10 / 12 / 14 / 16. */
export const repMax = (rank) => 6 + 2 * clampInt(rank, 0, 5);

export const TENSION_STEP = 9;      // 9 очков → +1 уровень, очки с нуля
export const TENSION_MAX_LEVEL = 4; // уровни 0–4, рискари стартуют с 0
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
  const rank = clampInt(f.rep?.rank ?? 0, 0, 5);
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
    tensionZero: s.tension.level === 0,
    tensionCells: cells(TENSION_POINTS_MAX, s.tension.points),
    tensionStep: TENSION_STEP,
    lifeLevels: life,
    lifeCurrent: life.find((l) => l.active) ?? null,
    lifeTitle: LIFE_TITLE,
    notes,
  };
}

// Загрузка снаряжения (лист 1.2): 0 — лёгкая (3), 1 — средняя (5), 2 — тяжёлая (7).
export const LOAD_LEVELS = [
  { key: "LOAD.LIGHT", max: 3 },
  { key: "LOAD.MEDIUM", max: 5 },
  { key: "LOAD.HEAVY", max: 7 },
];
/** Шаг загрузки по кругу: dir = +1 (тяжелее) или −1 (легче). «light» из 1.05 и мусор читаются как 0. */
export function loadStep(selected, dir = 1) {
  const cur = clampInt(parseInt(selected), 0, 2);
  const next = (((cur + (dir < 0 ? -1 : 1)) % 3) + 3) % 3;
  return { selected: next, ...LOAD_LEVELS[next] };
}
export const loadIndex = (selected) => clampInt(parseInt(selected), 0, 2);

/**
 * Сколько ячеек снаряжения занято на самом деле: сумма «веса» отмеченных предметов-снаряжения.
 * Лист 1.2 хранит загрузку отдельным счётчиком (system.GEAR.LOAD.value) и только прибавляет/вычитает
 * при клике — после перехода с 1.05 счётчик остался старым, а отметки сбросились. Считаем по предметам.
 */
export function gearLoad(items = []) {
  let total = 0;
  for (const it of items) {
    if (it?.type !== "gear") continue;
    if (isExtraLoad(it)) { total += Math.max(0, Math.trunc(Number(it.system.stack) || 0)); continue; }
    if (!it.system?.isUse) continue;
    total += Math.max(0, Math.trunc(Number(it.system.value) || 0));
  }
  return total;
}

/**
 * «Доп. нагрузка» (EXTRA LOAD): единственное снаряжение без веса, но со счётчиком (value 0, max 4).
 * В 1.05 каждое деление счётчика добавляло 1 к загрузке; в 1.2 счётчик к загрузке не подключён — подключаем.
 */
export function isExtraLoad(it) {
  return it?.type === "gear" && !Number(it.system?.value) && Number(it.system?.max) > 0;
}

/** Блокировка чеков под уровень жизни: + берёт чек из общего пула, − возвращает. */
export function blockStep({ cheki = 0, blocked = 0 } = {}, delta = 0) {
  const d = Math.trunc(Number(delta) || 0);
  if (d > 0) {
    const move = Math.min(d, Math.max(0, cheki));
    return { cheki: cheki - move, blocked: blocked + move, short: d - move };
  }
  const move = Math.min(-d, Math.max(0, blocked));
  return { cheki: cheki + move, blocked: blocked - move, short: 0 };
}

export const THEMES = ["tush", "smog"];

/**
 * Поля аугментаций в форме листа называются `ngAug.<id>.name` / `ngAug.<id>.desc`.
 * Вынуть их из данных формы (данные актёра остаются в data) и разложить по предметам.
 * Пустое имя не пишется — как в 1.05.
 */
export function splitAugFields(data = {}) {
  const items = {};
  const put = (id, field, value) => {
    if (field === "name") {
      const v = String(value ?? "").trim();
      if (!v) return;
      (items[id] ??= {}).name = v;
    } else if (field === "desc") {
      (items[id] ??= {})["system.desc"] = String(value ?? "");
    }
  };
  for (const key of Object.keys(data)) {
    const m = key.match(/^ngAug\.([^.]+)\.(name|desc)$/);
    if (m) { put(m[1], m[2], data[key]); delete data[key]; }
  }
  // если данные пришли развёрнутыми ({ ngAug: { id: { name } } })
  if (data.ngAug && typeof data.ngAug === "object") {
    for (const [id, f] of Object.entries(data.ngAug)) for (const [k, v] of Object.entries(f ?? {})) put(id, k, v);
    delete data.ngAug;
  }
  return items;
}
