// Кольца токенов рискарей: чистая логика (без Foundry).
// С 0.9.0 — встроенное «динамическое кольцо» Foundry с кольцами Надграда; основная картинка токена не меняется,
// с 0.9.1 круглый вырез кладётся в «объект» кольца (ring.subject.texture).

/** Кольца Надграда для настройки ядра «Динамическое кольцо токена» (core.dynamicTokenRing). */
export const RINGS = {
  nadgradTush: { label: "Надград — Тушь", file: "nadgrad-tush.json" }, // по умолчанию (автор, 2026-10-16)
  nadgradSmog: { label: "Надград — Смог", file: "nadgrad-smog.json" },
};
export const RING_DEFAULT = "nadgradTush";
export const ringPath = (moduleId, id) => `modules/${moduleId}/art/rings/${RINGS[id].file}`;
export const isNadgradRing = (id) => id in RINGS;

export const RING_EFFECTS = {
  RING_PULSE: "TOKEN.RING.EFFECTS.RING_PULSE",
  RING_GRADIENT: "TOKEN.RING.EFFECTS.RING_GRADIENT",
  BKG_WAVE: "TOKEN.RING.EFFECTS.BKG_WAVE",
  INVISIBILITY: "TOKEN.RING.EFFECTS.INVISIBILITY",
};

/** Рискари для списка: тип runner, хотя бы один владелец-игрок (не мастер), по алфавиту. */
export function playerRunners(actors, users) {
  const players = new Set(users.filter((u) => !u.isGM).map((u) => u.id));
  return actors
    .filter((a) => a.type === "runner")
    .filter((a) => Object.entries(a.ownership ?? {}).some(([id, lvl]) => players.has(id) && lvl >= 3))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
}

/** Строка списка: картинка токена, игроки, включено ли кольцо у прототипа. */
export function rowContext(actor, ownersById) {
  const owners = Object.entries(actor.ownership ?? {})
    .filter(([id, lvl]) => lvl >= 3 && ownersById.has(id))
    .map(([id]) => ownersById.get(id));
  return {
    id: actor.id,
    name: actor.name,
    thumb: actor.prototypeToken?.texture?.src || actor.img,
    owners: owners.join(", "),
    ring: !!actor.prototypeToken?.ring?.enabled,
    cut: !!actor.prototypeToken?.ring?.subject?.texture,
  };
}

/** Кольцо вкл/выкл: что писать в прототип и в токены на сценах. Картинку не трогаем. */
export const ringToken = (on) => ({ "ring.enabled": !!on });
export const ringPrototype = (on) => ({ "prototypeToken.ring.enabled": !!on });

/**
 * Откат 0.8.0. Та версия писала в токены путь к картинке, которая не загрузилась,
 * а исходник сохраняла во флаге nadgrad.token { src, out }. Возвращаем src туда, где стоит out.
 * actor: { prototypeToken, flags }; tokens: [{ id, texture: { src } }] этого актёра на сцене.
 */
export function restorePlan(actor, tokens = []) {
  const f = actor?.flags?.nadgrad?.token;
  if (!f?.src) return null;
  const out = f.out ?? null;
  const proto = actor.prototypeToken?.texture?.src;
  const plan = {
    // прототип: возвращаем, если там испечённая картинка (или если out неизвестен — всё равно исходник)
    proto: !out || proto === out ? { "prototypeToken.texture.src": f.src } : {},
    tokens: tokens.filter((t) => !out || t.texture?.src === out).map((t) => ({ _id: t.id, "texture.src": f.src })),
  };
  plan.proto[`flags.nadgrad.-=token`] = null;
  return plan;
}

// ---------- Вырез объекта для кольца (0.9.1) ----------
// Foundry не обрезает картинку под кольцо: ждёт «объект» с прозрачным фоном.
// Модуль печёт круглый вырез и пишет его в ring.subject.texture — основная картинка токена не меняется.

