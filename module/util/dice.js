export async function rollAttr(actor, attr_name, skip_dialog=false) {
  // Get the attribute from its name
  const attr = _getAttr(actor, attr_name);
  if (!attr) return;

  // Generate an OLRoll for the attribute
  let olroll = await OLRoll(attr_name, attr, 0, 0, 0, skip_dialog);
  if (!olroll.roll) return;

  // Generate a chat message template using OLRoll data
  const template = "systems/openlegend/templates/dialog/roll-chat.html";
  const data = {
    name: attr_name,
    type: "Attribute",
    attr: olroll.attr,
    adv: olroll.adv
  };
  const html = await renderTemplate(template, data);

  // Send to chat
  olroll.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: html
  });
}

export async function rollItem(actor, item, skip_dialog=false) {
  // If the item has a chosen action attribute...
  const attr_name = item.system.action.attribute;
  const attr = _getAttr(actor, attr_name);
  if (!attr) return;

  // Generate an OLRoll for the attribute
  let advantage = Number(item.system.action.default_adv);
  let advBonus = 0;
  if (actor.system.advantageBonus && (item.type === "attack" || item.type === "weapon")) {
    advantage += actor.system.advantageBonus;
    advBonus = actor.system.advantageBonus;
  }

  let olroll = await OLRoll(attr_name, attr, advantage, advBonus, item.system.action.explosion_mod, skip_dialog);
  if (!olroll.roll) return;

  // Generate a chat message template using OLRoll data
  const template = "systems/openlegend/templates/dialog/roll-chat.html";
  const data = {
    name: item.system.action.name,
    type: item.type,
    notes: item.system.details.notes,
    attr: olroll.attr,
    target: item.system.action.target,
    adv: olroll.adv
  };
  const html = await renderTemplate(template, data);

  // Send to chat
  olroll.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: html
  });
}

export async function OLRoll(attr_name, attr, default_adv=0, advBonus=0, explosion_modifier=0, skip_window=false) {
  const to_return = {
    roll: null,
    attr: {
      name: attr_name,
      score: attr.modified_score,
      dice: attr.dice
    },
    adv: {
      type: "",
      value: 0
    }
  };

  // Create the Dialog window
  let adv = default_adv;
  if (!skip_window) adv = await _OLRollDialog(attr_name, attr, default_adv, advBonus);
  if (adv == null) return to_return;

  const dice = attr.dice;
  const d20_explos = explosion_modifier > 0 ? `X>=${Math.max(2, 20 - explosion_modifier)}` : "X";

  // If score is zero
  if (attr.modified_score <= 0) {
    to_return.attr.dice = null;
    if (adv > 0) {
      to_return.adv.type = "Advantage";
      to_return.adv.value = 1;
      to_return.roll = new Roll(`2d20kh1${d20_explos}`);
    } else if (adv < 0) {
      to_return.adv.type = "Disadvantage";
      to_return.adv.value = 1;
      to_return.roll = new Roll(`2d20kl1${d20_explos}`);
    } else {
      to_return.adv = null;
      to_return.roll = new Roll(`1d20${d20_explos}`);
    }
  } else {
    const die_num = parseInt(dice.die.substring(1));
    const attr_explos = explosion_modifier > 0 ? `X>=${Math.max(2, die_num - explosion_modifier)}` : "X";
    // Normal roll
    if (adv === 0) {
      to_return.adv = null;
      to_return.roll = new Roll(`1d20${d20_explos} + ${dice.num + dice.die}${attr_explos}`);
    } else {
      to_return.adv.value = Math.abs(adv);
      let advstr = "";
      if (adv < 0) {
        to_return.adv.type = "Disadvantage";
        advstr = "kl" + dice.num;
      } else {
        to_return.adv.type = "Advantage";
        advstr = "kh" + dice.num;
      }
      // e.g., 1d20X + 3d8kh2X
      to_return.roll = new Roll(`1d20${d20_explos} + ${(to_return.adv.value + dice.num) + dice.die + advstr}${attr_explos}`);
    }
  }

  // Apply alternate d20 explosion mode (v13-safe: async evaluate)
  if (game.settings.get("openlegend", "alt_d20_explosion")) {
    to_return.roll = await _modifyD20Explosion(to_return.roll, dice);
  }

  return to_return;
}

/**
 * v13-safe d20 explosion modification:
 * - Evaluate roll asynchronously before inspecting terms/results.
 * - Use foundry.dice.terms.* classes when available.
 */
