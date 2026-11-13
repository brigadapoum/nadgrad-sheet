// Передышка: логика (таблицы, бюджет, «было → станет»), шаблон вкладки и сценарии на листе с заглушкой Foundry.
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";
import { JSDOM } from "jsdom";
import {
  ACTIONS, actionById, rollValue, tierIndex, valueText, poolOf, readDowntime, budget, newDowntime, outcome,
  applyPlan, heal3Plan, buyPlan, buyEntry, newEntry, entryLine, downtimeContext, lastContext, CLINICS,
} from "../scripts/downtime-logic.mjs";

const tpl = (n) => Handlebars.compile(readFileSync(new URL(`../templates/${n}`, import.meta.url), "utf8"));

// ---------- логика ----------

test("результат: лучший куб, две шестёрки — 6×6, пул 0 — худший из двух, +1 за чеки — шаг вверх до 6×6", () => {
  assert.equal(rollValue([2, 5, 3]), 5);
  assert.equal(rollValue([6, 6, 1]), 7);
  assert.equal(valueText(7), "6×6");
  assert.equal(rollValue([6, 2], { lowest: true }), 2);
  assert.equal(rollValue([3], { bonus: 1 }), 4);
  assert.equal(rollValue([6], { bonus: 3 }), 7);
  assert.deepEqual([1, 3, 4, 5, 6, 7].map(tierIndex), [0, 0, 1, 1, 2, 3]);
  assert.deepEqual(poolOf(0), { count: 2, lowest: true });
  assert.deepEqual(poolOf(9), { count: 6, lowest: false });
});

test("таблицы правил 0.9: напряжение, проект, негативный счётчик, лечение, качество", () => {
  const t = (kind, dice, extra = {}) => outcome({ kind, dice, bonus: 0, ...extra });
  assert.deepEqual([[2], [5], [6], [6, 6]].map((d) => t("tension", d).amount), [0, -2, -3, -5]);
  assert.deepEqual([[2], [5], [6], [6, 6]].map((d) => t("project", d).amount), [1, 2, 3, 5]);
  assert.deepEqual([[2], [5], [6], [6, 6]].map((d) => t("negclock", d).amount), [1, -2, -3, -5]);
  assert.deepEqual([[2], [5], [6], [6, 6]].map((d) => t("heal2", d).amount), [1, 3, 4, 5]);
  assert.deepEqual([[2], [5], [6], [6, 6]].map((d) => t("resource", d, { rank: 2 }).quality), [1, 2, 3, 4]);
  assert.equal(t("resource", [2], { rank: 0 }).quality, 0, "качество не ниже 0");
  assert.equal(t("craft", [6], { rank: 1, qualityBought: 2 }).quality, 4);
  assert.equal(t("passion", [5, 3]).amount, 5, "страсть: стирается максимум куба");
  assert.equal(t("passion", [6, 6]).amount, 6);
  assert.equal(t("tension", [2]).text, "напряжение не снижается");
});

test("бюджет: 2 бесплатных, покупки добавляют клетку, броски тратят, покупка и лечение 3 ур. — нет", () => {
  const dt = readDowntime({ downtime: { bought: 1, log: [
    newEntry({ id: "a", kind: "tension", dice: [5] }),
    buyEntry({ id: "b", note: "5 чеков" }),
    newEntry({ id: "c", kind: "heal3", note: "Цепь-2" }),
    newEntry({ id: "d", kind: "record", note: "переезд" }),
  ] } });
  const b = budget(dt);
  assert.deepEqual([b.total, b.used, b.left], [3, 2, 1]);
  assert.deepEqual(b.cells.map((c) => [c.used, c.bought]), [[true, false], [true, false], [false, true]]);
  assert.equal(dt.log.find((e) => e.id === "c").spends, false);
  assert.equal(dt.log.find((e) => e.id === "d").status, "info");
});

