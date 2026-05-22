const { z } = require('zod')

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')
const optionalId = z.string().optional()
const email = z.string().email()
const otp = z.string().min(4).max(8)
const twoFactorCode = z.string().min(6).max(8)
const password = z.string().min(8).max(128)
const text = z.string().min(1).max(1000)
const shortText = z.string().min(1).max(200)
const optionalText = z.string().max(2000).optional()
const optionalString = z.string().optional()
const optionalStringList = z.union([z.array(z.string()), z.string()]).optional()
const numericScore = z.union([z.number(), z.string()])
const emptyBody = z.object({}).strict()
const optionalObjectIdOrAll = z.string().optional().refine(
  (value) => !value || value === 'all' || objectId.safeParse(value).success,
  { message: 'Invalid id' }
)
const paginationQuery = z.object({
  page: z.string().optional(),
  limit: z.string().optional()
})
const projectsQuery = z.object({
  college: optionalObjectIdOrAll,
  category: optionalString,
  skills: optionalString,
  roles: optionalString,
  lifecycleStage: optionalString,
  status: optionalString,
  page: z.string().optional(),
  limit: z.string().optional()
}).passthrough()
const userProjectsQuery = z.object({
  lifecycleStage: optionalString,
  status: optionalString,
  page: z.string().optional(),
  limit: z.string().optional()
}).passthrough()
const activityQuery = z.object({
  activeWithin: optionalString
}).passthrough()

const registerBody = z.object({
  name: z.string().min(1).max(120),
  email,
  password,
  college_id: optionalId,
  collegeId: optionalId,
  college: optionalId,
  collegeName: optionalString,
  customCollegeName: optionalString,
  collegeType: optionalString,
  course: optionalString,
  yearOfStudy: optionalString,
  skills: optionalStringList,
  primaryCategory: optionalString,
  phone: optionalString,
  userGoal: optionalString,
  executionRoles: optionalStringList,
  industryInterests: optionalStringList,
  commitmentLevel: z.enum(['Exploring', 'Team Member', 'Casual Contributor', 'Serious Builder', 'Startup Founder']).optional()
}).passthrough()

const loginBody = z.object({
  email,
  password
})

const googleAuthBody = z.object({
  credential: z.string().min(20),
  college_id: optionalId,
  collegeId: optionalId,
  college: optionalId
}).passthrough()

const verifyEmailBody = z.object({
  email,
  otp
})

const resendVerificationBody = z.object({
  email
})

const adminTwoFactorConfirmBody = z.object({
  code: twoFactorCode
})

const adminTwoFactorVerifyLoginBody = z.object({
  token: z.string().min(10),
  code: twoFactorCode
})

const adminTwoFactorDisableBody = z.object({
  code: twoFactorCode
})

const forgotPasswordBody = z.object({
  email
})

const verifyResetBody = z.object({
  email,
  otp
})

const resetPasswordBody = z.object({
  email,
  otp,
  newPassword: password
})

const updateProfileBody = z.object({
  name: optionalString,
  course: optionalString,
  yearOfStudy: optionalString,
  skills: optionalStringList,
  primaryCategory: optionalString,
  phone: optionalString,
  showContactToTeam: z.union([z.boolean(), z.string()]).optional(),
  userGoal: optionalString,
  executionRoles: optionalStringList,
  industryInterests: optionalStringList,
  commitmentLevel: z.enum(['Exploring', 'Team Member', 'Casual Contributor', 'Serious Builder', 'Startup Founder']).optional()
}).passthrough()

const changePasswordBody = z.object({
  currentPassword: password,
  newPassword: password
})

const createProjectBody = z.object({
  title: text,
  shortPitch: shortText,
  description: optionalText,
  category: text,
  tags: z.union([z.array(z.string()), z.string()]).optional(),
  rolesNeeded: z.union([z.array(z.string()), z.string()]).optional(),
  skillsRequired: z.union([z.array(z.string()), z.string()]).optional(),
  numberOfTeammates: z.union([z.number(), z.string()]).optional(),
  visibility: optionalString,
  executionPlan: text,
  techProduct: z.any().optional(),
  businessStartup: z.any().optional(),
  designCreative: z.any().optional(),
  marketingContent: z.any().optional(),
  servicesOperations: z.any().optional()
}).passthrough()

