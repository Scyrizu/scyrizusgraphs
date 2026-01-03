/*
 * Copyright 2026
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import InputComponent, { COMPONENT_SIZES } from "../../../../systems/custom-system-builder/module/sheets/components/InputComponent.js";
import { RequiredFieldError } from "../../../../systems/custom-system-builder/module/errors/ComponentValidationError.js";

const LIVE_BINDINGS = new Map();
let LIVE_HOOKS_INSTALLED = false;

const FORMULA_ERROR = "__SCG_FORMULA_ERROR__";

function installLiveHooksOnce() {
  if (LIVE_HOOKS_INSTALLED) return;
  LIVE_HOOKS_INSTALLED = true;

  Hooks.on("updateActor", (actor, changed) => {
    if (!changed?.system?.props) return;
    for (const b of LIVE_BINDINGS.values()) {
      if (b.entityType !== "actor") continue;
      if (b.entityUuid !== actor.uuid) continue;
      b.setValueFn(actor);
    }
  });

  Hooks.on("updateItem", (item, changed) => {
    if (!changed?.system?.props) return;
    for (const b of LIVE_BINDINGS.values()) {
      if (b.entityType !== "item") continue;
      if (b.entityUuid !== item.uuid) continue;
      b.setValueFn(item);
    }
  });
}

function clampInt(n, min, max) {
  const x = Number.isFinite(n) ? Math.trunc(n) : min;
  return Math.max(min, Math.min(max, x));
}

function parseIntStrict(v) {
  const s = String(v ?? "").trim();
  if (!s.length) return NaN;
  const m = /^(-?\d+)(?:\.0+)?$/.exec(s);
  if (!m) return NaN;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : NaN;
}

function isCSBFormulaString(str) {
  const s = String(str ?? "").trim();
  return s.startsWith("${") && s.endsWith("}$");
}

function computeCSB(str, props, reference, source) {
  const s = String(str ?? "").trim();
  if (!isCSBFormulaString(s)) return s;

  const CP = globalThis.ComputablePhrase;
  if (!CP?.computeMessageStatic) return FORMULA_ERROR;

  try {
    const out = CP.computeMessageStatic(s, props ?? {}, {
      source,
      reference,
      defaultValue: "",
      triggerEntity: null
    })?.result;

    if (out === undefined || out === null) return FORMULA_ERROR;
    return String(out);
  } catch {
    return FORMULA_ERROR;
  }
}

function stripRgbRgbaWrapper(input) {
  const s = String(input ?? "").trim();
  const m = /^\s*rgba?\((.*)\)\s*$/i.exec(s);
  return m ? m[1].trim() : s;
}

function parseRgbChannelToken(tok) {
  const t = String(tok ?? "").trim();
  const m = /^(\d{1,3})(?:\.0+)?$/.exec(t);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 0 || n > 255) return null;
  return n;
}

function parseAlphaToken(tok) {
  const t = String(tok ?? "").trim();
  const m = /^(0|1|(?:0?\.\d+)|(?:1\.0+))$/.exec(t);
  if (!m) return null;
  const a = parseFloat(t);
  if (!Number.isFinite(a) || a < 0 || a > 1) return null;
  return a;
}

function parseRgbContentsSafe(input) {
  const str = String(input ?? "").trim();
  const parts = str.split(",").map((s) => s.trim());
  if (parts.length !== 3) return null;

  const r = parseRgbChannelToken(parts[0]);
  const g = parseRgbChannelToken(parts[1]);
  const b = parseRgbChannelToken(parts[2]);
  if (r === null || g === null || b === null) return null;

  return `${r}, ${g}, ${b}`;
}

function parseRgbaContentsSafe(input) {
  const str = String(input ?? "").trim();
  const parts = str.split(",").map((s) => s.trim());
  if (parts.length !== 4) return null;

  const r = parseRgbChannelToken(parts[0]);
  const g = parseRgbChannelToken(parts[1]);
  const b = parseRgbChannelToken(parts[2]);
  const a = parseAlphaToken(parts[3]);
  if (r === null || g === null || b === null || a === null) return null;

  return `${r}, ${g}, ${b}, ${a}`;
}

function normalizeSegmentColorContents(input) {
  const s = stripRgbRgbaWrapper(input);
  const rgba = parseRgbaContentsSafe(s);
  if (rgba) return rgba;
  const rgb = parseRgbContentsSafe(s);
  if (!rgb) return null;
  return `${rgb}, 1`;
}

function normalizeBackgroundColorContents(input) {
  const s = stripRgbRgbaWrapper(input);
  const rgba = parseRgbaContentsSafe(s);
  if (rgba) return rgba;
  const rgb = parseRgbContentsSafe(s);
  if (rgb) return `${rgb}, 1`;
  return null;
}

async function resolveDocument(entity) {
  if (!entity) return null;

  if (entity.documentName && typeof entity.update === "function") return entity;

  if (entity.document?.documentName && typeof entity.document.update === "function") return entity.document;
  if (entity.entity?.documentName && typeof entity.entity.update === "function") return entity.entity;
  if (entity.actor?.documentName && typeof entity.actor.update === "function") return entity.actor;
  if (entity.item?.documentName && typeof entity.item.update === "function") return entity.item;
  if (entity.parent?.documentName && typeof entity.parent.update === "function") return entity.parent;

  if (typeof entity.uuid === "string" && typeof fromUuid === "function") {
    try {
      const d = await fromUuid(entity.uuid);
      if (d?.documentName && typeof d.update === "function") return d;
    } catch (_) {}
  }

  return null;
}

function canUserUpdate(doc) {
  const owner = typeof doc?.isOwner === "boolean" ? doc.isOwner : false;
  return owner || game.user.isGM;
}

function forceRenderDoc(doc) {
  try { doc?.sheet?.render(true); } catch (_) {}

  const apps = doc?.apps ?? {};
  for (const app of Object.values(apps)) {
    try { app.render(true); } catch (_) {}
  }

  for (const app of Object.values(ui.windows ?? {})) {
    try {
      if (app?.document?.uuid === doc?.uuid) app.render(true);
    } catch (_) {}
  }
}

function openSimpleContextMenu(ev, items) {
  const existing = document.getElementById("scg-clock-context-menu");
  if (existing) existing.remove();

  const menu = document.createElement("div");
  menu.id = "scg-clock-context-menu";
  menu.style.position = "fixed";
  menu.style.left = `${ev.clientX}px`;
  menu.style.top = `${ev.clientY}px`;
  menu.style.zIndex = 2147483647;
  menu.style.background = "rgba(25,25,25,0.95)";
  menu.style.border = "1px solid rgba(255,255,255,0.15)";
  menu.style.borderRadius = "8px";
  menu.style.padding = "6px";
  menu.style.minWidth = "140px";
  menu.style.boxShadow = "0 8px 18px rgba(0,0,0,0.35)";
  menu.style.userSelect = "none";

  const close = () => {
    menu.remove();
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onKey, true);
  };

  const onDocPointer = (e) => {
    if (!menu.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  for (const it of items) {
    const row = document.createElement("div");
    row.textContent = it.label;
    row.style.padding = "6px 10px";
    row.style.cursor = "pointer";
    row.style.borderRadius = "6px";
    row.style.color = "white";
    row.addEventListener("mouseenter", () => (row.style.background = "rgba(255,255,255,0.08)"));
    row.addEventListener("mouseleave", () => (row.style.background = "transparent"));
    row.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    row.addEventListener("click", () => {
      try { it.onClick(); } finally { close(); }
    });
    menu.appendChild(row);
  }

  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
}

function appendClockWarn($root, i18nKey) {
  const warn = document.createElement("div");
  warn.className = "scg-clock-warn";
  warn.textContent = game.i18n.localize(i18nKey);
  warn.style.fontSize = "11px";
  warn.style.marginTop = "2px";
  warn.style.opacity = "0.85";
  warn.style.pointerEvents = "none";
  $root.append(warn);
}

function localize(key) {
  try { return game.i18n.localize(key); } catch { return key; }
}

export default class Clock extends InputComponent {
  static valueType = "number";

  static SHARED = null;
  static setShared(shared) {
    this.SHARED = shared;
  }

  constructor(props = {}) {
    super(props);

    this._disableInteraction = !!props.disableInteraction;

    this._clockColor = String(props.clockColor ?? "white");
    this._clockCustomColor = String(props.clockCustomColor ?? "0, 0, 0, 1");
    this._clockBackgroundColor = String(props.clockBackgroundColor ?? "0, 0, 0, 0.15");

    this._clockSegmentsExpr = String(props.clockSegmentsExpr ?? "").trim() || "4";
    this._defaultFilledExpr = String(props.defaultFilledExpr ?? "").trim() || "0";
  }

  static getTechnicalName() {
    return "scgclock";
  }

  static getPrettyName() {
    return "SCG Clock";
  }

  toJSON() {
    const base = super.toJSON();
    return {
      ...base,
      type: Clock.getTechnicalName(),

      disableInteraction: this._disableInteraction,

      clockColor: this._clockColor,
      clockCustomColor: this._clockCustomColor,
      clockBackgroundColor: this._clockBackgroundColor,

      clockSegmentsExpr: this._clockSegmentsExpr,
      defaultFilledExpr: this._defaultFilledExpr
    };
  }

  static fromJSON(json, templateAddress, parent) {
    return new Clock({
      key: json.key,
      tooltip: json.tooltip,
      templateAddress,
      label: json.label,
      size: json.size,
      customSize: json.customSize,
      cssClass: json.cssClass,
      role: json.role,
      permission: json.permission,
      visibilityFormula: json.visibilityFormula,
      parent,

      disableInteraction: json.disableInteraction,

      clockColor: json.clockColor,
      clockCustomColor: json.clockCustomColor,
      clockBackgroundColor: json.clockBackgroundColor,

      clockSegmentsExpr: json.clockSegmentsExpr ?? "4",
      defaultFilledExpr: json.defaultFilledExpr ?? "0"
    });
  }

  static async getConfigForm(existingComponent, _entity) {
    const data = existingComponent?.toJSON ? existingComponent.toJSON() : (existingComponent ?? {});
    const COLOR_SELECTION =
      this.SHARED?.COLOR_SELECTION ?? globalThis.SCG?.shared?.COLOR_SELECTION ?? {};

    const mainElt = $("<div></div>");
    mainElt.append(
      await renderTemplate("modules/ScyrizusGraphs/templates/clock.hbs", {
        ...data,
        COMPONENT_SIZES,
        COLOR_SELECTION
      })
    );
    return mainElt;
  }

  static attachListenersToConfigForm(html) {
    const $html = $(html);

    const updateSize = () => {
      const val = $html.find("#clockSize").val();
      const block = $html.find(".custom-system-size-custom");
      if (val === "custom") block.slideDown(150);
      else block.slideUp(150);
    };

    const updateColor = () => {
      const val = $html.find("#clockColor").val();
      const block = $html.find(".scg-color-custom");
      if (val === "custom") block.slideDown(150);
      else block.slideUp(150);
    };

    $html.find("#clockSize").on("change", updateSize);
    $html.find("#clockColor").on("change", updateColor);

    updateSize();
    updateColor();
  }

  static extractConfig(html) {
    const getByKey = (k) => html.find(`[data-key="${k}"]`).val()?.toString();

    const fieldData = {
      ...super.extractConfig(html),

      label: getByKey("label"),
      size: getByKey("size") ?? "full-size",
      customSize: undefined,

      disableInteraction: !!html.find("#clockDisableInteraction").is(":checked"),

      clockColor: getByKey("clockColor") ?? "white",
      clockCustomColor: getByKey("clockCustomColor") ?? "0, 0, 0, 1",
      clockBackgroundColor: getByKey("clockBackgroundColor") ?? "0, 0, 0, 0.15",

      clockSegmentsExpr: (getByKey("clockSegmentsExpr") ?? "4").trim() || "4",
      defaultFilledExpr: (getByKey("defaultFilledExpr") ?? "0").trim() || "0"
    };

    if (fieldData.size === "custom") {
      const cs = parseIntStrict(html.find("#clockCustomSize").val());
      if (!Number.isFinite(cs) || cs <= 0) throw new Error(localize("SCG.Clock.Config.Errors.CustomSizeInvalid"));
      fieldData.customSize = cs;
    }

    this.validateConfig(fieldData);
    return fieldData;
  }

  static validateConfig(json) {
    super.validateConfig(json);

    if (!json.key) {
      throw new RequiredFieldError(game.i18n.localize("CSB.ComponentProperties.ComponentKey"), json);
    }

    let segExpr = String(json.clockSegmentsExpr ?? "").trim();
    if (!segExpr) segExpr = "4";
    json.clockSegmentsExpr = segExpr;

    const segIsFormula = isCSBFormulaString(segExpr);
    if (!segIsFormula) {
      const seg = parseIntStrict(segExpr);
      if (!Number.isFinite(seg)) throw new Error(localize("SCG.Clock.Config.Errors.SegmentsNaN"));
      if (seg < 2 || seg > 12) throw new Error(localize("SCG.Clock.Config.Errors.SegmentsOutOfRange"));
    }

    let dfExpr = String(json.defaultFilledExpr ?? "").trim();
    if (!dfExpr) dfExpr = "0";
    json.defaultFilledExpr = dfExpr;

    const dfIsFormula = isCSBFormulaString(dfExpr);
    if (!dfIsFormula) {
      const df = parseIntStrict(dfExpr);
      if (!Number.isFinite(df)) throw new Error(localize("SCG.Clock.Config.Errors.DefaultFilledNaN"));
      if (df < 0) throw new Error(localize("SCG.Clock.Config.Errors.DefaultFilledNegative"));
      if (!segIsFormula) {
        const seg = parseIntStrict(segExpr);
        if (Number.isFinite(seg) && df > seg) throw new Error(localize("SCG.Clock.Config.Errors.DefaultFilledTooHigh"));
      }
    }

    let bgRaw = String(json.clockBackgroundColor ?? "").trim();
    if (!bgRaw) bgRaw = "0, 0, 0, 0.15";
    json.clockBackgroundColor = bgRaw;

    if (!isCSBFormulaString(bgRaw)) {
      const bgNorm = normalizeBackgroundColorContents(bgRaw);
      if (!bgNorm) throw new Error(localize("SCG.Clock.Config.Errors.BackgroundColorInvalid"));
      json.clockBackgroundColor = bgNorm;
    }

    let segColorRaw = String(json.clockCustomColor ?? "").trim();
    if (!segColorRaw) segColorRaw = "0, 0, 0, 1";
    json.clockCustomColor = segColorRaw;

    if (String(json.clockColor ?? "white") === "custom") {
      if (!isCSBFormulaString(segColorRaw)) {
        const segNorm = normalizeSegmentColorContents(segColorRaw);
        if (!segNorm) throw new Error(localize("SCG.Clock.Config.Errors.CustomColorInvalid"));
        json.clockCustomColor = segNorm;
      }
    }
  }

  _buildWedgePath(cx, cy, r, a0, a1) {
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const largeArc = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`;
  }

  _paint(wedges, filled) {
    wedges.forEach((w) => {
      const idx = parseInt(w.getAttribute("data-scg-seg"), 10);
      w.style.setProperty("fill-opacity", idx <= filled ? "1" : "0", "important");
    });
  }

  async _getElement(entity, isEditable = true, options = {}) {
    installLiveHooksOnce();

    const { reference } = options;
    const props = { ...(entity?.system?.props ?? {}), ...(options.customProps ?? {}) };

    const jQElement = await super._getElement(entity, isEditable, options);
    jQElement.addClass("SCG-Clock");
    jQElement.css({ userSelect: "none" });

    jQElement.find("svg[data-scg-clock]").remove();
    jQElement.find(".scg-clock-warn").remove();

    const segExpr = String(this._clockSegmentsExpr ?? "").trim() || "4";
    const segUsesFormula = isCSBFormulaString(segExpr);

    let segResolved = segExpr;
    if (segUsesFormula) segResolved = computeCSB(segExpr, props, reference, `${this.key}.segments`);

    const segNum = segResolved === FORMULA_ERROR ? NaN : parseIntStrict(segResolved);
    const segIsNum = Number.isFinite(segNum);
    const segInRange = segIsNum && segNum >= 2 && segNum <= 12;

    const segments = segInRange ? segNum : 4;

    const showSegNaNWarn = !entity.isTemplate && segUsesFormula && !segIsNum;
    const showSegRangeWarn = !entity.isTemplate && segUsesFormula && segIsNum && !segInRange;

    const dfExpr = String(this._defaultFilledExpr ?? "").trim() || "0";
    const dfUsesFormula = isCSBFormulaString(dfExpr);

    let dfResolved = dfExpr;
    if (dfUsesFormula) dfResolved = computeCSB(dfExpr, props, reference, `${this.key}.defaultFilled`);

    let defaultFilled = dfResolved === FORMULA_ERROR ? 0 : parseIntStrict(dfResolved);
    if (!Number.isFinite(defaultFilled)) defaultFilled = 0;
    defaultFilled = clampInt(defaultFilled, 0, segments);

    const rawVal = foundry.utils.getProperty(entity, `system.props.${this.key}`);
    const missing = rawVal === undefined || rawVal === null || rawVal === "";

    const rawValueCompat = (rawVal && typeof rawVal === "object") ? rawVal.value : rawVal;

    let current = missing ? defaultFilled : parseIntStrict(rawValueCompat);
    if (!Number.isFinite(current)) current = defaultFilled;
    current = clampInt(current, 0, segments);

    if (!entity.isTemplate) {
      const doc = await resolveDocument(entity);
      if (doc && canUserUpdate(doc)) {
        const updates = {};

        if (typeof rawVal === "object" || missing || parseIntStrict(rawValueCompat) !== current) {
          updates[`system.props.${this.key}`] = current;
        }

        updates[`system.props.${this.key}_max`] = segments;

        if (Object.keys(updates).length) {
          doc.update(updates, { diff: true, render: false }).catch(() => {});
        }
      }
    }

    if (entity.system?.props) {
      entity.system.props[this.key] = current;
      entity.system.props[`${this.key}_max`] = segments;
    }

    const svgUrl = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgUrl, "svg");
    svg.setAttribute("data-scg-clock", "1");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.style.display = "block";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.pointerEvents = "auto";
    svg.style.outline = "none";
    svg.style.userSelect = "none";
    svg.setAttribute("focusable", "false");
    svg.setAttribute("tabindex", "-1");

    const bg = document.createElementNS(svgUrl, "circle");
    bg.setAttribute("r", "45");
    bg.setAttribute("cx", "50");
    bg.setAttribute("cy", "50");
    bg.setAttribute("stroke", "black");
    bg.setAttribute("stroke-width", "3");
    bg.setAttribute("pointer-events", "none");

    let bgVal = String(this._clockBackgroundColor ?? "").trim();
    if (!bgVal) bgVal = "0, 0, 0, 0.15";

    const bgUsesFormula = isCSBFormulaString(bgVal);
    let bgComputed = bgVal;
    if (bgUsesFormula) bgComputed = computeCSB(bgVal, props, reference, `${this.key}.backgroundColor`);

    const bgNorm = (bgComputed === FORMULA_ERROR) ? null : normalizeBackgroundColorContents(bgComputed);
    const showBgWarn = !entity.isTemplate && bgUsesFormula && !bgNorm;

    const finalBg = bgNorm ?? "0, 0, 0, 0.15";
    bg.style.fill = `rgba(${finalBg})`;
    bg.style.fillOpacity = "1";
    svg.appendChild(bg);

    const wedges = [];
    const cx = 50, cy = 50, r = 44;
    const start = -Math.PI / 2;

    for (let i = 1; i <= segments; i++) {
      const a0 = start + (2 * Math.PI * (i - 1)) / segments;
      const a1 = start + (2 * Math.PI * i) / segments;

      const wedge = document.createElementNS(svgUrl, "path");
      wedge.setAttribute("d", this._buildWedgePath(cx, cy, r, a0, a1));
      wedge.setAttribute("data-scg-seg", String(i));
      wedge.style.stroke = "black";
      wedge.style.strokeWidth = "1";
      wedge.style.pointerEvents = "all";
      wedge.style.cursor = entity.isTemplate ? "default" : "pointer";
      wedge.style.outline = "none";

      wedges.push(wedge);
      svg.appendChild(wedge);
    }

    let showSegColorWarn = false;

    if (this._clockColor === "custom") {
      let segColor = String(this._clockCustomColor ?? "").trim();
      if (!segColor) segColor = "0, 0, 0, 1";

      const segColorUsesFormula = isCSBFormulaString(segColor);
      let segColorComputed = segColor;

      if (segColorUsesFormula) {
        segColorComputed = computeCSB(segColor, props, reference, `${this.key}.segmentColor`);
      }

      const segNorm = (segColorComputed === FORMULA_ERROR) ? null : normalizeSegmentColorContents(segColorComputed);
      showSegColorWarn = !entity.isTemplate && segColorUsesFormula && !segNorm;

      const finalSeg = segNorm ?? "0, 0, 0, 1";
      const rgba = `rgba(${finalSeg})`;
      wedges.forEach((w) => (w.style.fill = rgba));
    } else {
      wedges.forEach((w) => w.classList.add(`scg-fill-${this._clockColor}`));
    }

    this._paint(wedges, current);

    jQElement.append(svg);

    if (showSegNaNWarn) appendClockWarn(jQElement, "SCG.Clock.Errors.SegmentFormulaNaN");
    if (showSegRangeWarn) appendClockWarn(jQElement, "SCG.Clock.Errors.SegmentFormulaOutOfRange");
    if (showSegColorWarn) appendClockWarn(jQElement, "SCG.Clock.Errors.SegmentColorFormulaInvalid");
    if (showBgWarn) appendClockWarn(jQElement, "SCG.Clock.Errors.BackgroundColorFormulaInvalid");

    if (entity.isTemplate) {
      jQElement.addClass("custom-system-editable-component");
      jQElement.on("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.editComponent(entity);
      });
      return jQElement;
    }

    const allowInteract =
      !this._disableInteraction &&
      (isEditable || entity.isOwner || game.user.isGM);

    const persistValue = async (nextValue) => {
      const next = clampInt(nextValue, 0, segments);

      this._paint(wedges, next);

      if (entity.system?.props) entity.system.props[this.key] = next;

      const doc = await resolveDocument(entity);
      if (!doc || !canUserUpdate(doc)) return;

      await doc.update(
        {
          [`system.props.${this.key}`]: next,
          [`system.props.${this.key}_max`]: segments
        },
        { diff: true, render: true }
      );

      queueMicrotask(() => forceRenderDoc(doc));

      const ae = document.activeElement;
      if (ae && typeof ae.blur === "function") ae.blur();
    };

    if (allowInteract) {
      const root = jQElement[0];

      root.addEventListener(
        "pointerdown",
        (ev) => {
          if (!svg.contains(ev.target)) return;

          if (ev.button === 2) {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation?.();

            openSimpleContextMenu(ev, [
              {
                label: game.i18n.localize("SCG.ContextMenu.ClearAll"),
                onClick: () => persistValue(0)
              }
            ]);
          }
        },
        true
      );

      root.addEventListener(
        "mousedown",
        (ev) => {
          if (!svg.contains(ev.target)) return;
          if (ev.button !== 0) return;

          const target = ev.target instanceof Element ? ev.target.closest("path[data-scg-seg]") : null;
          if (!target) return;

          const seg = parseInt(target.getAttribute("data-scg-seg") ?? "", 10);
          if (!Number.isFinite(seg)) return;

          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation?.();

          persistValue(seg);
        },
        true
      );

      root.addEventListener(
        "contextmenu",
        (ev) => {
          if (!svg.contains(ev.target)) return;
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation?.();
          return false;
        },
        true
      );
    }

    const bindingKey = `${entity.uuid}:${this.key}`;
    LIVE_BINDINGS.set(bindingKey, {
      entityType: entity.documentName === "Item" ? "item" : "actor",
      entityUuid: entity.uuid,
      componentKey: this.key,
      setValueFn: async (updatedEntity) => {
        const maxNow = foundry.utils.getProperty(updatedEntity, `system.props.${this.key}_max`);
        if (Number.isFinite(Number(maxNow)) && Number(maxNow) !== segments) {
          const doc = await resolveDocument(updatedEntity);
          if (doc) forceRenderDoc(doc);
          return;
        }

        const rawNow = foundry.utils.getProperty(updatedEntity, `system.props.${this.key}`);
        const rawCompat = (rawNow && typeof rawNow === "object") ? rawNow.value : rawNow;

        const vNow = parseIntStrict(rawCompat);
        if (!Number.isFinite(vNow)) return;

        const next = clampInt(vNow, 0, segments);
        this._paint(wedges, next);

        if (updatedEntity.system?.props) updatedEntity.system.props[this.key] = next;
      }
    });

    return jQElement;
  }
}
