/*
 * Copyright 2026
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

Hooks.once("customSystemBuilderInit", () => {
  const CSB = game.CustomSystemBuilder?.API;
  if (!CSB) {
    console.error("SCG Clock | CSB API not found. Is Custom System Builder v13 loaded?");
    return;
  }

  const { InputComponent, componentFactory } = CSB.Components;
  const { RequiredFieldError } = CSB.Errors;
  const TemplateSystem = CSB.TemplateSystem;

  // Prevent double registration if your module.json loads this file twice
  globalThis.SCG = globalThis.SCG ?? {};
  if (globalThis.SCG.__clockRegistered) return;
  globalThis.SCG.__clockRegistered = true;

  // Reuse shared maps from main.js if you set them there
  const COLOR_SELECTION =
    globalThis.SCG.COLOR_SELECTION ??
    {
      white: "SCG.ComponentProperties.Color.White",
      black: "SCG.ComponentProperties.Color.Black",
      gray: "SCG.ComponentProperties.Color.Gray",
      red: "SCG.ComponentProperties.Color.Red",
      gold: "SCG.ComponentProperties.Color.Gold",
      green: "SCG.ComponentProperties.Color.Green",
      blue: "SCG.ComponentProperties.Color.Blue",
      custom: "SCG.ComponentProperties.Color.Custom"
    };

  // Use CSB’s standard sizes map (string labels)
  const COMPONENT_SIZES =
    globalThis.SCG.COMPONENT_SIZES ??
    {
      "full-size": "CSB.ComponentProperties.Size.Auto",
      "x-small": "CSB.ComponentProperties.Size.Tiny",
      small: "CSB.ComponentProperties.Size.Smaller",
      "m-small": "CSB.ComponentProperties.Size.Small",
      medium: "CSB.ComponentProperties.Size.Medium",
      "m-large": "CSB.ComponentProperties.Size.Large",
      large: "CSB.ComponentProperties.Size.Larger",
      "x-large": "CSB.ComponentProperties.Size.Gigantic",
      custom: "CSB.ComponentProperties.Size.Custom"
    };

  const FORMULA_ERROR = "__SCG_FORMULA_ERROR__";

  function isFormula(str) {
    const s = String(str ?? "").trim();
    return s.startsWith("${") && s.endsWith("}$");
  }

  function parseIntStrict(v) {
    const s = String(v ?? "").trim();
    if (!s) return NaN;
    const m = /^-?\d+$/.exec(s);
    if (!m) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function clampInt(n, min, max) {
    if (!Number.isFinite(n)) return min;
    n = Math.trunc(n);
    return Math.max(min, Math.min(max, n));
  }

  // Accept "r,g,b" or "r,g,b,a" or "rgb(...)" or "rgba(...)"
  function stripRgbWrapper(input) {
    const s = String(input ?? "").trim();
    const m = /^\s*rgba?\((.*)\)\s*$/i.exec(s);
    return m ? m[1].trim() : s;
  }

  function parseRgbToken(tok) {
    const t = String(tok ?? "").trim();
    const m = /^(\d{1,3})$/.exec(t);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    return n;
  }

  function parseAlphaToken(tok) {
    const t = String(tok ?? "").trim();
    // 0..1
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 1) return null;
    return n;
  }

  function normalizeSegmentColorContents(input) {
    const s = stripRgbWrapper(input);
    const parts = s.split(",").map((x) => x.trim());

    if (parts.length === 3) {
      const r = parseRgbToken(parts[0]);
      const g = parseRgbToken(parts[1]);
      const b = parseRgbToken(parts[2]);
      if (r === null || g === null || b === null) return null;
      return `${r}, ${g}, ${b}, 1`;
    }

    if (parts.length === 4) {
      const r = parseRgbToken(parts[0]);
      const g = parseRgbToken(parts[1]);
      const b = parseRgbToken(parts[2]);
      const a = parseAlphaToken(parts[3]);
      if (r === null || g === null || b === null || a === null) return null;
      return `${r}, ${g}, ${b}, ${a}`;
    }

    return null;
  }

  function normalizeBackgroundColorContents(input) {
    // same rules as segment custom color
    return normalizeSegmentColorContents(input);
  }

  async function computeMaybeFormula(str, props, options) {
    const s = String(str ?? "").trim();
    if (!isFormula(s)) return s;

    const CP = globalThis.ComputablePhrase ?? CSB.ComputablePhrase;
    if (!CP) return FORMULA_ERROR;

    try {
      // v13 supports async computeMessage
      const res = await CP.computeMessage(s, props, {
        source: options?.source ?? "scg",
        reference: options?.reference,
        defaultValue: "",
        triggerEntity: options?.triggerEntity
      });
      return String(res?.result ?? "");
    } catch (e) {
      return FORMULA_ERROR;
    }
  }

  function addWarnLine($root, i18nKey) {
    const d = document.createElement("div");
    d.className = "scg-clock-warn";
    d.textContent = game.i18n.localize(i18nKey);
    d.style.fontSize = "11px";
    d.style.marginTop = "2px";
    d.style.opacity = "0.85";
    d.style.pointerEvents = "none";
    $root.append(d);
  }

  function buildWedgePath(cx, cy, r, a0, a1) {
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const largeArc = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`;
  }

  function paintWedges(wedges, filled) {
    for (const w of wedges) {
      const idx = Number(w.dataset.scgSeg);
      // filled => opacity 1, otherwise transparent
      w.style.setProperty("fill-opacity", idx <= filled ? "1" : "0", "important");
    }
  }

  function openSimpleMenu(ev, items) {
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
        try {
          it.onClick();
        } finally {
          close();
        }
      });
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    setTimeout(() => {
      document.addEventListener("pointerdown", onDocPointer, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
  }

  async function resolveDocFromTemplateSystem(ts) {
    // AppliedTemplateSystem wraps an Actor/Item in ts.entity
    const d = ts?.entity;
    if (d && typeof d.update === "function") return d;

    // Fallbacks if a different wrapper shape is used
    if (ts?.document && typeof ts.document.update === "function") return ts.document;
    if (ts?.actor && typeof ts.actor.update === "function") return ts.actor;
    if (ts?.item && typeof ts.item.update === "function") return ts.item;
    return null;
  }

  class Clock extends InputComponent {
    static valueType = "number";

    constructor(data) {
      super({
        key: data.key,
        tooltip: data.tooltip,
        templateAddress: data.templateAddress,
        cssClass: data.cssClass,
        role: data.role,
        permission: data.permission,
        visibilityFormula: data.visibilityFormula,
        parent: data.parent,

        label: data.label,
        size: data.size,
        customSize: data.customSize
      });

      this._disableInteraction = !!data.disableInteraction;

      this._clockColor = String(data.clockColor ?? "white");
      this._clockCustomColor = String(data.clockCustomColor ?? "0, 0, 0, 1");
      this._clockBackgroundColor = String(data.clockBackgroundColor ?? "0, 0, 0, 0.15");
      this._clockBackgroundColorPreset = String(data.clockBackgroundColorPreset ?? "custom");
      this._clockStrokeColor = String(data.clockStrokeColor ?? "black");
      this._clockCustomStrokeColor = String(data.clockCustomStrokeColor ?? "0, 0, 0, 1");

      this._clockSegmentsExpr = String(data.clockSegmentsExpr ?? "4").trim() || "4";
      this._defaultFilledExpr = String(data.defaultFilledExpr ?? "0").trim() || "0";
    }

    static getTechnicalName() {
      return "scgclock";
    }

    static getPrettyName() {
      return "SG - Clock";
    }

    toJSON() {
      const jsonObj = super.toJSON();
      return {
        ...jsonObj,
        disableInteraction: this._disableInteraction,
        clockColor: this._clockColor,
        clockCustomColor: this._clockCustomColor,
        clockBackgroundColor: this._clockBackgroundColor,
        clockBackgroundColorPreset: this._clockBackgroundColorPreset,
        clockStrokeColor: this._clockStrokeColor,
        clockCustomStrokeColor: this._clockCustomStrokeColor,
        clockSegmentsExpr: this._clockSegmentsExpr,
        defaultFilledExpr: this._defaultFilledExpr
      };
    }

    static fromJSON(json, templateAddress, parent) {
      return new Clock({
        key: json.key,
        tooltip: json.tooltip,
        templateAddress,
        cssClass: json.cssClass,
        role: json.role,
        permission: json.permission,
        visibilityFormula: json.visibilityFormula,
        parent,

        label: json.label,
        size: json.size,
        customSize: json.customSize,

        disableInteraction: json.disableInteraction,

        clockColor: json.clockColor,
        clockCustomColor: json.clockCustomColor,
        clockBackgroundColor: json.clockBackgroundColor,
        clockBackgroundColorPreset: json.clockBackgroundColorPreset,
        clockStrokeColor: json.clockStrokeColor,
        clockCustomStrokeColor: json.clockCustomStrokeColor,

        clockSegmentsExpr: json.clockSegmentsExpr ?? "4",
        defaultFilledExpr: json.defaultFilledExpr ?? "0"
      });
    }

    // *** v13 signature: (entity, appId, existingComponent)
    // *** must return HTMLElement, not jQuery
    static async getConfigForm(entity, appId, existingComponent) {
      const data = existingComponent ?? {};

      const mainElt = document.createElement("div");
      mainElt.innerHTML = await renderTemplate("modules/scyrizusgraphs/templates/clock.hbs", {
        ...data,
        appId,
        COMPONENT_SIZES,
        COLOR_SELECTION
      });

      // light dynamic UI (no jQuery required)
      const sizeSelect = mainElt.querySelector("#clockSize");
      const sizeBlock = mainElt.querySelector(".custom-system-size-custom");
      const colorSelect = mainElt.querySelector("#clockColor");
      const colorBlock = mainElt.querySelector(".scg-color-custom");
      const strokeColorSelect = mainElt.querySelector("#clockStrokeColor");
      const strokeColorBlock = mainElt.querySelector(".scg-stroke-color-custom");
      const bgColorSelect = mainElt.querySelector("#clockBackgroundColorPreset");
      const bgColorBlock = mainElt.querySelector(".scg-bg-color-custom");

      const updateSize = () => {
        if (!sizeSelect || !sizeBlock) return;
        sizeBlock.style.display = sizeSelect.value === "custom" ? "" : "none";
      };
      const updateColor = () => {
        if (!colorSelect || !colorBlock) return;
        colorBlock.style.display = colorSelect.value === "custom" ? "" : "none";
      };
      const updateStrokeColor = () => {
        if (!strokeColorSelect || !strokeColorBlock) return;
        strokeColorBlock.style.display = strokeColorSelect.value === "custom" ? "" : "none";
      };
      const updateBgColor = () => {
        if (!bgColorSelect || !bgColorBlock) return;
        bgColorBlock.style.display = bgColorSelect.value === "custom" ? "" : "none";
      };

      sizeSelect?.addEventListener("change", updateSize);
      colorSelect?.addEventListener("change", updateColor);
      strokeColorSelect?.addEventListener("change", updateStrokeColor);
      bgColorSelect?.addEventListener("change", updateBgColor);
      updateSize();
      updateColor();
      updateStrokeColor();
      updateBgColor();

      return mainElt;
    }

    // v13 signature: extractConfig(configData, htmlFormElement)
    static extractConfig(configData, html) {
      // Fallbacks because your HBS is missing name="" on some fields
      const byId = (id) => html?.querySelector?.(id)?.value;

      const size = (configData.size ?? byId("#clockSize") ?? "full-size").toString();
      const clockColor = (configData.clockColor ?? byId("#clockColor") ?? "white").toString();

      const segmentsExpr = (configData.clockSegmentsExpr ?? byId("#clockSegmentsInput") ?? "4").toString();
      const defaultFilledExpr =
        (configData.defaultFilledExpr ??
          configData._defaultFilledExpr ?? // your current HBS mistake
          byId("#defaultFilledInput") ??
          "0"
        ).toString();

      const clockCustomColor = (configData.clockCustomColor ?? byId("#clockCustomColor") ?? "0, 0, 0, 1").toString();
      const clockBackgroundColorPreset =
        (configData.clockBackgroundColorPreset ?? byId("#clockBackgroundColorPreset") ?? "custom").toString();
      const clockBackgroundColor = clockBackgroundColorPreset !== "custom"
        ? clockBackgroundColorPreset
        : (configData.clockBackgroundColor ?? byId("#clockBackgroundColor") ?? "0, 0, 0, 0.15").toString();
      const clockStrokeColor = (configData.clockStrokeColor ?? byId("#clockStrokeColor") ?? "black").toString();
      const clockCustomStrokeColor = (configData.clockCustomStrokeColor ?? byId("#clockCustomStrokeColor") ?? "0, 0, 0, 1").toString();

      const disableInteraction =
        (configData.disableInteraction ??
          configData.clockDisableInteraction ?? // your current HBS name
          html?.querySelector?.("#clockDisableInteraction")?.checked ??
          false) === true ||
        (configData.disableInteraction === "true") ||
        (configData.clockDisableInteraction === "true");

      const fieldData = {
        ...super.extractConfig(configData, html),
        label: (configData.label ?? byId("#clockLabel") ?? "").toString(),
        size,
        customSize: undefined,

        disableInteraction,

        clockSegmentsExpr: segmentsExpr.trim() || "4",
        defaultFilledExpr: defaultFilledExpr.trim() || "0",

        clockColor,
        clockCustomColor: clockCustomColor.trim() || "0, 0, 0, 1",
        clockBackgroundColorPreset: clockBackgroundColorPreset.trim() || "custom",
        clockBackgroundColor: clockBackgroundColor.trim() || "0, 0, 0, 0.15",
        clockStrokeColor: clockStrokeColor.trim() || "black",
        clockCustomStrokeColor: clockCustomStrokeColor.trim() || "0, 0, 0, 1"
      };

      if (fieldData.size === "custom") {
        const cs = parseIntStrict(configData.customSize ?? byId("#clockCustomSize") ?? "");
        fieldData.customSize = Number.isFinite(cs) ? cs : 50;
      }

      this.validateConfig(fieldData);
      return fieldData;
    }

    static validateConfig(json) {
      super.validateConfig(json);

      if (!json.key) {
        throw new RequiredFieldError(game.i18n.localize("CSB.ComponentProperties.ComponentKey"), json);
      }

      // Segments (if not formula, enforce 2..12)
      const segExpr = String(json.clockSegmentsExpr ?? "4").trim() || "4";
      if (!isFormula(segExpr)) {
        const n = parseIntStrict(segExpr);
        if (!Number.isFinite(n)) throw new Error(game.i18n.localize("SCG.Clock.Config.Errors.SegmentsNaN"));
        if (n < 1 || n > 20) throw new Error(game.i18n.localize("SCG.Clock.Config.Errors.SegmentsOutOfRange"));
      }

      // Default filled (if not formula, enforce >=0)
      const dfExpr = String(json.defaultFilledExpr ?? "0").trim() || "0";
      if (!isFormula(dfExpr)) {
        const n = parseIntStrict(dfExpr);
        if (!Number.isFinite(n)) throw new Error(game.i18n.localize("SCG.Clock.Config.Errors.DefaultFilledNaN"));
        if (n < 0) throw new Error(game.i18n.localize("SCG.Clock.Config.Errors.DefaultFilledNegative"));
      }

    const bgPreset = String(json.clockBackgroundColorPreset ?? "custom").trim();
    if (bgPreset === "custom") {
      const bg = String(json.clockBackgroundColor ?? "").trim() || "0, 0, 0, 0.15";
      if (!isFormula(bg)) {
        if (!normalizeBackgroundColorContents(bg)) {
          throw new Error(game.i18n.localize("SCG.Clock.Config.Errors.BackgroundColorInvalid"));
        }
      }
    }

      // Segment custom color (if custom + not formula, validate)
      const cc = String(json.clockCustomColor ?? "").trim() || "0, 0, 0, 1";
      if (String(json.clockColor ?? "white") === "custom" && !isFormula(cc)) {
        if (!normalizeSegmentColorContents(cc)) {
          throw new Error(game.i18n.localize("SCG.Clock.Config.Errors.CustomColorInvalid"));
        }
      }

      // Stroke custom color (if custom + not formula, validate)
      const sc = String(json.clockCustomStrokeColor ?? "").trim() || "0, 0, 0, 1";
      if (String(json.clockStrokeColor ?? "black") === "custom" && !isFormula(sc)) {
        if (!normalizeSegmentColorContents(sc)) {
          throw new Error(game.i18n.localize("SCG.Clock.Config.Errors.CustomStrokeColorInvalid"));
        }
      }
    }

    async _getElement(entity, isEditable = true, options = {}) {
      const { reference } = options;
      const props = { ...(entity?.system?.props ?? {}), ...(options.customProps ?? {}) };

      const jQ = await super._getElement(entity, isEditable, options);
      jQ.addClass("SCG-Clock");

      // Remove prior artifacts
      jQ.find("svg[data-scg-clock]").remove();
      jQ.find(".scg-clock-warn").remove();

      const isApplied = TemplateSystem.isAppliedTemplateSystem(entity);
      const isBuilder = TemplateSystem.isBuilderTemplateSystem(entity);

      // Resolve segments
      const segExpr = String(this._clockSegmentsExpr ?? "4").trim() || "4";
      const segUsesFormula = isFormula(segExpr);

      const segResolved = await computeMaybeFormula(segExpr, props, {
        source: `${this.key}.segments`,
        reference,
        triggerEntity: entity?.entity
      });

      const segNum = segResolved === FORMULA_ERROR ? NaN : parseIntStrict(segResolved);
      const segIsNum = Number.isFinite(segNum);
      const segInRange = segIsNum && segNum >= 1 && segNum <= 20;
      const segments = segInRange ? segNum : 4;

      // Default filled applies ONCE (when prop missing)
      const dfExpr = String(this._defaultFilledExpr ?? "0").trim() || "0";
      const dfUsesFormula = isFormula(dfExpr);

      const dfResolved = await computeMaybeFormula(dfExpr, props, {
        source: `${this.key}.defaultFilled`,
        reference,
        triggerEntity: entity?.entity
      });

      let dfNum = dfResolved === FORMULA_ERROR ? 0 : parseIntStrict(dfResolved);
      if (!Number.isFinite(dfNum)) dfNum = 0;
      dfNum = clampInt(dfNum, 0, segments);

      // Current value stored at system.props[key] as NUMBER
      const currentRaw = foundry.utils.getProperty(entity, `system.props.${this.key}`);
      const missing = currentRaw === undefined || currentRaw === null || currentRaw === "";

      let current = missing ? dfNum : parseIntStrict(currentRaw);
      if (!Number.isFinite(current)) current = missing ? dfNum : 0;
      current = clampInt(current, 0, segments);

      // If missing, set it once
      if (isApplied && missing) {
        const doc = await resolveDocFromTemplateSystem(entity);
        if (doc?.isOwner || game.user.isGM) {
          await doc.update({ [`system.props.${this.key}`]: current }, { diff: true, render: false }).catch(() => {});
        }
      }

      // Make formulas resolve immediately to a number (no reload)
      if (entity?.system?.props) entity.system.props[this.key] = current;

      // Build SVG
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.dataset.scgClock = "1";
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.style.display = "block";
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.outline = "none";
      svg.style.userSelect = "none";

      // Background circle
      const bg = document.createElementNS(NS, "circle");
      bg.setAttribute("cx", "50");
      bg.setAttribute("cy", "50");
      bg.setAttribute("r", "45");
      bg.setAttribute("stroke-width", "3");
      bg.setAttribute("pointer-events", "none");

      const NAMED_BG = {
        white: "245, 245, 245, 0.15",
        black: "27, 27, 27, 0.15",
        gray:  "112, 128, 144, 0.15",
        red:   "205, 92, 92, 0.15",
        gold:  "218, 165, 32, 0.15",
        green: "46, 139, 87, 0.15",
        blue:  "30, 144, 255, 0.15"
      };
      const bgPreset = String(this._clockBackgroundColorPreset ?? "custom").trim();
      const bgRaw = bgPreset !== "custom" && NAMED_BG[bgPreset]
        ? NAMED_BG[bgPreset]
        : String(this._clockBackgroundColor ?? "").trim() || "0, 0, 0, 0.15";
      const bgUsesFormula = isFormula(bgRaw);
      const bgResolved = await computeMaybeFormula(bgRaw, props, {
        source: `${this.key}.backgroundColor`,
        reference,
        triggerEntity: entity?.entity
      });
      const bgNorm = bgResolved === FORMULA_ERROR ? null : normalizeBackgroundColorContents(bgResolved);
      const bgFinal = bgNorm ?? "0, 0, 0, 0.15";
      bg.style.fill = `rgba(${bgFinal})`;

      // Stroke color
      const stRaw = String(this._clockStrokeColor ?? "black").trim() || "black";
      const stIsCustom = stRaw === "custom";
      let stFinalColor = null;
      let stUsesFormula = false;
      if (stIsCustom) {
        const scRaw2 = String(this._clockCustomStrokeColor ?? "").trim() || "0, 0, 0, 1";
        stUsesFormula = isFormula(scRaw2);
        const scResolved2 = await computeMaybeFormula(scRaw2, props, {
          source: `${this.key}.strokeColor`,
          reference,
          triggerEntity: entity?.entity
        });
        const scNorm2 = scResolved2 === FORMULA_ERROR ? null : normalizeSegmentColorContents(scResolved2);
        stFinalColor = scNorm2 ? `rgba(${scNorm2})` : "black";
        if (!isBuilder && stUsesFormula && !scNorm2) {
          addWarnLine(jQ[0], "SCG.Clock.Errors.StrokeColorFormulaInvalid");
        }
      } else {
        // Map named color keys to their CSS values via the fill class colors
        const NAMED_STROKE = {
          white: "rgba(245, 245, 245, 1)",
          black: "rgba(27, 27, 27, 1)",
          gray:  "rgba(112, 128, 144, 1)",
          red:   "rgba(205, 92, 92, 1)",
          gold:  "rgba(218, 165, 32, 1)",
          green: "rgba(46, 139, 87, 1)",
          blue:  "rgba(30, 144, 255, 1)"
        };
        stFinalColor = NAMED_STROKE[stRaw] ?? "rgba(27, 27, 27, 1)";
      }
      bg.setAttribute("stroke", stFinalColor);

      svg.appendChild(bg);

      // Wedges
      const wedges = [];
      const cx = 50, cy = 50, r = 44;
      const start = -Math.PI / 2;

      // Fill color
      let segFillStyle = null;
      let segFillClass = null;

      if (this._clockColor === "custom") {
        const scRaw = String(this._clockCustomColor ?? "").trim() || "0, 0, 0, 1";
        const scUsesFormula = isFormula(scRaw);
        const scResolved = await computeMaybeFormula(scRaw, props, {
          source: `${this.key}.segmentColor`,
          reference,
          triggerEntity: entity?.entity
        });
        const scNorm = scResolved === FORMULA_ERROR ? null : normalizeSegmentColorContents(scResolved);
        const scFinal = scNorm ?? "0, 0, 0, 1";
        segFillStyle = `rgba(${scFinal})`;

        if (!isBuilder && scUsesFormula && !scNorm) {
          addWarnLine(jQ[0], "SCG.Clock.Errors.SegmentColorFormulaInvalid");
        }
      } else {
        segFillClass = `scg-fill-${this._clockColor}`;
      }

    for (let i = 1; i <= segments; i++) {
      let w;
      if (segments === 1) {
        w = document.createElementNS(NS, "circle");
        w.setAttribute("cx", String(cx));
        w.setAttribute("cy", String(cy));
        w.setAttribute("r", String(r));
      } else {
        const a0 = start + (2 * Math.PI * (i - 1)) / segments;
        const a1 = start + (2 * Math.PI * i) / segments;
        w = document.createElementNS(NS, "path");
        w.setAttribute("d", buildWedgePath(cx, cy, r, a0, a1));
      }
      w.dataset.scgSeg = String(i);

      w.style.stroke = stFinalColor;
      w.style.strokeWidth = "1";
      w.style.cursor = isApplied ? "pointer" : "default";
      w.style.outline = "none";

      if (segFillStyle) {
        w.style.fill = segFillStyle;
      } else if (segFillClass) {
        w.classList.add(segFillClass);
      }

      wedges.push(w);
      svg.appendChild(w);
    }

      paintWedges(wedges, current);

      jQ.append(svg);

      // Debug warnings for segments/background formulas
      if (!isBuilder && segUsesFormula && !segIsNum) {
        addWarnLine(jQ[0], "SCG.Clock.Errors.SegmentFormulaNaN");
      }
      if (!isBuilder && segUsesFormula && segIsNum && !segInRange) {
        addWarnLine(jQ[0], "SCG.Clock.Errors.SegmentFormulaOutOfRange");
      }
      if (!isBuilder && bgUsesFormula && !bgNorm) {
        addWarnLine(jQ[0], "SCG.Clock.Errors.BackgroundColorFormulaInvalid");
      }

      // Builder template: click opens editor (never disabled)
      if (isBuilder) {
        jQ.addClass("custom-system-editable-component");
        jQ.on("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.editComponent(entity);
        });
        return jQ;
      }

      // Applied actor/item: interactivity optional
      const allowInteract = isApplied && !this._disableInteraction && isEditable;

      const persistValue = async (nextValue) => {
        nextValue = clampInt(nextValue, 0, segments);

        // Visual update immediately
        paintWedges(wedges, nextValue);

        // Update in-memory props immediately so formulas can see it right now
        if (entity?.system?.props) entity.system.props[this.key] = nextValue;

        const doc = await resolveDocFromTemplateSystem(entity);
        if (!doc || !(doc.isOwner || game.user.isGM)) return;

        await doc.update({ [`system.props.${this.key}`]: nextValue }, { diff: true, render: true });

        // kill focus outline artifact
        const ae = document.activeElement;
        if (ae && typeof ae.blur === "function") ae.blur();
      };

      if (allowInteract) {
        const root = jQ[0];

        root.addEventListener(
          "contextmenu",
          (ev) => {
            if (!svg.contains(ev.target)) return;
            ev.preventDefault();
            ev.stopPropagation();
          },
          true
        );

        root.addEventListener(
          "pointerdown",
          (ev) => {
            if (!svg.contains(ev.target)) return;

            // Right click menu
            if (ev.button === 2) {
              ev.preventDefault();
              ev.stopPropagation();

              openSimpleMenu(ev, [
                {
                  label: game.i18n.localize("SCG.ContextMenu.ClearAll"),
                  onClick: () => persistValue(0)
                }
              ]);
              return;
            }
          },
          true
        );

        root.addEventListener(
          "mousedown",
          (ev) => {
            if (!svg.contains(ev.target)) return;
            if (ev.button !== 0) return;

            const path = ev.target?.closest?.("[data-scg-seg]");
            if (!path) return;

            const seg = Number(path.dataset.scgSeg);
            if (!Number.isFinite(seg)) return;

            ev.preventDefault();
            ev.stopPropagation();

            persistValue(seg);
          },
          true
        );
      }

      return jQ;
    }
  }

  // Register component in factory (v13 style)
  componentFactory.addComponentType(Clock);
  console.log("SCG Clock | registered");
});
