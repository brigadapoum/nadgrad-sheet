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

// ---------- Отношения и силы мира ----------

/** Ранги сил на эскизе 2026-10-16: 0–4. Пустой ранг — «ранг ?». */
export const FORCE_RANKS = [0, 1, 2, 3, 4];
export const FORCE_GROUPS = ["Фракции", "Люди", "Места"];
export const REL_LIMIT = 99;

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Список сил мира (настройка мира) — с безопасными значениями, без пустых имён. */
export function normForces(list) {
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    const name = String(f?.name ?? "").trim();
    if (!name) continue;
    const r = f?.rank;
    out.push({
      id: String(f?.id || newId()),
      name,
      group: String(f?.group ?? "").trim(),
      rank: r === null || r === undefined || r === "" ? null : clampInt(r, FORCE_RANKS[0], FORCE_RANKS.at(-1)),
    });
  }
  return out;
}

/** Отношения рискаря из флагов: [{ id (id силы), name (имя на момент добавления), v, note }]. */
export function readRelations(flags = {}) {
  const out = [];
  for (const r of Array.isArray(flags?.relations) ? flags.relations : []) {
    if (!r?.id) continue;
    out.push({ id: String(r.id), name: String(r.name ?? ""), v: clampInt(r.v ?? 0, -REL_LIMIT, REL_LIMIT), note: String(r.note ?? "") });
  }
  return out;
}

const fmtRel = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");

/**
 * Экран «Отношения»: три группы (плюс / ноль / минус), внутри сильнее по модулю выше,
 * при равенстве — порядок добавления (как в ширме). Имя и ранг — из списка сил мастера.
 * options — выпадающий список: силы мастера по группам, уже добавленные выключены.
 */
export function relContext(relations, forces) {
  const byId = new Map(forces.map((f) => [f.id, f]));
  const all = relations.map((r, i) => {
    const f = byId.get(r.id);
    const sign = r.v > 0 ? "pos" : r.v < 0 ? "neg" : "zero";
    return {
      ...r, i, sign,
      label: f?.name ?? r.name ?? "?",
      rank: f ? f.rank : null,
      hasRank: !!f && f.rank !== null,
      missing: !f,
      vText: fmtRel(r.v),
    };
  });
  const by = (a, b) => Math.abs(b.v) - Math.abs(a.v) || a.i - b.i;
  const cols = [
    ["pos", "плюс"], ["zero", "ноль"], ["neg", "минус"],
  ].map(([key, label]) => {
    const items = all.filter((r) => r.sign === key).sort(by);
    return { key, label, items, count: items.length };
  });
  const have = new Set(relations.map((r) => r.id));
  const groups = new Map();
  for (const f of forces) {
    const g = f.group || "Без группы";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({
      id: f.id,
      label: `${f.name}${f.rank !== null ? ` · ранг ${f.rank}` : ""}${have.has(f.id) ? " (уже есть)" : ""}`,
      disabled: have.has(f.id),
    });
  }
  const options = [...groups].map(([group, items]) => ({ group, items }));
  return { cols, count: all.length, options, noForces: forces.length === 0, allAdded: forces.length > 0 && forces.every((f) => have.has(f.id)) };
}

// ---------- Долгосрочные проекты ----------

export const PROJECT_SIZES = [4, 6, 8, 10, 12];
export const projSize = (v) => (PROJECT_SIZES.includes(Math.trunc(Number(v))) ? Math.trunc(Number(v)) : 8);

/** Проекты рискаря из флагов: [{ id, name, size, value, note }]. */
export function readProjects(flags = {}) {
  const out = [];
  for (const p of Array.isArray(flags?.projects) ? flags.projects : []) {
    if (!p?.id) continue;
    const size = projSize(p.size);
    out.push({ id: String(p.id), name: String(p.name ?? ""), size, value: clampInt(p.value ?? 0, 0, size), note: String(p.note ?? "") });
  }
  return out;
}

/** Картинка часов проекта — те же арты, что у счётчиков на столе. */
export const projSrc = (p, theme) =>
  `modules/${MODULE_ID}/art/clocks/${theme === "smog" ? "smog" : "tush"}/clock${projSize(p.size)}-${clampInt(p.value, 0, projSize(p.size))}.webp`;

export function projContext(projects, theme, draft = null) {
  return {
    items: projects.map((p) => ({ ...p, src: projSrc(p, theme), full: p.value >= p.size })),
    count: projects.length,
    draft: draft ? { ...draft, sizes: PROJECT_SIZES.map((s) => ({ s, on: s === projSize(draft.size) })) } : null,
  };
}

/**
 * Поля списков в форме листа: `<prefix>.<id>.<field>` → { id: { field: value } }.
 * Найденные ключи удаляются из data (чтобы не ушли в актёра).
 */
export function splitListFields(data = {}, prefix) {
  const out = {};
  const re = new RegExp(`^${prefix}\\.([^.]+)\\.([A-Za-z]+)$`);
  for (const key of Object.keys(data)) {
    const m = key.match(re);
    if (m) { (out[m[1]] ??= {})[m[2]] = data[key]; delete data[key]; }
  }
  if (data[prefix] && typeof data[prefix] === "object") {
    for (const [id, f] of Object.entries(data[prefix])) Object.assign((out[id] ??= {}), f);
    delete data[prefix];
  }
  return out;
}
