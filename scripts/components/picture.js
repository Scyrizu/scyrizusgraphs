/*
 * Copyright 2026
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
Hooks.once("customSystemBuilderInit", () => {
  const CSB = game.CustomSystemBuilder?.API;
  if (!CSB) return;

  const { InputComponent, componentFactory } = CSB.Components;
  const { TemplateSystem } = CSB;

  const RESERVED_KEY = "scg-picture";

  class Picture extends InputComponent {
    static valueType = "string";

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
        customSize: data.customSize,
      });
    }

    static getTechnicalName() {
      return RESERVED_KEY;
    }

    static getPrettyName() {
      return "SCG - Picture";
    }

    toJSON() {
      return { ...super.toJSON() };
    }

    static fromJSON(json, templateAddress, parent) {
    return new Picture({
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
      });
    }

    static getConfigForm(entity, appId, existingComponent) {
      const div = document.createElement("div");
      div.innerHTML = `
        <div class="form-group">
          <label>Component Key</label>
          <input type="text" name="key" id="pictureKey" 
            value="${existingComponent?.key ?? RESERVED_KEY}" 
            readonly 
            title="This key is reserved and cannot be changed.">
          <p class="hint">This component uses the reserved key '${RESERVED_KEY}'.</p>
        </div>
      `;
      return div;
    }

    static extractConfig(configData, html) {
      const base = super.extractConfig(configData, html);
      return { ...base, key: RESERVED_KEY };
    }

    static validateConfig(json) {
      super.validateConfig(json);
      json.key = RESERVED_KEY;
    }

async _getElement(entity, isEditable = true, options = {}) {
  try {
    const jQ = await super._getElement(entity, isEditable, options);
    jQ.addClass("scg-picture-component");

    const doc = entity?.entity;
    const isApplied = TemplateSystem.isAppliedTemplateSystem(entity);
    const isBuilder = TemplateSystem.isBuilderTemplateSystem(entity);

    const display = doc?.system?.display ?? {};
    const width = display.pp_width ?? 64;
    const height = display.pp_height ?? 64;
    const imgSrc = doc?.img ?? "icons/svg/mystery-man.svg";

    const wrapper = document.createElement("div");
    wrapper.classList.add("scg-picture-wrapper");
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    wrapper.style.overflow = "hidden";
    wrapper.style.flexShrink = "0";

    const img = document.createElement("img");
    img.src = imgSrc;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "contain";
    img.draggable = false;

    wrapper.appendChild(img);
    jQ.append(wrapper);

    wrapper.style.cursor = "pointer";
    if (isBuilder) {
    jQ.addClass("custom-system-editable-component");
    }
    wrapper.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const isGMOrAGM = game.user.isGM || game.user.role === CONST.USER_ROLES.ASSISTANT;
    if (!isGMOrAGM) return;
    const fp = new foundry.applications.apps.FilePicker.implementation({
        type: "image",
        current: doc?.img ?? "",
        callback: async (path) => {
        await doc.update({ img: path });
        img.src = path;
        },
    });
    fp.render(true);
    });

return jQ;

    return jQ;
  } catch(e) {
    console.error("SCG Picture | _getElement error:", e);
    throw e;
  }
}
}

    componentFactory.addComponentType(Picture);

    console.log("SCG Picture | registered");


    Hooks.on("renderComponentSettingsApplication", (app, html) => {
    const select = html.querySelector?.("select.compType") 
        ?? html.querySelector?.('select[data-key="type"]');
    if (!select) return;
    const option = select.querySelector('option[value="scg-picture"]');
    if (option) option.remove();
    });
});