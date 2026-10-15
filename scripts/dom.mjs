// Правки DOM родного листа после каждой перерисовки (общие для модуля и стенда).

/** Полоса над портретом: убрать CRED, DEBT, бросок по мотиву, «охотника»; поставить переключатель тем. */
export function tidyHeader(root, { active }) {
  const bar = root.querySelector("section.header .options");
  if (bar) {
    for (const el of [...bar.children]) if (!el.classList.contains("ng-theme")) el.remove();
    let sw = bar.querySelector(".ng-theme");
    if (!sw) {
      sw = root.ownerDocument.createElement("div");
      sw.className = "ng-theme";
      sw.innerHTML =
        `<span class="ng-theme-label">Тема</span>` +
        `<button type="button" data-action="ngTheme" data-theme="tush">Тушь</button>` +
        `<button type="button" data-action="ngTheme" data-theme="smog">Смог</button>`;
      bar.append(sw);
    }
    for (const b of sw.querySelectorAll("button")) b.classList.toggle("active", b.dataset.theme === active);
  }
  // красная раскраска «на рискаря охотятся» больше не нужна
  root.querySelector('[data-application-part="form"]')?.classList.remove("hunted");
}

/** Темы: явный выбор вешает класс на окно; «auto» — по теме Foundry. */
export function applyThemeClass(root, theme) {
  root.classList.toggle("ng-tush", theme === "tush");
  root.classList.toggle("ng-smog", theme === "smog");
}

/** Какая тема сейчас видна (для подсветки переключателя). */
export function effectiveTheme(root, theme) {
  if (theme === "tush" || theme === "smog") return theme;
  const body = root.ownerDocument.body;
  const dark = root.classList.contains("theme-dark") ||
    (body.classList.contains("theme-dark") && !root.classList.contains("theme-light"));
  return dark ? "smog" : "tush";
}

/** Кнопка загрузки, как в 1.05: текст уровня, клик — тяжелее, ПКМ — легче. Цифра «x / max» — только показ. */
export function loadButton(root, { index, label, levels }) {
  const gears = root.querySelector("section.gears");
  if (!gears) return;
  const stack = gears.querySelector('h3 button[data-action="gearLoadChange"]');
  if (stack) { stack.removeAttribute("data-action"); stack.classList.add("ng-load-count"); stack.tabIndex = -1; }
  gears.querySelector(":scope > p.desc")?.remove();
  let btn = gears.querySelector(":scope > button.ng-load");
  if (!btn) {
    btn = root.ownerDocument.createElement("button");
    btn.type = "button";
    btn.className = "ng-load";
    btn.dataset.action = "ngLoad";
    btn.title = "Клик — тяжелее, правый клик — легче";
    const h3 = gears.querySelector(":scope > h3");
    h3 ? h3.after(btn) : gears.prepend(btn);
  }
  const dots = levels.map((_, i) => `<i class="ng-dot${i <= index ? " on" : ""}"></i>`).join("");
  btn.innerHTML = `<span class="ng-load-text">${label}</span><span class="ng-dots">${dots}</span>`;
}

/** Чат и пауза: тема на <body> — та же, что выбрана для листа («auto» — по теме интерфейса Foundry). */
export function applyUiTheme(body, theme) {
  const t = effectiveTheme(body, theme);
  body.classList.toggle("ng-ui", true);
  body.classList.toggle("ng-ui-tush", t === "tush");
  body.classList.toggle("ng-ui-smog", t === "smog");
  return t;
}

/**
 * Все кнопки листа — type="button". Иначе Enter в любом поле «нажимает» первую кнопку формы —
 * в 1.2 это кнопка досье над портретом, отсюда «Enter открывает заметки».
 */
export function noSubmitButtons(root) {
  for (const b of root.querySelectorAll("button:not([type])")) b.type = "button";
}

/** Enter в однострочном поле — просто закончить ввод (поле теряет фокус, срабатывает сохранение). */
export function enterBlurs(root) {
  if (root.dataset.ngEnter) return;
  root.dataset.ngEnter = "1";
  root.addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.key !== "Enter" || t?.tagName !== "INPUT") return;
    if (!["text", "number", "search", ""].includes(t.type ?? "")) return;
    e.preventDefault();
    t.blur();
  });
}

/** Дорожка доп. кубов: у положительных значений — плюс (+1 … +4). */
export function dicePlus(root) {
  for (const label of root.querySelectorAll(".rollSection .addDice label")) {
    const v = Number(label.querySelector("input")?.value);
    if (!(v > 0)) continue;
    for (const n of [...label.childNodes]) if (n.nodeType === 3 && n.textContent.trim()) n.textContent = `+${v}`;
  }
}

/**
 * Аугментации: имя сохраняется (поле получает имя формы), стрелка «описание» слева, как в 1.05,
 * у открытой аугментации — поле описания (редактор Foundry с кнопкой правки).
 * items: Map-подобное с get(id) → { name, system: { isOpen, desc } }.
 */
export function augDecorate(root, { items, editable }) {
  const doc = root.ownerDocument;
  for (const aug of root.querySelectorAll("section.augmentations .aug")) {
    const head = aug.querySelector(":scope > [data-item-id]");
    const id = head?.getAttribute("data-item-id");
    const item = id ? items.get(id) : null;
    if (!item) continue;
    const input = head.querySelector('input[type="text"]');
    if (input) {
      input.removeAttribute("data-action"); // родное действие вешало слушатель только по клику
      input.name = `ngAug.${id}.name`;
      if (!editable) input.disabled = true;
    }
    let open = head.querySelector(":scope > .ng-aug-open");
    if (!open) {
      open = doc.createElement("button");
      open.type = "button";
      open.className = "ng-aug-open";
      open.dataset.action = "itemToggle"; // родное действие системы: переключает system.isOpen
      open.dataset.flag = "isOpen";
      head.prepend(open);
    }
    const isOpen = !!item.system?.isOpen;
    open.classList.toggle("on", isOpen);
    open.title = isOpen ? "Свернуть описание" : "Развернуть описание";
    open.innerHTML = `<i class="fa-solid ${isOpen ? "fa-caret-down" : "fa-caret-right"}"></i>`;
    aug.classList.toggle("ng-open", isOpen);

    let desc = aug.querySelector(":scope > .desc");
    if (!isOpen) { desc?.remove(); continue; }
    if (!desc) { desc = doc.createElement("div"); desc.className = "desc"; aug.append(desc); }
    const html = String(item.system?.desc ?? "");
    desc.classList.add("ng-aug-desc");
    if (editable) {
      if (desc.querySelector("prose-mirror")) continue;
      const pm = doc.createElement("prose-mirror");
      pm.setAttribute("name", `ngAug.${id}.desc`);
      pm.setAttribute("toggled", "");
      pm.setAttribute("value", html);
      pm.innerHTML = html;
      desc.replaceChildren(pm);
      if (!html.replace(/<[^>]*>/g, "").trim()) {
        const hint = doc.createElement("p");
        hint.className = "ng-hint";
        hint.textContent = "Описания пока нет — кнопка правки справа.";
        desc.append(hint);
      }
    } else {
      desc.innerHTML = html || `<p class="ng-hint">Описания нет.</p>`;
    }
  }
}
