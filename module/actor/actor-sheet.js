import { rollAttr, rollItem, rollDread } from "../util/dice.js";
import { move_action_up, move_feat_up, move_gear_up } from "./item-movement.js";

function dreadDiceFromLevel(lvl){
  lvl = Number(lvl ?? 0);
  if (lvl <= 2)  return { num: 0, faces: 0,  diceStr: "+d0"   };
  if (lvl <= 4)  return { num: 1, faces: 4,  diceStr: "+1d4"  };
  if (lvl <= 6)  return { num: 1, faces: 6,  diceStr: "+1d6"  };
  if (lvl <= 8)  return { num: 1, faces: 8,  diceStr: "+1d8"  };
  if (lvl <= 10) return { num: 1, faces: 10, diceStr: "+1d10" };
  if (lvl <= 12) return { num: 2, faces: 6,  diceStr: "+2d6"  };
  if (lvl <= 14) return { num: 2, faces: 8,  diceStr: "+2d8"  };
  if (lvl <= 16) return { num: 2, faces: 10, diceStr: "+2d10" };
  if (lvl <= 18) return { num: 3, faces: 8,  diceStr: "+3d8"  };
  if (lvl === 19) return { num: 3, faces: 10, diceStr: "+3d10" };
  return               { num: 4, faces: 8,  diceStr: "+4d8"  }; // 20
}

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
export class olActorSheet extends ActorSheet {

  /** @override */
  static get defaultOptions() {
    const options = foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["openlegend", "sheet", "actor", "character"],
      width: 1200,
      height: 600,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" }],
      dragDrop: [{dragSelector: ".macro", dropSelector: null}]
    });
    return options;
  }

  /** @override */
  get template() {
    return "systems/openlegend/templates/actor/actor-sheet.html";
  }

  /* -------------------------------------------- */

  /** @override */
