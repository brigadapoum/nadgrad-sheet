// Счётчики: чистая логика, картинки на диске, окно счётчика на заглушке Foundry,
// и шаблоны (clock.hbs, status.hbs) — настоящим Handlebars в настоящем DOM (jsdom).
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import Handlebars from "handlebars";
import {
  CLOCK_TYPE, CLOCK_SIZES, clockSize, normClock, clockSrc, clockStep, clockSegClick,
  clockUpdateExtras, sectorPath, clockView,
} from "../scripts/clock-logic.mjs";
import { makeClockSheet } from "../scripts/clock.mjs";
import { buildStatusContext } from "../scripts/logic.mjs";

const ROOT = new URL("../", import.meta.url);
const tpl = (name) => Handlebars.compile(readFileSync(new URL(`templates/${name}`, ROOT), "utf8"));

test("тип и размеры", () => {
  assert.equal(CLOCK_TYPE, "nadgrad.clock");
  assert.deepEqual(CLOCK_SIZES, [4, 6, 8, 10, 12]);
  assert.equal(clockSize("6"), 6);
  assert.equal(clockSize(7), 8);
  assert.equal(clockSize("мусор"), 8);
});

test("данные по умолчанию и обрезка", () => {
  assert.deepEqual(normClock(undefined), { size: 8, value: 0, theme: "tush", note: "" });
  assert.deepEqual(normClock({ size: 4, value: 9, theme: "smog" }), { size: 4, value: 4, theme: "smog", note: "" });
  assert.equal(normClock({ value: -3 }).value, 0);
  assert.equal(normClock({ theme: "нечто" }).theme, "tush");
});

test("картинка токена есть на диске для каждого размера, заполнения и темы", () => {
  assert.equal(clockSrc({ size: 8, value: 3, theme: "smog" }), "modules/nadgrad/art/clocks/smog/clock8-3.webp");
  let count = 0;
  for (const theme of ["tush", "smog"]) for (const size of CLOCK_SIZES) for (let value = 0; value <= size; value++) {
    const rel = clockSrc({ size, value, theme }).replace("modules/nadgrad/", "");
    assert.ok(existsSync(new URL(rel, ROOT)), rel);
    count++;
  }
  assert.equal(count, 90);
});

test("±1 и клики по секторам", () => {
  assert.equal(clockStep({ size: 4, value: 4 }, 1), 4);
  assert.equal(clockStep({ size: 4, value: 0 }, -1), 0);
  assert.equal(clockStep({ size: 6, value: 2 }, 1), 3);
  assert.equal(clockSegClick({ size: 8, value: 2 }, 5), 5);     // ЛКМ — до сектора
  assert.equal(clockSegClick({ size: 8, value: 5 }, 5), 4);     // повторно по последнему — снять
  assert.equal(clockSegClick({ size: 8, value: 5 }, 2), 2);     // клик раньше — откат до него
  assert.equal(clockSegClick({ size: 8, value: 5 }, 7, 2), 4);  // ПКМ — минус один
  assert.equal(clockSegClick({ size: 8, value: 0 }, 7, 2), 0);
});

test("перед сохранением: картинка, прототип токена, значение под новый размер", () => {
  const cur = { img: "modules/nadgrad/art/clocks/tush/clock8-6.webp", system: { size: 8, value: 6, theme: "tush" } };
  assert.equal(clockUpdateExtras(cur, { flags: { x: 1 } }), null);
  assert.deepEqual(clockUpdateExtras(cur, { system: { size: 4 } }), {
    "system.value": 4,
    img: "modules/nadgrad/art/clocks/tush/clock4-4.webp",
    "prototypeToken.texture.src": "modules/nadgrad/art/clocks/tush/clock4-4.webp",
  });
  assert.deepEqual(clockUpdateExtras(cur, { system: { value: 7 } }), {
    img: "modules/nadgrad/art/clocks/tush/clock8-7.webp",
    "prototypeToken.texture.src": "modules/nadgrad/art/clocks/tush/clock8-7.webp",
  });
  assert.deepEqual(clockUpdateExtras(cur, { name: "Облава" }), {
    "prototypeToken.texture.src": cur.img,
    "prototypeToken.name": "Облава",
  });
  assert.equal(clockUpdateExtras(cur, { system: { theme: "smog" } }).img, "modules/nadgrad/art/clocks/smog/clock8-6.webp");
});

test("геометрия секторов: первый начинается у верхнего шва, справа от него", () => {
  const d = sectorPath(4, 0);
  const [x, y] = d.match(/^M ([\d.]+) ([\d.]+)/).slice(1).map(Number);
  assert.ok(x > 128 && x < 131 && y > 20 && y < 23, d);
  for (const n of CLOCK_SIZES) assert.equal(clockView({ size: n }).segments.length, n);
  const v = clockView({ size: 6, value: 6, theme: "smog" });
  assert.equal(v.full, true);
  assert.equal(v.sizes.find((s) => s.on).n, 6);
  assert.equal(v.themes.find((t) => t.on).id, "smog");
});

