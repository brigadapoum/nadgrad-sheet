// Прогон класса листа на заглушке Foundry: ловим ошибки private-полей, действий и вкладок.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeSheetClass } from "../scripts/sheet.mjs";

globalThis.ui = { notifications: { warns: [], warn(m) { this.warns.push(m); } } };

class FakeEl {
  constructor(attrs = {}) { this.attrs = attrs; this.cls = new Set(); this.value = attrs.value ?? ""; this.dataset = attrs.dataset ?? {}; }
  get classList() { const s = this.cls; return { toggle: (c, on) => (on ? s.add(c) : s.delete(c)), contains: (c) => s.has(c) }; }
  scrollTo() {}
}
class Runner {
  static DEFAULT_OPTIONS = { classes: ["runner-actor"], actions: { openNotes: function () { this.openedNotes = true; } } };
  static PARTS = { form: { template: "systems/CBRPNK/actors/runner/runner.hbs" } };
  constructor(actor) {
    this.actor = actor; this.isEditable = true;
    const C = this.constructor;
    this.options = { actions: { ...Runner.DEFAULT_OPTIONS.actions, ...C.DEFAULT_OPTIONS.actions } };
    this.parts = { form: new FakeEl(), status: new FakeEl(), relations: new FakeEl(), projects: new FakeEl(), ngTabs: new FakeEl() };
    this.tabBtns = ["sheet", "status", "relations", "projects"].map((tab) => new FakeEl({ dataset: { tab } }));
    this.addInput = new FakeEl({ value: "" });
    this.element = {
      querySelector: (sel) => {
        if (sel.includes('"form"')) return this.parts.form;
        for (const p of ["status", "relations", "projects"]) if (sel.includes(`"${p}"`)) return this.parts[p];
        if (sel.includes("ng-tension-add")) return this.addInput;
        if (sel === ".window-content") return new FakeEl();
        return null;
      },
      querySelectorAll: () => this.tabBtns,
    };
  }
  async _prepareContext() { return { base: true }; }
  async _onRender() {}
}
function makeActor(flags = {}) {
  const a = { flags: { nadgrad: flags }, system: { angle: { for: "", DETAILS: "" } }, items: [], updates: [] };
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
  assert.ok(sh.parts.status.classList.contains("ng-hidden"));
  assert.ok(!sh.parts.form.classList.contains("ng-hidden"));
  await act(sh, "ngTab", { tab: "status" });
  assert.ok(sh.parts.form.classList.contains("ng-hidden"));
  assert.ok(!sh.parts.status.classList.contains("ng-hidden"));
  assert.ok(sh.tabBtns[1].classList.contains("active"));
});
test("чеки и дела", async () => {
  const a = makeActor(); const sh = new S(a);
  await act(sh, "ngStep", { field: "cheki", delta: "1" });
  await act(sh, "ngStep", { field: "cheki", delta: "-1" });
  await act(sh, "ngStep", { field: "cheki", delta: "-1" });
  assert.equal(a.flags.nadgrad.cheki, -1);
  await act(sh, "ngStep", { field: "dela", delta: "-1" });
  assert.equal(a.flags.nadgrad.dela, 0);
});
test("репутация: ячейка, ранг обрезает значение", async () => {
  const a = makeActor({ rep: { rank: 3, value: 0 } }); const sh = new S(a);
  await act(sh, "ngRepCell", { n: "9" });
  assert.equal(a.flags.nadgrad.rep.value, 9);
  await act(sh, "ngRepRank", { rank: "1" });
  assert.deepEqual(a.flags.nadgrad.rep, { rank: 1, value: 6 });
});
test("напряжение: ЛКМ/ПКМ, +N с переносом, потолок", async () => {
  const a = makeActor({ tension: { level: 0, points: 8 } }); const sh = new S(a);
  await act(sh, "ngTensionStep", {}, 0);
  assert.deepEqual(a.flags.nadgrad.tension, { level: 1, points: 0 });
  await act(sh, "ngTensionStep", {}, 2);
  assert.deepEqual(a.flags.nadgrad.tension, { level: 0, points: 8 });
  sh.addInput.value = "10";
  await act(sh, "ngTensionAdd");
  assert.deepEqual(a.flags.nadgrad.tension, { level: 2, points: 0 });
  assert.equal(sh.addInput.value, "");
  sh.addInput.value = "40";
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

test("вкладки «Отношения» и «Проекты» переключаются", async () => {
  const sh = new S(makeActor());
  await sh._onRender({}, {});
  await act(sh, "ngTab", { tab: "projects" });
  for (const p of ["form", "status", "relations"]) assert.ok(sh.parts[p].classList.contains("ng-hidden"), p);
  assert.ok(!sh.parts.projects.classList.contains("ng-hidden"));
});
test("заблокированные чеки: −/+ и не ниже нуля", async () => {
  const a = makeActor(); const sh = new S(a);
  await act(sh, "ngStep", { field: "blocked", delta: "1" });
  await act(sh, "ngStep", { field: "blocked", delta: "-1" });
  await act(sh, "ngStep", { field: "blocked", delta: "-1" });
  assert.equal(a.flags.nadgrad.blocked, 0);
});
