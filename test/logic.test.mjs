import assert from "node:assert/strict";
import { test } from "node:test";
import { tensionAdd, repMax, cellClick, readState, buildStatusContext } from "../scripts/logic.mjs";
import { LIFE_LEVELS } from "../scripts/data.mjs";

test("напряжение: примеры автора", () => {
  assert.deepEqual(tensionAdd({ level: 0, points: 0 }, 9), { level: 1, points: 0, overflow: 0 });
  assert.deepEqual(tensionAdd({ level: 0, points: 0 }, 10), { level: 1, points: 1, overflow: 0 });
});
test("напряжение: по одному очку 8 → 9 переносится", () => {
  assert.deepEqual(tensionAdd({ level: 0, points: 8 }, 1), { level: 1, points: 0, overflow: 0 });
  assert.deepEqual(tensionAdd({ level: 2, points: 5 }, 1), { level: 2, points: 6, overflow: 0 });
});
test("напряжение: снятие идёт обратно через уровень и не уходит ниже нуля", () => {
  assert.deepEqual(tensionAdd({ level: 1, points: 0 }, -1), { level: 0, points: 8, overflow: 0 });
  assert.deepEqual(tensionAdd({ level: 0, points: 2 }, -5), { level: 0, points: 0, overflow: 0 });
});
test("напряжение: потолок — 4 уровень, 8 очков, лишнее считается", () => {
  assert.deepEqual(tensionAdd({ level: 4, points: 7 }, 3), { level: 4, points: 8, overflow: 2 });
  assert.deepEqual(tensionAdd({ level: 3, points: 0 }, 18), { level: 4, points: 8, overflow: 1 });
});
test("напряжение: мусор на входе не ломает", () => {
  assert.deepEqual(tensionAdd({ level: "2", points: "4" }, "5"), { level: 3, points: 0, overflow: 0 });
  assert.deepEqual(tensionAdd(undefined, "abc"), { level: 0, points: 0, overflow: 0 });
});
test("репутация: максимум по рангу 6/8/10/12/14", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(repMax), [6, 8, 10, 12, 14]);
  assert.equal(repMax(0), 6);
  assert.equal(repMax(9), 14);
});
test("клик по ячейке: ставит, повторный клик по последней — снимает", () => {
  assert.equal(cellClick(0, 3), 3);
  assert.equal(cellClick(3, 3), 2);
  assert.equal(cellClick(5, 2), 2);
});
test("состояние по умолчанию и обрезка репутации под ранг", () => {
  const s = readState(undefined);
  assert.deepEqual(s, { cheki: 0, blocked: 0, rep: { rank: 1, value: 0 }, tension: { level: 0, points: 0 }, life: { level: null, note: "" }, dela: 0 });
  assert.equal(readState({ rep: { rank: 1, value: 13 } }).rep.value, 6);
});
test("контекст: заметки берутся из досье, если оно есть, иначе из старых полей 1.05", () => {
  const old = buildStatusContext({ system: { angle: { for: "Долг семье", DETAILS: "<p>Живёт в Бункере</p>" } }, items: [] });
  assert.equal(old.notes.source, "angle");
  assert.equal(old.notes.wrf, "Долг семье");
  assert.equal(old.notes.empty, false);
  const dos = buildStatusContext({ system: { angle: { for: "x" } }, items: [{ type: "dossier", system: { wrf: "Ради сестры", desc: "<p>…</p>" } }] });
  assert.equal(dos.notes.source, "dossier");
  assert.equal(dos.notes.wrf, "Ради сестры");
  assert.equal(buildStatusContext({ system: { angle: { for: "", DETAILS: "<p></p>" } }, items: [] }).notes.empty, true);
});
test("контекст: ячейки шкал", () => {
  const c = buildStatusContext({ flags: { nadgrad: { rep: { rank: 2, value: 3 }, tension: { level: 1, points: 4 }, life: { level: 3 } } } });
  assert.equal(c.repCells.length, 8);
  assert.equal(c.repCells.filter((x) => x.on).length, 3);
  assert.equal(c.tensionCells.length, 8);
  assert.equal(c.tensionCells.filter((x) => x.on).length, 4);
  assert.equal(c.tensionLevels.filter((x) => x.on).length, 1);
  assert.equal(c.lifeCurrent.name, "Стабильность");
});
test("уровни жизни: пять, по порядку, названия как в таблице", () => {
  assert.deepEqual(LIFE_LEVELS.map((l) => l.name), ["Бродяга", "Беднота", "Стабильность", "Процветание", "Лоск"]);
});

test("уровни жизни: «что даёт» — дословный текст без цен и без названия", () => {
  const words = (h) => h.replace(/<[^>]+>/g, "").split(/\s+/).filter(Boolean);
  for (const l of LIFE_LEVELS) {
    assert.ok(!/чеков/.test(l.gives), `${l.name}: остались цены`);
    assert.ok(!l.gives.includes(`${l.name}.`) && !l.gives.startsWith(`<strong>${l.name}`), `${l.name}: осталось название`);
    // каждое слово «что даёт» стоит в оригинале в том же порядке
    const full = words(l.html); let i = 0;
    for (const w of words(l.gives)) { while (i < full.length && full[i] !== w) i++; assert.ok(i < full.length, `${l.name}: «${w}» не из оригинала`); i++; }
  }
});
test("заблокированные чеки не уходят в минус", () => {
  assert.equal(readState({ blocked: -5 }).blocked, 0);
  assert.equal(readState({ blocked: 40 }).blocked, 40);
});

import { loadStep, loadIndex } from "../scripts/logic.mjs";
test("загрузка: по кругу в обе стороны, «light» из 1.05 = лёгкая", () => {
  assert.deepEqual(loadStep(0, 1), { selected: 1, key: "LOAD.MEDIUM", max: 5 });
  assert.deepEqual(loadStep(2, 1), { selected: 0, key: "LOAD.LIGHT", max: 3 });
  assert.deepEqual(loadStep(0, -1), { selected: 2, key: "LOAD.HEAVY", max: 7 });
  assert.deepEqual(loadStep("light", 1), { selected: 1, key: "LOAD.MEDIUM", max: 5 });
  assert.equal(loadIndex(undefined), 0);
});
