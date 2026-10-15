// Прогон класса листа на заглушке Foundry с настоящим DOM (jsdom):
// ловим ошибки private-полей, действий, вкладок, правок полосы над портретом и кнопки загрузки.
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import { makeSheetClass } from "../scripts/sheet.mjs";

const SETTINGS = { "nadgrad.theme": "auto" };
globalThis.ui = { notifications: { warns: [], warn(m) { this.warns.push(m); } } };
globalThis.game = {
  i18n: { localize: (k) => ({ "LOAD.LIGHT": "LIGHT: Move freely", "LOAD.MEDIUM": "MEDIUM: Look ready", "LOAD.HEAVY": "HEAVY: Loud or slow" }[k] ?? k) },
  settings: {
    get: (m, k) => SETTINGS[`${m}.${k}`],
    set: async (m, k, v) => { SETTINGS[`${m}.${k}`] = v; },
  },
};
beforeEach(() => { SETTINGS["nadgrad.theme"] = "auto"; ui.notifications.warns = []; });

// Скелет окна с родным листом 1.2 — только то, что трогает модуль.
const SHEET_HTML = `
<form class="application sheet actor runner-actor nadgrad themed theme-light">
 <section class="window-content">
  <nav data-application-part="ngTabs">
   <button data-action="ngTab" data-tab="sheet"></button><button data-action="ngTab" data-tab="status"></button>
   <button data-action="ngTab" data-tab="relations"></button><button data-action="ngTab" data-tab="projects"></button>
  </nav>
  <div data-application-part="form" class="hunted">
   <div><section class="header"><div class="options">
     <button data-action="fateChange" data-flag="CRED">CRED</button><button data-action="rollAngle"></button>
     <label><input type="checkbox" name="system.angle.hunted"></label><button data-action="fateChange" data-flag="DEBT">DEBT</button>
   </div></section></div>
   <section class="gears"><h3>GEAR <button data-action="gearLoadChange" class="stack">0 / 3</button></h3><p class="desc"></p></section>
  </div>
  <div data-application-part="status"><input class="ng-tension-add"></div>
  <div data-application-part="relations"></div>
  <div data-application-part="projects"></div>
 </section>
</form>`;

class Runner {
  static DEFAULT_OPTIONS = { classes: ["runner-actor"], actions: { openNotes: function () { this.openedNotes = true; } } };
  static PARTS = { form: { template: "systems/CBRPNK/actors/runner/runner.hbs" } };
  constructor(actor) {
    this.actor = actor; this.isEditable = true;
    const C = this.constructor;
    this.options = { classes: C.DEFAULT_OPTIONS.classes, form: C.DEFAULT_OPTIONS.form, actions: { ...Runner.DEFAULT_OPTIONS.actions, ...C.DEFAULT_OPTIONS.actions } };
    this.dom = new JSDOM(`<body class="theme-dark">${SHEET_HTML}</body>`);
    this.element = this.dom.window.document.querySelector("form");
  }
  async _prepareContext() { return { base: true }; }
  async _onRender() {}
}
function makeActor(flags = {}, system = {}) {
  const a = { flags: { nadgrad: flags }, system: { angle: { for: "", DETAILS: "" }, GEAR: { LOAD: { selected: 0, value: 0, max: 3 } }, ...system }, items: [], updates: [] };
  a.update = async (data) => {
    a.updates.push(data);
    for (const [k, v] of Object.entries(data)) {
      const parts = k.split("."); let o = a;
      for (const p of parts.slice(0, -1)) o = o[p] ??= {};
      const last = parts.at(-1);
      o[last] = v && typeof v === "object" && !Array.isArray(v) ? { ...(o[last] ?? {}), ...v } : v;
    }
  };
  return a;
}
const S = makeSheetClass(Runner);
const act = (sheet, name, dataset = {}, button = 0) => {
  const a = sheet.options.actions[name]; const h = typeof a === "function" ? a : a.handler;
  return h.call(sheet, { button }, { dataset });
};
const part = (sh, id) => sh.element.querySelector(`[data-application-part="${id}"]`);
const hidden = (sh, id) => part(sh, id).classList.contains("ng-hidden");

