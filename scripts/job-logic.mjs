// Стол дела: чистая логика (без Foundry).
// Макет — «А · Доска дела» (холст «Надград — стол дела», 2026-11-14): шапка дела с фигурой-лого,
// фото-слоты на постоянных местах и нити между ними (автор: «таскать карточки и связи не нужно —
// несколько фоток, внутри кнопки, я буду добавлять туда картинки»), справа — рискари в деле и часы.
// Сцен у дела может быть несколько; раскладок — три (автор: «заготовь типа 3 шаблона»).
// Подписи — «согласуем»: пока мастер вписывает их сам, у пустой подписи игрок ничего не видит.

export const JOB_SCENE_FOLDER = "Дела";

/** Раскладки фото: x, y — левый верхний угол рамки; w, h — картинка; rot — наклон. Нити — пары номеров слотов. */
export const LAYOUTS = [
  {
    id: "six",
    label: "Шесть фото",
    hint: "Четыре фото сверху, два горизонтальных крупно снизу; пять нитей.",
    // автор, 2026-11-15: «пару фоток в два раза больше, которые горизонтальные» — 5 и 6 вдвое крупнее, 4 — наверх
    slots: [
      { x: 90, y: 165, w: 220, h: 230, rot: -3 },
      { x: 400, y: 180, w: 260, h: 208, rot: 2 },
      { x: 750, y: 160, w: 230, h: 240, rot: -2 },
      { x: 1060, y: 190, w: 300, h: 200, rot: 3 },
      { x: 110, y: 484, w: 640, h: 290, rot: -1.5 },
      { x: 820, y: 484, w: 480, h: 290, rot: 1.5 },
    ],
    links: [[1, 2], [2, 3], [3, 4], [2, 5], [5, 6]],
  },
  {
    id: "four",
    label: "Четыре крупных",
    hint: "Четыре больших фото — для дела с парой ключевых лиц и мест.",
    slots: [
      { x: 120, y: 200, w: 360, h: 260, rot: -2 },
      { x: 620, y: 180, w: 340, h: 300, rot: 2 },
      { x: 1040, y: 230, w: 300, h: 250, rot: -3 },
      { x: 520, y: 560, w: 420, h: 210, rot: 1.5 },
    ],
    links: [[1, 2], [2, 3], [2, 4], [1, 4]],
  },
  {
    id: "nine",
    label: "Девять мелких",
    hint: "Девять небольших фото сеткой вразброс — для дела с кучей участников.",
    slots: [
      { x: 110, y: 155, w: 230, h: 140, rot: -3 },
      { x: 500, y: 150, w: 240, h: 140, rot: 2 },
      { x: 930, y: 160, w: 230, h: 140, rot: -2 },
      { x: 150, y: 385, w: 230, h: 140, rot: 2 },
      { x: 540, y: 400, w: 250, h: 145, rot: -1.5 },
      { x: 960, y: 385, w: 240, h: 140, rot: 3 },
      { x: 110, y: 615, w: 240, h: 140, rot: -2 },
      { x: 520, y: 630, w: 230, h: 140, rot: 2.5 },
      { x: 940, y: 615, w: 250, h: 140, rot: -1 },
    ],
    links: [[1, 2], [2, 3], [2, 5], [4, 5], [5, 6], [5, 8], [7, 8], [3, 6], [6, 9]],
  },
];
export const MAX_SLOTS = Math.max(...LAYOUTS.map((l) => l.slots.length));
export const layoutOf = (id) => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];

const str = (v) => (typeof v === "string" ? v : "");
const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x))] : []);

/**
 * Данные стола из флага сцены nadgrad.jobScene.
 * job — id записи журнала с делом; bg / logo / side — картинки (пусто — арт модуля по умолчанию);
 * slots — [{ img, caption, clock }] по номерам (clock — id счётчика, приколотого к фото) (лишние при смене раскладки не теряются); runners, clocks — id актёров.
 */
