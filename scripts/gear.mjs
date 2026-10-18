// Задвоенное снаряжение у рискарей (лист 1.2 создаёт базовый набор без защиты от повторной перерисовки).
// 1) Лист Надграда не даёт засеять набор второй раз (sheet.mjs → baseGear).
// 2) Уже задвоенное чистится: при запуске мира мастером — у всех рискарей, и при открытии листа.
import { MODULE_ID, gearDupes } from "./logic.mjs";

const BUSY = new Set();

/** Кто чистит: активный мастер; если мастера нет — владелец листа. Так два клиента не удаляют одно и то же. */
export function gearJanitor(actor) {
  const gm = game.users?.activeGM;
  if (gm) return gm.isSelf;
  return !!actor?.isOwner;
}

/** Убрать дубли у одного рискаря. Возвращает число групп с дублями (0 — всё чисто). */
export async function fixGearDupes(actor) {
  if (!actor || actor.type !== "runner" || BUSY.has(actor.id)) return 0;
  const plan = gearDupes(Array.from(actor.items));
  if (!plan.groups) return 0;
  BUSY.add(actor.id);
  try {
    if (plan.updates.length) await actor.updateEmbeddedDocuments("Item", plan.updates);
    const ids = plan.deletes.filter((id) => actor.items.has(id));
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
    console.log(`${MODULE_ID} | ${actor.name}: убраны дубли снаряжения (${ids.length})`);
  } catch (err) {
    console.warn(`${MODULE_ID} | ${actor.name}: не удалось убрать дубли снаряжения`, err);
    return 0;
  } finally {
    BUSY.delete(actor.id);
  }
  return plan.groups;
}

/** Идёт ли засев базового набора у этого рискаря (в этом браузере). */
const SEEDING = new Set();
export function startSeeding(actor) {
  if (!actor || SEEDING.has(actor.id)) return false;
  SEEDING.add(actor.id);
  // 21 предмет создаётся по одному; через 15 с набор точно на месте — снимаем отметку
  const t = setTimeout(() => SEEDING.delete(actor.id), 15000);
  t?.unref?.();
  return true;
}

export function registerGear() {
  Hooks.once("ready", async () => {
    if (game.system?.id !== "CBRPNK" || !game.user?.isGM || !gearJanitor(null)) return;
    const fixed = [];
    for (const actor of game.actors) {
      if (actor.type !== "runner") continue;
      if (await fixGearDupes(actor)) fixed.push(actor.name);
    }
    if (fixed.length) ui.notifications.info(`Надград: убрано задвоенное снаряжение — ${fixed.join(", ")}.`, { permanent: true });
  });
}
