export interface ISetPassword {
  new_password: string
  old_password: string
}

export interface IVerifyTOTP {
  token: string
}

export interface ICompleteOnboardingPayload {
  self_description?: string
  current_priority?: string[]
  dob?: string
  join_reasons?: string[]
}

export interface IUpdateContext {
  important_notes?: string[]
  key_preferences?: string[]
  conversation_history_summary?: string
  emotional_state_trends?: string[]
  goals_and_aspirations?: string[]
  self_description?: string
  current_priority?: string[]
  join_reasons?: string[]
}