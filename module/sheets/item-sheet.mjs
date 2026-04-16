import { SW1E } from "../config.mjs";
import { formatDiceCode } from "../dice.mjs";
import { getForcePowerDifficultySummary, getForcePowerRequirementLabel } from "../force.mjs";

const { ItemSheet } = foundry.appv1.sheets;

export class SW1EItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sw1e", "sheet", "item"],
      width: 640,
      height: 760
    });
  }

  get template() {
    return `systems/sw1e/templates/item/${this.item.type}-sheet.hbs`;
  }

  async getData(options = {}) {
    const context = await super.getData(options);

    context.system = this.item.system;
    context.config = {
      attributes: Object.entries(SW1E.attributes).map(([key, value]) => ({
        key,
        label: game.i18n.localize(value)
      })),
      categories: Object.entries(SW1E.equipmentCategories).map(([key, value]) => ({
        key,
        label: game.i18n.localize(value)
      })),
      forceSkills: Object.entries(SW1E.forceSkills).map(([key, value]) => ({
        key,
        label: game.i18n.localize(value)
      })),
      shipSystems: Object.entries(SW1E.starshipSystems).map(([key, value]) => ({
        key,
        label: game.i18n.localize(value)
      }))
    };

    context.diceCode = this.item.type === "skill"
      ? formatDiceCode(this.item.system.dice, this.item.system.pips)
      : formatDiceCode(this.item.system.damageDice, this.item.system.damagePips);

    context.armorCode = formatDiceCode(this.item.system.armorDice, this.item.system.armorPips);
    context.fireControlCode = formatDiceCode(this.item.system.fireControlDice, this.item.system.fireControlPips);
    context.requirementLabel = this.item.type === "forcePower" ? getForcePowerRequirementLabel(this.item.system) : "";
    context.difficultySummary = this.item.type === "forcePower" ? getForcePowerDifficultySummary(this.item.system) : "";
    context.systemLabel = this.item.type === "shipSystem"
      ? game.i18n.localize(SW1E.starshipSystems[this.item.system.systemKey] ?? this.item.system.systemKey ?? "")
      : "";

    return context;
  }
}
