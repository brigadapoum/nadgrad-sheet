// Холл кампании: чистая логика (без Foundry).
// Макет — «Д · Гибрид 2» (холст «Надград — сцена-холл кампании», 2026-11-13): карта на всю ширину,
// доска дел слева (6 дел, листается), лента рискарей по центру (10, листается), фото справа, новости внизу.
// Дела живут в Notion: автор присылает таблицу, Claude пересобирает data/jobs.json, модуль при входе мастера
// добавляет новые дела и правит изменённые. Закрытое мастером (×) остаётся закрытым.

export const STAGE = { w: 1920, h: 1080 };
export const JOBS_PAGE = 6;
export const RUNNERS_PAGE = 10;
export const JOB_FOLDER = "Доска дел";

export const RANKS = ["0", "I", "II", "III", "IV", "V", "VI+"];
/** Ранг препятствия → 0…6 (VI и VI+ — 6), иначе null. */
export function rankLevel(r) {
  const s = String(r ?? "").trim().toUpperCase();
  if (s === "VI") return 6;
  const i = RANKS.indexOf(s);
  return i < 0 ? null : i;
}
/** Цвет плашки: 0–I бирюза, II–III оранжевый, IV+ красный. */
export const rankTone = (lvl) => (lvl == null ? "none" : lvl <= 1 ? "low" : lvl <= 3 ? "mid" : "high");

/** «50 ч., 4 р.» → «50 ч · 4 р». */
export function formatReward(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*ч\.\s*/g, " ч ")
    .replace(/\s*р\.\s*/g, " р ")
    .replace(/\s*репы?\b/g, " р")
    .replace(/\s*,\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
}

export const JOB_STATUSES = ["open", "playing", "closed"];
/** Данные дела из флагов записи журнала (или из data/jobs.json). */
export function readJob(raw = {}) {
  const obstacles = Array.isArray(raw.obstacles) ? raw.obstacles.map((x) => String(x).trim()).filter(Boolean) : [];
  return {
    key: String(raw.key ?? ""),
    name: String(raw.name ?? ""),
    client: String(raw.client ?? ""),
    place: String(raw.place ?? ""),
    reward: String(raw.reward ?? ""),
    obstacles,
    fixerRank: Number.isInteger(raw.fixerRank) ? raw.fixerRank : null,
    status: JOB_STATUSES.includes(raw.status) ? raw.status : "open",
    order: Number.isFinite(raw.order) ? raw.order : 999,
  };
}

/** Карточка дела для доски. */
export function jobView(job, { id = "", canOpen = true } = {}) {
  const j = readJob(job);
  const lv = j.obstacles.map(rankLevel);
  const top = lv.filter((x) => x != null);
  return {
    id, key: j.key, name: j.name, canOpen,
    reward: formatReward(j.reward),
    meta: [j.client, j.place].filter(Boolean).join(" · "),
    chips: j.obstacles.map((r, i) => ({ label: r, tone: rankTone(lv[i]) })),
    unknown: j.obstacles.length === 0,
    tone: top.length ? rankTone(Math.max(...top)) : "none",
    playing: j.status === "playing",
    closed: j.status === "closed",
  };
}

/** Дела на доске: без закрытых, по порядку из Notion; при равенстве — по имени. */
export function boardJobs(list) {
  return list
    .filter((x) => readJob(x.job).status !== "closed")
    .sort((a, b) => readJob(a.job).order - readJob(b.job).order || readJob(a.job).name.localeCompare(readJob(b.job).name, "ru"));
}

/** Страница списка: смещение прижимается к границам. */
export function page(list, offset = 0, size = 6) {
  const total = list.length;
  const maxOff = Math.max(0, total - size);
  const off = Math.min(Math.max(0, Math.trunc(offset) || 0), maxOff);
  return {
    items: list.slice(off, off + size),
    offset: off,
    from: total ? off + 1 : 0,
    to: Math.min(total, off + size),
    total,
    canPrev: off > 0,
    canNext: off < maxOff,
    paged: total > size,
  };
}
/**
 * Карусель (лента рискарей, автор 2026-11-13): «по кругу по одному». Показывает size штук с offset,
 * после последнего идёт первый. Если всех меньше или ровно size — крутить нечего.
 */
export function ring(list, offset = 0, size = 10) {
  const total = list.length;
  if (!total) return { items: [], offset: 0, total: 0, cyclic: false };
  const off = ((Math.trunc(offset) || 0) % total + total) % total;
  const cyclic = total > size;
  const n = Math.min(size, total);
  const items = Array.from({ length: n }, (_, i) => list[cyclic ? (off + i) % total : i]);
  return { items, offset: cyclic ? off : 0, total, cyclic };
}

/** Сдвиг на страницу вперёд/назад. */
export const turn = (offset, dir, size, total) => Math.min(Math.max(0, offset + dir * size), Math.max(0, total - size));

