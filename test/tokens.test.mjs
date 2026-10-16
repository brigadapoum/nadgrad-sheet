// Кольца токенов рискарей: кольца Надграда, список, откат картинок 0.8.0, шаблон окна, спрайт-листы.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import Handlebars from "handlebars";
import { JSDOM } from "jsdom";
import {
  RINGS, RING_DEFAULT, ringPath, isNadgradRing, playerRunners, rowContext, ringToken, ringPrototype, restorePlan,
  CUT_R, TOKEN_VIEW, clampCrop, defaultCrop, sourceRect, zoomBy, drawCutout, cutDir, cutFileName, uploadedPath,
  cutToken, cutPrototype, uncutToken, uncutPrototype, SCALE_MAX, clampScale, scaleToken, scalePrototype,
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
  assert.deepEqual(rowContext(a, owners), { id: "a", name: "Кай", thumb: "t.jpg", owners: "Лера", ring: true, cut: false });
  a.prototypeToken.ring.subject = { texture: "worlds/neon/nadgrad-tokens/a-1.webp" };
  assert.equal(rowContext(a, owners).cut, true);
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
    rows: [{ id: "a", name: "Кай", thumb: "t.jpg", owners: "Лера", ring: true, cut: true }, { id: "b", name: "Гонг", thumb: "g.jpg", owners: "osya", ring: false, cut: false }],
    todo: 1,
    dir: "worlds/neon/nadgrad-tokens",
    rings: [{ id: "nadgradTush", label: "Надград — Тушь", on: true }, { id: "nadgradSmog", label: "Надград — Смог", missing: true }],
    currentLabel: "Надград — Тушь",
    isOurs: true,
  })).window.document;
  assert.ok(doc.querySelector(".ng-tk-current.ours"));
  assert.equal(doc.querySelector("[data-action='worldRing'].on").dataset.ring, "nadgradTush");
  assert.ok(doc.querySelector("[data-ring='nadgradSmog']").disabled);
  assert.equal(doc.querySelectorAll(".ng-tk-row").length, 2);
  assert.ok(doc.querySelector(".ng-tk-row.done [data-action='remove']"));
  assert.equal(doc.querySelector(".ng-tk-row:not(.done) [data-action='remove']"), null, "без кольца снимать нечего");
  assert.equal(doc.querySelectorAll("[data-action='cut']").length, 2);
  assert.match(doc.querySelector("[data-action='allCut']").textContent, /\(1\)/);
  assert.match(doc.body.textContent, /worlds\/neon\/nadgrad-tokens/);
});

test("вырез: квадрат при зуме 1 целиком в круге; широкий двигается только вбок; высокий — ближе к верху", () => {
  const r = sourceRect(400, 400, { zoom: 1, x: 50, y: -30 });
  assert.deepEqual([r.sx, r.sy, r.size], [0, 0, 400]);
  const c = clampCrop(800, 400, { zoom: 1, x: 9999, y: 50 });
  assert.equal(c.x, TOKEN_VIEW / 2); assert.equal(c.y, 0);
  const d = defaultCrop(400, 800);
  assert.ok(d.y > 0 && sourceRect(400, 800, d).sy < 200);
  assert.deepEqual(defaultCrop(800, 400), { zoom: 1, x: 0, y: 0 });
  assert.equal(zoomBy(400, 400, { zoom: 3.9, x: 0, y: 0 }, 2).zoom, 4);
  assert.equal(zoomBy(400, 800, { zoom: 1, x: 0, y: 100 }, 2).y, 200);
});

test("вырез: рисуется кругом под внутренний край кольца, снаружи прозрачно", () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (...a) => calls.push([k, ...a]), set: () => true });
  drawCutout(ctx, { width: 400, height: 600 }, 512, { zoom: 1, x: 0, y: 0 });
  assert.equal(calls[0][0], "clearRect");
  const arc = calls.find((c) => c[0] === "arc");
  assert.equal(arc[3], 256 * CUT_R);
  assert.ok(CUT_R > 0.667 && CUT_R < 0.7, "чуть заходит под кольцо Надграда (0.667)");
  const img = calls.find((c) => c[0] === "drawImage");
  assert.equal(img[8], 2 * 256 * CUT_R);
});

