
import { SW1E } from "./config.mjs";
import { adjustDiceCode, formatDiceCode, pipsToDiceCode } from "./dice.mjs";

const BUILDER_DATA = {
  templates: null,
  skills: null,
  equipment: null,
  weapons: null
};

async function fetchBuilderJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Unable to load ${path}: ${response.status}`);
  }

  return response.json();
}

async function getBuilderData() {
  if (!BUILDER_DATA.templates) {
    BUILDER_DATA.templates = await fetchBuilderJson("systems/sw1e/packs-src/charactertemplates.json");
  }

  if (!BUILDER_DATA.skills) {
    BUILDER_DATA.skills = await fetchBuilderJson("systems/sw1e/packs-src/skills.json");
  }

  if (!BUILDER_DATA.equipment) {
    BUILDER_DATA.equipment = await fetchBuilderJson("systems/sw1e/packs-src/equipment.json");
  }

  if (!BUILDER_DATA.weapons) {
    BUILDER_DATA.weapons = await fetchBuilderJson("systems/sw1e/packs-src/weapons.json");
  }

  return {
    templates: BUILDER_DATA.templates,
    skills: BUILDER_DATA.skills,
    equipment: BUILDER_DATA.equipment,
    weapons: BUILDER_DATA.weapons
  };
}

function cloneForCreation(data) {
  const clone = foundry.utils.deepClone(data);
  delete clone._id;
  delete clone._stats;
  delete clone.pack;
  delete clone.folder;
  delete clone.sort;
  delete clone.ownership;
  return clone;
}

function normalizePipAllocation(value, { min = 0, max = 6 } = {}) {
  const numeric = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : min;
  return Math.max(min, Math.min(max, numeric));
}

function formatAllocationLabel(totalPips = 0) {
  const safe = Math.max(0, Number(totalPips) || 0);
  if (safe === 0) return "0D";

  const code = pipsToDiceCode(safe);
  if (code.dice === 0) {
    return code.pips === 1 ? "+1 pip" : `+${code.pips} pips`;
  }

  if (code.pips > 0) return `+${code.dice}D+${code.pips}`;
  return `+${code.dice}D`;
}

function formatPipPool(totalPips = 0) {
  const safe = Number(totalPips) || 0;
  if (safe === 0) return "0D";

  const negative = safe < 0;
  const abs = Math.abs(safe);
  const code = pipsToDiceCode(abs);
  let label = "";

  if (code.dice === 0) {
    label = code.pips === 1 ? "1 pip" : `${code.pips} pips`;
  } else if (code.pips > 0) {
    label = `${code.dice}D+${code.pips}`;
  } else {
    label = `${code.dice}D`;
  }

  return negative ? `-${label}` : label;
}

function localizeAttributeLabel(key) {
  return game.i18n.localize(SW1E.attributes[key] ?? key);
}

function getTemplateSource(template) {
  return template?.system?.notes?.storyNotes || "";
}

function getTemplatePageLabel(template) {
  const source = getTemplateSource(template);
  const match = source.match(/p\.\s*\d+/i);
  return match ? match[0] : "";
}

function getTemplateStartingPackage(template) {
  return template?.flags?.sw1e?.startingPackage ?? null;
}

function getTemplateBackData(template) {
  return template?.flags?.sw1e?.templateBack ?? {};
}


const TEMPLATE_SPECIFIC_SKILLS = new Set([
  "Black-powder Pistol",
  "Wookiee Bowcaster"
]);

function getTemplateSkillNames(template) {
  const skillNames = template?.flags?.sw1e?.skillNames;
  return Array.isArray(skillNames) && skillNames.length ? skillNames : null;
}

function getActiveTemplateSkills(template, allSkills = []) {
  const skillNames = getTemplateSkillNames(template);
  const commonNames = new Set(
    allSkills
      .filter(skill => !TEMPLATE_SPECIFIC_SKILLS.has(skill.name))
      .map(skill => skill.name)
  );

  if (!skillNames) {
    return allSkills.filter(skill => commonNames.has(skill.name));
  }

  const allowed = new Set([...commonNames, ...skillNames]);
  return allSkills.filter(skill => allowed.has(skill.name));
}

const EQUIPMENT_ALIASES = new Map([
  ["hold out blaster", { pack: "weapons", name: "Hold-out Blaster" }],
  ["holdout blaster", { pack: "weapons", name: "Hold-out Blaster" }],
  ["hold-out blaster", { pack: "weapons", name: "Hold-out Blaster" }],
  ["heavy blaster pistol", { pack: "weapons", name: "Heavy Blaster Pistol" }],
  ["blaster pistol", { pack: "weapons", name: "Blaster Pistol" }],
  ["blaster rifle", { pack: "weapons", name: "Blaster Rifle" }],
  ["lightsaber", { pack: "weapons", name: "Lightsaber" }],
  ["black powder pistol", { pack: "weapons", name: "Black-powder Pistol" }],
  ["black-powder pistol", { pack: "weapons", name: "Black-powder Pistol" }],
  ["bowcaster", { pack: "weapons", name: "Wookiee Bowcaster" }],
  ["comlink", { pack: "equipment", name: "Comlink" }],
  ["pocket computer", { pack: "equipment", name: "Pocket Computer" }],
  ["concentrated rations", { pack: "equipment", name: "Rations, 1 Week, Concentrate" }],
  ["protective helmet", { pack: "equipment", name: "Protective Helmet" }],
  ["medpac", { pack: "equipment", name: "Medpac" }],
  ["medpacs", { pack: "equipment", name: "Medpac", quantity: 2 }]
]);

function normalizeEquipmentLine(line) {
  return String(line ?? "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9+' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseTemplateGear(line) {
  const text = String(line ?? "").trim();
  if (!text) return "Template Gear";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatSourcePageLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return /^p\./i.test(text) ? text : `p. ${text}`;
}

function splitCreditsData(value) {
  if (value === null || value === undefined || value === "") return { amount: "", note: "" };

  if (Number.isFinite(Number(value))) {
    return { amount: Math.trunc(Number(value)), note: "" };
  }

  const text = String(value).trim();
  if (!text) return { amount: "", note: "" };

  const match = text.match(/-?\d[\d,]*/);
  const amount = match ? Number(match[0].replace(/,/g, "")) : "";
  const note = text.replace(/^\s*-?\d[\d,]*\s*credits?(?:\s+standard)?\s*[;,:-]?\s*/i, "").trim();

  return {
    amount: Number.isFinite(amount) ? Math.trunc(amount) : "",
    note
  };
}

function appendBuilderNote(existing = "", addition = "") {
  const current = String(existing ?? "").trim();
  const next = String(addition ?? "").trim();
  if (!next) return current;
  if (!current) return next;
  if (current.split(/\n+/).includes(next)) return current;
  return `${current}\n${next}`;
}

function getEmptyState() {
  return {
    templateId: "",
    name: "",
    species: "",
    sex: "",
    age: "",
    height: "",
    weight: "",
    physicalDescription: "",
    credits: "",
    importEquipment: true,
    skill: {},
    force: {
      control: 0,
      sense: 0,
      alter: 0
    }
  };
}

export class SW1ECharacterBuilder extends FormApplication {
  constructor(options = {}) {
    super(options);
    this.state = getEmptyState();
    this._dataReady = false;
    this._builderData = {
      templates: [],
      skills: [],
      equipment: [],
      weapons: []
    };
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "sw1e-character-builder",
      classes: ["sw1e", "sheet", "sw1e-character-builder"],
      template: "systems/sw1e/templates/apps/character-builder.hbs",
      width: 980,
      height: 900,
      resizable: true,
      submitOnChange: false,
      closeOnSubmit: false,
      title: game.i18n.localize("SW1E.Builder.Title")
    });
  }

  async _prepareBuilderData() {
    if (this._dataReady) return;

    const { templates, skills, equipment, weapons } = await getBuilderData();

    this._builderData.templates = [...templates].sort((a, b) => a.name.localeCompare(b.name));
    this._builderData.skills = [...skills].sort((a, b) => {
      const attrA = a.system.linkedAttribute.localeCompare(b.system.linkedAttribute);
      if (attrA !== 0) return attrA;
      return a.name.localeCompare(b.name);
    });

    this._builderData.equipment = [...equipment].sort((a, b) => a.name.localeCompare(b.name));
    this._builderData.weapons = [...weapons].sort((a, b) => a.name.localeCompare(b.name));

    if (!this.state.templateId && this._builderData.templates.length) {
      this.state.templateId = this._builderData.templates[0]._id;
    }

    this._dataReady = true;
  }

  get selectedTemplate() {
    return this._builderData.templates.find(template => template._id === this.state.templateId) ?? null;
  }

  get allocationOptions() {
    return Array.from({ length: 7 }, (_, index) => ({
      value: index,
      label: formatAllocationLabel(index)
    }));
  }

  _getRemainingPips() {
    const skillSpent = Object.values(this.state.skill ?? {}).reduce((total, value) => total + normalizePipAllocation(value), 0);
    const forceSpent = Object.values(this.state.force ?? {}).reduce((total, value) => total + normalizePipAllocation(value), 0);
    return 21 - skillSpent - forceSpent;
  }

  _applyFormState(formData = {}) {
    const expanded = foundry.utils.expandObject(formData);
    const nextTemplateId = String(expanded.templateId ?? this.state.templateId ?? "");
    const templateChanged = nextTemplateId !== this.state.templateId;

    this.state.templateId = nextTemplateId;
    this.state.name = String(expanded.name ?? this.state.name ?? "");
    this.state.species = String(expanded.species ?? this.state.species ?? "");
    this.state.sex = String(expanded.sex ?? this.state.sex ?? "");
    this.state.age = String(expanded.age ?? this.state.age ?? "");
    this.state.height = String(expanded.height ?? this.state.height ?? "");
    this.state.weight = String(expanded.weight ?? this.state.weight ?? "");
    this.state.physicalDescription = String(expanded.physicalDescription ?? this.state.physicalDescription ?? "");
    this.state.credits = splitCreditsData(expanded.credits ?? this.state.credits ?? "").amount;
    this.state.importEquipment = expanded.importEquipment === true || expanded.importEquipment === "true" || expanded.importEquipment === "on" || expanded.importEquipment === 1 || expanded.importEquipment === "1";

    if (templateChanged) {
      this.state.skill = {};
      this.state.force = { control: 0, sense: 0, alter: 0 };
      this.state.species = "";
      this.state.sex = "";
      this.state.age = "";
      this.state.height = "";
      this.state.weight = "";
      this.state.physicalDescription = "";
      this.state.credits = "";
      this.state.importEquipment = true;
      return;
    }

    const template = this.selectedTemplate;
    const nextSkillState = {};
    const activeSkills = getActiveTemplateSkills(template, this._builderData.skills);

    for (const skill of activeSkills) {
      nextSkillState[skill._id] = normalizePipAllocation(expanded.skill?.[skill._id]);
    }

    const nextForceState = {};
    for (const key of SW1E.forceSkillKeys) {
      nextForceState[key] = normalizePipAllocation(expanded.force?.[key]);
    }

    this.state.skill = nextSkillState;
    this.state.force = nextForceState;
  }

  _captureFormState() {
    if (!this.form) return;
    const formData = this._getSubmitData();
    this._applyFormState(formData);
  }

  async getData(options = {}) {
    await this._prepareBuilderData();
    const context = await super.getData(options);
    const template = this.selectedTemplate;

    const templateOptions = this._builderData.templates.map(entry => ({
      id: entry._id,
      name: entry.name,
      selected: entry._id === this.state.templateId
    }));

    const attributes = Object.entries(template?.system?.attributes ?? {}).map(([key, value]) => ({
      key,
      label: localizeAttributeLabel(key),
      diceCode: formatDiceCode(value.dice, value.pips)
    }));

    const groupedSkillMap = new Map();
    for (const [key, labelKey] of Object.entries(SW1E.attributes)) {
      groupedSkillMap.set(key, {
        key,
        label: game.i18n.localize(labelKey),
        attributeCode: formatDiceCode(template?.system?.attributes?.[key]?.dice ?? 0, template?.system?.attributes?.[key]?.pips ?? 0),
        skills: []
      });
    }

    const activeSkills = getActiveTemplateSkills(template, this._builderData.skills);

    for (const skill of activeSkills) {
      const attributeKey = skill.system.linkedAttribute;
      const baseAttribute = template?.system?.attributes?.[attributeKey] ?? { dice: 0, pips: 0 };
      const bonusPips = normalizePipAllocation(this.state.skill?.[skill._id]);
      const totalCode = adjustDiceCode(baseAttribute, pipsToDiceCode(bonusPips));

      const row = {
        id: skill._id,
        name: skill.name,
        attributeKey,
        baseCode: formatDiceCode(baseAttribute.dice, baseAttribute.pips),
        bonusPips,
        totalCode: formatDiceCode(totalCode.dice, totalCode.pips),
        options: this.allocationOptions.map(option => ({
          value: option.value,
          label: option.label,
          selected: option.value === bonusPips
        })),
        sourcePage: skill.system.sourcePage
      };

      groupedSkillMap.get(attributeKey)?.skills.push(row);
    }

    const forceSkills = SW1E.forceSkillKeys.map(key => {
      const base = template?.system?.force?.[key] ?? { dice: 0, pips: 0 };
      const trained = (Number(base.dice) || 0) > 0 || (Number(base.pips) || 0) > 0;
      const bonusPips = trained ? normalizePipAllocation(this.state.force?.[key]) : 0;
      const totalCode = trained ? adjustDiceCode(base, pipsToDiceCode(bonusPips)) : { dice: 0, pips: 0 };

      return {
        key,
        label: game.i18n.localize(SW1E.forceSkills[key]),
        trained,
        baseCode: formatDiceCode(base.dice, base.pips),
        bonusPips,
        totalCode: formatDiceCode(totalCode.dice, totalCode.pips),
        options: this.allocationOptions.map(option => ({
          value: option.value,
          label: option.label,
          selected: option.value === bonusPips
        }))
      };
    });

    const remainingPips = this._getRemainingPips();

    context.templateOptions = templateOptions;
    context.selectedTemplateName = template?.name ?? "";
    context.templateSource = getTemplateSource(template);
    context.templatePageLabel = getTemplatePageLabel(template);
    const startingPackage = getTemplateStartingPackage(template);
    context.templateNotes = template?.system?.notes?.gamemasterNotes ?? "";
    const templateCreditsData = splitCreditsData(template?.system?.resources?.credits);
    const startingCreditsData = splitCreditsData(startingPackage?.credits);
    const templateBack = getTemplateBackData(template);
    context.templateBackground = template?.system?.identity?.background ?? "";
    context.templatePersonality = template?.system?.identity?.personality ?? "";
    context.templateQuote = template?.system?.identity?.quote ?? "";
    context.templateConnection = templateBack?.connection ?? "";
    context.templateSpecialRule = templateBack?.specialRule ?? "";
    context.templateBackPageLabel = templateBack?.backPage ? `p. ${templateBack.backPage}` : "";
    context.hasTemplateNarrative = Boolean(context.templateBackground || context.templatePersonality || context.templateQuote || context.templateConnection || context.templateSpecialRule);
    context.attributes = attributes;
    context.skillGroups = Array.from(groupedSkillMap.values());
    context.forceSkills = forceSkills;
    context.remainingPips = remainingPips;
    context.remainingDiceCode = formatPipPool(remainingPips);
    context.canCreate = !!template && remainingPips === 0;
    context.hasOverspent = remainingPips < 0;
    context.name = this.state.name;
    context.species = this.state.species || template?.system?.identity?.species || "";
    context.sex = this.state.sex || template?.system?.identity?.sex || "";
    context.age = this.state.age || template?.system?.identity?.age || "";
    context.height = this.state.height || template?.system?.identity?.height || "";
    context.weight = this.state.weight || template?.system?.identity?.weight || "";
    context.physicalDescription = this.state.physicalDescription || template?.system?.identity?.physicalDescription || "";
    context.credits = this.state.credits !== "" ? this.state.credits : (templateCreditsData.amount !== "" ? templateCreditsData.amount : startingCreditsData.amount);
    context.financialNote = template?.flags?.sw1e?.startingPackage?.financialNote || templateCreditsData.note || startingCreditsData.note || "";
    context.importEquipment = this.state.importEquipment === true;
    context.startingEquipment = startingPackage?.equipment ?? [];
    context.startingGearPage = startingPackage?.backPage ? `p. ${startingPackage.backPage}` : "";
    context.hasTemplateGear = Boolean((startingPackage?.equipment?.length ?? 0) || context.credits !== "" || context.financialNote);
    context.hasAnyTrainedForceSkill = forceSkills.some(entry => entry.trained);

    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("select, input, textarea").on("change", () => {
      this._captureFormState();
      this.render(false);
    });

    html.find(".sw1e-builder-cancel").on("click", event => {
      event.preventDefault();
      this.close();
    });
  }

  async _updateObject(event, formData) {
    await this._prepareBuilderData();
    this._applyFormState(formData);

    const template = this.selectedTemplate;
    if (!template) {
      ui.notifications.error(game.i18n.localize("SW1E.Builder.Errors.TemplateRequired"));
      return;
    }

    const remainingPips = this._getRemainingPips();
    if (remainingPips !== 0) {
      ui.notifications.error(game.i18n.localize("SW1E.Builder.Errors.ExactlySevenD"));
      return;
    }

    const canCreate = typeof game.user?.can === "function" ? game.user.can("ACTOR_CREATE") : true;
    if (canCreate === false) {
      ui.notifications.error(game.i18n.localize("SW1E.Builder.Errors.Permission"));
      return;
    }

    const actorData = cloneForCreation(template);
    const actorName = this.state.name?.trim() || template.name;

    actorData.name = actorName;
    actorData.items = [];
    actorData.prototypeToken = actorData.prototypeToken ?? {};
    actorData.prototypeToken.name = actorName;
    actorData.prototypeToken.actorLink = true;
    actorData.prototypeToken.disposition = 1;
    actorData.system = actorData.system ?? {};
    actorData.system.identity = actorData.system.identity ?? {};
    actorData.system.resources = actorData.system.resources ?? {};

    actorData.system.identity.templateName = template.name;
    actorData.system.identity.species = this.state.species?.trim() || actorData.system.identity.species || "";
    actorData.system.identity.sex = this.state.sex?.trim() || actorData.system.identity.sex || "";
    actorData.system.identity.age = this.state.age?.trim() || actorData.system.identity.age || "";
    actorData.system.identity.height = this.state.height?.trim() || actorData.system.identity.height || "";
    actorData.system.identity.weight = this.state.weight?.trim() || actorData.system.identity.weight || "";
    actorData.system.identity.physicalDescription = this.state.physicalDescription?.trim() || actorData.system.identity.physicalDescription || "";
    const templateCreditsData = splitCreditsData(actorData.system.resources.credits);
    const startingPackage = getTemplateStartingPackage(template);
    const startingCreditsData = splitCreditsData(startingPackage?.credits);
    const financialNote = template?.flags?.sw1e?.startingPackage?.financialNote || templateCreditsData.note || startingCreditsData.note || "";
    actorData.system.resources.credits = this.state.credits !== "" ? this.state.credits : (templateCreditsData.amount !== "" ? templateCreditsData.amount : (startingCreditsData.amount !== "" ? startingCreditsData.amount : 0));

    const templateBack = getTemplateBackData(template);
    actorData.system.notes = actorData.system.notes ?? {};
    actorData.system.notes.storyNotes = appendBuilderNote(templateBack?.connection ?? "", financialNote ? `Financial note: ${financialNote}` : "");
    actorData.system.notes.gamemasterNotes = templateBack?.specialRule ?? "";

    const activeSkills = getActiveTemplateSkills(template, this._builderData.skills);

    for (const skill of activeSkills) {
      const skillData = cloneForCreation(skill);
      skillData.system = skillData.system ?? {};

      const baseAttribute = actorData.system.attributes?.[skill.system.linkedAttribute] ?? { dice: 0, pips: 0 };
      const bonusPips = normalizePipAllocation(this.state.skill?.[skill._id]);
      const totalCode = adjustDiceCode(baseAttribute, pipsToDiceCode(bonusPips));

      skillData.system.dice = totalCode.dice;
      skillData.system.pips = totalCode.pips;
      actorData.items.push(skillData);
    }

    actorData.system.force = actorData.system.force ?? {};
    if (this.state.importEquipment === true) {
      actorData.items.push(...this._buildStartingEquipment(template));
    }

    for (const key of SW1E.forceSkillKeys) {
      const base = actorData.system.force[key] ?? { dice: 0, pips: 0 };
      const trained = (Number(base.dice) || 0) > 0 || (Number(base.pips) || 0) > 0;
      const bonusPips = trained ? normalizePipAllocation(this.state.force?.[key]) : 0;
      const totalCode = trained ? adjustDiceCode(base, pipsToDiceCode(bonusPips)) : { dice: 0, pips: 0 };

      actorData.system.force[key] = {
        dice: totalCode.dice,
        pips: totalCode.pips
      };
    }

    const created = await Actor.create(actorData, { renderSheet: true });
    if (created?.sheet) {
      created.sheet.render(true);
    }

    ui.notifications.info(game.i18n.format("SW1E.Builder.Created", { name: actorName }));
    await this.close();
  }

  _buildStartingEquipment(template) {
    const startingPackage = getTemplateStartingPackage(template);
    if (!startingPackage?.equipment?.length) return [];

    return startingPackage.equipment.map(line => {
      const match = this._findStartingItem(line);
      if (match) {
        const itemData = cloneForCreation(match);
        itemData.system = itemData.system ?? {};
        itemData.system.notes = [itemData.system.notes, `Granted by template on p. ${startingPackage.backPage}: ${line}`].filter(Boolean).join(" ");
        itemData.system.sourcePage = itemData.system.sourcePage || formatSourcePageLabel(startingPackage.backPage);
        if (Number.isFinite(match._quantity) && match._quantity > 0) {
          itemData.system.quantity = match._quantity;
          delete itemData._quantity;
        }
        return itemData;
      }

      return {
        name: titleCaseTemplateGear(line),
        type: "equipment",
        img: "systems/sw1e/icons/equipment.svg",
        system: {
          category: "gear",
          quantity: 1,
          equipped: false,
          armorDice: 0,
          armorPips: 0,
          weightText: "",
          cost: null,
          notes: `Imported from the template equipment list: ${line}`,
          sourcePage: formatSourcePageLabel(startingPackage.backPage)
        }
      };
    });
  }

  _findStartingItem(line) {
    const normalized = normalizeEquipmentLine(line);
    for (const [needle, target] of EQUIPMENT_ALIASES.entries()) {
      if (!normalized.includes(needle)) continue;
      const list = target.pack === "weapons" ? this._builderData.weapons : this._builderData.equipment;
      const doc = list.find(entry => entry.name === target.name);
      if (!doc) return null;
      const copy = foundry.utils.deepClone(doc);
      if (target.quantity) copy._quantity = target.quantity;
      return copy;
    }
    return null;
  }

}

export function openCharacterBuilder() {
  return new SW1ECharacterBuilder().render(true);
}
