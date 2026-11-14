// Надград — лист рискаря для CBR+PNK (Foundry v13, система CBR+PNK 1.1+).
// 1) Вкладки на листе: «Лист» (родной лист системы) и «Статус» (поля Надграда).
// 2) Темы «Тушь» / «Смог» — по светлой/тёмной теме Foundry (styles/nadgrad.css).
// 3) Чат (карточки бросков) и пауза — в той же теме, что и лист.
// 4) Разовый архив старых заметок 1.05 (Why you running for / DETAILS) в журнал.
// 5) Счётчики (часы): актёр «Счётчик», токен на сцене, заполнение мышкой (scripts/clock.mjs).
// 6) Токены рискарей: кадр в круге и рамка Надграда, только мастер (scripts/tokens.mjs).
// 7) Холл кампании: стартовая сцена с картой, доской дел, рискарями и новостями (scripts/hall.mjs).
// 8) Стол дела: сцена дела с доской фото, рискарями в деле и часами; переход из холла (scripts/job.mjs).
// 9) Язык листа: перевод Надграда для строк системы CBR+PNK (lang/cbrpnk-ru.json).
import { MODULE_ID } from "./logic.mjs";
import { registerArchive } from "./archive.mjs";
import { applyUiTheme } from "./dom.mjs";
import { registerClocks } from "./clock.mjs";
import { forcesAppClass } from "./forces.mjs";
import { registerTokens } from "./tokens.mjs";
import { registerGear } from "./gear.mjs";
import { registerHall, refresh as refreshHall } from "./hall.mjs";
import { registerJobTable, refresh as refreshJob } from "./job.mjs";

registerArchive();
registerGear();
registerClocks();
registerTokens();
registerHall();
registerJobTable();

// Тема листа — для каждого браузера своя. «Как в Foundry» — по светлой/тёмной теме интерфейса.
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "theme", {
    name: "Тема Надграда",
    hint: "Лист рискаря, холл кампании, стол дела, карточки бросков в чате и пауза. Тушь — светлая, Смог — тёмная, Кислота — тёмная с оранжевой рамкой, Классика — дневной лист 1.05. «Как в Foundry» — Тушь или Смог по теме интерфейса. Переключается и прямо на листе, над портретом.",
    scope: "client",
    config: true,
    type: String,
    choices: { auto: "Как в Foundry", tush: "Тушь", smog: "Смог", acid: "Кислота", classic: "Классика" },
    default: "auto",
    onChange: () => {
      syncUiTheme();
      rerenderSheets();
      refreshHall();
      refreshJob();
    },
  });

  // Язык листа и карточек системы: свой перевод Надграда поверх словаря CBR+PNK.
  // Меняет только строки системы (подходы, навыки, раны, исходы бросков…), не язык всего Foundry.
  game.settings.register(MODULE_ID, "sheetLang", {
    name: "Язык листа",
    hint: "Русский — перевод Надграда (рискарь, подходы, навыки, раны, исходы бросков). English — оригинал CBR+PNK. «Как в Foundry» — по языку интерфейса. Нужна перезагрузка.",
    scope: "client",
    config: true,
    type: String,
    choices: { auto: "Как в Foundry", ru: "Русский (Надград)", en: "English" },
    default: "ru",
    requiresReload: true,
  });

  // Силы мира — общий список для вкладки «Отношения» (ведёт мастер).
  game.settings.register(MODULE_ID, "forces", {
    name: "Силы мира",
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => rerenderSheets(),
  });
  game.settings.registerMenu(MODULE_ID, "forcesMenu", {
    name: "Силы мира",
    label: "Открыть список сил",
    hint: "Силы с группами и рангами — из них игроки выбирают, с кем у рискаря отношения.",
    icon: "fa-solid fa-people-group",
    type: forcesAppClass(),
    restricted: true,
  });
});

// Словарь подменяется после загрузки переводов Foundry, до первой отрисовки листов.
Hooks.once("i18nInit", async () => {
  if (game.system?.id !== "CBRPNK") return;
  let lang = "ru";
  try { lang = game.settings.get(MODULE_ID, "sheetLang"); } catch { /* настройка ещё не зарегистрирована */ }
  const path = lang === "ru" ? `modules/${MODULE_ID}/lang/cbrpnk-ru.json` : lang === "en" ? "systems/CBRPNK/lang/en.json" : null;
  if (!path) return;
  try {
    const dict = await foundry.utils.fetchJsonWithTimeout(foundry.utils.getRoute(path));
    foundry.utils.mergeObject(game.i18n.translations, dict, { inplace: true, overwrite: true });
  } catch (err) {
    console.warn(`${MODULE_ID} | словарь листа не загрузился (${path})`, err);
  }
});

function rerenderSheets() {
  for (const app of foundry.applications.instances.values()) {
    if (app.options?.classes?.includes("nadgrad")) app.render();
  }
}

Hooks.once("init", async () => {
  if (game.system.id !== "CBRPNK") return;
  // Лист 1.1+ лежит здесь; в 1.05 файла нет — тогда тихо остаёмся только с архивом.
  const url = foundry.utils.getRoute("systems/CBRPNK/actors/runner/runner.js");
  let Runner;
  try {
    ({ default: Runner } = await import(url));
  } catch (err) {
    console.warn(`${MODULE_ID} | лист CBR+PNK 1.1+ не найден — вкладки не подключены (система ${game.system.version}).`, err);
    return;
  }
  const { makeSheetClass } = await import("./sheet.mjs");
  const NadgradRunner = makeSheetClass(Runner);
  foundry.documents.collections.Actors.registerSheet(MODULE_ID, NadgradRunner, {
    types: ["runner"],
    makeDefault: true,
    label: "Надград — рискарь",
  });
  await foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/tabs.hbs`,
    `modules/${MODULE_ID}/templates/status.hbs`,
    `modules/${MODULE_ID}/templates/relations.hbs`,
    `modules/${MODULE_ID}/templates/projects.hbs`,
    `modules/${MODULE_ID}/templates/breather.hbs`,
  ]);
  console.log(`${MODULE_ID} | лист рискаря с вкладками подключён`);
});

// Чат и пауза живут вне листа, поэтому тема для них вешается на <body>.
const themeSetting = () => {
  try { return game.settings.get(MODULE_ID, "theme"); } catch { return "auto"; }
};
function syncUiTheme() {
  if (game.system?.id !== "CBRPNK") return;
  applyUiTheme(document.body, themeSetting());
}
Hooks.once("ready", () => {
  syncUiTheme();
  // «Как в Foundry»: тема интерфейса может смениться на лету — следим за классом <body>.
  // Повторная установка уже стоящих классов не меняет атрибут, так что зацикливания нет.
  new MutationObserver(syncUiTheme).observe(document.body, { attributes: true, attributeFilter: ["class"] });
});