test("новая передышка: журнал в архив (не больше 5), снова 2 бесплатных, часы лечения остаются", () => {
  let dt = readDowntime({ downtime: { bought: 2, log: [newEntry({ id: "a", kind: "tension", dice: [5] })], heal: { first: 3 } } });
  for (let i = 0; i < 7; i++) dt = readDowntime({ downtime: { ...newDowntime({ ...dt, log: [newEntry({ id: `x${i}`, kind: "record", note: "n" })] }, i) } });
  assert.equal(dt.archive.length, 5);
  assert.equal(dt.bought, 0);
  assert.equal(dt.log.length, 0);
  assert.equal(dt.heal.first, 3);
});

const STATE = {
  cheki: 12, tension: { level: 1, points: 5 }, rank: 2, stress: { value: 4, max: 7 },
  projects: [{ id: "p1", name: "Планер", size: 8, value: 6, note: "" }],
  heal: { first: 1, second: 0 },
  harm: { medium: { first: "Ожог", second: "" }, hard: "Пробито лёгкое" },
  clocks: [{ id: "k1", name: "Виверны", size: 6, value: 3 }],
};
const pend = (kind, dice, extra = {}) => ({ ...newEntry({ id: "e", kind, dice, ...extra }), ...extra });

test("«Применить» напряжение и страсть: было → станет; отрыв — галочка +1 напряжение", () => {
  const t = applyPlan(pend("tension", [5]), STATE);
  assert.deepEqual(t.lines, [{ label: "Напряжение", from: "ур. 1 · 5", to: "ур. 1 · 3" }]);
  assert.deepEqual(t.actor, { "flags.nadgrad.tension": { level: 1, points: 3 } });
  const big = applyPlan(pend("tension", [6, 6]), { ...STATE, tension: { level: 1, points: 2 } });
  assert.equal(big.lines[0].to, "ур. 0 · 6", "−5 с переносом через уровень");
  const p = applyPlan(pend("passion", [6]), STATE);
  assert.deepEqual(p.actor, { "system.stress.value": 0 });
  assert.ok(p.overindulge);
  assert.equal(p.extra.checked, true);
  assert.deepEqual(p.extra.value, { level: 1, points: 6 });
  assert.ok(!applyPlan(pend("passion", [3]), STATE).extra, "стресса хватает — отрыва нет");
});

test("«Применить» проект, счётчик, лечение 2 ур.; ничего не делает с уже применённым", () => {
  const pr = applyPlan(pend("project", [6, 6], { target: "p1" }), STATE);
  assert.equal(pr.projects[0].value, 8);
  assert.ok(pr.done);
  assert.ok(applyPlan(pend("project", [5], { target: "нет" }), STATE).warn);
  const k = applyPlan(pend("negclock", [6], { target: "k1" }), STATE);
  assert.deepEqual(k.clock, { id: "k1", value: 0 });
  assert.ok(applyPlan(pend("negclock", [6], { target: "чужой" }), STATE).warn);
  const h = applyPlan(pend("heal2", [5], { target: "first" }), STATE);
  assert.deepEqual(h.heal, { first: 0 }, "1 + 3 = 4 — вылечено, часы обнулены");
  assert.equal(h.actor["system.HARM.medium.first.name"], "");
  const h2 = applyPlan(pend("heal2", [2], { target: "first" }), STATE);
  assert.deepEqual(h2.heal, { first: 2 });
  assert.equal(h2.actor["system.HARM.medium.first.name"], undefined);
  assert.equal(applyPlan({ ...pend("tension", [5]), status: "applied" }, STATE), null);
});

test("ресурс: качество в журнал, контрабанда — +1 напряжение в том же окне", () => {
  const r = applyPlan(pend("resource", [6], { rank: 2, note: "фургон", contraband: true }), STATE);
  assert.equal(r.lines[0].to, "ранг качества 3");
  assert.deepEqual(r.actor["flags.nadgrad.tension"], { level: 1, points: 6 });
  assert.deepEqual(applyPlan(pend("craft", [5], { rank: 2 }), STATE).actor, {});
});