/**
 * Синхронизация доски с data/jobs.json.
 * world: [{ id, job }] — записи журнала с флагом дела; data: [job] из модуля.
 * Новые дела — создать. Знакомые — обновить поля, но закрытое мастером не открывать.
 * Дела, которых больше нет в таблице Notion, — закрыть (в архив, не удалять).
 */
export function syncPlan(world, data) {
  const byKey = new Map(world.filter((w) => w.job?.key).map((w) => [w.job.key, w]));
  const keys = new Set();
  const create = [];
  const update = [];
  for (const raw of data) {
    const d = readJob(raw);
    if (!d.key) continue;
    keys.add(d.key);
    const w = byKey.get(d.key);
    if (!w) { create.push(d); continue; }
    const cur = readJob(w.job);
    const status = cur.status === "closed" ? "closed" : d.status;
    const next = { ...d, status };
    const changed = ["name", "client", "place", "reward", "status", "order", "fixerRank"].some((k) => cur[k] !== next[k])
      || cur.obstacles.join("|") !== next.obstacles.join("|");
    if (changed) update.push({ id: w.id, job: next, rename: cur.name !== next.name });
  }
  const close = world.filter((w) => w.job?.key && !keys.has(w.job.key) && readJob(w.job).status !== "closed").map((w) => w.id);
  return { create, update, close };
}

// ---------- рискари ----------

export const CAMPAIGN = [
  { id: "active", label: "Действует" },
  { id: "waiting", label: "Ждёт" },
  { id: "dead", label: "Погиб" },
  { id: "off", label: "Не на доске" },
];
const CAMPAIGN_IDS = CAMPAIGN.map((c) => c.id);

/** Имя для сверки: без кавычек и прозвищ в «», ё → е, нижний регистр. */
export function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'“”„]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
/** Одни и те же рискари под разными именами (автор, 2026-11-13). */
export const ALIASES = [["ржавый", "клемм"], ["коль", "реймонд"], ["фло", "флоренс"], ["рика кан", "рика"], ["сима эхо банши", "сима"], ["желтая", "жёлтая"]];

/** Статус в кампании: флаг листа (ставит мастер) → запись базы PC из Notion → null (не на доске). */
export function campaignStatus(name, flag, roster = []) {
  if (CAMPAIGN_IDS.includes(flag)) return flag;
  const n = normName(name);
  const variants = new Set([n, n.split(" ")[0]]);
  for (const [a, b] of ALIASES) {
    const na = normName(a), nb = normName(b);
    if (variants.has(na)) variants.add(nb);
    if (variants.has(nb)) variants.add(na);
  }
  for (const r of roster) {
    const rn = normName(r.name);
    if (variants.has(rn) || variants.has(rn.split(" ")[0])) return r.status;
  }
  return null;
}

/** Лента и галерея: слева — самый высокий ранг, при равном — больше дел, потом по имени (автор, 2026-11-13). */
export const byStanding = (a, b) => (b.rank ?? -1) - (a.rank ?? -1) || (b.dela ?? 0) - (a.dela ?? 0) || a.name.localeCompare(b.name, "ru");
export function runnerViews(list, filter = "active") {
  return list
    .filter((r) => (filter === "all" ? r.status && r.status !== "off" : r.status === filter))
    .sort(byStanding)
    .map((r) => ({ ...r, initial: (r.name.trim()[0] ?? "?").toUpperCase(), rankText: r.rank == null ? "?" : String(r.rank) }));
}
export const countBy = (list) => ({
  active: list.filter((r) => r.status === "active").length,
  waiting: list.filter((r) => r.status === "waiting").length,
  dead: list.filter((r) => r.status === "dead").length,
  all: list.filter((r) => r.status && r.status !== "off").length,
});

// ---------- раскладка ----------

/**
 * Куда положить сцену 1920×1080: в свободную середину экрана (между кнопками Foundry слева,
 * сайдбаром справа и хотбаром снизу). Масштаб — чтобы влезла целиком, по центру.
 */
export function fitStage(area, stage = STAGE) {
  const w = Math.max(1, area.right - area.left);
  const h = Math.max(1, area.bottom - area.top);
  const scale = Math.min(w / stage.w, h / stage.h);
  return {
    scale,
    left: Math.round(area.left + (w - stage.w * scale) / 2),
    top: Math.round(area.top + (h - stage.h * scale) / 2),
  };
}

export const ZASLON = [
  { id: "closed", label: "Заслон: закрыт", tone: "high" },
  { id: "cracks", label: "Заслон: щели", tone: "mid" },
  { id: "open", label: "Заслон: открыт", tone: "low" },
  { id: "none", label: "", tone: "none" },
];
export const zaslonOf = (id) => ZASLON.find((z) => z.id === id) ?? ZASLON[0];

/** Новости: строки, «Слух:» в начале — непроверенное. */
export function newsViews(list) {
  return (Array.isArray(list) ? list : [])
    .map((x) => (typeof x === "string" ? x : x?.text ?? ""))
    .map((t) => String(t).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((t) => {
      const m = t.match(/^(слух|внимание)\s*[:!]\s*/i);
      return { text: m ? t.slice(m[0].length) : t, tag: m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : "" };
    });
}
