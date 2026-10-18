// Передышка: чистая логика (без Foundry). Правила — документ автора «Правила Надграда» 0.9 (раздел «Фаза передышки»).
// Решения автора 2026-10-18: игрок проходит передышку сам, до сессии, мастер не участвует;
// броски — родные (подход + навык с листа) или по рангу; модуль бросает и показывает исход по таблице,
// значения меняет «Применить» после окна «было → станет»; любое изменение ресурсов — через окно подтверждения.
import { clampInt, tensionAdd } from "./logic.mjs";

export const FREE_ACTIONS = 2;
export const BUY_CHEKI = 5;          // +1 действие за 5 чеков
export const BUY_TENSION = 2;        // … или за +2 напряжения
export const BONUS_CHEKI = 5;        // +1 к результату за 5 чеков
export const DOC_RANK_DEFAULT = 2;   // ранг дока по умолчанию (автор, 2026-10-18)
export const HEAL_CLOCK = 4;         // часы лечения повреждения 2 уровня
export const LOG_KEEP = 5;           // сколько прошлых передышек хранить в архиве

/** Уровни результата: 1–3, 4–5, 6, 6×6. Внутри — число 1…7, где 7 = 6×6. */
export const TIERS = [
  { id: "fail", label: "1–3", title: "Провал" },
  { id: "part", label: "4–5", title: "Частичный" },
  { id: "good", label: "6", title: "Успех" },
  { id: "crit", label: "6×6", title: "Крит" },
];
export const tierIndex = (v) => (v >= 7 ? 3 : v === 6 ? 2 : v >= 4 ? 1 : 0);

/** Результат броска: лучший куб (у пула 0 — худший из двух), две шестёрки = 7; +1 за чеки — шаг вверх, не выше 7. */
export function rollValue(dice = [], { lowest = false, bonus = 0 } = {}) {
  const d = dice.map((x) => clampInt(x, 1, 6));
  if (!d.length) return 1;
  const base = lowest ? Math.min(...d) : d.filter((x) => x === 6).length >= 2 ? 7 : Math.max(...d);
  return Math.min(7, base + Math.max(0, Math.trunc(bonus) || 0));
}
export const valueText = (v) => (v >= 7 ? "6×6" : String(v));

/** Пул: 0 кубов — бросаем 2 и берём худший (как в системе). Больше 6 не бывает. */
export const poolOf = (n) => {
  const k = clampInt(n, 0, 6);
  return k === 0 ? { count: 2, lowest: true } : { count: k, lowest: false };
};

/** Места экстренной помощи (лечение 3 уровня): формула цены в чеках. */
export const CLINICS = [
  { id: "c1", label: "Цепь-1", formula: "2d6", note: "+ ответная услуга" },
  { id: "c2", label: "Цепь-2", formula: "12+1d6" },
  { id: "mag", label: "Магистрали", formula: "12+2d6" },
  { id: "udel", label: "Удел или Маслопустоши", formula: "18+1d6" },
  { id: "pan", label: "Панорамбург", formula: "30+2d6" },
];

/**
 * Действия передышки. roll: "skill" — подход + навык с листа, "rank" — ранг рискаря, "doc" — ранг дока, null — без броска.
 * table: значения для 1–3 / 4–5 / 6 / 6×6. free: не тратит действие.
 */
export const ACTIONS = [
  { id: "tension", label: "Снизить напряжение", roll: "skill", table: [0, -2, -3, -5], hint: "навык → −напряжение", ask: "Что делаешь, чтобы залечь на дно" },
  { id: "passion", label: "Предаться страсти", roll: "skill", table: null, hint: "навык → −стресс (по кубу)", ask: "Какой страсти предаёшься" },
  { id: "project", label: "Долгосрочный проект", roll: "skill", table: [1, 2, 3, 5], hint: "навык → часы проекта" },
  { id: "negclock", label: "Против негативного счётчика", roll: "skill", table: [1, -2, -3, -5], hint: "навык → часы на столе", ask: "Как заметаешь следы" },
  { id: "resource", label: "Приобретение ресурса", roll: "rank", table: [-1, 0, 1, 2], hint: "ранг рискаря → качество", ask: "Что ищешь" },
  { id: "craft", label: "Изготовление / модификация", roll: "skill", table: [-1, 0, 1, 2], hint: "навык → качество", ask: "Что делаешь" },
  { id: "heal2", label: "Лечение 2 уровня", roll: "doc", table: [1, 3, 4, 5], hint: "ранг дока → часы на 4" },
  { id: "record", label: "Моды · переезд", roll: null, table: null, hint: "без броска, запись", ask: "Что сделал (установка мода, переезд…)" },
  { id: "heal3", label: "Лечение 3 уровня", roll: null, table: null, hint: "не тратит действие", free: true },
];
export const actionById = (id) => ACTIONS.find((a) => a.id === id) ?? null;

