// Import Modules
import { olActor } from "./actor/actor.js";
import { olActorSheet } from "./actor/actor-sheet.js";
import { olNPCActorSheet } from "./actor/npc-sheet.js";
import { olItem } from "./item/item.js";
import { olItemSheet } from "./item/item-sheet.js";
import { preloadHandlebarsTemplates } from "./templates.js";
import * as macros from "./util/macros.js";

/* ----------------------------- */
/* Utility: local slugify (v13+) */
/* ----------------------------- */
function slugifyLabel(input) {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFKD")                    // split accented chars
    .replace(/[\u0300-\u036f]/g, "")      // drop diacritics
    .replace(/[^a-z0-9]+/g, "-")          // non-alphanumerics -> hyphen
    .replace(/^-+|-+$/g, "");             // trim hyphens
}

Hooks.once("init", async function () {
  game.openlegend = { olActor, olItem, macros };

  // Register settings
  game.settings.register("openlegend", "alt_d20_explosion", {
    name: "Alternate D20 Explosions",
    hint: "D20's explode as scaling attribute dice rather than d20s",
    scope: "world",
    config: true,
    type: Boolean,
    choices: { true: "On", false: "Off" },
    default: false,
    onChange: (value) => console.log(value),
  });

  // Initiative
  CONFIG.Combat.initiative = { formula: "1d20X" };
  Combatant.prototype._getInitiativeFormula = _getInitiativeFormula;

  // Document classes
  CONFIG.Actor.documentClass = olActor;
  CONFIG.Item.documentClass = olItem;

  // Sheets
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("openlegend", olActorSheet, { types: ["character"], makeDefault: true });
  Actors.registerSheet("openlegend", olNPCActorSheet, { types: ["npc"], makeDefault: true });
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("openlegend", olItemSheet, { makeDefault: true });

  // Handlebars helpers
  Handlebars.registerHelper("concat", function () {
    let outStr = "";
    for (let arg in arguments) if (typeof arguments[arg] !== "object") outStr += arguments[arg];
    return outStr;
  });
  Handlebars.registerHelper("toLowerCase", (str) => String(str ?? "").toLowerCase());
  Handlebars.registerHelper("ifeq", (a, b, opts) => (a === b ? opts.fn(this) : opts.inverse(this)));
  Handlebars.registerHelper("gtz", (v) => v > 0);

  // Preload template partials
  preloadHandlebarsTemplates();
});

Hooks.once("ready", async function () {
  // Hotbar macro from drag
  Hooks.on("hotbarDrop", (bar, data, slot) => macros.createOLMacro(data, slot));

  // Build custom status effects (Open Legend boons/banes)
  await buildOpenLegendStatusEffects();

  // Special mappings (ids must exist in CONFIG.statusEffects)
  CONFIG.specialStatusEffects = {
    DEFEATED: "dead",
    INVISIBLE: "concealment",
    BLIND: "blinded",
  };

  // --- Combat lifecycle (no scene linkage assumptions in v13) ---
  Hooks.on("combatStart", (combat) => {
    for (const c of combat.combatants) c.actor?.update({ system: { defendUsed: false, majorUnavailable: false } });
  });

  Hooks.on("preDeleteCombat", (combat) => {
    for (const c of combat.combatants) c.actor?.update({ system: { defendUsed: false, majorUnavailable: false } });
  });

  Hooks.on("deleteCombat", (combat) => {
    for (const c of combat.combatants) c.actor?.sheet?.render(false);
  });

  Hooks.on("updateCombat", async (combat) => {
    const curr = combat.combatant?.actor ?? null;
    if (curr?.system.defendUsed) await curr.update({ "system.defendUsed": false });

    const prevId = combat.previous?.combatantId;
    const prev = prevId ? combat.combatants.get(prevId)?.actor ?? null : null;
    if (prev?.system.majorUnavailable) await prev.update({ "system.majorUnavailable": false });
    if (prev?.system.defendUsed) await prev.update({ "system.majorUnavailable": true });
  });
});

/* -------------------------------------------- */
/*  Status Effects Builder (v13-safe)           */
/* -------------------------------------------- */
async function buildOpenLegendStatusEffects() {
  const logPrefix = "[Open Legend] StatusEffects:";
  const effectsMap = new Map();

  // Helper to normalize and add entries, deduped by id
  const addEffect = (labelOrName, iconOrImg) => {
    const label = String(labelOrName ?? "").trim();
    const icon = String(iconOrImg ?? "").trim();
    if (!label || !icon) return;
    const id = slugifyLabel(label); // local, v13-safe
    const img = icon.replace(/blackbackground/g, "whitetransparent");
    effectsMap.set(id, {
      id,
      // Provide BOTH key styles to be robust across HUD expectations
      label, icon: img,
      name: label, img,
    });
  };

  // 1) System compendia
  let boonCount = 0, baneCount = 0;
  const packIds = ["openlegend.banes", "openlegend.boons"];
  for (const pid of packIds) {
    try {
      const pack = game.packs.get(pid);
      if (!pack) { console.warn(`${logPrefix} Missing compendium ${pid}`); continue; }

      // Try fast index first; if it lacks imgs, fall back to full docs.
      const index = await pack.getIndex();
      const hasImgs = index.some(e => !!e.img);
      if (hasImgs) {
        index.forEach(e => addEffect(e.name, e.img));
        if (pid.endsWith(".boons")) boonCount = index.length;
        if (pid.endsWith(".banes")) baneCount = index.length;
      } else {
        const docs = await pack.getDocuments();
        docs.forEach(d => addEffect(d.name, d.img));
        if (pid.endsWith(".boons")) boonCount = docs.length;
        if (pid.endsWith(".banes")) baneCount = docs.length;
      }
    } catch (err) {
      console.warn(`${logPrefix} Failed to read ${pid}:`, err);
    }
  }

  // 2) World items (homebrew)
  let homebrewCount = 0;
  try {
    for (const it of game.items.contents) {
      if (it.type === "boon" || it.type === "bane") {
        addEffect(it.name, it.img);
        homebrewCount++;
      }
    }
  } catch (err) {
    console.warn(`${logPrefix} Failed to scan world items:`, err);
  }

  // 3) Always include "Dead"
  addEffect(game.i18n.localize("EFFECT.StatusDead") || "Dead", "icons/svg/skull.svg");

  // 4) Finalize: sort and assign
  const statusEffects = Array.from(effectsMap.values()).sort((a, b) => {
    const A = (a.label || a.name || "").toLowerCase();
    const B = (b.label || b.name || "").toLowerCase();
    return A.localeCompare(B);
  });
  CONFIG.statusEffects = statusEffects;

  console.log(`${logPrefix} Banes: ${baneCount}, Boons: ${boonCount}, Homebrew: ${homebrewCount}, Total: ${statusEffects.length}`);
}

/* -------------------------------------------- */
/*  Initiative                                  */
/* -------------------------------------------- */
export const _getInitiativeFormula = function () {
  const actor = this.actor;
  if (!actor) return "1d20";
  const agi = actor.system.attributes.physical.agility.dice;

  const init_mod = actor.system.initiative_mod;
  if (init_mod === undefined || init_mod === 0) {
    if (agi.num === 0) return "1d20X";
    else return `1d20X + ${agi.str}X`;
  } else if (agi.num === 0) {
    return init_mod < 0 ? "2d20kl1X" : "2d20kh1X";
  }
  const keep_str = init_mod < 0 ? `kl${agi.num}X` : `kh${agi.num}X`;
  const dice_to_roll = Math.abs(init_mod) + agi.num;
  return `1d20X + ${dice_to_roll}${agi.die}${keep_str}`;
};