test("классы, части и порядок частей", () => {
  assert.deepEqual(Object.keys(S.PARTS), ["ngTabs", "form", "status", "relations", "projects"]);
  assert.ok(S.DEFAULT_OPTIONS.classes.includes("runner-actor"));
});
test("контекст и вкладки", async () => {
  const sh = new S(makeActor());
  const ctx = await sh._prepareContext({});
  assert.equal(ctx.base, true);
  assert.equal(ctx.ng.repMax, 6);
  await sh._onRender(ctx, {});
  assert.ok(hidden(sh, "status") && !hidden(sh, "form"));
  await act(sh, "ngTab", { tab: "status" });
  assert.ok(hidden(sh, "form") && !hidden(sh, "status"));
  await act(sh, "ngTab", { tab: "projects" });
  for (const p of ["form", "status", "relations"]) assert.ok(hidden(sh, p), p);
  assert.ok(!hidden(sh, "projects"));
});
test("полоса над портретом: CRED, DEBT, бросок и «охотник» убраны, стоит переключатель тем", async () => {
  const sh = new S(makeActor());
  await sh._onRender({}, {});
  const bar = sh.element.querySelector("section.header .options");
  assert.equal(bar.querySelector('[data-flag], [data-action="rollAngle"], input[name="system.angle.hunted"]'), null);
  assert.deepEqual([...bar.querySelectorAll('[data-action="ngTheme"]')].map((b) => b.dataset.theme), ["tush", "smog"]);
  assert.equal(part(sh, "form").classList.contains("hunted"), false);
  // окно светлое → подсвечена «Тушь», хотя интерфейс тёмный
  assert.equal(bar.querySelector(".active").dataset.theme, "tush");
  await sh._onRender({}, {}); // повторная перерисовка не плодит переключатели
  assert.equal(bar.querySelectorAll(".ng-theme").length, 1);
});
test("переключатель тем: выбор запоминается и вешает класс на окно", async () => {
  const sh = new S(makeActor());
  await act(sh, "ngTheme", { theme: "smog" });
  assert.equal(SETTINGS["nadgrad.theme"], "smog");
  await sh._onRender({}, {});
  assert.ok(sh.element.classList.contains("ng-smog") && !sh.element.classList.contains("ng-tush"));
  assert.equal(sh.element.querySelector(".ng-theme .active").dataset.theme, "smog");
  await act(sh, "ngTheme", { theme: "tush" });
  await sh._onRender({}, {});
  assert.ok(sh.element.classList.contains("ng-tush") && !sh.element.classList.contains("ng-smog"));
});
test("кнопка загрузки: текст уровня, цифра больше не кнопка, ЛКМ тяжелее, ПКМ легче по кругу", async () => {
  const a = makeActor({}, { GEAR: { LOAD: { selected: "light", value: 1, max: 3 } } });
  a.items = [{ id: "blade", type: "gear", system: { value: 1, isUse: true } }];
  const sh = new S(a);
  await sh._onRender({}, {});
  const g = sh.element.querySelector("section.gears");
  const btn = g.querySelector("button.ng-load");
  assert.ok(btn && btn.dataset.action === "ngLoad");
  assert.match(btn.textContent, /LIGHT/);
  assert.equal(g.querySelector("p.desc"), null);
  assert.equal(g.querySelector("h3 button").hasAttribute("data-action"), false);
  assert.equal(btn.querySelectorAll(".ng-dot.on").length, 1);
  await act(sh, "ngLoad", {}, 0);
  assert.equal(a.system.GEAR.LOAD.selected, 1); assert.equal(a.system.GEAR.LOAD.max, 5);
  await act(sh, "ngLoad", {}, 2);
  await act(sh, "ngLoad", {}, 2);
  assert.equal(a.system.GEAR.LOAD.selected, 2); assert.equal(a.system.GEAR.LOAD.max, 7);
  assert.equal(a.system.GEAR.LOAD.value, 1); // отмеченное снаряжение не трогаем
  await sh._onRender({}, {});
  assert.match(g.querySelector("button.ng-load").textContent, /HEAVY/);
  assert.equal(g.querySelectorAll("button.ng-load").length, 1);
});
test("чеки, заблокированные и дела", async () => {
  const a = makeActor(); const sh = new S(a);
  await act(sh, "ngStep", { field: "cheki", delta: "1" });
  await act(sh, "ngStep", { field: "cheki", delta: "-1" });
  await act(sh, "ngStep", { field: "cheki", delta: "-1" });
  assert.equal(a.flags.nadgrad.cheki, -1);
  await act(sh, "ngStep", { field: "blocked", delta: "-1" });
  assert.equal(a.flags.nadgrad.blocked ?? 0, 0);
  await act(sh, "ngStep", { field: "blocked", delta: "1" }); // чеков в минусе — блокировать нечего
  assert.equal(a.flags.nadgrad.blocked ?? 0, 0);
  assert.equal(ui.notifications.warns.length, 1);
  await act(sh, "ngStep", { field: "dela", delta: "-1" });
  assert.equal(a.flags.nadgrad.dela, 0);
});
test("репутация: ЛКМ ставит, ПКМ снимает, в пределах ранга; ранг обрезает значение", async () => {
  const a = makeActor({ rep: { rank: 1, value: 7 } }); const sh = new S(a);
  await act(sh, "ngRepCell", { n: "2" }, 0);
  await act(sh, "ngRepCell", { n: "1" }, 0);
  assert.equal(a.flags.nadgrad.rep.value, 8);
  await act(sh, "ngRepCell", { n: "8" }, 2);
  assert.equal(a.flags.nadgrad.rep.value, 7);
  a.flags.nadgrad.rep = { rank: 3, value: 12 };
  await act(sh, "ngRepRank", { rank: "2" });
  assert.deepEqual(a.flags.nadgrad.rep, { rank: 2, value: 10 });
  await act(sh, "ngRepRank", { rank: "0" });
  assert.deepEqual(a.flags.nadgrad.rep, { rank: 0, value: 6 });
});
test("напряжение: ромбы ЛКМ/ПКМ с переносом, уровни ЛКМ/ПКМ, +N, потолок", async () => {
  const a = makeActor({ tension: { level: 0, points: 8 } }); const sh = new S(a);
  await act(sh, "ngTensionCell", { n: "3" }, 0);
  assert.deepEqual(a.flags.nadgrad.tension, { level: 1, points: 0 });
  await act(sh, "ngTensionCell", { n: "1" }, 2);
  assert.deepEqual(a.flags.nadgrad.tension, { level: 0, points: 8 });
  await act(sh, "ngTensionLevel", { n: "1" }, 0);
  assert.deepEqual(a.flags.nadgrad.tension, { level: 1, points: 8 });
  await act(sh, "ngTensionLevel", { n: "1" }, 2);
  await act(sh, "ngTensionLevel", { n: "1" }, 2);
  assert.equal(a.flags.nadgrad.tension.level, 0);
  a.flags.nadgrad.tension = { level: 3, points: 5 };
  await act(sh, "ngTensionZero");
  assert.deepEqual(a.flags.nadgrad.tension, { level: 0, points: 5 });
  a.flags.nadgrad.tension = { level: 0, points: 8 };
  const input = sh.element.querySelector("input.ng-tension-add");
  input.value = "10";
  await act(sh, "ngTensionAdd");
  assert.deepEqual(a.flags.nadgrad.tension, { level: 2, points: 0 });
  assert.equal(input.value, "");
  input.value = "40";
  await act(sh, "ngTensionAdd");
  assert.deepEqual(a.flags.nadgrad.tension, { level: 4, points: 8 });
  assert.equal(ui.notifications.warns.length, 1);
});
test("уровень жизни: выбор и снятие повторным кликом", async () => {
  const a = makeActor(); const sh = new S(a);
  await act(sh, "ngLife", { level: "4" });
  assert.equal(a.flags.nadgrad.life.level, 4);
  await act(sh, "ngLife", { level: "4" });
  assert.equal(a.flags.nadgrad.life.level, null);
});
test("досье открывается родным действием листа", async () => {
  const sh = new S(makeActor());
  await act(sh, "ngNotes");
  assert.equal(sh.openedNotes, true);
});