test("лечение 3 уровня: цена — из чеков, повреждение в свободную ячейку 2 ур.; занято — предупреждение", () => {
  const p = heal3Plan(STATE, 15);
  assert.equal(p.slot, "second");
  assert.deepEqual(p.actor, { "flags.nadgrad.cheki": -3, "system.HARM.hard.name": "", "system.HARM.medium.second.name": "Пробито лёгкое" });
  assert.ok(p.short);
  assert.ok(heal3Plan({ ...STATE, harm: { medium: { first: "a", second: "b" }, hard: "x" } }, 5).warn);
  assert.ok(heal3Plan({ ...STATE, harm: { medium: {}, hard: "" } }, 5).warn);
  assert.equal(CLINICS.find((c) => c.id === "pan").formula, "30+2d6");
});

test("покупки: 5 чеков / +2 напряжения / флешбек — оба; +1 к результату; ранг качества", () => {
  assert.deepEqual(buyPlan("cheki", STATE).actor, { "flags.nadgrad.cheki": 7 });
  assert.deepEqual(buyPlan("tension", STATE).actor, { "flags.nadgrad.tension": { level: 1, points: 7 } });
  const f = buyPlan("flash", STATE);
  assert.equal(f.lines.length, 2);
  assert.deepEqual(buyPlan("quality", STATE, { qualityCost: 6 }).actor, { "flags.nadgrad.cheki": 6 });
  assert.ok(buyPlan("cheki", { ...STATE, cheki: 3 }).short);
  assert.equal(buyPlan("чепуха", STATE), null);
});

test("журнал и карточка последнего броска", () => {
  const e = { ...newEntry({ id: "e1", kind: "project", dice: [2, 5, 3], target: "p1" }), bonus: 1 };
  assert.equal(entryLine(e, { p1: "Планер" }), "Долгосрочный проект · Планер · 5 → часы +3 (+1 за чеки)");
  const l = lastContext(e);
  assert.deepEqual(l.dice.map((d) => d.on), [false, true, false]);
  assert.equal(l.table.findIndex((r) => r.on), 1, "куб не меняется — подсвечен ряд 4–5");
  assert.equal(l.applyText, "часы +3");
  assert.ok(l.canBonus);
  const ctx = downtimeContext(readDowntime({ downtime: { log: [e] } }), { open: "project" });
  assert.equal(ctx.actions.find((a) => a.open).id, "project");
  assert.equal(ctx.pendingCount, 1);
  assert.equal(ACTIONS.length, 9);
  assert.ok(actionById("heal3").free);
});

// ---------- шаблон ----------

test("шаблон вкладки: бюджет, карточки, открытая карточка с результатом, журнал", () => {
  const e = { ...newEntry({ id: "e1", kind: "tension", dice: [2, 5, 3] }) };
  const dt = readDowntime({ downtime: { bought: 1, log: [e] } });
  const ng = { dt: { ...downtimeContext(dt, { open: "tension" }), res: { cheki: 12, tension: { level: 1, points: 5 }, stress: "4/7", rank: 2 } } };
  ng.dt.card = {
    draft: { note: "", doc: 2 }, ask: "Что делаешь", roll: true, isSkill: true,
    approaches: [{ id: "SMART", label: "УМНО", dice: 2, on: true }], skills: [{ id: "ANALYZE", label: "АНАЛИЗ", dice: 1, on: true }],
    poolText: "Пул 3d6 — УМНО + АНАЛИЗ", last: lastContext(e),
  };
  const doc = new JSDOM(tpl("breather.hbs")({ ng, ngEditable: true })).window.document;
  assert.equal(doc.querySelectorAll(".ng-dt-cell").length, 3);
  assert.equal(doc.querySelectorAll(".ng-dt-cell.used").length, 1);
  assert.equal(doc.querySelectorAll(".ng-dt-act").length, 9);
  assert.ok(doc.querySelector(".ng-dt-act.open[data-kind='tension'] select[data-dt='approach']"));
  assert.match(doc.querySelector(".ng-dt-result .ng-dt-apply").textContent, /−2 напряжения/);
  assert.equal(doc.querySelector(".ng-dt-table .on b").textContent, "−2");
  assert.ok(doc.querySelector(".ng-dt-log [data-action='ngDtApply']"));
  assert.ok(doc.querySelector("[data-action='ngDtBuy'][data-kind='flash']"));
  assert.ok(doc.querySelector("[data-action='ngDtNew']"));
  // без прав — нет покупок и «Новой передышки»
  const ro = new JSDOM(tpl("breather.hbs")({ ng, ngEditable: false })).window.document;
  assert.equal(ro.querySelector("[data-action='ngDtBuy']"), null);
});

