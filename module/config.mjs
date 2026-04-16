export const SW1E = {
  attributes: {
    dexterity: "SW1E.Attributes.Dexterity",
    knowledge: "SW1E.Attributes.Knowledge",
    mechanical: "SW1E.Attributes.Mechanical",
    perception: "SW1E.Attributes.Perception",
    strength: "SW1E.Attributes.Strength",
    technical: "SW1E.Attributes.Technical"
  },
  forceSkills: {
    control: "SW1E.Force.Skills.control",
    sense: "SW1E.Force.Skills.sense",
    alter: "SW1E.Force.Skills.alter"
  },
  woundStatuses: {
    healthy: "SW1E.Wound.healthy",
    stunned: "SW1E.Wound.stunned",
    wounded: "SW1E.Wound.wounded",
    incapacitated: "SW1E.Wound.incapacitated",
    mortallyWounded: "SW1E.Wound.mortallyWounded",
    dead: "SW1E.Wound.dead"
  },
  woundSeverity: {
    healthy: 0,
    stunned: 1,
    wounded: 2,
    incapacitated: 3,
    mortallyWounded: 4,
    dead: 5
  },
  equipmentCategories: {
    gear: "SW1E.EquipmentCategory.gear",
    armor: "SW1E.EquipmentCategory.armor",
    weapon: "SW1E.EquipmentCategory.weapon",
    consumable: "SW1E.EquipmentCategory.consumable",
    tool: "SW1E.EquipmentCategory.tool",
    document: "SW1E.EquipmentCategory.document",
    miscellaneous: "SW1E.EquipmentCategory.miscellaneous"
  },
  attackRanges: {
    pointBlank: "SW1E.Combat.Range.pointBlank",
    short: "SW1E.Combat.Range.short",
    medium: "SW1E.Combat.Range.medium",
    long: "SW1E.Combat.Range.long",
    custom: "SW1E.Combat.Range.custom"
  },
  starshipCodes: {
    sublightSpeed: "SW1E.Starship.Codes.sublightSpeed",
    maneuverability: "SW1E.Starship.Codes.maneuverability",
    hull: "SW1E.Starship.Codes.hull",
    shields: "SW1E.Starship.Codes.shields"
  },
  starshipRangeBands: {
    short: "SW1E.Starship.RangeBands.short",
    medium: "SW1E.Starship.RangeBands.medium",
    long: "SW1E.Starship.RangeBands.long"
  },
  starshipDamageStates: {
    operational: "SW1E.Starship.DamageStates.operational",
    lightlyDamaged: "SW1E.Starship.DamageStates.lightlyDamaged",
    heavilyDamaged: "SW1E.Starship.DamageStates.heavilyDamaged",
    severelyDamaged: "SW1E.Starship.DamageStates.severelyDamaged",
    deadInSpace: "SW1E.Starship.DamageStates.deadInSpace",
    destroyed: "SW1E.Starship.DamageStates.destroyed"
  },
  starshipSystems: {
    ionDrives: "SW1E.Starship.Systems.ionDrives",
    navComputer: "SW1E.Starship.Systems.navComputer",
    hyperdrives: "SW1E.Starship.Systems.hyperdrives",
    weaponSystem: "SW1E.Starship.Systems.weaponSystem",
    shields: "SW1E.Starship.Systems.shields",
    lateralThrusters: "SW1E.Starship.Systems.lateralThrusters"
  },
  starshipRepairAttempts: {
    first: "SW1E.Starship.Repair.Attempts.first",
    second: "SW1E.Starship.Repair.Attempts.second",
    third: "SW1E.Starship.Repair.Attempts.third"
  },
  forceSkillKeys: ["control", "sense", "alter"]
};
