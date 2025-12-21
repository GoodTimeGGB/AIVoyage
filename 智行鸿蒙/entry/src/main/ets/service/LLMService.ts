/**
 * 大语言模型服务
 * 支持通义千问、豆包等主流LLM API
 */
import http from '@ohos.net.http'
import { getLLMConfig, LLMConfig } from '../config/AppConfig'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMResponse {
  success: boolean
  content: string
  error?: string
}

export default class LLMService {
  private config: LLMConfig

  constructor() {
    this.config = getLLMConfig()
  }

  /**
   * 发送聊天请求到LLM
   */
  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      return { success: false, content: '', error: 'LLM API Key未配置' }
    }

    try {
      switch (this.config.provider) {
        case 'qianwen':
          return await this.callQianwen(messages)
        case 'doubao':
          return await this.callDoubao(messages)
        default:
          return await this.callCustom(messages)
      }
    } catch (e) {
      return { success: false, content: '', error: `LLM请求失败: ${e}` }
    }
  }

  /**
   * 调用通义千问API
   */
  private async callQianwen(messages: LLMMessage[]): Promise<LLMResponse> {
    const httpClient = http.createHttp()
    try {
      const response = await httpClient.request({
        url: `${this.config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1'}/services/aigc/text-generation/generation`,
        method: http.RequestMethod.POST,
        extraData: JSON.stringify({
          model: this.config.model || 'qwen-turbo',
          input: { messages },
          parameters: { result_format: 'message' }
        }),
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        }
      })

      const data = JSON.parse(response.result as string)
      const content = data?.output?.choices?.[0]?.message?.content || ''
      return { success: true, content }
    } finally {
      httpClient.destroy()
    }
  }

  /**
   * 调用豆包API
   */
  private async callDoubao(messages: LLMMessage[]): Promise<LLMResponse> {
    const httpClient = http.createHttp()
    try {
      const response = await httpClient.request({
        url: `${this.config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3'}/chat/completions`,
        method: http.RequestMethod.POST,
        extraData: JSON.stringify({
          model: this.config.model || 'doubao-pro-4k',
          messages
        }),
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        }
      })

      const data = JSON.parse(response.result as string)
      const content = data?.choices?.[0]?.message?.content || ''
      return { success: true, content }
    } finally {
      httpClient.destroy()
    }
  }

  /**
   * 调用自定义API
   */
  private async callCustom(messages: LLMMessage[]): Promise<LLMResponse> {
    if (!this.config.baseUrl) {
      return { success: false, content: '', error: '自定义API未配置baseUrl' }
    }

    const httpClient = http.createHttp()
    try {
      const response = await httpClient.request({
        url: `${this.config.baseUrl}/chat/completions`,
        method: http.RequestMethod.POST,
        extraData: JSON.stringify({
          model: this.config.model,
          messages
        }),
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        }
      })

      const data = JSON.parse(response.result as string)
      const content = data?.choices?.[0]?.message?.content || ''
      return { success: true, content }
    } finally {
      httpClient.destroy()
    }
  }
}
