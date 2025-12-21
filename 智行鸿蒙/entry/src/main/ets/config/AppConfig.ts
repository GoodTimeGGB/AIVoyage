/**
 * 应用配置管理
 * 统一管理高德API Key、LLM API配置等
 */

export interface LLMConfig {
  provider: 'doubao' | 'qianwen' | 'custom'
  apiKey: string
  baseUrl?: string
  model?: string
}

export interface AppConfigData {
  amapKey: string
  llm: LLMConfig
  userPreferences: {
    homeAddress?: string
    workAddress?: string
    preferredRouteType?: 'fastest' | 'shortest' | 'economical'
    avoidHighway?: boolean
    avoidToll?: boolean
  }
}

const defaultConfig: AppConfigData = {
  amapKey: '',
  llm: {
    provider: 'qianwen',
    apiKey: '',
    model: 'qwen-turbo'
  },
  userPreferences: {
    preferredRouteType: 'fastest',
    avoidHighway: false,
    avoidToll: false
  }
}

let cachedConfig: AppConfigData | null = null

export function getAmapKey(): string {
  const g: any = globalThis as any
  return typeof g.__amap_key === 'string' ? g.__amap_key : ''
}

export function getLLMConfig(): LLMConfig {
  const g: any = globalThis as any
  if (g.__llm_config) {
    return g.__llm_config as LLMConfig
  }
  return defaultConfig.llm
}

export function getUserPreferences(): AppConfigData['userPreferences'] {
  const g: any = globalThis as any
  if (g.__user_preferences) {
    return g.__user_preferences
  }
  return defaultConfig.userPreferences
}

export function setUserPreferences(prefs: Partial<AppConfigData['userPreferences']>): void {
  const g: any = globalThis as any
  g.__user_preferences = { ...getUserPreferences(), ...prefs }
}

export function getFullConfig(): AppConfigData {
  return {
    amapKey: getAmapKey(),
    llm: getLLMConfig(),
    userPreferences: getUserPreferences()
  }
}
