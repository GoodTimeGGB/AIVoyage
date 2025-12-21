/**
 * 智能对话引擎
 * 负责解析用户自然语言输入，转换为结构化的机器指令
 */
import LLMService, { LLMMessage } from '../service/LLMService'
import { getUserPreferences } from '../config/AppConfig'

/**
 * 结构化出行指令
 */
export interface TravelIntent {
  action: 'plan_route' | 'search_poi' | 'navigate' | 'query_traffic' | 'query_weather' | 'set_preference' | 'unknown'
  origin?: string
  destination?: string
  time?: string
  preferences?: string[]
  poiType?: string
  poiKeyword?: string
  mode?: 'drive' | 'walk' | 'ride' | 'transit'
  rawQuery: string
  confidence: number
}

/**
 * 对话消息
 */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  intent?: TravelIntent
}

const SYSTEM_PROMPT = `你是一个智能出行助手，名叫"智行"。你需要理解用户的出行需求，并将其转换为结构化的JSON指令。

用户可能会说：
- "明天早上9点带我去国贸" → 路径规划
- "附近有什么咖啡店" → POI搜索
- "前方路况怎么样" → 交通查询
- "今天天气如何" → 天气查询
- "避开高速走" → 设置偏好

请严格按照以下JSON格式返回（不要包含其他文字）：
{
  "action": "plan_route|search_poi|navigate|query_traffic|query_weather|set_preference|unknown",
  "origin": "起点地址（可选，默认当前位置）",
  "destination": "目的地地址",
  "time": "出发时间（如09:00）",
  "preferences": ["fastest", "avoid_highway", "avoid_toll", "coffee_shop"],
  "poiType": "POI类型（如餐饮、加油站）",
  "poiKeyword": "POI关键词",
  "mode": "drive|walk|ride|transit",
  "confidence": 0.0-1.0
}

注意：
1. 如果用户说"回家"，destination应为"家庭地址"
2. 如果用户说"去公司"，destination应为"工作地址"
3. 如果无法理解用户意图，action设为"unknown"
4. confidence表示理解的确定性，越高越确定`

export default class DialogEngine {
  private llmService: LLMService
  private chatHistory: ChatMessage[] = []
  private maxHistoryLength: number = 10

  constructor() {
    this.llmService = new LLMService()
  }

  /**
   * 解析用户输入，返回结构化意图
   */
  async parseIntent(userInput: string): Promise<TravelIntent> {
    // 先尝试本地规则匹配（快速响应常见场景）
    const localIntent = this.localParse(userInput)
    if (localIntent.confidence > 0.9) {
      this.addToHistory('user', userInput, localIntent)
      return localIntent
    }

    // 调用LLM进行深度理解
    const messages: LLMMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...this.getRecentHistory(),
      { role: 'user', content: userInput }
    ]

    const response = await this.llmService.chat(messages)

    if (!response.success) {
      console.error(`LLM解析失败: ${response.error}`)
      // 降级使用本地解析
      this.addToHistory('user', userInput, localIntent)
      return localIntent
    }