test("чат и пауза: тема на <body> — по выбору, «auto» — по теме интерфейса", async () => {
  const { applyUiTheme } = await import("../scripts/dom.mjs");
  const { window } = new JSDOM(`<body class="theme-dark"></body>`);
  const b = window.document.body;
  assert.equal(applyUiTheme(b, "auto"), "smog");
  assert.ok(b.classList.contains("ng-ui") && b.classList.contains("ng-ui-smog") && !b.classList.contains("ng-ui-tush"));
  assert.equal(applyUiTheme(b, "tush"), "tush");
  assert.ok(b.classList.contains("ng-ui-tush") && !b.classList.contains("ng-ui-smog"));
  b.classList.replace("theme-dark", "theme-light");
  assert.equal(applyUiTheme(b, "auto"), "tush");
  assert.equal(applyUiTheme(b, "smog"), "smog");
});

// ---- загрузка снаряжения по отмеченным предметам ----
function gearActor(stored, gears) {
  const a = makeActor({}, { GEAR: { LOAD: { selected: 0, value: stored, max: 3 } } });
  const list = gears.map(([id, value, isUse]) => {
    const it = { id, type: "gear", system: { value, isUse } };
    it.update = async (d) => { it.system.isUse = d["system.isUse"]; };
    return it;
  });
  list.push({ id: "dos", type: "dossier", system: { value: 5, isUse: true } });
  a.items = Object.assign(list, { get: (id) => list.find((i) => i.id === id) });
  return a;
}
const gearTarget = (sh, id) => {
  const el = sh.dom.window.document.createElement("button");
  el.setAttribute("data-item-id", id);
  return el;
};