// ---------- сценарии на листе ----------

const { makeSheetClass } = await import("../scripts/sheet.mjs");

const DIALOGS = [];
let NEXT = [];
let ROLLS = [];
const CHAT = [];
globalThis.ui = { notifications: { warns: [], warn(m) { this.warns.push(m); }, info() {}, error() {} } };
globalThis.game = {
  i18n: { localize: (k) => k },
  settings: { get: () => "auto", set: async () => {} },
  user: { id: "u1", isGM: false },
  users: { contents: [] },
  actors: { contents: [], get: () => null },
};
globalThis.ChatMessage = { create: async (m) => CHAT.push(m), getSpeaker: () => ({}) };
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() {
    const dice = ROLLS.shift() ?? [1];
    this.dice = [{ results: dice.map((result) => ({ result })) }];
    this.total = dice.reduce((a, b) => a + b, 0);
    return this;
  }
};
const answer = () => NEXT.shift() ?? "no";
globalThis.foundry = {
  applications: {
    api: {
      DialogV2: {
        wait: async (o) => {
          DIALOGS.push(o);
          const a = answer();
          const id = a === "ok-noextra" ? "ok" : a;
          const b = o.buttons.find((x) => x.action === id);
          return b?.callback ? b.callback({}, { form: { elements: { extra: { checked: a !== "ok-noextra" } } } }) : id;
        },
        confirm: async (o) => { DIALOGS.push(o); return answer() === "yes"; },
      },
    },
    handlebars: { renderTemplate: async () => "<div>card</div>" },
  },
};
beforeEach(() => { DIALOGS.length = 0; CHAT.length = 0; NEXT = []; ROLLS = []; ui.notifications.warns = []; });

class Runner {
  static DEFAULT_OPTIONS = { classes: ["runner-actor"], actions: {} };
  static PARTS = { form: { template: "x" } };
  constructor(actor) {
    this.actor = actor; this.isEditable = true;
    const C = this.constructor;
    this.options = { actions: { ...C.DEFAULT_OPTIONS.actions } };
    this.element = new JSDOM(`<form><div data-application-part="breather"><div class="ng-breather"></div></div></form>`).window.document.querySelector("form");
  }
  async _prepareContext() { return {}; }
  async _onRender() {}
  async render() { this.renders = (this.renders ?? 0) + 1; }
}
const S = makeSheetClass(Runner);
function makeActor(flags = {}, system = {}) {
  const a = {
    id: "r1", name: "Чужбина", img: "i.png", type: "runner", items: [], updates: [],
    flags: { nadgrad: { cheki: 12, tension: { level: 1, points: 5 }, rep: { rank: 2, value: 0 }, ...flags } },
    system: {
      stress: { value: 4, max: 7 }, roll: { approach: "SMART", skill: "ANALYZE" },
      approach: { SMART: { dice: 2 }, AGGRESSIVE: { dice: 1 } }, skills: { ANALYZE: { dice: 1 }, CODING: { dice: 2 } },
      HARM: { medium: { first: { name: "Ожог" }, second: { name: "" } }, hard: { name: "" } },
      ...system,
    },
  };
  a.update = async (data) => {
    a.updates.push(data);
    for (const [k, v] of Object.entries(data)) {
      const parts = k.split("."); let o = a;
      for (const p of parts.slice(0, -1)) o = o[p] ??= {};
      o[parts.at(-1)] = v;
    }
  };
  return a;
}
const act = (sh, name, dataset = {}) => sh.options.actions[name].call(sh, {}, { dataset });

test("лист: части и действия передышки на месте", () => {
  assert.ok(Object.keys(S.PARTS).includes("breather"));
  for (const k of ["ngDtOpen", "ngDtBuy", "ngDtRoll", "ngDtApply", "ngDtDecline", "ngDtBonus", "ngDtQuality", "ngDtRecord", "ngDtPrice", "ngDtHeal3", "ngDtNew"]) assert.ok(S.DEFAULT_OPTIONS.actions[k], k);
});

