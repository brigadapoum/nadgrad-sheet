// Кольца токенов рискарей: кольца Надграда, список, откат картинок 0.8.0, шаблон окна, спрайт-листы.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import Handlebars from "handlebars";
import { JSDOM } from "jsdom";
import {
  RINGS, RING_DEFAULT, ringPath, isNadgradRing, playerRunners, rowContext, ringToken, ringPrototype, restorePlan,
} from "../scripts/tokens-logic.mjs";

const ROOT = new URL("../", import.meta.url);
const tpl = (n) => Handlebars.compile(readFileSync(new URL(`templates/${n}`, ROOT), "utf8"));

test("кольца Надграда: Тушь по умолчанию, Смог; пути к спрайт-листам модуля", () => {
  assert.deepEqual(Object.keys(RINGS), ["nadgradTush", "nadgradSmog"]);
  assert.equal(RING_DEFAULT, "nadgradTush");
  assert.equal(ringPath("nadgrad", "nadgradTush"), "modules/nadgrad/art/rings/nadgrad-tush.json");
  assert.ok(isNadgradRing("nadgradSmog"));
  assert.ok(!isNadgradRing("coreSteel"));
});

test("спрайт-листы: все кадры размеров ядра, картинка рядом, полоса цвета и цвет по умолчанию", () => {
  for (const id of Object.keys(RINGS)) {
    const url = new URL(ringPath(".", id).replace(/^modules\/\.\//, ""), ROOT);
    const j = JSON.parse(readFileSync(url, "utf8"));
    for (const size of ["gnt", "hge", "lrg", "med", "tny"]) {
      assert.ok(j.frames[`${size}-ring`], `${id}: ${size}-ring`);
      assert.ok(j.frames[`${size}-ring-bkg`], `${id}: ${size}-ring-bkg`);
      assert.ok(j.frames[`${size}-ring`].gridTarget > 0);
    }
    assert.ok(existsSync(new URL(j.meta.image, url)), `${id}: ${j.meta.image}`);
    assert.ok(j.config.defaultColorBand.startRadius < j.config.defaultColorBand.endRadius);
    assert.match(j.config.defaultRingColor, /^#[0-9A-F]{6}$/i);
    // кадры не вылезают за лист
    for (const f of Object.values(j.frames)) assert.ok(f.frame.x + f.frame.w <= j.meta.size.w && f.frame.h <= j.meta.size.h);
  }
});

test("список: только рискари с владельцем-игроком, не мастером; по алфавиту", () => {
  const users = [{ id: "gm", isGM: true }, { id: "p1", isGM: false }, { id: "p2", isGM: false }];
  const actors = [
    { id: "a", type: "runner", name: "Яблоко", ownership: { p1: 3 } },
    { id: "b", type: "runner", name: "Гонг", ownership: { gm: 3, p2: 3 } },
    { id: "c", type: "runner", name: "Мастерский", ownership: { gm: 3, p1: 2 } },
    { id: "d", type: "nadgrad.clock", name: "Часы", ownership: { p1: 3 } },
  ];
  assert.deepEqual(playerRunners(actors, users).map((a) => a.id), ["b", "a"]);
});

test("строка списка и что пишется: только ring.enabled, картинку не трогаем", () => {
  const owners = new Map([["p1", "Лера"]]);
  const a = { id: "a", name: "Кай", img: "p.jpg", ownership: { p1: 3, gm: 3 }, prototypeToken: { texture: { src: "t.jpg" }, ring: { enabled: true } } };
  assert.deepEqual(rowContext(a, owners), { id: "a", name: "Кай", thumb: "t.jpg", owners: "Лера", ring: true });
  assert.deepEqual(ringToken(true), { "ring.enabled": true });
  assert.deepEqual(ringPrototype(false), { "prototypeToken.ring.enabled": false });
});

test("откат 0.8.0: где стоит испечённая картинка — возвращаем исходник и снимаем флаг", () => {
  const actor = {
    prototypeToken: { texture: { src: "worlds/neon/nadgrad-tokens/a-1.webp" } },
    flags: { nadgrad: { token: { src: "media/home/worlds/neon/art/x.jpg", out: "worlds/neon/nadgrad-tokens/a-1.webp" } } },
  };
  const toks = [
    { id: "t1", texture: { src: "worlds/neon/nadgrad-tokens/a-1.webp" } },
    { id: "t2", texture: { src: "своя-картинка.png" } }, // мастер поменял руками — не трогаем
  ];
  const plan = restorePlan(actor, toks);
  assert.deepEqual(plan.proto, { "prototypeToken.texture.src": "media/home/worlds/neon/art/x.jpg", "flags.nadgrad.-=token": null });
  assert.deepEqual(plan.tokens, [{ _id: "t1", "texture.src": "media/home/worlds/neon/art/x.jpg" }]);
  // прототип уже поменяли руками — прототип не трогаем, флаг снимаем
  const handFixed = restorePlan({ ...actor, prototypeToken: { texture: { src: "new.png" } } }, []);
  assert.deepEqual(handFixed.proto, { "flags.nadgrad.-=token": null });
  // нечего откатывать
  assert.equal(restorePlan({ flags: {} }), null);
});

test("шаблон окна: кольцо мира, кнопки колец, список с переключателями", () => {
  const doc = new JSDOM(tpl("tokens.hbs")({
    rows: [{ id: "a", name: "Кай", thumb: "t.jpg", owners: "Лера", ring: true }, { id: "b", name: "Гонг", thumb: "g.jpg", owners: "osya", ring: false }],
    off: 1,
    rings: [{ id: "nadgradTush", label: "Надград — Тушь", on: true }, { id: "nadgradSmog", label: "Надград — Смог", missing: true }],
    currentLabel: "Надград — Тушь",
    isOurs: true,
  })).window.document;
  assert.ok(doc.querySelector(".ng-tk-current.ours"));
  assert.equal(doc.querySelector("[data-action='worldRing'].on").dataset.ring, "nadgradTush");
  assert.ok(doc.querySelector("[data-ring='nadgradSmog']").disabled);
  assert.equal(doc.querySelectorAll(".ng-tk-row").length, 2);
  assert.equal(doc.querySelector(".ng-tk-row.done [data-action='toggle']").textContent, "Снять");
  assert.match(doc.querySelector("[data-action='allOn']").textContent, /\(1\)/);
});
