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
  status: optionalString,
  page: z.string().optional(),
  limit: z.string().optional()
}).passthrough()
const userProjectsQuery = z.object({
  status: optionalString,
  page: z.string().optional(),
  limit: z.string().optional()
}).passthrough()
const leaderboardQuery = z.object({
  college: optionalString,
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
  skills: z.union([z.array(z.string()), z.string()]).optional(),
  primaryCategory: optionalString,
  phone: optionalString
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
  skills: z.union([z.array(z.string()), z.string()]).optional(),
  primaryCategory: optionalString,
  phone: optionalString,
  showContactToTeam: z.union([z.boolean(), z.string()]).optional()
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

const markHelpfulBody = z.object({})

const adminCreateUserBody = z.object({
  name: text,
  email,
  password,
  role: optionalString,
  emailVerified: z.union([z.boolean(), z.string()]).optional(),
  course: optionalString,
  yearOfStudy: optionalString,
  skills: z.union([z.array(z.string()), z.string()]).optional(),
  primaryCategory: optionalString,
  phone: optionalString,
  showContactToTeam: z.union([z.boolean(), z.string()]).optional()
}).passthrough()

const adminUpdateUserBody = z.object({
  name: optionalString,
  role: optionalString,
  emailVerified: z.union([z.boolean(), z.string()]).optional(),
  points: z.union([z.number(), z.string()]).optional(),
  course: optionalString,
  yearOfStudy: optionalString,
  skills: z.union([z.array(z.string()), z.string()]).optional(),
  primaryCategory: optionalString,
  phone: optionalString,
  showContactToTeam: z.union([z.boolean(), z.string()]).optional()
}).passthrough()

const sprintApplyBody = z.object({}).strict()

const sprintStatusUpdateBody = z.object({
  status: z.enum(['active']).optional()
}).passthrough()

module.exports = {
  objectId,
  emptyBody,
  paginationQuery,
  projectsQuery,
  userProjectsQuery,
  leaderboardQuery,
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
    updateProjectRequirementsBody,
    joinRequestBody,
    respondRequestBody,
    addMemberBody,
    removeMemberBody,
    messageBody,
    validationSubmitBody,
    startValidationBody,
    retryValidationBody,
    markHelpfulBody
  },
  sprint: {
    sprintApplyBody,
    sprintStatusUpdateBody
  }
}