test("сценарий: купить действие → бросок → +1 к результату → применить; значения меняются только после «Применить»", async () => {
  const a = makeActor();
  const sh = new S(a);
  NEXT = ["ok"];
  await act(sh, "ngDtBuy", { kind: "cheki" });
  assert.equal(a.flags.nadgrad.cheki, 7);
  assert.equal(a.flags.nadgrad.downtime.bought, 1);

  await act(sh, "ngDtOpen", { kind: "tension" });
  ROLLS = [[2, 5, 3]];
  await act(sh, "ngDtRoll");
  const e = a.flags.nadgrad.downtime.log.at(-1);
  assert.equal(e.kind, "tension");
  assert.deepEqual(e.dice, [2, 5, 3]);
  assert.equal(e.pool, 3, "подход УМНО 2 + навык АНАЛИЗ 1");
  assert.deepEqual(a.flags.nadgrad.tension, { level: 1, points: 5 }, "бросок сам ничего не меняет");

  NEXT = ["ok"];
  await act(sh, "ngDtBonus", { id: e.id });
  assert.equal(a.flags.nadgrad.cheki, 2);
  assert.equal(a.flags.nadgrad.downtime.log.at(-1).bonus, 1);

  NEXT = ["ok"];
  await act(sh, "ngDtApply", { id: e.id });
  assert.deepEqual(a.flags.nadgrad.tension, { level: 1, points: 2 }, "6 → −3");
  assert.equal(a.flags.nadgrad.downtime.log.at(-1).status, "applied");
  NEXT = ["ok"];
  await act(sh, "ngDtApply", { id: e.id });
  assert.deepEqual(a.flags.nadgrad.tension, { level: 1, points: 2 }, "второй раз не применяется");
});

test("сценарий: «Не сейчас» в окне — ничего не меняется", async () => {
  const a = makeActor();
  const sh = new S(a);
  NEXT = ["no"];
  await act(sh, "ngDtBuy", { kind: "tension" });
  assert.equal(a.updates.length, 0);
});

test("сценарий: новый бросок при неприменённом — окно; «Оставить» — оба в журнале, «Отказаться» — зачёркнут", async () => {
  const a = makeActor({ downtime: { bought: 2 } });
  const sh = new S(a);
  await act(sh, "ngDtOpen", { kind: "tension" });
  ROLLS = [[5]];
  await act(sh, "ngDtRoll");
  NEXT = ["keep"];
  ROLLS = [[6]];
  await act(sh, "ngDtRoll");
  assert.match(DIALOGS.at(-1).window.title, /не применён/);
  assert.deepEqual(a.flags.nadgrad.downtime.log.map((x) => x.status), ["pending", "pending"]);
  NEXT = ["decline"];
  ROLLS = [[3]];
  await act(sh, "ngDtRoll");
  assert.deepEqual(a.flags.nadgrad.downtime.log.map((x) => x.status), ["pending", "declined", "pending"]);
  NEXT = ["cancel"];
  await act(sh, "ngDtRoll");
  assert.equal(a.flags.nadgrad.downtime.log.length, 3, "отмена — без броска");
});

test("сценарий: действия кончились — бросок не делается; лечение 3 уровня действие не тратит", async () => {
  const a = makeActor({ downtime: { log: [newEntry({ id: "x", kind: "record", note: "a" }), newEntry({ id: "y", kind: "record", note: "b" })] } }, {
    HARM: { medium: { first: { name: "Ожог" }, second: { name: "" } }, hard: { name: "Пробито лёгкое" } },
  });
  const sh = new S(a);
  await act(sh, "ngDtOpen", { kind: "tension" });
  await act(sh, "ngDtRoll");
  assert.match(ui.notifications.warns.at(-1), /кончились/);
  await act(sh, "ngDtOpen", { kind: "heal3" });
  sh._ngDt.clinic = "c2";
  ROLLS = [[12, 4]];
  await act(sh, "ngDtPrice");
  assert.equal(sh._ngDt.price, 16);
  NEXT = ["ok"];
  await act(sh, "ngDtHeal3");
  assert.equal(a.flags.nadgrad.cheki, -4);
  assert.equal(a.system.HARM.hard.name, "");
  assert.equal(a.system.HARM.medium.second.name, "Пробито лёгкое");
  assert.equal(budget(readDowntime(a.flags.nadgrad)).left, 0);
});