const updateProjectDetailsBody = z.object({
  title: optionalString,
  shortPitch: optionalString,
  description: optionalString,
  tags: z.union([z.array(z.string()), z.string()]).optional(),
  executionPlan: optionalString
}).passthrough()

const updateValidationWorkspaceBody = z.object({
  problemStatement: optionalString,
  targetUsers: optionalString,
  coreAssumptions: z.union([z.array(z.string()), z.string()]).optional(),
  whoSpokenTo: optionalString,
  repeatedProblems: optionalString,
  surprisingInsights: optionalString,
  useOrPaySignal: optionalString,
  feedbackChanges: optionalString,
  confidenceScore: z.union([z.number(), z.string()]).optional(),
  validationTasks: z.array(
    z.object({
      taskId: optionalString,
      title: optionalString,
      status: optionalString,
      dueDate: optionalString,
      completedAt: optionalString
    }).passthrough()
  ).optional(),
  validationEvidence: z.array(
    z.object({
      evidenceId: optionalString,
      kind: optionalString,
      title: optionalString,
      summary: optionalString,
      link: optionalString,
      createdAt: optionalString
    }).passthrough()
  ).optional()
}).passthrough()

const updateProjectRequirementsBody = z.object({
  rolesNeeded: z.union([z.array(z.string()), z.string()]).optional(),
  skillsRequired: z.union([z.array(z.string()), z.string()]).optional(),
  numberOfTeammates: z.union([z.number(), z.string()]).optional(),
  visibility: optionalString
}).passthrough()

const joinRequestBody = z.object({
  userId: optionalId
}).passthrough()

const respondRequestBody = z.object({
  userId: objectId,
  action: z.enum(['accept', 'reject'])
}).passthrough()

const addMemberBody = z.object({
  requesterId: optionalId,
  userId: objectId
}).passthrough()

const removeMemberBody = z.object({
  requesterId: optionalId,
  userId: objectId
}).passthrough()

const messageBody = z.object({
  text: text
}).passthrough()

const validationSubmitBody = z.object({
  rating: numericScore.optional(),
  criteria: z.object({
    problemClarity: numericScore,
    userPainSeverity: numericScore,
    solutionFit: numericScore,
    innovation: numericScore,
    usefulness: numericScore,
    executionReadiness: numericScore,
    feasibility30Days: numericScore,
    evidenceStrength: numericScore,
    scalabilityPotential: numericScore,
    teamReadiness: numericScore,
    confidence: numericScore,
    wouldUse: z.enum(['yes', 'maybe', 'no']),
    finalVerdict: z.enum(['pass', 'rework', 'hold'])
  }),
  feedback: text,
  topStrengths: text,
  topGaps: text,
  biggestRisk: text,
  next7DayAction: text,
  projectId: optionalId
}).passthrough()

const startValidationBody = z.object({
  demoLink: optionalString,
  demoNotes: optionalString,
  sharedFileIds: z.union([z.array(z.string()), z.string()]).optional()
}).passthrough()

const retryValidationBody = z.object({}).passthrough()

const adminCreateUserBody = z.object({
  name: text,
  email,
  password,
  role: optionalString,
  emailVerified: z.union([z.boolean(), z.string()]).optional(),
  course: optionalString,
  yearOfStudy: optionalString,
  skills: optionalStringList,
  primaryCategory: optionalString,
  phone: optionalString,
  showContactToTeam: z.union([z.boolean(), z.string()]).optional(),
  userGoal: optionalString,
  executionRoles: optionalStringList,
  industryInterests: optionalStringList,
  commitmentLevel: z.enum(['Exploring', 'Team Member', 'Casual Contributor', 'Serious Builder', 'Startup Founder']).optional()
}).passthrough()

