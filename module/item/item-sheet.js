/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {ItemSheet}
 */
export class olItemSheet extends ItemSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["openlegend", "sheet", "item"],
      width: 520,
      height: 480,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" }]
    });
  }

  /** @override */
  get template() {
    const path = "systems/openlegend/templates/item";
    return `${path}/${this.item.type}.html`;
  }

  /* -------------------------------------------- */

  /** @override */
  async getData(options) {
    const itemData = super.getData();
    const sheetData = itemData.data;
    sheetData.owner = itemData.owner;
    sheetData.editable = itemData.editable;

    sheetData.system.details.description = await TextEditor.enrichHTML(
      sheetData.system.details.description,
      { secrets: itemData.isOwner }
    );

    return sheetData;
  }

  /* -------------------------------------------- */

  /** @override */
  setPosition(options = {}) {
    const position = super.setPosition(options);
    const sheetBody = this.element.find(".sheet-body");
    const bodyHeight = position.height - 192;
    sheetBody.css("height", bodyHeight);
    return position;
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Add a new attack row (keeps using the existing partial)
    html.find(".add-attack").off("click.ol").on("click.ol", async () => {
      const template = "systems/openlegend/templates/item/parts/attack-target.html";
      const data = { attack: {}, attributes: this.object.system.attributes };
      const new_attack = await renderTemplate(template, data);
      html.find(".attack-list").append(new_attack);
    });

    // Use event delegation so dynamically-added rows have working delete buttons
    html.off("click.ol", ".attack-delete")
        .on("click.ol", ".attack-delete", (ev) => {
          $(ev.currentTarget).closest("li").remove();
        });

    // Robust Edit/Save toggle that respects the HTML `hidden` attribute (v13-safe)
    html.find(".update-action").off("click.ol").on("click.ol", async (ev) => {
      ev.preventDefault();
      const $btn = $(ev.currentTarget);
      const $list = html.find(".action-list");
      const $edit = html.find(".action-edit");

      // Determine if we're currently editing by checking visibility + hidden attribute
      const editing = $edit.length && $edit.is(":visible") && !$edit.is(":hidden");

      if (!editing) {
        // Enter edit mode
        if ($edit.length) {
          $edit.removeAttr("hidden").show();
        }
        if ($list.length) {
          $list.hide();
        }
        $btn.text("Save");
        return;
      }

      // Collect and save changes, then exit edit mode
      const data = {};

      // Attribute checkboxes (e.g., which attributes apply to this item)
      html.find(".attr-checkbox").each((i, obj) => {
        data[`system.attributes.${obj.dataset.attr}`] = obj.checked;
      });

      // Attacks (attribute ↔ target pairs)
      if (this.object.system.attacks) {
        const attacks = [];
        html.find(".action-attack").each((i, attack) => {
          const $a = $(attack);
          const attr = $a.find(".attack-attribute").val();
          const target = $a.find(".attack-target").val();
          attacks.push({ attribute: attr, target: target });
        });
        data["system.attacks"] = attacks;
      }

      if (Object.keys(data).length) {
        await this.object.update(data);
      }

      // Exit edit mode
      if ($edit.length) {
        $edit.attr("hidden", true).hide();
      }
      if ($list.length) {
        $list.show();
      }
      $btn.text("Edit");
    });

    // Scale input autoresize helpers
    html.off("keyup.ol", ".scale")
        .on("keyup.ol", ".scale", (ev) => {
          const input = $(ev.currentTarget);
          const tester = html.find(".scale-tester");
          tester.text(input.val());
          input.width(tester.width() + 5);
        });

    html.find(".scale").each((i, tag) => {
      const tester = html.find(".scale-tester");
      tester.text($(tag).val());
      $(tag).width(tester.width() + 5);
    });

    // Everything below here is only needed if the sheet is editable
    if (!this.options.editable) return;

    // Roll handlers, click handlers, etc. would go here.
  }

  resizeInput() {
    console.log($(this));
    $(this).attr("size", $(this).val().length);
  }
}