const fmt = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const tensionText = (t) => `ур. ${t.level} · ${t.points}`;

/** Состояние передышки из флагов: бюджет, журнал, часы лечения, архив. */
export function readDowntime(flags = {}) {
  const d = flags?.downtime ?? {};
  const log = Array.isArray(d.log) ? d.log.filter((e) => e && e.id) : [];
  return {
    free: FREE_ACTIONS,
    bought: clampInt(d.bought ?? 0, 0, 99),
    log,
    heal: { first: clampInt(d.heal?.first ?? 0, 0, HEAL_CLOCK), second: clampInt(d.heal?.second ?? 0, 0, HEAL_CLOCK) },
    archive: Array.isArray(d.archive) ? d.archive.slice(-LOG_KEEP) : [],
  };
}

/** Сколько действий потрачено: все записи журнала, которые тратят действие (не «покупка», не лечение 3 уровня). */
export const usedActions = (log) => log.filter((e) => e.spends).length;
export function budget(dt) {
  const total = dt.free + dt.bought;
  const used = usedActions(dt.log);
  return { total, used, left: Math.max(0, total - used), bought: dt.bought, cells: Array.from({ length: Math.max(total, used) }, (_, i) => ({ used: i < used, bought: i >= dt.free })) };
}

/** Новая передышка: журнал — в архив (последние LOG_KEEP), снова 2 бесплатных. Часы лечения остаются. */
export function newDowntime(dt, at) {
  const archive = dt.log.length ? [...dt.archive, { at, log: dt.log }].slice(-LOG_KEEP) : dt.archive;
  return { bought: 0, log: [], heal: dt.heal, archive };
}

/** Исход записи по таблице: { tier, value, amount, text }. */
export function outcome(entry) {
  const a = actionById(entry.kind);
  const value = rollValue(entry.dice, { lowest: entry.lowest, bonus: entry.bonus });
  const tier = tierIndex(value);
  if (!a) return { value, tier, amount: 0, text: "" };
  if (a.id === "passion") {
    const amount = Math.min(6, value);
    return { value, tier, amount, text: `−${amount} стресса` };
  }
  const amount = a.table ? a.table[tier] : 0;
  if (a.id === "tension") return { value, tier, amount, text: amount ? `${fmt(amount)} напряжения` : "напряжение не снижается" };
  if (a.id === "project" || a.id === "heal2") return { value, tier, amount, text: `часы ${fmt(amount)}` };
  if (a.id === "negclock") return { value, tier, amount, text: `счётчик ${fmt(amount)}` };
  if (a.id === "resource" || a.id === "craft") {
    const q = Math.max(0, clampInt(entry.rank ?? 0, 0, 6) + amount + clampInt(entry.qualityBought ?? 0, 0, 99));
    return { value, tier, amount, quality: q, text: `ранг качества ${q}` };
  }
  return { value, tier, amount, text: "" };
}

/**
 * Что изменит «Применить»: строки для окна «было → станет» и данные для update.
 * state: { cheki, tension, stress: { value, max }, projects, heal, harm, clocks } — снимок актёра.
 * Возвращает { lines: [{ label, from, to }], actor: {…}, projects?, clock?: { id, value }, extra?, warn? } или null.
 */