const adminUpdateUserBody = z.object({
  name: optionalString,
  role: optionalString,
  emailVerified: z.union([z.boolean(), z.string()]).optional(),
  points: z.union([z.number(), z.string()]).optional(),
  course: optionalString,
  yearOfStudy: optionalString,
  skills: optionalStringList,
  primaryCategory: optionalString,
  phone: optionalString,
  showContactToTeam: z.union([z.boolean(), z.string()]).optional(),
  userGoal: optionalString,
  executionRoles: optionalStringList,
  industryInterests: optionalStringList,
  commitmentLevel: z.enum(['Exploring', 'Team Member', 'Casual Contributor', 'Serious Builder', 'Startup Founder']).optional()
}).passthrough()

const milestoneCreateBody = z.object({
  title: z.string().min(1).max(180),
  description: z.string().max(4000).optional(),
  owner: optionalId,
  lifecycleStage: optionalString,
  dueDate: z.string().optional(),
  dependencies: optionalStringList,
  blockers: optionalStringList,
  blockerDetails: z.array(z.object({
    blockerId: optionalString,
    type: z.enum(['technical', 'design', 'validation', 'team', 'contributor']).optional(),
    description: z.string().min(1).max(500),
    status: z.enum(['open', 'resolved']).optional(),
    resolvedAt: optionalString
  }).passthrough()).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional()
}).passthrough()

const milestoneUpdateBody = z.object({
  title: z.string().min(1).max(180).optional(),
  description: z.string().max(4000).optional(),
  owner: optionalId,
  lifecycleStage: optionalString,
  dueDate: z.string().optional(),
  dependencies: optionalStringList,
  blockers: optionalStringList,
  blockerDetails: z.array(z.object({
    blockerId: optionalString,
    type: z.enum(['technical', 'design', 'validation', 'team', 'contributor']).optional(),
    description: z.string().min(1).max(500),
    status: z.enum(['open', 'resolved']).optional(),
    resolvedAt: optionalString
  }).passthrough()).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional()
}).passthrough()

const milestoneParams = z.object({
  id: objectId,
  milestoneId: objectId
})

const contributionCreateBody = z.object({
  action: z.string().min(1).max(200),
  impact: z.string().max(1000).optional(),
  milestoneId: optionalId
}).passthrough()

const checkInBody = z.object({
  status: z.enum(['strong_momentum', 'facing_blockers', 'needs_team_decision', 'need_contributors', 'pivoting', 'preparing_launch']),
  note: z.string().max(500).optional()
}).passthrough()

const continuationBody = z.object({
  action: z.enum([
    'continue_planning',
    'continue_building',
    'prepare_incubation',
    'pivot_venture',
    'relaunch_validation',
    'extend_mvp',
    'archive_venture'
  ]),
  note: z.string().max(800).optional()
}).passthrough()

module.exports = {
  objectId,
  emptyBody,
  paginationQuery,
  projectsQuery,
  userProjectsQuery,
  activityQuery,
  auth: {
    registerBody,
    loginBody,
    googleAuthBody,
    verifyEmailBody,
    resendVerificationBody,
    forgotPasswordBody,
    verifyResetBody,
    resetPasswordBody,
    adminTwoFactorConfirmBody,
    adminTwoFactorVerifyLoginBody,
    adminTwoFactorDisableBody
  },
  user: {
    updateProfileBody,
    changePasswordBody,
    adminCreateUserBody,
    adminUpdateUserBody
  },
  project: {
    createProjectBody,
    updateProjectDetailsBody,
    updateValidationWorkspaceBody,
    updateProjectRequirementsBody,
    joinRequestBody,
    respondRequestBody,
    addMemberBody,
    removeMemberBody,
    messageBody,
    validationSubmitBody,
    startValidationBody,
    retryValidationBody
  },
  milestone: {
    milestoneCreateBody,
    milestoneUpdateBody,
    milestoneParams
  },
  contribution: {
    contributionCreateBody
  },
  checkIn: {
    checkInBody,
    continuationBody
  }
}
