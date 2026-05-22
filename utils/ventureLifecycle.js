const VENTURE_LIFECYCLE = [
  'idea',
  'planning',
  'building',
  'mvp',
  'validation',
  'incubation_ready',
  'pivoted',
  'archived'
]

const LIFECYCLE_LABELS = {
  idea: 'Idea',
  planning: 'Planning',
  building: 'Building',
  mvp: 'MVP',
  validation: 'Validation',
  incubation_ready: 'Incubation Ready',
  pivoted: 'Pivoted',
  archived: 'Archived'
}

const LIFECYCLE_INDEX = VENTURE_LIFECYCLE.reduce((acc, stage, index) => {
  acc[stage] = index
  return acc
}, {})

const LINEAR_LIFECYCLE = [
  'idea',
  'planning',
  'building',
  'mvp',
  'validation',
  'incubation_ready'
]

const LIFECYCLE_TRANSITIONS = {
  idea: new Set(['planning', 'pivoted', 'archived']),
  planning: new Set(['building', 'pivoted', 'archived']),
  building: new Set(['mvp', 'validation', 'pivoted', 'archived']),
  mvp: new Set(['validation', 'incubation_ready', 'pivoted', 'archived']),
  validation: new Set(['incubation_ready', 'building', 'mvp', 'pivoted', 'archived']),
  incubation_ready: new Set(['validation', 'pivoted', 'archived']),
  pivoted: new Set(['planning', 'building', 'mvp', 'validation', 'archived']),
  archived: new Set([])
}

const LEGACY_STATUS_MAP = {
  planning: 'planning',
  building: 'building',
  completed: 'mvp',
  validation: 'validation',
  validated: 'incubation_ready',
  validation_failed: 'pivoted',
  team_formation: 'planning',
  prototype: 'building',
  growth: 'incubation_ready',
  archived: 'archived'
}

const LEGACY_PHASE_MAP = {
  problem: 'idea',
  plan: 'planning',
  build: 'building',
  mvp: 'mvp',
  validation: 'validation',
  demo: 'mvp'
}

const VALID_LIFECYCLE = new Set(VENTURE_LIFECYCLE)

const toId = (value) => (value ? value.toString() : '')

const normalizeLifecycleStage = (value, fallback = 'idea') => {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return VALID_LIFECYCLE.has(normalized)
    ? normalized
    : LEGACY_STATUS_MAP[normalized] || LEGACY_PHASE_MAP[normalized] || fallback
}

const normalizeLifecycleFilter = (value, fallback = 'idea') => {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (VALID_LIFECYCLE.has(normalized)) return normalized
  return LEGACY_STATUS_MAP[normalized] || LEGACY_PHASE_MAP[normalized] || fallback
}

const getLifecycleLabel = (stage) => LIFECYCLE_LABELS[normalizeLifecycleStage(stage)] || 'Idea'

const getLifecycleProgress = (stage) => {
  const normalized = normalizeLifecycleStage(stage)
  if (normalized === 'pivoted') return 35
  if (normalized === 'archived') return 100
  const index = LINEAR_LIFECYCLE.indexOf(normalized)
  if (index < 0) return 0
  return Math.round(((index + 1) / LINEAR_LIFECYCLE.length) * 100)
}

const getNextLifecycleStage = (stage) => {
  const normalized = normalizeLifecycleStage(stage)
  if (normalized === 'pivoted') return 'planning'
  if (normalized === 'archived' || normalized === 'incubation_ready') return null
  const index = LINEAR_LIFECYCLE.indexOf(normalized)
  if (index < 0 || index >= LINEAR_LIFECYCLE.length - 1) return null
  return LINEAR_LIFECYCLE[index + 1]
}

const countProjectContributors = (project = {}) => {
  const ids = new Set()
  const ownerId = toId(project.owner?._id || project.owner)
  if (ownerId) ids.add(ownerId)
  ;(project.teamMembers || []).forEach((member) => {
    const normalized = toId(member?._id || member)
    if (normalized) ids.add(normalized)
  })
  return ids.size
}

const hasValidationWorkspaceData = (project = {}) => {
  const workspace = project.validation?.workspace || {}
  return Boolean(
    (workspace.problemStatement || '').trim()
    || (workspace.targetUsers || '').trim()
    || (workspace.coreAssumptions || []).length
    || (workspace.tasks || []).length
    || (workspace.evidence || []).length
    || Number(workspace.confidenceScore || 0) > 0
  )
}

const inferLifecycleStage = (project = {}) => {
  const explicitStage = normalizeLifecycleStage(project.lifecycleStage || '', '')
  if (explicitStage) return explicitStage

  const validationStatus = normalizeLifecycleStage(project.validation?.validationStatus || '', '')
  if (validationStatus === 'archived') return 'archived'

  const legacyStatus = typeof project.status === 'string' ? project.status.trim().toLowerCase() : ''
  const legacyPhase = typeof project.phase === 'string' ? project.phase.trim().toLowerCase() : ''
  const contributorCount = countProjectContributors(project)
  const targetTeamSize = Math.max(1, Number(project.numberOfTeammates || 1))
  const hasFullTeam = contributorCount >= targetTeamSize

  if (legacyStatus === 'archived') return 'archived'
  if (project.validation?.validationStatus === 'passed' || legacyStatus === 'validated') return 'incubation_ready'
  if (project.validation?.validationStatus === 'failed' || legacyStatus === 'validation_failed') return 'pivoted'
  if (legacyStatus === 'validation') return 'validation'
  if (legacyPhase === 'demo') return 'mvp'
  if (legacyPhase === 'mvp') return 'mvp'
  if (legacyStatus === 'building' || legacyPhase === 'build') {
    return hasFullTeam ? 'building' : 'planning'
  }
  if (legacyPhase === 'plan') return 'planning'
  if (hasValidationWorkspaceData(project)) return 'validation'
  if ((project.interestedUsers || []).length > 0 || contributorCount > 1) return 'planning'
  return LEGACY_STATUS_MAP[legacyStatus] || LEGACY_PHASE_MAP[legacyPhase] || 'idea'
}

const canTransitionLifecycle = (fromStage, toStage) => {
  const from = normalizeLifecycleStage(fromStage)
  const to = normalizeLifecycleStage(toStage)
  if (from === to) return true
  return LIFECYCLE_TRANSITIONS[from]?.has(to) || false
}

const assertLifecycleTransition = (fromStage, toStage) => {
  const from = normalizeLifecycleStage(fromStage)
  const to = normalizeLifecycleStage(toStage)
  if (canTransitionLifecycle(from, to)) {
    return { ok: true, from, to }
  }
  return {
    ok: false,
    from,
    to,
    message: `Invalid lifecycle transition from ${getLifecycleLabel(from)} to ${getLifecycleLabel(to)}`
  }
}

const updateLifecycleStage = (project, nextStage) => {
  if (!project) return 'idea'
  const normalized = normalizeLifecycleStage(nextStage)
  project.lifecycleStage = normalized
  return normalized
}

module.exports = {
  VENTURE_LIFECYCLE,
  LINEAR_LIFECYCLE,
  LIFECYCLE_LABELS,
  LIFECYCLE_INDEX,
  LIFECYCLE_TRANSITIONS,
  normalizeLifecycleStage,
  normalizeLifecycleFilter,
  getLifecycleLabel,
  getLifecycleProgress,
  getNextLifecycleStage,
  inferLifecycleStage,
  canTransitionLifecycle,
  assertLifecycleTransition,
  updateLifecycleStage
}