    try {
      const parsed = JSON.parse(response.content) as Partial<TravelIntent>
      const intent: TravelIntent = {
        action: parsed.action || 'unknown',
        origin: parsed.origin,
        destination: parsed.destination,
        time: parsed.time,
        preferences: parsed.preferences,
        poiType: parsed.poiType,
        poiKeyword: parsed.poiKeyword,
        mode: parsed.mode || 'drive',
        rawQuery: userInput,
        confidence: parsed.confidence || 0.8
      }

      // 替换特殊地址
      const prefs = getUserPreferences()
      if (intent.destination === '家庭地址' && prefs.homeAddress) {
        intent.destination = prefs.homeAddress
      }
      if (intent.destination === '工作地址' && prefs.workAddress) {
        intent.destination = prefs.workAddress
      }

      this.addToHistory('user', userInput, intent)
      return intent
    } catch {
      console.error('LLM返回格式解析失败')
      this.addToHistory('user', userInput, localIntent)
      return localIntent
    }
  }

  /**
   * 生成自然语言回复
   */
  async generateResponse(intent: TravelIntent, resultData?: any): Promise<string> {
    const prefs = getUserPreferences()

    // 根据意图类型生成基础回复
    let baseResponse = ''

    switch (intent.action) {
      case 'plan_route':
        if (resultData?.routes?.length > 0) {
          const route = resultData.routes[0]
          const distKm = (route.distanceMeters / 1000).toFixed(1)
          const durMin = Math.round(route.durationSeconds / 60)
          baseResponse = `已为您规划路线，全程${distKm}公里，预计${durMin}分钟到达。`
          if (resultData.pois?.length > 0) {
            baseResponse += `途中有${resultData.pois.length}个推荐地点。`
          }
        } else {
          baseResponse = '抱歉，暂时无法规划该路线，请检查目的地是否正确。'
        }
        break

      case 'search_poi':
        if (resultData?.pois?.length > 0) {
          baseResponse = `为您找到${resultData.pois.length}个${intent.poiKeyword || '相关'}地点：${resultData.pois.slice(0, 3).map((p: any) => p.name).join('、')}。`
        } else {
          baseResponse = `附近暂未找到${intent.poiKeyword || '相关'}地点。`
        }
        break

      case 'query_traffic':
        if (resultData?.status) {
          baseResponse = `当前路况：${resultData.status}，${resultData.description || ''}`
        } else {
          baseResponse = '暂时无法获取路况信息。'
        }
        break

      case 'query_weather':
        if (resultData?.weather) {
          baseResponse = `当前天气：${resultData.weather}，温度${resultData.temperature}℃，${resultData.tips || ''}`
        } else {
          baseResponse = '暂时无法获取天气信息。'
        }
        break

      case 'set_preference':
        baseResponse = '好的，已为您更新出行偏好设置。'
        break

      default:
        baseResponse = '抱歉，我没有完全理解您的需求。您可以告诉我想去哪里，或者搜索附近的地点。'
    }

    this.addToHistory('assistant', baseResponse)
    return baseResponse
  }

  /**
   * 本地规则解析（快速匹配常见场景）
   */
  private localParse(input: string): TravelIntent {
    const intent: TravelIntent = {
      action: 'unknown',
      mode: 'drive',
      rawQuery: input,
      confidence: 0.5
    }

    const lowerInput = input.toLowerCase()

    // 回家/去公司
    if (lowerInput.includes('回家') || lowerInput.includes('去家')) {
      intent.action = 'plan_route'
      intent.destination = '家庭地址'
      intent.confidence = 0.95
      return intent
    }

    if (lowerInput.includes('去公司') || lowerInput.includes('去上班') || lowerInput.includes('通勤')) {
      intent.action = 'plan_route'
      intent.destination = '工作地址'
      intent.confidence = 0.95
      return intent
    }

    // POI搜索
    const poiPatterns = [
      { pattern: /附近.*?(加油站|充电站|停车场|餐厅|咖啡|超市|银行|医院|药店)/, type: 'search_poi' },
      { pattern: /找.*?(加油站|充电站|停车场|餐厅|咖啡|超市|银行|医院|药店)/, type: 'search_poi' },
      { pattern: /哪里有(加油站|充电站|停车场|餐厅|咖啡|超市|银行|医院|药店)/, type: 'search_poi' }
    ]

    for (const p of poiPatterns) {
      const match = input.match(p.pattern)
      if (match) {
        intent.action = 'search_poi'
        intent.poiKeyword = match[1]
        intent.confidence = 0.9
        return intent
      }
    }

    // 路况查询
    if (lowerInput.includes('路况') || lowerInput.includes('堵车') || lowerInput.includes('拥堵')) {
      intent.action = 'query_traffic'
      intent.confidence = 0.9
      return intent
    }

    // 天气查询
    if (lowerInput.includes('天气') || lowerInput.includes('下雨') || lowerInput.includes('温度')) {
      intent.action = 'query_weather'
      intent.confidence = 0.9
      return intent
    }

    // 路径规划（带目的地）
    const routePatterns = [
      /(?:带我)?去(.+)/,
      /(?:导航)?到(.+)/,
      /怎么去(.+)/,
      /(.+)怎么走/
    ]

    for (const pattern of routePatterns) {
      const match = input.match(pattern)
      if (match && match[1]) {
        intent.action = 'plan_route'
        intent.destination = match[1].trim()
        intent.confidence = 0.8

        // 检查偏好
        if (input.includes('避开高速')) {
          intent.preferences = intent.preferences || []
          intent.preferences.push('avoid_highway')
        }
        if (input.includes('不走高速')) {
          intent.preferences = intent.preferences || []
          intent.preferences.push('avoid_highway')
        }
        if (input.includes('最快')) {
          intent.preferences = intent.preferences || []
          intent.preferences.push('fastest')
        }

        return intent
      }
    }

    return intent
  }

  /**
   * 添加消息到历史记录
   */
  private addToHistory(role: 'user' | 'assistant', content: string, intent?: TravelIntent): void {
    this.chatHistory.push({
      role,
      content,
      timestamp: Date.now(),
      intent
    })

    // 保持历史记录长度
    if (this.chatHistory.length > this.maxHistoryLength) {
      this.chatHistory = this.chatHistory.slice(-this.maxHistoryLength)
    }
  }

  /**
   * 获取最近对话历史（用于上下文）
   */
  private getRecentHistory(): LLMMessage[] {
    return this.chatHistory.slice(-4).map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content
    }))
  }

  /**
   * 清除对话历史
   */
  clearHistory(): void {
    this.chatHistory = []
  }

  /**
   * 获取对话历史
   */
  getHistory(): ChatMessage[] {
    return [...this.chatHistory]
  }
}