export function applyPlan(entry, state, opts = {}) {
  const a = actionById(entry.kind);
  if (!a || entry.status !== "pending") return null;
  const o = outcome(entry);
  const plan = { lines: [], actor: {}, text: o.text };
  if (a.id === "tension") {
    const t = tensionAdd(state.tension, o.amount);
    plan.lines.push({ label: "Напряжение", from: tensionText(state.tension), to: tensionText(t) });
    plan.actor["flags.nadgrad.tension"] = { level: t.level, points: t.points };
  } else if (a.id === "passion") {
    const cur = clampInt(state.stress?.value ?? 0, 0, 99);
    const to = Math.max(0, cur - o.amount);
    plan.lines.push({ label: "Стресс", from: String(cur), to: String(to) });
    plan.actor["system.stress.value"] = to;
    plan.overindulge = o.amount > cur; // стирать больше, чем есть, — отрыв: предложить +1 напряжение
    if (plan.overindulge) {
      const t = tensionAdd(state.tension, 1);
      plan.extra = { label: "Отрыв: рискарь поддаётся страстям — +1 напряжение", from: tensionText(state.tension), to: tensionText(t), key: "flags.nadgrad.tension", value: { level: t.level, points: t.points }, checked: true };
    }
  } else if (a.id === "project") {
    const list = state.projects ?? [];
    const p = list.find((x) => x.id === entry.target);
    if (!p) return { ...plan, warn: "Проект не найден — выбери другой или поправь вкладку «Проекты» руками." };
    const v = clampInt(p.value + o.amount, 0, p.size);
    plan.lines.push({ label: `Проект «${p.name}»`, from: `${p.value} / ${p.size}`, to: `${v} / ${p.size}` });
    plan.projects = list.map((x) => (x.id === p.id ? { ...x, value: v } : x));
    plan.actor["flags.nadgrad.projects"] = plan.projects;
    plan.done = v >= p.size && p.value < p.size;
  } else if (a.id === "negclock") {
    const c = (state.clocks ?? []).find((x) => x.id === entry.target);
    if (!c) return { ...plan, warn: "Счётчик не найден или его меняет только мастер — передай результат мастеру." };
    const v = clampInt(c.value + o.amount, 0, c.size);
    plan.lines.push({ label: `Счётчик «${c.name}»`, from: `${c.value} / ${c.size}`, to: `${v} / ${c.size}` });
    plan.clock = { id: c.id, value: v };
  } else if (a.id === "heal2") {
    const slot = entry.target === "second" ? "second" : "first";
    const cur = clampInt(state.heal?.[slot] ?? 0, 0, HEAL_CLOCK);
    const v = Math.min(HEAL_CLOCK, cur + o.amount);
    const name = state.harm?.medium?.[slot] || (slot === "first" ? "первое" : "второе");
    plan.lines.push({ label: `Лечение «${name}»`, from: `${cur} / ${HEAL_CLOCK}`, to: `${v} / ${HEAL_CLOCK}` });
    plan.heal = { [slot]: v };
    if (v >= HEAL_CLOCK) {
      // вылечено: стереть повреждение с листа и обнулить часы
      plan.lines.push({ label: "Повреждение 2 уровня", from: name, to: "вылечено" });
      plan.actor[`system.HARM.medium.${slot}.name`] = "";
      plan.heal = { [slot]: 0 };
    }
  } else if (a.id === "resource" || a.id === "craft") {
    plan.lines.push({ label: a.id === "resource" ? "Ресурс" : "Изделие", from: entry.note || "—", to: `ранг качества ${o.quality}` });
    if (a.id === "resource" && entry.contraband) {
      const t = tensionAdd(state.tension, 1);
      plan.lines.push({ label: "Контрабанда / обход ЛКС: напряжение", from: tensionText(state.tension), to: tensionText(t) });
      plan.actor["flags.nadgrad.tension"] = { level: t.level, points: t.points };
    }
  }
  return plan;
}

/** Лечение 3 уровня: цена выпала — списать чеки и перенести повреждение во свободную ячейку 2 уровня. */
export function heal3Plan(state, price) {
  const hard = state.harm?.hard || "";
  if (!hard) return { warn: "На листе нет повреждения 3 уровня." };
  const slot = !state.harm?.medium?.first ? "first" : !state.harm?.medium?.second ? "second" : null;
  if (!slot) return { warn: "Обе ячейки 2 уровня заняты — повреждение 3 уровня некуда перевести. Освободи ячейку на листе." };
  const cost = Math.max(0, Math.trunc(Number(price) || 0));
  const to = state.cheki - cost;
  return {
    lines: [
      { label: "Чеки", from: String(state.cheki), to: String(to) },
      { label: "Повреждение", from: `3 уровень: ${hard}`, to: `2 уровень (${slot === "first" ? "первая" : "вторая"} ячейка)` },
    ],
    actor: {
      "flags.nadgrad.cheki": to,
      "system.HARM.hard.name": "",
      [`system.HARM.medium.${slot}.name`]: hard,
    },
    heal: { [slot]: 0 },
    slot,
    short: to < 0,
  };
}

