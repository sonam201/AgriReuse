// Listing Compliance Check: category questions + NZ rules, evaluated once when a seller lists.
// Rules are data (RULES below): to change a rule, edit its entry, not the evaluation code.
// Guidance only, not legal advice. Wording and sources come from the AgriReuse rules design.

export type CategoryId = 'fruit_veg' | 'processing' | 'crop_residue' | 'spare_feed' | 'animal_waste'
export type Level = 'ok' | 'check' | 'blocked'
export type Answers = Record<string, string>

export const CATEGORIES: { id: CategoryId; label: string; hint: string; cond: string; beta?: boolean }[] = [
  { id: 'fruit_veg', label: 'Fruit and veg surplus', hint: 'unsold, overripe or damaged produce', cond: 'Unsellable/overripe' },
  { id: 'processing', label: 'Processing leftovers', hint: 'pomace, peel, pulp, trimmings', cond: 'Processing by-product' },
  { id: 'crop_residue', label: 'Crop residues', hint: 'straw, stover, vines, prunings', cond: 'Post-harvest residue' },
  { id: 'spare_feed', label: 'Spare animal feed', hint: 'hay, silage, baleage, grain', cond: 'Spare feed' },
  { id: 'animal_waste', label: 'Animal waste', hint: 'manure, bedding', cond: 'Unknown', beta: true },
]

const YNU = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'not_sure', label: 'Not sure' }]
const YN = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]

// Asked only for the listed categories, in this order. (Region/town + suburb are asked for every category.)
export const QUESTIONS: { id: string; text: string; options: { value: string; label: string }[]; categories: CategoryId[] }[] = [
  { id: 'fruit_fly_zone', text: 'Is it in a fruit fly controlled area?', options: YNU, categories: ['fruit_veg', 'processing', 'crop_residue'] },
  { id: 'touched_meat', text: 'Has it touched meat or food scraps?', options: YNU, categories: ['fruit_veg'] },
  { id: 'meat_facility', text: 'Does the facility handle meat?', options: YNU, categories: ['processing'] },
  {
    id: 'last_sprayed', text: 'When was it last sprayed?', categories: ['fruit_veg', 'spare_feed'],
    options: [{ value: 'never', label: 'Not sprayed' }, { value: 'not_recent', label: 'A while ago' }, { value: 'recent', label: 'Recently' }, { value: 'unknown', label: 'Don’t know' }],
  },
  {
    id: 'condition', text: 'What condition is it in?', categories: ['fruit_veg', 'processing'],
    options: [{ value: 'fresh', label: 'Fresh' }, { value: 'damaged', label: 'Bruised / damaged' }, { value: 'rotting', label: 'Rotting' }],
  },
  { id: 'is_kiwifruit', text: 'Is it kiwifruit?', options: YN, categories: ['fruit_veg'] },
  { id: 'kiwi_prunings', text: 'Is it kiwifruit prunings or vines?', options: YN, categories: ['crop_residue'] },
  { id: 'weed_free', text: 'Is it free of weeds?', options: YNU, categories: ['spare_feed'] },
  { id: 'composted', text: 'Has it been composted?', options: YN, categories: ['animal_waste'] },
]

export const questionsFor = (category: string | null | undefined) =>
  QUESTIONS.filter(q => category && q.categories.includes(category as CategoryId))

// Uses a buyer can request. 'feed' is general stock feed (kept for older listings).
export const ALL_USES = ['composting', 'worm farming', 'biogas', 'feed', 'pig feed', 'firewood'] as const
export const USE_LABELS: Record<string, string> = {
  composting: 'Composting', 'worm farming': 'Worm farming', biogas: 'Biogas', feed: 'Stock feed', 'pig feed': 'Pig feed', firewood: 'Firewood',
}
const FEED = ['feed', 'pig feed']
const except = (...keep: string[]) => ALL_USES.filter(u => !keep.includes(u))

export interface Rule {
  id: string
  level: Exclude<Level, 'ok'>
  message: string
  source: string
  // Uses hidden from matching entirely, and uses that need (simulated) verification first.
  hideUses?: readonly string[]
  checkUses?: readonly string[]
  applies: (a: Answers, ctx: { inDemoZone: boolean }) => boolean
}

