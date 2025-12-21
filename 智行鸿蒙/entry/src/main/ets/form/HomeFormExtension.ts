/**
 * 元服务卡片扩展
 * 处理卡片事件和数据更新
 */
import FormExtensionAbility from '@ohos.app.form.FormExtensionAbility'
import formBindingData from '@ohos.app.form.formBindingData'
import formProvider from '@ohos.app.form.formProvider'
import common from '@ohos.app.ability.common'
import RoutePlanEngine from '../engine/RoutePlanEngine'
import WeatherService from '../service/WeatherService'
import { getUserPreferences } from '../config/AppConfig'

export default class HomeFormExtension extends FormExtensionAbility {
  private updateTimer: number = 0
  private routeEngine: RoutePlanEngine | null = null
  private weatherService: WeatherService | null = null

  onCreate(want, callback) {
    console.info('HomeFormExtension onCreate')
    
    this.routeEngine = new RoutePlanEngine()
    this.weatherService = new WeatherService()

    // 返回初始卡片数据
    const formData = {
      formId: want?.parameters?.['ohos.extra.param.key.form_identity'],
      commuteStatus: '加载中...',
      commuteTime: '--',
      weather: '☀️',
      trafficColor: '#4CAF50'
    }

    const bindingData = formBindingData.createFormBindingData(formData)
    callback(bindingData)

    // 延迟加载实际数据
    setTimeout(() => {
      this.updateCardData(formData.formId)
    }, 1000)
  }

  onDestroy(formId: string) {
    console.info(`HomeFormExtension onDestroy: ${formId}`)
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = 0
    }
  }

  onEvent(formId: string, message: Record<string, unknown>) {
    const action = message?.['action'] as string
    console.info(`卡片事件: ${action}`)

    const ctx = this.context as common.FormExtensionContext

    switch (action) {
      case 'go_home':
        ctx.startAbility({
          bundleName: ctx.bundleName,
          abilityName: 'EntryAbility',
          parameters: { 
            action: 'navigate',
            destination: '家庭地址'
          }
        })
        break

      case 'go_work':
        ctx.startAbility({
          bundleName: ctx.bundleName,
          abilityName: 'EntryAbility',
          parameters: { 
            action: 'navigate',
            destination: '工作地址'
          }
        })
        break

      case 'search_nearby':
        ctx.startAbility({
          bundleName: ctx.bundleName,
          abilityName: 'EntryAbility',
          parameters: { 
            action: 'search_poi',
            keyword: '附近'
          }
        })
        break

      case 'view_commute':
        ctx.startAbility({
          bundleName: ctx.bundleName,
          abilityName: 'EntryAbility',
          parameters: { action: 'view_commute' }
        })
        break
    }
  }

  onUpdate(formId: string) {
    console.info(`卡片更新: ${formId}`)
    this.updateCardData(formId)
  }

  onCastToNormal(formId: string) {
    console.info(`卡片转为普通: ${formId}`)
  }

  onCastToForm(formId: string) {
    console.info(`卡片转为服务卡片: ${formId}`)
  }

  /**
   * 更新卡片数据
   */
  private async updateCardData(formId: string) {
    try {
      const prefs = getUserPreferences()
      let commuteStatus = '畅通'
      let commuteTime = '--'
      let trafficColor = '#4CAF50'
      let weather = '☀️'

      // 获取天气
      if (this.weatherService) {
        const weatherResult = await this.weatherService.getLiveWeather('110105')
        if (weatherResult.success && weatherResult.live) {
          weather = this.getWeatherEmoji(weatherResult.live.weather)
        }
      }

      // 获取通勤路况
      if (this.routeEngine && prefs.workAddress) {
        const routeResult = await this.routeEngine.planRoute({
          origin: prefs.homeAddress || '当前位置',
          destination: prefs.workAddress,
          mode: 'drive',
          considerTraffic: true
        })

        if (routeResult.routes.length > 0) {
          const route = routeResult.routes[0]
          const durMin = Math.round(route.durationSeconds / 60)
          commuteTime = `${durMin}分钟`

          // 根据路况设置状态
          if (route.trafficStatus) {
            commuteStatus = route.trafficStatus
            switch (route.trafficStatus) {
              case '畅通':
                trafficColor = '#4CAF50'
                break
              case '缓行':
                trafficColor = '#FF9800'
                break
              case '拥堵':
                trafficColor = '#f44336'
                break
              default:
                trafficColor = '#4CAF50'
            }
          }
        }
      }

      // 更新卡片
      const formData = {
        formId,
        commuteStatus,
        commuteTime,
        weather,
        trafficColor
      }

      const bindingData = formBindingData.createFormBindingData(formData)
      await formProvider.updateForm(formId, bindingData)
      console.info(`卡片数据已更新: ${JSON.stringify(formData)}`)
    } catch (e) {
      console.error(`更新卡片数据失败: ${e}`)
    }
  }

  /**
   * 获取天气Emoji
   */
  private getWeatherEmoji(weatherText: string): string {
    if (weatherText.includes('晴')) return '☀️'
    if (weatherText.includes('云')) return '⛅'
    if (weatherText.includes('阴')) return '☁️'
    if (weatherText.includes('雨')) return '🌧️'
    if (weatherText.includes('雪')) return '❄️'
    if (weatherText.includes('雾')) return '🌫️'
    return '☀️'
  }
}