async getData(options) {
  const actorData = super.getData();
  const sheetData = actorData.data;
  sheetData.owner = actorData.owner;
  sheetData.editable = actorData.editable;

  if (sheetData.actions === undefined) {
    sheetData.actions = [];
    sheetData.gear    = [];
    sheetData.feats   = [];
    sheetData.perks   = [];
    sheetData.flaws   = [];
  }

  actorData.items.forEach(item => {
    if (item.system.action) sheetData.actions.push(item);
    if (item.system.gear)   sheetData.gear.push(item);
    if (item.type === 'feat') sheetData.feats.push(item);
    else if (item.type === 'perk') sheetData.perks.push(item);
    else if (item.type === 'flaw') sheetData.flaws.push(item);
  });

  sheetData.actions.sort((a, b) => a.system.action.index - b.system.action.index);
  sheetData.gear.sort((a, b) => a.system.gear.index - b.system.gear.index);
  sheetData.feats.sort((a, b) => a.system.index - b.system.index);

  sheetData.inCombat = this.actor.inCombat;
  sheetData.system.notes = await TextEditor.enrichHTML(sheetData.system.notes, { secrets: actorData.isOwner });

  // Dread dice for the template label
  const { diceStr } = dreadDiceFromLevel(sheetData.system?.dread?.level);
  sheetData.dread = { diceStr };

  return sheetData;
}


  /** @override */
  async _onDropItemCreate(itemData) {
    const data = await this.getData();
    if (itemData.system.action) {
      itemData.system.action.index = data.actions.length;
      itemData.system.action.name = itemData.name;
    }

    if (itemData.system.gear)
      itemData.system.gear.index = data.gear.length;

    if (itemData.type === 'feat')
      itemData.system.index = data.feats.length;

    // Create the owned item as normal
    return super._onDropItemCreate(itemData);
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Everything below here is only needed if the sheet is editable
    if (!this.options.editable) return;

    html.find(".update-box").click(this._onUpdateBoxClick.bind(this));

    html.find(".add-asset").click( ev => {
      const dataset = ev.currentTarget.dataset;
      let type = dataset.type;
      this.actor.createEmbeddedDocuments("Item",[{ type: type, name: "New " + type }], {renderSheet: false });
    });

    html.find('.macro').on('dragstart', ev => {
      const dataset = ev.currentTarget.dataset;
      dataset.actor = this.actor.uuid;
      ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify(dataset));
    });

    // Update Inventory Item
    html.find('.item-edit').click(ev => {
      const tag = ev.currentTarget;
      const item = this.actor.items.get(tag.dataset.item);
      item.sheet.render(true);
    });

    // Move items up in their corresponding rows
    html.find('.action-move-up').click(move_action_up.bind(this));
    html.find('.gear-move-up').click(move_gear_up.bind(this));
    html.find('.feat-move-up').click(move_feat_up.bind(this));

    // Delete Inventory Item
    html.find('.item-delete').click(ev => {
      const tag = ev.currentTarget;
      const item = this.actor.items.get(tag.dataset.item);
      item.delete();
    });

    // HeroMuster Lookup
    html.find('.lookup').click(ev => {
      const tag = ev.currentTarget;
      const type = tag.dataset.type;
      const code = tag.dataset.code;
      const heroURL = "https://openlegend.heromuster.com/"
      const options = {};
      options.height = 650;
      options.width = 550;
      options.resizable = true;
      options.title = "HeroMuster " + type.charAt(0).toUpperCase() + type.substr(1).toLowerCase();
      // Prefer FrameViewer if present; otherwise open in a new window
      if (typeof FrameViewer !== "undefined") {
        new FrameViewer(heroURL + type + "-" + code, options).render(true);
      } else {
        window.open(heroURL + type + "-" + code, "_blank", "noopener");
      }
    });

    // Update action 'items' directly
    html.find('.action-edit').change( ev => {
      const tag = ev.currentTarget;
      const item = this.actor.items.get(tag.dataset.item);
      const field = tag.dataset.field;
      const value = tag.value;

      let data = foundry.utils.deepClone(item.system);
      if( field === 'action_attr') data.action.attribute = value;
      else if( field === 'action_name') data.action.name = value;
      else if (field === 'action_adv') data.action.default_adv = value;
      else if( field === 'notes') data.details.notes = value;
      else if( field === 'attack') {
        // Set both attack attribute and find its target
        data.action.attribute = value;
        data.attacks.forEach(attack => {
          if (attack.attribute === value)
            data.action.target = attack.target;
        });
      }
      item.update({"system": data});
    });

    // Update curr hp of npcs if max hp changes
    html.find('.npc_hp_edit').change(ev => {
      const hp_val = Number( $(ev.currentTarget).val() );
      const data = this.actor.system;
      const hp = data.defense.hp;
      hp.max = hp_val;
      hp.value = hp_val;
      this.actor.update({ "system.defense": { hp } } );
    });

    html.find(".update-npc-attributes").click(ev => {
      const btn = $(ev.currentTarget);
      if (btn.html() === "Edit")
        btn.html("Save");
      else {
        let data = {}
        html.find(".npc-attr-setter").each((i, obj) => {
          data[`system.attributes.${obj.dataset.group}.${obj.dataset.attr}.score`] = parseInt(obj.value);
        });
        this.actor.update(data);
        btn.html("Edit");
      }
      html.find(".npc-attributes-display").toggle();
      html.find(".npc-attributes-edit").toggle();
    });

    // Rollable abilities.
    html.find('.rollable').click(this._onRoll.bind(this));

    // v13-compatible initiative roll (replaces deprecated Actor.rollInitiative)
    html.find('.init-rollable').click(async ev => {
      const scene = game.scenes.current;
      const token = this.actor.getActiveTokens(true, true)[0] ?? null;

      let combat = game.combat;
      if (!combat || combat.scene?.id !== scene?.id) {
        combat = await Combat.create({ scene: scene?.id, active: true });
      }

      let combatant = combat.combatants.find(c => c.actorId === this.actor.id);
      if (!combatant) {
        const created = await combat.createEmbeddedDocuments("Combatant", [{
          actorId: this.actor.id,
          tokenId: token?.id
        }]);
        combatant = created[0];
      }

      await combat.rollInitiative([combatant.id]);
    });
	
	// Dread roll (d20 + Dread Dice)
	html.find('.dread-rollable').on('click', ev => {
  ev.preventDefault();
  ev.stopPropagation();
  rollDread(this.actor);
});
    
	// Configurable settings.
    html.find('.settings').click(this._onConfigure.bind(this));
    html.find('.attr-settings').click(this._onAttrConfigure.bind(this));
	
	html.find('input[name="system.dread.level"]').on('input', ev => {
	const { diceStr } = dreadDiceFromLevel(ev.currentTarget.value);
	html.find('.dread-dice').text(`[Dread Dice: ${diceStr}]`);
	});

  }

  /* -------------------------------------------- */

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  async _onRoll(event) {
    event.preventDefault();
    const ctrl_held = event.ctrlKey || event.metaKey;
    const element = event.currentTarget;
    const dataset = element.dataset;

    // Roll using the appropriate logic -- item vs attribute
    if (dataset.item)
      rollItem(this.actor, this.actor.items.get(dataset.item), ctrl_held);
    else if (dataset.attr)
      rollAttr(this.actor, dataset.attr, ctrl_held);
  }

  /**
   * Handle clickable settings.
   * @param {Event} event The originating click event
   * @private
   */
  async _onConfigure(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    const subCat = dataset.defense;
    const data = this.actor.system;
    const defense = data.defense;

    let result = await this._SettingsDialog(dataset.name, defense[subCat]);
    if( result ) {
      result.forEach((item, index) => {
        defense[subCat].formula[index].active = item.value;
      });
      let update = { system: {defense} }
      await this.actor.update( update );
    }
  }

  async _SettingsDialog(name, defense) {
    const template = "systems/openlegend/templates/dialog/defense-settings.html";
    const attrs = this.actor.system.attributes;
    const data = { 'name': name, 'formula': defense.formula, 'attrs': attrs }

    const html = await renderTemplate(template, data);
    // Create the Dialog window
    return new Promise(resolve => {
        new Dialog({
            title: data.name,
            content: html,
            buttons: {
                update: {
                    label: "Update",
                    callback: html => resolve(html[0].querySelectorAll("select"))
                }
            },
            default: "update",
            close: html => resolve(null)
        }).render(true);
    });
  }

  async _onAttrConfigure(event) {
    event.preventDefault();
    const data = this.actor.system;
    const attrs = data.attributes;

    let result = await this._AttrSettingsDialog();
    if( result ) {
      result.forEach((item, index) => {
        const dataset = item.dataset
        if (item.value !== '')
          attrs[dataset.group][dataset.attr]['bonus'] = parseInt(item.value);
      });
      let update = { system: { attributes: attrs } };
      await this.actor.update(update);
    }
  }

  // v13-safe dialog prefill: only fill inputs with existing bonuses; leave blank otherwise.
  async _AttrSettingsDialog() {
    const template = "systems/openlegend/templates/dialog/attr-settings.html";
    const attrs = this.actor.system.attributes;
    const data = { 'attributes': attrs }

    const html = await renderTemplate(template, data);

    const prefill = (app, jQ) => {
      try {
        // Only fill inputs that are currently empty; do not force-score into bonus fields.
        jQ.find("input[data-group][data-attr]").each((i, el) => {
          const g = el.dataset.group;
          const a = el.dataset.attr;
          const curBonus = attrs?.[g]?.[a]?.bonus;

          // If a bonus is defined (including 0), show it; otherwise leave blank to match v12 feel.
          if ((el.value === "" || el.value === undefined) && curBonus !== undefined) {
            el.value = curBonus;
          }
        });

        // Optional: prefill selects if your template uses them (safe no-op if absent)
        jQ.find("select[data-group][data-attr]").each((i, el) => {
          const g = el.dataset.group;
          const a = el.dataset.attr;
          const cur = attrs?.[g]?.[a]?.substitute ?? "";
          if ((el.value === "" || el.value === undefined) && cur !== "") {
            el.value = cur;
          }
        });
      } finally {
        Hooks.off("renderDialog", prefill); // run once for this dialog
      }
    };
    Hooks.on("renderDialog", prefill);

    // Create the Dialog window
    return new Promise(resolve => {
      new Dialog({
        title: data.name, // unchanged; template didn’t use it before either
        content: html,
        buttons: {
          update: {
            label: "Update",
            callback: html => resolve(html[0].querySelectorAll("input"))
          }
        },
        default: "update",
        close: html => resolve(null)
      }).render(true);
    });
  }

  async _onUpdateBoxClick(event) {
    event.preventDefault();
    const item_id = $(event.currentTarget).data("item");
    const update_type = $(event.currentTarget).data("utype");
    let update = [];
    if(update_type === "activation"){
      let value = !this.actor.items.get(item_id).system.activated
      update.push( {_id: item_id, system:{activated: value}} );
      let effectUpdates = [];
      this.actor.effects.forEach( e => { effectUpdates.push( {"_id": e.id, "disabled":!value} ) } )
      await this.actor.updateEmbeddedDocuments( "ActiveEffect", effectUpdates );
    }
    await this.actor.updateEmbeddedDocuments("Item",update);
  }

}
