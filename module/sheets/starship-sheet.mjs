import { SW1E } from "../config.mjs";
import { formatDiceCode } from "../dice.mjs";
import {
  clearStarshipIonization,
  clearStarshipTemporaryEffects,
  prepareStarshipSheetContext,
  removeStarshipEngagement,
  restoreStarshipShieldStatus,
  rollStarshipAstrogation,
  rollStarshipAstrogationMishap,
  rollStarshipDamage,
  rollStarshipEvasion,
  rollStarshipGunnery,
  rollStarshipRepair,
  rollStarshipShields,
  rollStarshipSpeed,
  rollStarshipSystemDamage,
  syncStarshipTargetEngagement,
  updateStarshipEngagementRange
} from "../starships.mjs";

function sortByName(items) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function formatRepairDisplay(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const { ActorSheet } = foundry.appv1.sheets;

export class SW1EStarshipSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sw1e", "sheet", "actor", "starship"],
      template: "systems/sw1e/templates/actor/starship-sheet.hbs",
      width: 940,
      height: 860,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "overview" }]
    });
  }

  async getData(options = {}) {
    const context = await super.getData(options);
    const system = this.actor.system;

    const shipGear = sortByName(this.actor.items.filter(i => i.type === "equipment"));
    const weapons = sortByName(this.actor.items.filter(i => i.type === "starshipWeapon"));
    const shipSystems = sortByName(this.actor.items.filter(i => i.type === "shipSystem"));
    const routes = sortByName(this.actor.items.filter(i => i.type === "astrogationRoute"));
    const prepared = prepareStarshipSheetContext(this.actor);
    const weaponContext = new Map(prepared.effectiveWeapons.map(entry => [entry.id, entry]));

    context.system = system;
    context.actorTypeLabel = game.i18n.localize(`TYPES.Actor.${this.actor.type}`);
    context.rangeBands = Object.entries(SW1E.starshipRangeBands).map(([key, value]) => ({
      key,
      label: game.i18n.localize(value)
    }));
    context.damageStates = Object.entries(SW1E.starshipDamageStates).map(([key, value]) => ({
      key,
      label: game.i18n.localize(value)
    }));
    context.codeCards = prepared.codeCards;
    context.engagementRanges = prepared.engagementRanges;
    context.lastAstrogation = prepared.lastAstrogation;
    context.systemStatusCards = Object.entries(SW1E.starshipSystems).map(([key, value]) => {
      const entry = system.systems?.[key] ?? {};
      const stateLabel = entry.disabled
        ? game.i18n.localize('SW1E.Disabled')
        : entry.damaged
          ? game.i18n.localize('SW1E.Damaged')
          : entry.repaired
            ? game.i18n.localize('SW1E.Repaired')
            : game.i18n.localize('SW1E.Starship.Helpers.RepairStateOperational');
      return {
        key,
        label: game.i18n.localize(value),
        damaged: !!entry.damaged,
        disabled: !!entry.disabled,
        repaired: !!entry.repaired,
        repairedAt: entry.repairedAt ?? "",
        repairedAtDisplay: formatRepairDisplay(entry.repairedAt),
        repairedBy: entry.repairedBy ?? "",
        repairDifficulty: entry.repairDifficulty ?? "",
        repairAttempt: entry.repairAttempt ?? "",
        repairAttemptLabel: entry.repairAttempt ? game.i18n.localize(SW1E.starshipRepairAttempts?.[entry.repairAttempt] ?? entry.repairAttempt) : "",
        notes: entry.notes ?? "",
        stateLabel
      };
    });
    context.shipGear = shipGear.map(item => ({
      id: item.id,
      name: item.name,
      category: item.system.category,
      quantity: Number(item.system.quantity) || 0,
      notes: item.system.notes ?? ""
    }));
    context.weapons = weapons.map(item => {
      const effective = weaponContext.get(item.id) ?? {};
      return {
        id: item.id,
        name: item.name,
        mount: item.system.mount,
        fireArc: item.system.fireArc,
        fireControlCode: effective.fireControlCode ?? `${Number(item.system.fireControlDice) || 0}D`,
        fireControlBaseCode: effective.fireControlBaseCode ?? "",
        fireControlChanged: !!effective.fireControlChanged,
        fireControlBlocked: !!effective.fireControlBlocked,
        fireControlBlockedReason: effective.fireControlBlockedReason ?? "",
        fireControlNotes: effective.fireControlNotes ?? [],
        damageCode: formatDiceCode(item.system.damageDice, item.system.damagePips),
        ammo: item.system.ammo,
        operational: item.system.operational !== false,
        rangeNotes: item.system.rangeNotes,
        shortUseNote: item.system.shortUseNote
      };
    });
    context.routes = routes.map(item => ({
      id: item.id,
      name: item.name,
      origin: item.system.origin,
      destination: item.system.destination,
      standardDuration: item.system.standardDuration,
      preCalculated: !!item.system.preCalculated
    }));
    context.shipSystems = shipSystems.map(item => ({
      id: item.id,
      name: item.name,
      systemKey: item.system.systemKey,
      systemLabel: game.i18n.localize(SW1E.starshipSystems[item.system.systemKey] ?? item.system.systemKey ?? ""),
      damaged: !!item.system.damaged,
      disabled: !!item.system.disabled,
      repaired: !!item.system.repaired,
      repairedAtDisplay: formatRepairDisplay(item.system.repairedAt),
      repairedBy: item.system.repairedBy ?? "",
      repairDifficulty: item.system.repairDifficulty ?? "",
      repairAttemptLabel: item.system.repairAttempt ? game.i18n.localize(SW1E.starshipRepairAttempts?.[item.system.repairAttempt] ?? item.system.repairAttempt) : "",
      operational: item.system.operational !== false,
      repairNotes: item.system.repairNotes
    }));

    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".sw1e-starship-action").on("click", this._onStarshipAction.bind(this));
    html.find(".sw1e-roll-starship-weapon").on("click", this._onRollStarshipWeapon.bind(this));
    html.find(".sw1e-roll-route").on("click", this._onRollRoute.bind(this));
    html.find(".item-create").on("click", this._onItemCreate.bind(this));
    html.find(".item-edit").on("click", this._onItemEdit.bind(this));
    html.find(".item-delete").on("click", this._onItemDelete.bind(this));
    html.find(".sw1e-range-contact-select").on("change", this._onRangeContactChange.bind(this));
    html.find(".sw1e-range-contact-remove").on("click", this._onRangeContactRemove.bind(this));
  }

  async _onStarshipAction(event) {
    event.preventDefault();
    const action = event.currentTarget.dataset.action;
    if (action === "speed") return rollStarshipSpeed(this.actor);
    if (action === "evasion") return rollStarshipEvasion(this.actor);
    if (action === "shields") return rollStarshipShields(this.actor);
    if (action === "astrogation") return rollStarshipAstrogation(this.actor);
    if (action === "mishap") return rollStarshipAstrogationMishap(this.actor);
    if (action === "systemDamage") return rollStarshipSystemDamage(this.actor);
    if (action === "repair") return rollStarshipRepair(this.actor);
    if (action === "clearTemporary") return clearStarshipTemporaryEffects(this.actor);
    if (action === "clearIonization") return clearStarshipIonization(this.actor);
    if (action === "restoreShields") return restoreStarshipShieldStatus(this.actor);
    if (action === "syncTarget") return syncStarshipTargetEngagement(this.actor);
    return null;
  }

  async _onRollStarshipWeapon(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const mode = event.currentTarget.dataset.mode;
    const weapon = this.actor.items.get(itemId);
    if (!weapon) return;

    if (mode === "gunnery") return rollStarshipGunnery(this.actor, weapon);
    if (mode === "damage") return rollStarshipDamage(this.actor, weapon);
    return null;
  }

  async _onRollRoute(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    if (!itemId) return;
    return rollStarshipAstrogation(this.actor, itemId);
  }

  async _onRangeContactChange(event) {
    event.preventDefault();
    const targetId = event.currentTarget.dataset.targetId;
    const rangeBand = event.currentTarget.value;
    if (!targetId || !rangeBand) return;
    await updateStarshipEngagementRange(this.actor, targetId, rangeBand);
  }

  async _onRangeContactRemove(event) {
    event.preventDefault();
    const targetId = event.currentTarget.dataset.targetId;
    if (!targetId) return;
    await removeStarshipEngagement(this.actor, targetId);
  }

  async _onItemCreate(event) {
    event.preventDefault();
    const type = event.currentTarget.dataset.type;
    const typeLabel = game.i18n.localize(`TYPES.Item.${type}`);

    const itemData = {
      name: game.i18n.format("SW1E.NewItem", { type: typeLabel }),
      type,
      system: {}
    };

    if (type === "equipment") itemData.system.category = "gear";
    if (type === "starshipWeapon") itemData.system.operational = true;
    if (type === "shipSystem") itemData.system.operational = true;
    if (type === "astrogationRoute") itemData.system.preCalculated = false;

    const created = await this.actor.createEmbeddedDocuments("Item", [itemData]);
    if (created?.length) created[0].sheet.render(true);
  }

  _onItemEdit(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) item.sheet.render(true);
  }

  async _onItemDelete(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    await item.delete();
  }
}