export function readTable(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const slots = Array.from({ length: MAX_SLOTS }, (_, i) => {
    const s = Array.isArray(r.slots) ? r.slots[i] : null;
    return { img: str(s?.img).trim(), caption: str(s?.caption).replace(/\s+/g, " ").trim().slice(0, 80), clock: str(s?.clock).trim() };
  });
  return {
    job: str(r.job),
    layout: layoutOf(r.layout).id,
    bg: str(r.bg).trim(),
    logo: str(r.logo).trim(),
    side: str(r.side).trim(),
    corner: str(r.corner).trim(),
    slots,
    runners: ids(r.runners),
    clocks: ids(r.clocks),
    bgView: readBgView(r.bgView),
    hidden: r.hidden === true,
    at: Number.isFinite(r.at) ? r.at : 0,
  };
}

// ---------- кадр задника (автор, 2026-11-14: «как обрезаем в кружок аватарку — но на задник») ----------
// x, y — куда сдвинут кадр (0…1, как object-position), z — приближение поверх «заполнить экран» (1…4).
export const BG_ZOOM = { min: 1, max: 4 };
export const BG_DEFAULT = { x: 0.5, y: 0.4, z: 1 };
const clamp = (v, lo, hi, fb) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fb);
export function readBgView(v = {}) {
  const o = v && typeof v === "object" ? v : {};
  return {
    x: clamp(o.x, 0, 1, BG_DEFAULT.x),
    y: clamp(o.y, 0, 1, BG_DEFAULT.y),
    z: clamp(o.z, BG_ZOOM.min, BG_ZOOM.max, BG_DEFAULT.z),
  };
}
/**
 * CSS картинки задника в рамке любого размера: коробка z×100% сдвинута на (1−z)·x, внутри — cover с object-position x y.
 * Итог — картинка «заполнить» × z, левый край = (W − ширина)·x. Натуральный размер картинки не нужен.
 */
export function bgCss(view) {
  const v = readBgView(view);
  const r = (n) => Math.round(n * 1000) / 1000;
  return { w: r(v.z * 100), h: r(v.z * 100), left: r((1 - v.z) * v.x * 100), top: r((1 - v.z) * v.y * 100), pos: `${r(v.x * 100)}% ${r(v.y * 100)}%` };
}
/** Размер картинки в рамке W×H при «заполнить» и приближении z. */
export function coverSize(nw, nh, W, H, z = 1) {
  const s = Math.max(W / (nw || 1), H / (nh || 1)) * z;
  return { w: (nw || 1) * s, h: (nh || 1) * s };
}
/** Тянем мышкой на dx, dy пикселей рамки W×H: картинка едет за мышкой; по оси без запаса — стоит. */
export function bgPan(view, dx, dy, nw, nh, W, H) {
  const v = readBgView(view);
  const c = coverSize(nw, nh, W, H, v.z);
  const ox = c.w - W, oy = c.h - H;
  return readBgView({ ...v, x: ox > 0.5 ? v.x - dx / ox : v.x, y: oy > 0.5 ? v.y - dy / oy : v.y });
}
export const bgZoom = (view, z) => readBgView({ ...readBgView(view), z });

// ---------- оформление: одна кнопка по кругу (автор, 2026-11-14) ----------
export const SKIN_CYCLE = [
  { id: "tush", label: "Тушь" },
  { id: "smog", label: "Смог" },
  { id: "acid", label: "Кислота" },
  { id: "classic", label: "Классика" },
];
export const skinLabel = (id) => (SKIN_CYCLE.find((s) => s.id === id) ?? SKIN_CYCLE[1]).label;
export function nextSkin(id) {
  const i = SKIN_CYCLE.findIndex((s) => s.id === id);
  return SKIN_CYCLE[(i + 1) % SKIN_CYCLE.length].id;
}

/** Наклон полоски скотча по номеру слота — фото крепятся скотчем, как в холле (автор, 2026-11-14). */
const TAPE = [3, -4, 5, -2, 4, -3, 2, -5, 3];

/** Точка крепления (под скотчем) — середина верхнего края рамки; от неё идут нити. */
export const pinOf = (s) => ({ x: s.x + s.w / 2 + 8, y: s.y });

