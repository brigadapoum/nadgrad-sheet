// Надград — лист рискаря для CBR+PNK (Foundry v13, система CBR+PNK 1.1+).
// 1) Вкладки на листе: «Лист» (родной лист системы) и «Статус» (поля Надграда).
// 2) Темы «Тушь» / «Смог» — по светлой/тёмной теме Foundry (styles/nadgrad.css).
// 3) Разовый архив старых заметок 1.05 (Why you running for / DETAILS) в журнал.
import { MODULE_ID } from "./logic.mjs";
import { registerArchive } from "./archive.mjs";

registerArchive();

// Тема листа — для каждого браузера своя. «Как в Foundry» — по светлой/тёмной теме интерфейса.
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "theme", {
    name: "Тема листа рискаря",
    hint: "Тушь — светлая, Смог — тёмная. «Как в Foundry» — по теме интерфейса. Переключается и прямо на листе, над портретом.",
    scope: "client",
    config: true,
    type: String,
    choices: { auto: "Как в Foundry", tush: "Тушь", smog: "Смог" },
    default: "auto",
    onChange: () => {
      for (const app of foundry.applications.instances.values()) {
        if (app.options?.classes?.includes("nadgrad")) app.render();
      }
    },
  });
});

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
  ]);
  console.log(`${MODULE_ID} | лист рискаря с вкладками подключён`);
});