export const RULES: Rule[] = [
  {
    id: 'fruit_fly_zone', level: 'blocked', source: 'MPI',
    message: 'In a fruit fly controlled area: not allowed to leave the zone. Use MPI bins.',
    hideUses: ALL_USES,
    applies: (a, ctx) => a.fruit_fly_zone == 'yes' || ctx.inDemoZone,
  },
  {
    id: 'fruit_fly_unsure', level: 'check', source: 'MPI',
    message: 'Not sure about the fruit fly zone: check MPI’s list of controlled areas first.',
    checkUses: ALL_USES,
    applies: (a, ctx) => a.fruit_fly_zone == 'not_sure' && !ctx.inDemoZone,
  },
  {
    id: 'touched_meat', level: 'check', source: 'MPI',
    message: 'Touched meat or food scraps (or a meat facility): no pig feed unless treated.',
    hideUses: ['pig feed'],
    applies: a => ['yes', 'not_sure'].includes(a.touched_meat) || ['yes', 'not_sure'].includes(a.meat_facility),
  },
  {
    id: 'spray_withholding', level: 'check', source: 'ACVM label',
    message: 'Sprayed recently, or not known: for feed, check the spray withholding period on the product label.',
    checkUses: FEED,
    applies: a => ['recent', 'unknown'].includes(a.last_sprayed),
  },
  {
    id: 'rotting', level: 'check', source: 'Guidance',
    message: 'Rotting: compost or biogas only.',
    hideUses: except('composting', 'biogas'),
    applies: a => a.condition == 'rotting',
  },
  {
    id: 'kiwi_prunings', level: 'check', source: 'KVH',
    message: 'Kiwifruit prunings or vines: no firewood to other regions.',
    checkUses: ['firewood'],
    applies: a => a.kiwi_prunings == 'yes',
  },
  {
    id: 'weed_risk', level: 'check', source: 'MPI velvetleaf guidance',
    message: 'Not confirmed weed-free: weed risk if used as feed.',
    checkUses: FEED,
    applies: a => ['no', 'not_sure'].includes(a.weed_free),
  },
  {
    id: 'not_composted', level: 'check', source: 'Council rules',
    message: 'Animal waste not composted: compost first, and check your council’s rules.',
    hideUses: except('composting'),
    applies: a => a.composted == 'no',
  },
]

// Demo fruit fly zone (toggled live from the app; stored in the database).
export interface DemoZone { active: boolean; suburbs: string[] }
export const inZone = (suburb: string | null | undefined, zone: DemoZone | null) =>
  !!(zone?.active && suburb && zone.suburbs.some(z => z.toLowerCase() == suburb.trim().toLowerCase()))

export interface Compliance { level: Level; rules: Rule[]; hidden: Set<string>; check: Set<string>; unanswered: string[] }

export function evaluate(category: string | null | undefined, answers: Answers, suburb: string | null | undefined, zone: DemoZone | null): Compliance {
  const ctx = { inDemoZone: inZone(suburb, zone) }
  const rules = category ? RULES.filter(r => r.applies(answers, ctx)) : RULES.filter(r => r.id == 'fruit_fly_zone' && ctx.inDemoZone)
  const level: Level = rules.some(r => r.level == 'blocked') ? 'blocked' : rules.length ? 'check' : 'ok'
  return {
    level, rules,
    hidden: new Set(rules.flatMap(r => r.hideUses ?? [])),
    check: new Set(rules.flatMap(r => r.checkUses ?? [])),
    unanswered: questionsFor(category).filter(q => !answers[q.id]).map(q => q.id),
  }
}

export const LEVEL_BADGE: Record<Level, { icon: string; text: string; cls: string }> = {
  ok: { icon: '🟢', text: 'OK', cls: 'eligible' },
  check: { icon: '🟠', text: 'Needs check', cls: 'restricted' },
  blocked: { icon: '🔴', text: 'Not allowed', cls: 'blocked' },
}

export const DISCLAIMER = 'Compliance checks are guidance only, not legal advice. The seller is responsible for the information they provide.'
export const DECLARATION = 'I confirm this information is true to the best of my knowledge, and I accept responsibility for any false information.'
