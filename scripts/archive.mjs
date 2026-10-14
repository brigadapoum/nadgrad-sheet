// Страховка: один раз собрать старые заметки рискарей (поле «Why you running for?»
// и DETAILS из шторки EXPAND листа 1.05) в журнал «Архив заметок рискарей».
// Ничего не удаляет и не меняет у персонажей — только создаёт журнал.
import { MODULE_ID } from "./logic.mjs";

const SETTING = "notesArchived";
const JOURNAL_NAME = "Архив заметок рискарей (лист 1.05)";

export function registerArchive() {
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, SETTING, {
      name: "Архив старых заметок уже собран",
      hint: "Снимите галочку и перезагрузите мир, чтобы собрать архив заметок рискарей заново (новый журнал, старый останется).",
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
    });
  });

  Hooks.once("ready", async () => {
    if (!game.user.isGM || game.system.id !== "CBRPNK") return;
    if (game.settings.get(MODULE_ID, SETTING)) return;
    try {
      const n = await buildArchive();
      await game.settings.set(MODULE_ID, SETTING, true);
      if (n) ui.notifications.info(`Надград: старые заметки ${n} рискарей сохранены в журнал «${JOURNAL_NAME}».`);
    } catch (err) {
      console.error(`${MODULE_ID} | архив заметок не собран`, err);
      ui.notifications.error("Надград: не удалось собрать архив заметок — подробности в консоли (F12).");
    }
  });
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hasText = (html) => String(html ?? "").replace(/<[^>]*>/g, "").trim().length > 0;

export async function buildArchive() {
  const runners = game.actors.filter((a) => a.type === "runner");
  const pages = [];
  for (const a of runners) {
    const angle = a.system?.angle ?? {};
    const forText = String(angle.for ?? "").trim();
    const details = angle.DETAILS ?? "";
    if (!forText && !hasText(details)) continue;
    pages.push({
      name: a.name,
      type: "text",
      text: {
        format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
        content:
          `<p><em>Снято ${new Date().toLocaleString("ru-RU")} из листа рискаря. Оригинал у персонажа не тронут.</em></p>` +
          `<h3>Why you running for?</h3><p>${forText ? esc(forText) : "—"}</p>` +
          `<h3>DETAILS</h3>${hasText(details) ? details : "<p>—</p>"}`,
      },
    });
  }
  if (!pages.length) return 0;
  await JournalEntry.create({ name: JOURNAL_NAME, pages });
  return pages.length;
}
