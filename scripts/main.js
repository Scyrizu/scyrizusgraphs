/*
 * Copyright 2026
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import Clock from "./components/clock.js";

function ensureSCGShared() {
  globalThis.SCG = globalThis.SCG || {};
  globalThis.SCG.shared = globalThis.SCG.shared || {};

  globalThis.SCG.shared.COLOR_SELECTION = {
    white: "SCG.ComponentProperties.Color.White",
    black: "SCG.ComponentProperties.Color.Black",
    gray: "SCG.ComponentProperties.Color.Gray",
    red: "SCG.ComponentProperties.Color.Red",
    gold: "SCG.ComponentProperties.Color.Gold",
    green: "SCG.ComponentProperties.Color.Green",
    blue: "SCG.ComponentProperties.Color.Blue",
    custom: "SCG.ComponentProperties.Color.Custom"
  };

  return globalThis.SCG.shared;
}

function rewriteRefMax(message, props) {
  try {
    if (typeof message !== "string") return message;
    if (!message.includes("ref(") || !message.includes(".max")) return message;
    if (!props || typeof props !== "object") return message;

    return message.replace(
      /ref\(\s*(['"])([^'"]+)\1\s*\)\s*\.max\b/g,
      (m, _q, key) => {
        const maxKey = `${key}_max`;
        if (Object.prototype.hasOwnProperty.call(props, maxKey)) {
          return `ref('${maxKey}')`;
        }
        return m;
      }
    );
  } catch {
    return message;
  }
}

function patchComputablePhraseOnce() {
  const CP = globalThis.ComputablePhrase;
  if (!CP) return false;
  if (CP.__scgPatchedRefMax) return true;

  if (typeof CP.computeMessageStatic === "function") {
    const orig = CP.computeMessageStatic;
    CP.computeMessageStatic = function (message, props, options) {
      return orig.call(this, rewriteRefMax(message, props), props, options);
    };
  }

  if (typeof CP.computeMessage === "function") {
    const orig = CP.computeMessage;
    CP.computeMessage = async function (message, props, options) {
      return orig.call(this, rewriteRefMax(message, props), props, options);
    };
  }

  CP.__scgPatchedRefMax = true;
  return true;
}

let SCG_REGISTERED = false;

Hooks.once("customSystemBuilderInit", () => {
  if (SCG_REGISTERED) return;
  SCG_REGISTERED = true;

  const shared = ensureSCGShared();
  Clock.setShared?.(shared);

  componentFactory.addComponentType(Clock.getTechnicalName(), Clock);

  patchComputablePhraseOnce();

  console.log(`SCG: Registered "${Clock.getTechnicalName()}"`);
});