async function _modifyD20Explosion(roll, dice) {
  // Safety: ensure we have a Roll
  if (!roll) return roll;

  // Check if there is a D20 in the roll (first term is a d20 pool)
  const first = roll.terms?.[0];
  if (!(first && first.faces === 20)) return roll;

  // Evaluate the roll (v13: async)
  await roll.evaluate({ async: true });

  // Check if a nat 20 was rolled via explosion
  let nat20 = false;
  let nat20_index = -1;
  const d20results = roll.terms[0].results ?? [];
  for (let i = 0; i < d20results.length; i++) {
    const result = d20results[i];
    if (nat20) {
      // Ignore extra exploded results after we detect the first active explosion
      result["ignore"] = true;
      continue;
    }
    if (result["exploded"] && result["active"]) {
      nat20 = true;
      nat20_index = i;
    }
  }

  // Do not modify if didn't roll a 20
  if (!nat20) return roll;

  // Clone the roll and iterate through all terms/results
  let new_roll = roll.clone();

  for (let t = 0; t < roll.terms.length; t++) {
    const term = roll.terms[t];
    const new_term = new_roll.terms[t];
    // Skip if not a resultable die
    if (term.results === undefined) continue;

    for (let r = 0; r < term.results.length; r++) {
      const result = term.results[r];
      if (!result["ignore"]) new_term.results.push(result);
    }
    new_term._evaluated = true;
  }

  // Add bonus die (upgrade attribute die once)
  const bonus_die = _upgradeDie(dice);

  const OperatorTermCls = foundry?.dice?.terms?.OperatorTerm ?? OperatorTerm;
  const DieCls = foundry?.dice?.terms?.Die ?? Die;

  new_roll.terms.splice(1, 0, new OperatorTermCls({ operator: "+" }));
  new_roll.terms.splice(2, 0, new DieCls({ faces: bonus_die.faces, number: bonus_die.num, modifiers: ["X"] }));

  return new_roll;
}

async function _OLRollDialog(attr_name, attr, default_adv=0, advBonus=0) {
  const template = "systems/openlegend/templates/dialog/roll-dialog.html";
  const data = { attr: attr_name, score: attr.modified_score, formula: "1d20", default_adv, advBonus };
  if (attr.modified_score > 0) data.formula += " + " + attr.dice.num + attr.dice.die;

  const content = await renderTemplate(template, data);

  return new Promise(resolve => {
    const dlg = new Dialog({
      title: "Configure Roll",
      content,
      buttons: {
        dis: { label: "Dis [-1]" }, // handled below to keep dialog open
        roll: {
          label: "Roll",
          callback: (html) => {
            const val = parseInt(html[0].querySelector("input[name='advlevel']").value || "0", 10);
            resolve(val);
          }
        },
        adv: { label: "Adv [+1]" }  // handled below to keep dialog open
      },
      default: "roll",
      close: () => resolve(null)
    });

    Hooks.once("renderDialog", (app, html) => {
      if (app.appId !== dlg.appId) return;

      const bump = (delta) => {
        const inp = html[0].querySelector("input[name='advlevel']");
        const cur = parseInt(inp.value || "0", 10);
        inp.value = cur + delta;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
      };

      // Intercept side buttons so the dialog stays open
      html.find('button[data-button="dis"]').off('click').on('click', ev => {
        ev.preventDefault(); ev.stopImmediatePropagation();
        bump(-1);
      });
      html.find('button[data-button="adv"]').off('click').on('click', ev => {
        ev.preventDefault(); ev.stopImmediatePropagation();
        bump(1);
      });
    });

    dlg.render(true);
  });
}


export function _getAttr(actor, attr_name) {
  // Find the attribute data object using its name
  for (const [, attr_group] of Object.entries(actor.system.attributes)) {
    if (attr_group[attr_name]) return attr_group[attr_name];
  }
  return null;
}

function _upgradeDie(die) {
  const d = {};
  d.num = 1;
  if (die.num === 0) d.faces = 4;
  else if (die.num === 1) d.faces = Math.max(4, parseInt(die.die.substring(1)));
  else d.faces = 10;
  return d;
}
export async function rollDread(actor) {
  const lvl = Number(actor.system?.dread?.level ?? 0);

  // level -> dice
  let num = 0, die = "d4";
  if (lvl <= 2)  { num = 0; die = "d4"; }
  else if (lvl <= 4)  { num = 1; die = "d4"; }
  else if (lvl <= 6)  { num = 1; die = "d6"; }
  else if (lvl <= 8)  { num = 1; die = "d8"; }
  else if (lvl <= 10) { num = 1; die = "d10"; }
  else if (lvl <= 12) { num = 2; die = "d6"; }
  else if (lvl <= 14) { num = 2; die = "d8"; }
  else if (lvl <= 16) { num = 2; die = "d10"; }
  else if (lvl <= 18) { num = 3; die = "d8"; }
  else if (lvl === 19) { num = 3; die = "d10"; }
  else { num = 4; die = "d8"; } // 20

  // If there are dice, set modified_score=1 so OLRoll includes them; else 0 (1d20 only)
  const hasDice = num > 0;
  const attr = { name: "Dread", modified_score: hasDice ? 1 : 0, dice: { num, die } };

  // SHOW the Adv/Dis dialog (skip_window = false)
  const olroll = await OLRoll("Dread", attr, /*default_adv*/ 0, /*advBonus*/ 0, /*explosion_mod*/ 0, /*skip_window*/ false);
  if (!olroll?.roll) return;

  // Display 0 as the attribute score on the chat card
  if (olroll.attr) olroll.attr.score = 0;

  // Target = Resolve capped at 15
  const resolve = Math.min(15, Number(actor.system?.defense?.resolve?.resolve ?? 0));

  // Chat card
  const template = "systems/openlegend/templates/dialog/roll-chat.html";
  const data = { name: "Dread Check", type: "Dread", attr: olroll.attr, adv: olroll.adv, target: resolve };
  const html = await renderTemplate(template, data);

  return olroll.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: html
  });
}