/** Нить от булавки к булавке: начало, длина, угол (для div с transform-origin: 0 50%). */
export function thread(a, b) {
  const pa = pinOf(a), pb = pinOf(b);
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  return {
    x: Math.round(pa.x * 10) / 10,
    y: Math.round(pa.y * 10) / 10,
    len: Math.round(Math.hypot(dx, dy) * 10) / 10,
    deg: Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10,
  };
}

/**
 * Что рисовать на доске. Мастер видит все слоты (пустые — с кнопкой «Добавить фото»),
 * игрок — только слоты с картинкой; нить видна, только если видны оба её конца.
 */
export function boardView(table, { isGM = false } = {}) {
  const t = readTable(table);
  const lay = layoutOf(t.layout);
  const slots = lay.slots.map((pos, i) => {
    const data = t.slots[i];
    const has = !!data.img;
    return {
      n: i + 1,
      ...pos,
      frame: pos.w + 16,
      img: data.img,
      caption: data.caption,
      clock: has ? data.clock : "",
      badge: Math.min(120, Math.max(72, Math.round(pos.h * 0.45))),
      has,
      visible: has || isGM,
      showCaption: !!data.caption || isGM,
      pin: pinOf(pos),
      tape: TAPE[i % TAPE.length],
    };
  });
  const threads = lay.links
    .filter(([a, b]) => slots[a - 1]?.visible && slots[b - 1]?.visible)
    .map(([a, b]) => ({ a, b, ...thread(lay.slots[a - 1], lay.slots[b - 1]) }));
  return { layout: lay.id, slots: slots.filter((s) => s.visible), threads, pins: slots.filter((s) => s.visible).map((s) => s.pin) };
}

/**
 * Часы, приколотые к фото (автор, 2026-11-15: «кнопки привязки к фоткам часов»):
 * id счётчиков у слотов текущей раскладки, где есть фото. Такие часы — на фото, не в полосе внизу.
 */
export function pinnedClocks(table) {
  const t = readTable(table);
  const n = layoutOf(t.layout).slots.length;
  return new Set(t.slots.slice(0, n).filter((s) => s.img && s.clock).map((s) => s.clock));
}

/** Шкала стресса: клетки, если максимум разумный, иначе — число. */
export function stressView(value, max) {
  const v = Math.max(0, Math.trunc(Number(value)) || 0);
  const m = Math.max(0, Math.trunc(Number(max)) || 0);
  if (m > 0 && m <= 12) return { pips: Array.from({ length: m }, (_, i) => ({ on: i < v })), text: `${Math.min(v, m)}/${m}` };
  return { pips: [], text: m ? `${v}/${m}` : String(v) };
}

/** Рискари в деле — по порядку добавления; кого нет в мире — пропускаем. */
export function tableRunners(table, rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return readTable(table).runners.map((id) => byId.get(id)).filter(Boolean);
}
/** Кого можно добавить: действующие, кого ещё нет в деле; по рангу и делам, как лента холла. */
export function addableRunners(table, rows) {
  const inTable = new Set(readTable(table).runners);
  return rows
    .filter((r) => r.status === "active" && !inTable.has(r.id))
    .sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1) || (b.dela ?? 0) - (a.dela ?? 0) || a.name.localeCompare(b.name, "ru"));
}

/** Сцены одного дела по порядку создания: «сцена 1 · 2 · 3». */
export function jobScenes(scenes, jobId) {
  return scenes
    .filter((s) => s.table?.job === jobId && jobId)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name), "ru"))
    .map((s, i) => ({ ...s, n: i + 1 }));
}
/** Куда вести по «На дело»: сцена, на которой были последней; иначе первая. */
export function lastScene(list) {
  if (!list.length) return null;
  return [...list].sort((a, b) => (b.table?.at ?? 0) - (a.table?.at ?? 0))[0];
}
/** Имя новой сцены: «Дело: Мойка», вторая — «Дело: Мойка — 2». */
export const sceneName = (jobName, count = 0) => `Дело: ${jobName || "без названия"}${count ? ` — ${count + 1}` : ""}`;
