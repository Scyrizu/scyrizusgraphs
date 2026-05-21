/*
 * Copyright 2026
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import "./components/clock.js";
import "./components/picture.js";

Hooks.once("customSystemBuilderInit", () => {
  globalThis.SCG = globalThis.SCG || {};
  globalThis.SCG.shared = globalThis.SCG.shared || {};
  globalThis.SCG.shared.COLOR_SELECTION = {
    white:  "SCG.ComponentProperties.Color.White",
    black:  "SCG.ComponentProperties.Color.Black",
    gray:   "SCG.ComponentProperties.Color.Gray",
    red:    "SCG.ComponentProperties.Color.Red",
    gold:   "SCG.ComponentProperties.Color.Gold",
    green:  "SCG.ComponentProperties.Color.Green",
    blue:   "SCG.ComponentProperties.Color.Blue",
    custom: "SCG.ComponentProperties.Color.Custom"
  };

  game.settings.register("scyrizusgraphs", "scg-picture-check", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });
});

Hooks.on("renderDisplaySettingsDialog", (app, html) => {
  const stored = game.settings.get("scyrizusgraphs", "scg-picture-check");
  const currentValue = stored[app.entity.id] ?? false;
  const footer = html.querySelector(".form-footer");

  footer.insertAdjacentHTML("beforebegin", `
    <div>
      <h1 class="pictureSize">${game.i18n.localize("SCG.DisplaySettings.PictureHeader")}</h1>
      <div class="display-settings">
        <label for="scg-picture-check">${game.i18n.localize("SCG.DisplaySettings.UsePictureLabel")}</label>
        <input type="checkbox" id="scg-picture-check" name="scg-picture-check" ${currentValue ? "checked" : ""}>
      </div>
    </div>
  `);

  let pendingValue = currentValue;
  let saved = false;

  html.querySelector("#scg-picture-check").addEventListener("change", (e) => {
    pendingValue = e.target.checked;
  });

  html.closest("form")?.addEventListener("submit", () => {
    saved = true;
  });

  Hooks.once("closeDisplaySettingsDialog", async (closedApp) => {
  if (closedApp.id !== app.id) return;
  if (!saved) return;
  
  const template = app.entity.documentName === "Actor" 
    ? game.actors.get(app.entity.id) 
    : game.items.get(app.entity.id);
  if (!template) return;

    const componentExists = template.system.header.contents.some(c => c.key === "scg-picture");
    const storedValue = game.settings.get("scyrizusgraphs", "scg-picture-check")[app.entity.id] ?? false;

        if (pendingValue === storedValue && pendingValue === componentExists) {
          return;
        }


    const current = game.settings.get("scyrizusgraphs", "scg-picture-check");
    current[app.entity.id] = pendingValue;
    game.settings.set("scyrizusgraphs", "scg-picture-check", current);

    const header = foundry.utils.deepClone(template.system.header);

    if (pendingValue) {
      const alreadyPlaced = header.contents.some(c => c.key === "scg-picture");
      if (!alreadyPlaced) {
        header.contents.unshift({
          key: "scg-picture",
          colSpan: 1,
          rowSpan: 1,
          cssClass: "",
          role: 0,
          editRole: 0,
          permission: 0,
          tooltip: "",
          visibilityFormula: "",
          editableFormula: "",
          escapeHTML: false,
          type: "scg-picture",
          size: "full-size",
        });
      }
    } else {
      header.contents = header.contents.filter(c => c.key !== "scg-picture");
    }

    await template.update({ "system.header": header });

    // Clear CSB's cached parsed template state so it re-parses from the updated header
    if (template.templateSystem) {
      template.templateSystem.customHeader = undefined;
      template.templateSystem.customBody = undefined;
    }

    template.render(false);


  });
});

function applyPictureHide(app, html) {
  const stored = game.settings.get("scyrizusgraphs", "scg-picture-check");
  const templateId = app.document?.system?.template ?? app.document?.id;
  const hide = stored[templateId] ?? false;
  const container = html.querySelector(".profile-img-container");
  if (!container) return;
  
  if (hide) {
    // Only hide native image if SCG picture component is actually rendered
    const scgPicture = html.querySelector(".scg-picture-component");
    if (scgPicture) {
      container.classList.add("scg-hide");
    } else {
      container.classList.remove("scg-hide");
    }
  } else {
    container.classList.remove("scg-hide");
  }
}

Hooks.on("renderCharacterSheetV2", applyPictureHide);
Hooks.on("renderTemplateSheetV2", applyPictureHide);
Hooks.on("renderEquippableItemSheetV2", applyPictureHide);
Hooks.on("renderEquippableItemTemplateSheetV2", applyPictureHide);