test("загрузка: путь только при успехе; папка — данные Foundry, без «media/home/»", () => {
  assert.equal(uploadedPath({ status: "success", path: "worlds/neon/nadgrad-tokens/a.webp" }), "worlds/neon/nadgrad-tokens/a.webp");
  assert.equal(uploadedPath({ status: "error", path: "worlds/neon/x.webp", message: "Target directory … does not exist" }), null);
  assert.equal(uploadedPath(undefined), null);
  assert.equal(uploadedPath(false), null);
  assert.equal(uploadedPath({ path: "" }), null);
  assert.equal(cutDir("neon"), "worlds/neon/nadgrad-tokens");
  assert.equal(cutDir("neon", "/my/dir/"), "my/dir");
  assert.equal(cutFileName("abc", 1), "abc-1.webp");
});

test("вырез пишется в объект кольца, основная картинка токена не трогается; «снять» — обратно", () => {
  const t = cutToken("worlds/neon/nadgrad-tokens/a.webp");
  assert.deepEqual(t, { "ring.enabled": true, "ring.subject.texture": "worlds/neon/nadgrad-tokens/a.webp", "ring.subject.scale": 1 });
  assert.ok(!Object.keys(t).some((k) => k.startsWith("texture.")), "texture.src не меняется");
  assert.ok(Object.keys(cutPrototype("x")).every((k) => k.startsWith("prototypeToken.ring.")));
  assert.deepEqual(uncutToken(), { "ring.enabled": false, "ring.subject.texture": null });
  assert.deepEqual(uncutPrototype(), { "prototypeToken.ring.enabled": false, "prototypeToken.ring.subject.texture": null });
  assert.deepEqual(ringToken(true), { "ring.enabled": true });
  assert.deepEqual(ringPrototype(false), { "prototypeToken.ring.enabled": false });
});

test("шаблон кадра собирается; при ошибке — без холста и без «На стол»", () => {
  const ok = new JSDOM(tpl("token-crop.hbs")({ name: "Кай", zoomPct: 100, zoomMin: 100, zoomMax: 400 })).window.document;
  assert.ok(ok.querySelector("canvas.ng-crop-view"));
  const err = new JSDOM(tpl("token-crop.hbs")({ name: "Кай", error: "нет картинки" })).window.document;
  assert.equal(err.querySelector("canvas"), null);
  assert.ok(err.querySelector("[data-action='save']").disabled);
});

test("масштаб на столе: больше 3 (ползунок ядра), в пределах 0.25–10, мусор — нет", () => {
  assert.equal(clampScale(5), 5);
  assert.equal(clampScale("6"), 6);
  assert.equal(clampScale(42), SCALE_MAX);
  assert.equal(clampScale(0.1), 0.25);
  assert.equal(clampScale("abc"), null);
  assert.equal(clampScale(0), null);
  assert.equal(clampScale(-2), null);
  assert.deepEqual(scaleToken(5), { "texture.scaleX": 5, "texture.scaleY": 5 });
  assert.deepEqual(scalePrototype(6), { "prototypeToken.texture.scaleX": 6, "prototypeToken.texture.scaleY": 6 });
  const doc = new JSDOM(tpl("tokens.hbs")({ rows: [{ id: "a", name: "Кай", ring: true, cut: true }], todo: 0, scale: 5, scaleMin: 0.25, scaleMax: 10, rings: [] })).window.document;
  assert.equal(doc.querySelector("input.ng-tk-scale").value, "5");
  assert.equal(doc.querySelector("input.ng-tk-scale").max, "10");
  assert.match(doc.querySelector("[data-action='scaleAll']").textContent, /\(1\)/);
});
