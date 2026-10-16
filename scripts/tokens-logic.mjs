// Кольца токенов рискарей: чистая логика (без Foundry).
// С 0.9.0 — встроенное «динамическое кольцо» Foundry с кольцами Надграда; картинки токенов не меняются.

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