test("загрузка: считается по отмеченному снаряжению, не по счётчику", async () => {
  const { gearLoad } = await import("../scripts/logic.mjs");
  assert.equal(gearLoad([]), 0);
  assert.equal(gearLoad([{ type: "gear", system: { value: 2, isUse: true } }, { type: "gear", system: { value: 1, isUse: false } }, { type: "dossier", system: { value: 4, isUse: true } }]), 2);
});
test("загрузка: старый счётчик 3/3 без отметок чинится при открытии листа", async () => {
  const a = gearActor(3, [["blade", 1, false], ["smg", 1, false]]);
  const sh = new S(a);
  await sh._onRender(await sh._prepareContext({}), {});
  assert.equal(a.system.GEAR.LOAD.value, 0);
  const n = a.updates.length;
  await sh._onRender(await sh._prepareContext({}), {});
  assert.equal(a.updates.length, n); // уже верно — повторно не пишет
});
test("загрузка: отметка снаряжения ставит число по предметам, снятие — убавляет", async () => {
  const a = gearActor(3, [["blade", 1, false], ["heavy", 2, true]]);
  const sh = new S(a);
  const h = sh.options.actions.gearSelect;
  await h.call(sh, { button: 0 }, gearTarget(sh, "blade"));
  assert.equal(a.items.get("blade").system.isUse, true);
  assert.equal(a.system.GEAR.LOAD.value, 3);
  await h.call(sh, { button: 0 }, gearTarget(sh, "heavy"));
  assert.equal(a.system.GEAR.LOAD.value, 1);
  sh.isEditable = false;
  await h.call(sh, { button: 0 }, gearTarget(sh, "blade"));
  assert.equal(a.items.get("blade").system.isUse, true);
});

test("заблокировано: + берёт чек из общего пула, − возвращает; старые суммы не трогаются", async () => {
  const a = makeActor({ cheki: 2, blocked: 40 }); const sh = new S(a);
  await act(sh, "ngStep", { field: "blocked", delta: "1" });
  assert.deepEqual([a.flags.nadgrad.cheki, a.flags.nadgrad.blocked], [1, 41]);
  await act(sh, "ngStep", { field: "blocked", delta: "-1" });
  await act(sh, "ngStep", { field: "blocked", delta: "-1" });
  assert.deepEqual([a.flags.nadgrad.cheki, a.flags.nadgrad.blocked], [3, 39]);
  const { blockStep } = await import("../scripts/logic.mjs");
  assert.deepEqual(blockStep({ cheki: 0, blocked: 5 }, 1), { cheki: 0, blocked: 5, short: 1 });
  assert.deepEqual(blockStep({ cheki: 4, blocked: 0 }, -1), { cheki: 4, blocked: 0, short: 0 });
});

test("доп. нагрузка: деления счётчика идут в загрузку, как в 1.05", async () => {
  const { gearLoad, isExtraLoad } = await import("../scripts/logic.mjs");
  const extra = { type: "gear", system: { value: 0, max: 4, stack: 2, isUse: false } };
  assert.ok(isExtraLoad(extra));
  assert.ok(!isExtraLoad({ type: "gear", system: { value: 1, max: 3, stack: 1 } })); // патроны и т. п. — не нагрузка
  assert.equal(gearLoad([extra, { type: "gear", system: { value: 1, isUse: true, max: 3, stack: 3 } }]), 3);

  const a = gearActor(0, [["blade", 1, true]]);
  const ex = { id: "extra", type: "gear", system: { value: 0, max: 4, stack: 0, isUse: false } };
  ex.update = async (d) => { ex.system.stack = d["system.stack"]; };
  a.items.push(ex);
  const sh = new S(a);
  const h = sh.options.actions.gearChangeStack.handler;
  await h.call(sh, { button: 0 }, gearTarget(sh, "extra"));
  await h.call(sh, { button: 0 }, gearTarget(sh, "extra"));
  assert.equal(ex.system.stack, 2);
  assert.equal(a.system.GEAR.LOAD.value, 3);
  await h.call(sh, { button: 2 }, gearTarget(sh, "extra"));
  assert.equal(a.system.GEAR.LOAD.value, 2);
  // лечение при открытии листа тоже учитывает доп. нагрузку
  a.system.GEAR.LOAD.value = 0;
  await sh._onRender(await sh._prepareContext({}), {});
  assert.equal(a.system.GEAR.LOAD.value, 2);
});