test("сценарий: страсть с отрывом — галочка ставит +1 напряжение; без галочки — только стресс", async () => {
  const a = makeActor();
  const sh = new S(a);
  await act(sh, "ngDtOpen", { kind: "passion" });
  ROLLS = [[6, 2]];
  await act(sh, "ngDtRoll");
  NEXT = ["ok"];
  await act(sh, "ngDtApply", { id: a.flags.nadgrad.downtime.log.at(-1).id });
  assert.equal(a.system.stress.value, 0);
  assert.deepEqual(a.flags.nadgrad.tension, { level: 1, points: 6 });
  const b = makeActor();
  const sb = new S(b);
  await act(sb, "ngDtOpen", { kind: "passion" });
  ROLLS = [[6]];
  await act(sb, "ngDtRoll");
  NEXT = ["ok-noextra"];
  const res = await act(sb, "ngDtApply", { id: b.flags.nadgrad.downtime.log.at(-1).id });
  assert.equal(res, true);
  assert.equal(b.system.stress.value, 0);
  assert.deepEqual(b.flags.nadgrad.tension, { level: 1, points: 5 }, "галочку сняли — напряжение не растёт");
});

test("сценарий: новая передышка — снова 2 бесплатных, журнал в архив; форма не пишет поля передышки в актёра", async () => {
  const a = makeActor({ downtime: { bought: 2, log: [newEntry({ id: "x", kind: "record", note: "a" })] } });
  const sh = new S(a);
  NEXT = ["yes"];
  await act(sh, "ngDtNew");
  const dt = readDowntime(a.flags.nadgrad);
  assert.deepEqual([dt.bought, dt.log.length, dt.archive.length], [0, 0, 1]);
  await S.DEFAULT_OPTIONS.form.handler.call(sh, { preventDefault() {} }, sh.element, { object: { "ngDt.clinic": "c2", "flags.nadgrad.why": "x" } });
  assert.ok(!a.updates.some((u) => Object.keys(u).some((k) => k.startsWith("ngDt"))));
});

test("+1 к результату за чеки — +1 к итогу действия в пользу рискаря (автор, 2026-11-13)", () => {
  const t = (kind, dice, bonus) => outcome({ kind, dice, bonus });
  assert.equal(t("project", [5], 1).amount, 3, "частичный +2 и +1 за чеки = +3");
  assert.equal(t("project", [5], 1).value, 5, "куб не меняется");
  assert.equal(t("heal2", [2], 2).amount, 3);
  assert.equal(t("tension", [5], 1).amount, -3);
  assert.equal(t("negclock", [2], 1).amount, 0, "провал +1, с чеками 0");
  assert.equal(t("passion", [4], 1).amount, 5);
  assert.equal(t("resource", [5], 3).quality, t("resource", [5], 0).quality, "у ресурса бонус не действует — там покупается качество");
  assert.ok(!lastContext({ ...newEntry({ id: "r", kind: "resource", dice: [5] }) }).canBonus);
  assert.ok(lastContext({ ...newEntry({ id: "p", kind: "project", dice: [6, 6], target: "x" }) }).canBonus, "и после 6×6 можно докупить");
});

test("лечение 2 уровня: вылеченное повреждение уходит на 1 уровень (домашнее правило)", () => {
  const e = { ...newEntry({ id: "h", kind: "heal2", dice: [6, 6], target: "first" }) };
  const st = { harm: { light: { first: "Ушиб", second: "" }, medium: { first: "Перелом", second: "" } }, heal: { first: 1, second: 0 } };
  const p = applyPlan(e, st);
  assert.equal(p.actor["system.HARM.medium.first.name"], "");
  assert.equal(p.actor["system.HARM.light.second.name"], "Перелом");
  assert.deepEqual(p.heal, { first: 0 });
  const full = applyPlan(e, { ...st, harm: { ...st.harm, light: { first: "a", second: "b" } } });
  assert.ok(full.lines.some((l) => /впиши вручную/.test(l.to)));
});
