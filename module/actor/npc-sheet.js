import { olActorSheet } from "./actor-sheet.js";

/**
 * NPC sheet
 * Fixes the Edit/Save toggle by handling the HTML [hidden] attribute explicitly (v13-safe).
 */
export class olNPCActorSheet extends olActorSheet {

  /** @override */
  static get defaultOptions() {
    const options = foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["openlegend", "sheet", "actor", "npc"],
      width: 750
    });
    return options;
  }

  /** @override */
  get template() {
    return "systems/openlegend/templates/actor/npc-sheet.html";
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    const $display = html.find(".npc-attributes-display");
    const $edit = html.find(".npc-attributes-edit");
    const $btn = html.find(".update-npc-attributes");

    // Keep initial state as defined by the template:
    // - display is visible
    // - edit has [hidden]
    // Don't force show/hide here; we respect what's in the HTML.

    const enterEdit = () => {
      // remove the hidden attribute; THEN show
      $edit.removeAttr("hidden").show();
      $display.hide();
      $btn.text("Save");
    };

    const exitEdit = () => {
      // restore hidden attribute and hide
      $edit.attr("hidden", true).hide();
      $display.show();
      $btn.text("Edit");
    };

    // Click handler for Edit/Save
    $btn.off("click.olnpc").on("click.olnpc", async (ev) => {
      ev.preventDefault();

      const editing = $edit.is(":visible") && !$edit.is(":hidden");
      if (!editing) {
        // Enter edit mode
        enterEdit();
        return;
      }

      // Save: collect input values and update scores
      const updates = {};
      html.find(".npc-attr-setter").each((i, el) => {
        const g = el.dataset.group;
        const a = el.dataset.attr;
        if (!g || !a) return;
        const v = Number.parseInt(el.value ?? "0", 10);
        updates[`system.attributes.${g}.${a}.score`] = Number.isFinite(v) ? v : 0;
      });

      if (Object.keys(updates).length) {
        await this.actor.update(updates);
      }

      // Exit edit mode
      exitEdit();
      // Re-render to refresh the compact list with new non-zero filters
      this.render(false);
    });
  }
}