/** Покупки: что списать. kind: "cheki" | "tension" | "flash" (флешбек — и то и другое) | "bonus" | "quality". */
export function buyPlan(kind, state, { qualityCost = 6 } = {}) {
  const lines = [];
  const actor = {};
  let cheki = 0;
  let tension = 0;
  if (kind === "cheki") cheki = BUY_CHEKI;
  else if (kind === "tension") tension = BUY_TENSION;
  else if (kind === "flash") { cheki = BUY_CHEKI; tension = BUY_TENSION; }
  else if (kind === "bonus") cheki = BONUS_CHEKI;
  else if (kind === "quality") cheki = qualityCost;
  else return null;
  if (cheki) {
    lines.push({ label: "Чеки", from: String(state.cheki), to: String(state.cheki - cheki) });
    actor["flags.nadgrad.cheki"] = state.cheki - cheki;
  }
  if (tension) {
    const t = tensionAdd(state.tension, tension);
    lines.push({ label: "Напряжение", from: tensionText(state.tension), to: tensionText(t) });
    actor["flags.nadgrad.tension"] = { level: t.level, points: t.points };
    if (t.overflow) lines.push({ label: "Напряжение упёрлось в максимум", from: "", to: `лишних: ${t.overflow}` });
  }
  return { lines, actor, short: state.cheki - cheki < 0 && cheki > 0 };
}

/** Запись о покупке в журнале (действие не тратит). */
export const buyEntry = ({ id, note, at = 0 }) => ({ id, kind: "buy", note, at, dice: [], bonus: 0, spends: false, status: "info" });

/** Новая запись журнала после броска (или записи без броска). */
export function newEntry({ id, kind, dice = [], lowest = false, pool = 0, poolText = "", note = "", target = null, rank = 0, contraband = false, at = 0 }) {
  const a = actionById(kind);
  return {
    id, kind, dice, lowest, pool, poolText, note, target, rank, contraband, at,
    bonus: 0, qualityBought: 0,
    spends: !!a && !a.free,
    status: !a || a.roll === null ? "info" : "pending",
  };
}

/** Строка журнала для экрана и чата. */
export function entryLine(entry, names = {}) {
  const a = actionById(entry.kind);
  const label = a?.label ?? entry.kind;
  if (entry.kind === "buy") return `Куплено действие · ${entry.note}`;
  if (entry.kind === "heal3") return `${label} · ${entry.note}`;
  if (!a?.roll) return `${label}${entry.note ? ` · ${entry.note}` : ""}`;
  const o = outcome(entry);
  const tgt = entry.target && names[entry.target] ? ` · ${names[entry.target]}` : "";
  return `${label}${tgt} · ${valueText(o.value)}${entry.bonus ? ` (+${entry.bonus})` : ""} → ${o.text}`;
}

/** Контекст экрана: бюджет, карточки действий, журнал. */
export function downtimeContext(dt, { open = null, last = null, names = {} } = {}) {
  const b = budget(dt);
  const pending = dt.log.filter((e) => e.status === "pending");
  return {
    budget: b,
    actions: ACTIONS.map((a) => ({ ...a, open: a.id === open, free: !!a.free })),
    log: dt.log.map((e, i) => ({
      ...e, n: i + 1, line: entryLine(e, names),
      pending: e.status === "pending", applied: e.status === "applied", declined: e.status === "declined", info: e.status === "info",
    })),
    pendingCount: pending.length,
    last,
    archiveCount: dt.archive.length,
  };
}

/** Карточка последнего броска: кубы, таблица с подсветкой, подпись «Применить». */
export function lastContext(entry) {
  if (!entry) return null;
  const a = actionById(entry.kind);
  if (!a?.roll) return null;
  const o = outcome(entry);
  const best = entry.lowest ? Math.min(...entry.dice) : Math.max(...entry.dice);
  const marked = new Set();
  return {
    id: entry.id,
    pending: entry.status === "pending",
    applied: entry.status === "applied",
    status: entry.status,
    dice: entry.dice.map((d) => {
      const on = d === best && !marked.has("x");
      if (on) marked.add("x");
      return { d, on };
    }),
    valueText: valueText(o.value),
    tierTitle: TIERS[o.tier].title,
    bonus: entry.bonus,
    canBonus: entry.status === "pending" && o.value < 7,
    table: a.table
      ? TIERS.map((t, i) => ({ label: t.label, value: a.id === "resource" || a.id === "craft" ? `ранг ${a.table[i] >= 0 ? "+" : "−"}${Math.abs(a.table[i])}` : fmt(a.table[i]), on: i === o.tier }))
      : null,
    applyText: o.text,
    quality: o.quality ?? null,
    canQuality: entry.status === "pending" && (a.id === "resource" || a.id === "craft"),
    qualityCost: a.id === "resource" ? 6 : 5,
  };
}
