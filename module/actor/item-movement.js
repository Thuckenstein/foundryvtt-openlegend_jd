export async function move_action_up(ev) {
  // Get the item to move up
  const tag = ev.currentTarget;
  const item = this.actor.items.get(tag.dataset.item);
  if (!item?.system?.action) return;

  // Get this item's current and new indexes
  const curr_index = item.system.action.index;
  const new_index = curr_index - 1;

  // Skip if already at top
  if (curr_index > 0) {
    // Find the item above it
    for (const _sub_item of this.actor.items) {
      if (_sub_item.system?.action) {
        const i = _sub_item.system.action.index;
        if (i === new_index) {
          // Get the actual owned item and update its index
          const sub_item = this.actor.items.get(_sub_item.id); // v13: use id, not _id
          if (sub_item) await sub_item.update({ "system.action.index": curr_index });
          break;
        }
      }
    }
    // Update the main item's index
    await item.update({ "system.action.index": new_index });
  }
}

export async function move_gear_up(ev) {
  // Get the item to move up
  const tag = ev.currentTarget;
  const item = this.actor.items.get(tag.dataset.item);
  if (!item?.system?.gear) return;

  // Get this item's current and new indexes
  const curr_index = item.system.gear.index;
  const new_index = curr_index - 1;

  // Skip if already at top
  if (curr_index > 0) {
    // Find the item above it
    for (const _sub_item of this.actor.items) {
      if (_sub_item.system?.gear) {
        const i = _sub_item.system.gear.index;
        if (i === new_index) {
          // Get the actual owned item and update its index
          const sub_item = this.actor.items.get(_sub_item.id); // v13: use id, not _id
          if (sub_item) await sub_item.update({ "system.gear.index": curr_index });
          break;
        }
      }
    }
    // Update the main item's index
    await item.update({ "system.gear.index": new_index });
  }
}

// Move feat up in the feat rows
export async function move_feat_up(ev) {
  // Get the item to move up
  const tag = ev.currentTarget;
  const item = this.actor.items.get(tag.dataset.item);
  if (item?.type !== "feat") return;

  // Get this item's current and new indexes
  const curr_index = item.system.index;
  const new_index = curr_index - 1;

  // Skip if already at top
  if (curr_index > 0) {
    // Find the item above it
    for (const _sub_item of this.actor.items) {
      if (_sub_item.type === "feat") {
        const i = _sub_item.system.index;
        if (i === new_index) {
          // Get the actual owned item and update its index
          const sub_item = this.actor.items.get(_sub_item.id); // v13: use id, not _id
          if (sub_item) await sub_item.update({ "system.index": curr_index });
          break;
        }
      }
    }
    // Update the main item's index
    await item.update({ "system.index": new_index });
  }
}