// ---- окно счётчика на заглушке ----
class Base {
  static DEFAULT_OPTIONS = {};
  constructor(actor) {
    this.actor = actor; this.isEditable = true;
    this.options = { actions: this.constructor.DEFAULT_OPTIONS.actions };
    this.dom = new JSDOM(`<form class="application nadgrad ng-clock-sheet"><section class="window-content"></section></form>`);
    this.element = this.dom.window.document.querySelector("form");
  }
  async _prepareContext() { return {}; }
  async _onRender() {}
}
const Sheet = makeClockSheet(Base);
function makeClock(system = {}) {
  const a = { id: "abc", name: "Облава", type: CLOCK_TYPE, system: { size: 8, value: 0, theme: "tush", note: "", ...system }, updates: [] };
  a.update = async (data) => {
    a.updates.push(data);
    for (const [k, v] of Object.entries(data)) a.system[k.replace("system.", "")] = v;
  };
  return a;
}
const act = (sh, name, dataset = {}, button = 0) => {
  const a = sh.options.actions[name]; const h = typeof a === "function" ? a : a.handler;
  return h.call(sh, { button }, { dataset });
};
async function render(sh) {
  const ctx = await sh._prepareContext({});
  sh.element.querySelector(".window-content").innerHTML = tpl("clock.hbs")(ctx);
  await sh._onRender(ctx, {});
  return ctx;
}

test("окно: части, действия, тема по счётчику", async () => {
  assert.deepEqual(Object.keys(Sheet.PARTS), ["main"]);
  assert.equal(Sheet.DEFAULT_OPTIONS.form.submitOnChange, true);
  const sh = new Sheet(makeClock({ theme: "smog", value: 3 }));
  await render(sh);
  assert.ok(sh.element.classList.contains("ng-clock-smog"));
  assert.equal(sh.element.querySelectorAll("path.seg").length, 8);
  assert.equal(sh.element.querySelectorAll("path.seg.on").length, 3);
  assert.equal(sh.element.querySelector("text.num").textContent, "8");
  assert.equal(sh.element.querySelector("input.ng-clock-name").value, "Облава");
  assert.equal(sh.element.querySelector(".ng-clock-val").textContent.trim(), "3 / 8");
  // все data-action из шаблона есть среди действий окна
  for (const el of sh.element.querySelectorAll("[data-action]")) assert.ok(sh.options.actions[el.dataset.action], el.dataset.action);
});

test("окно: клики по секторам, ±, размер, тема; без прав — ничего", async () => {
  const a = makeClock({ value: 2 }); const sh = new Sheet(a);
  await act(sh, "ngClockSeg", { n: "5" });
  assert.equal(a.system.value, 5);
  await act(sh, "ngClockSeg", { n: "5" });
  assert.equal(a.system.value, 4);
  await act(sh, "ngClockSeg", { n: "1" }, 2);
  assert.equal(a.system.value, 3);
  await act(sh, "ngClockStep", { delta: "1" });
  assert.equal(a.system.value, 4);
  await act(sh, "ngClockSize", { size: "6" });
  assert.equal(a.system.size, 6);
  await act(sh, "ngClockTheme", { theme: "smog" });
  assert.equal(a.system.theme, "smog");
  const n = a.updates.length;
  await act(sh, "ngClockStep", { delta: "0" });   // без изменений — без записи
  sh.isEditable = false;
  await act(sh, "ngClockSeg", { n: "6" });
  await act(sh, "ngClockSize", { size: "12" });
  assert.equal(a.updates.length, n);
});

test("заполненный счётчик помечается в шаблоне", async () => {
  const sh = new Sheet(makeClock({ size: 4, value: 4 }));
  await render(sh);
  assert.ok(sh.element.querySelector(".ng-clock.full"));
});

test("статус: кнопки ранга 0 и уровня напряжения 0 в шаблоне", () => {
  const html = tpl("status.hbs")({ ng: buildStatusContext({}), ngEditable: true });
  const doc = new JSDOM(html).window.document;
  const ranks = [...doc.querySelectorAll("[data-action='ngRepRank']")];
  assert.deepEqual(ranks.map((b) => b.dataset.rank), ["0", "1", "2", "3", "4", "5"]);
  assert.ok(ranks[0].classList.contains("on"));
  assert.ok(doc.querySelector("[data-action='ngTensionZero']").classList.contains("on"));
  assert.equal(doc.querySelectorAll(".ng-rep .ng-cell").length, 6);
});