test("аугментации: поля формы уходят в предметы, пустое имя не пишется", async () => {
  const { splitAugFields } = await import("../scripts/logic.mjs");
  const data = { name: "Рентген", "ngAug.a1.name": " Кибер-глаз ", "ngAug.a2.name": "  ", "ngAug.a1.desc": "<p>Видит в темноте</p>", "system.x": 1 };
  assert.deepEqual(splitAugFields(data), { a1: { name: "Кибер-глаз", "system.desc": "<p>Видит в темноте</p>" } });
  assert.deepEqual(data, { name: "Рентген", "system.x": 1 });

  const a = makeActor();
  const aug = { id: "a1", name: "Aug", type: "augmentation", system: { desc: "", isOpen: false }, upd: [] };
  aug.update = async (d) => { aug.upd.push(d); if (d.name) aug.name = d.name; };
  a.items = Object.assign([aug], { get: (id) => (id === "a1" ? aug : undefined) });
  const sh = new S(a);
  await sh.options.form.handler.call(sh, { preventDefault() {} }, sh.element, { object: { "ngAug.a1.name": "Кибер-глаз", "flags.nadgrad.dela": 2 } });
  assert.equal(aug.name, "Кибер-глаз");
  assert.equal(a.flags.nadgrad.dela, 2);
  assert.ok(!a.updates.some((u) => Object.keys(u).some((k) => k.startsWith("ngAug"))));
});

test("аугментации и броски в DOM: стрелка описания, имя в форме, плюсы у доп. кубов, кнопки не отправляют форму", async () => {
  const { augDecorate, dicePlus, noSubmitButtons } = await import("../scripts/dom.mjs");
  const doc = new JSDOM(`<form>
    <section class="rollSection"><div class="addDice">${[-1, 0, 1, 2].map((i) => `<label><input type="radio" value=${i}>${i}</label>`).join("")}</div></section>
    <section class="augmentations">
      <div class="aug"><div data-item-id="a1"><button data-action="itemToggle" data-flag="isActive"></button><input type="text" value="Aug" data-action="itemName"><button data-action="itemDelAug"></button></div></div>
      <div class="aug"><div data-item-id="a2"><input type="text" value="Глаз" data-action="itemName"></div><div class="desc"><p>Видит</p></div></div>
    </section></form>`).window.document;
  const root = doc.querySelector("form");
  const items = new Map([["a1", { system: { isOpen: false, desc: "" } }], ["a2", { system: { isOpen: true, desc: "<p>Видит</p>" } }]]);
  augDecorate(root, { items, editable: true });
  dicePlus(root);
  noSubmitButtons(root);
  const [r1, r2] = root.querySelectorAll(".aug");
  assert.equal(r1.querySelector("input").name, "ngAug.a1.name");
  assert.equal(r1.querySelector("input").dataset.action, undefined);
  assert.equal(r1.querySelector(":scope > div").firstElementChild.dataset.flag, "isOpen");
  assert.equal(r1.querySelector(".desc"), null);
  const pm = r2.querySelector(".desc prose-mirror");
  assert.equal(pm.getAttribute("name"), "ngAug.a2.desc");
  assert.equal(pm.getAttribute("value"), "<p>Видит</p>");
  assert.deepEqual([...root.querySelectorAll(".addDice label")].map((l) => l.textContent.trim()), ["-1", "0", "+1", "+2"]);
  assert.equal(root.querySelectorAll("button:not([type='button'])").length, 0);
  // повторная правка не плодит стрелки и редакторы
  augDecorate(root, { items, editable: true });
  assert.equal(root.querySelectorAll(".ng-aug-open").length, 2);
  assert.equal(root.querySelectorAll("prose-mirror").length, 1);
});