export const CUT_OUT = 512;           // сторона выреза, px
export const CUT_R = 0.68;            // радиус круга — доля половины стороны (кольцо Надграда начинается с 0.667)
export const TOKEN_VIEW = 320;        // сторона окна кадра, px
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const viewScale = (w, h, zoom) => (TOKEN_VIEW / Math.min(w, h)) * clamp(zoom, ZOOM_MIN, ZOOM_MAX);

/** Сдвиг ограничен так, чтобы картинка всегда закрывала круг. x, y — px окна от центра. */
export function clampCrop(w, h, { zoom, x, y }) {
  const z = clamp(Number(zoom) || 1, ZOOM_MIN, ZOOM_MAX);
  const s = viewScale(w, h, z);
  const mx = Math.max(0, (w * s - TOKEN_VIEW) / 2);
  const my = Math.max(0, (h * s - TOKEN_VIEW) / 2);
  // + 0 — без «минус нуля» в сохранённых данных
  return { zoom: z, x: clamp(Number(x) || 0, -mx, mx) + 0, y: clamp(Number(y) || 0, -my, my) + 0 };
}

/** Кадр по умолчанию: по центру; у высоких портретов — ближе к верху (лицо). */
export function defaultCrop(w, h) {
  if (h <= w) return { zoom: 1, x: 0, y: 0 };
  return clampCrop(w, h, { zoom: 1, x: 0, y: (h / w - 1) * TOKEN_VIEW * 0.3 });
}

/** Квадрат исходника, который попадает в круг: { sx, sy, size } в px исходника. */
export function sourceRect(w, h, crop) {
  const c = clampCrop(w, h, crop);
  const s = viewScale(w, h, c.zoom);
  const dx = TOKEN_VIEW / 2 - (w * s) / 2 + c.x;
  const dy = TOKEN_VIEW / 2 - (h * s) / 2 + c.y;
  return { sx: -dx / s + 0, sy: -dy / s + 0, size: TOKEN_VIEW / s };
}

/** Зум с сохранением точки под центром. */
export function zoomBy(w, h, crop, factor) {
  const c = clampCrop(w, h, crop);
  const z = clamp(c.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  const k = z / c.zoom;
  return clampCrop(w, h, { zoom: z, x: c.x * k, y: c.y * k });
}

/** Нарисовать вырез N×N: картинка в круге радиуса CUT_R, снаружи прозрачно. */
export function drawCutout(ctx, img, N, crop) {
  const { sx, sy, size } = sourceRect(img.width, img.height, crop);
  const c = N / 2;
  const r = c * CUT_R;
  ctx.clearRect(0, 0, N, N);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, sx, sy, size, size, c - r, c - r, r * 2, r * 2);
  ctx.restore();
}

/** Папка для вырезов: своя из настроек или worlds/<мир>/nadgrad-tokens (путь источника «data», без «media/home/»). */
export function cutDir(worldId, setting = "") {
  const own = String(setting ?? "").trim().replace(/^\/+|\/+$/g, "");
  return own || `worlds/${worldId}/nadgrad-tokens`;
}

export const cutFileName = (actorId, stamp) => `${actorId}-${stamp}.webp`;

/** Ответ FilePicker.upload → путь, только если сервер сказал «успех». */
export function uploadedPath(res) {
  if (!res || typeof res !== "object") return null;
  if (res.status && res.status !== "success") return null;
  return typeof res.path === "string" && res.path ? res.path : null;
}

/** Что писать при вырезе: кольцо включено, объект — вырез, масштаб объекта 1. Картинку токена не трогаем. */
export const cutToken = (path) => ({ "ring.enabled": true, "ring.subject.texture": path, "ring.subject.scale": 1 });
export const cutPrototype = (path) =>
  Object.fromEntries(Object.entries(cutToken(path)).map(([k, v]) => [`prototypeToken.${k}`, v]));
/** «Снять»: кольцо выключено, вырез убран. */
export const uncutToken = () => ({ "ring.enabled": false, "ring.subject.texture": null });
export const uncutPrototype = () => ({ "prototypeToken.ring.enabled": false, "prototypeToken.ring.subject.texture": null });
