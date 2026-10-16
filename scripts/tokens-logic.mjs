// Токены рискарей: чистая логика (без Foundry) — кадр, рамки, кого показывать, что писать в токены.

export const TOKEN_OUT = 512;          // сторона готовой картинки токена, px
export const TOKEN_VIEW = 320;         // сторона окна кадрирования, px
export const ZOOM_MIN = 1;             // 1 = картинка ровно закрывает круг
export const ZOOM_MAX = 4;
export const TOKEN_DIR_DEFAULT = (worldId) => `worlds/${worldId}/nadgrad-tokens`;

/** Рамки. inner — доля радиуса, внутри которой картинка; рамка рисуется кольцом снаружи. */
export const FRAMES = {
  tush: { label: "Тушь", ring: "#1C1814", line: "#A64F2B", glow: null, inner: 0.86 },
  smog: { label: "Смог", ring: "#100C0A", line: "#E0763A", glow: "rgba(224,118,58,.85)", inner: 0.86 },
  none: { label: "Без рамки", ring: null, line: null, glow: null, inner: 1 },
};
export const frameId = (f) => (f in FRAMES ? f : "tush");

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Кадр по умолчанию: картинка закрывает круг (cover), центр по горизонтали,
 * по вертикали чуть выше центра — на портретах лицо обычно в верхней части.
 */
export function defaultCrop(w, h) {
  const crop = { zoom: 1, x: 0, y: 0 };
  if (h > w) crop.y = clampCrop(w, h, { zoom: 1, x: 0, y: (h / w - 1) * TOKEN_VIEW * 0.3 }).y;
  return crop;
}

/** Масштаб «картинка → окно» при данном зуме: zoom 1 — короткая сторона = окну. */
export const viewScale = (w, h, zoom) => (TOKEN_VIEW / Math.min(w, h)) * clamp(zoom, ZOOM_MIN, ZOOM_MAX);

/**
 * Сдвиг ограничен так, чтобы картинка всегда закрывала квадрат окна (и круг внутри).
 * x, y — сдвиг картинки от центра в px окна (вправо/вниз — плюс).
 */
export function clampCrop(w, h, { zoom, x, y }) {
  const z = clamp(Number(zoom) || 1, ZOOM_MIN, ZOOM_MAX);
  const s = viewScale(w, h, z);
  const mx = Math.max(0, (w * s - TOKEN_VIEW) / 2);
  const my = Math.max(0, (h * s - TOKEN_VIEW) / 2);
  return { zoom: z, x: clamp(Number(x) || 0, -mx, mx), y: clamp(Number(y) || 0, -my, my) };
}

/** Какой квадрат исходной картинки попадает в окно: { sx, sy, size } в px исходника. */
export function sourceRect(w, h, crop) {
  const c = clampCrop(w, h, crop);
  const s = viewScale(w, h, c.zoom);
  const dx = TOKEN_VIEW / 2 - (w * s) / 2 + c.x;   // левый край картинки в окне
  const dy = TOKEN_VIEW / 2 - (h * s) / 2 + c.y;
  return { sx: -dx / s, sy: -dy / s, size: TOKEN_VIEW / s };
}

/** Зум колесом: шаг 10 %, сдвиг пересчитывается, чтобы точка под центром осталась на месте. */
export function zoomBy(w, h, crop, factor) {
  const c = clampCrop(w, h, crop);
  const z = clamp(c.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  const k = z / c.zoom;
  return clampCrop(w, h, { zoom: z, x: c.x * k, y: c.y * k });
}

/** Рискари для списка: тип runner, хотя бы один владелец-игрок (не мастер). */
export function playerRunners(actors, users) {
  const players = new Set(users.filter((u) => !u.isGM).map((u) => u.id));
  return actors
    .filter((a) => a.type === "runner")
    .filter((a) => Object.entries(a.ownership ?? {}).some(([id, lvl]) => players.has(id) && lvl >= 3))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
}

/** Безопасное имя файла: id актёра + метка времени (иначе браузеры держат старую картинку в кэше). */
export const tokenFileName = (actorId, stamp) => `${actorId}-${stamp}.webp`;

/** Исходник для кадрирования: сохранённый оригинал, иначе текущая картинка токена, иначе портрет. */
export function originalSrc(actor) {
  const f = actor?.flags?.nadgrad?.token;
  return f?.src || actor?.prototypeToken?.texture?.src || actor?.img || "";
}

/** Что записать в прототип токена и в токены на сценах. */
export function tokenUpdate(src, scale) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  return {
    "texture.src": src,
    "texture.scaleX": s,
    "texture.scaleY": s,
    "texture.fit": "contain",
    "ring.enabled": false,
  };
}

/** То же для прототипа: ключи с префиксом prototypeToken. */
export const prototypeUpdate = (src, scale) =>
  Object.fromEntries(Object.entries(tokenUpdate(src, scale)).map(([k, v]) => [`prototypeToken.${k}`, v]));

/** Строка списка в окне. */
export function rowContext(actor, ownersById) {
  const f = actor?.flags?.nadgrad?.token;
  const owners = Object.entries(actor.ownership ?? {})
    .filter(([id, lvl]) => lvl >= 3 && ownersById.has(id))
    .map(([id]) => ownersById.get(id));
  return {
    id: actor.id,
    name: actor.name,
    thumb: actor.prototypeToken?.texture?.src || actor.img,
    owners: owners.join(", "),
    done: !!f?.out && f.out === actor.prototypeToken?.texture?.src,
    frame: f?.frame ? FRAMES[frameId(f.frame)].label : "",
  };
}
