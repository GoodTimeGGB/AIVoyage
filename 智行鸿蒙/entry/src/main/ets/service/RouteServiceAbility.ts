/**
 * 路线服务能力
 * 后台服务，负责动态监听环境变化、主动推送和动态重规划
 */
import ServiceAbility from '@ohos.app.ability.ServiceAbility'
import http from '@ohos.net.http'
import emitter from '@ohos.events.emitter'
import notification from '@ohos.notificationManager'
import { getAmapKey } from '../config/AppConfig'
import WeatherService, { WeatherInfo } from './WeatherService'
import TrafficEventService, { TrafficAlert, TRAFFIC_EVENT_ID } from './TrafficEventService'
import RoutePlanEngine from '../engine/RoutePlanEngine'

// 服务事件ID
export const ROUTE_SERVICE_EVENT_ID = 10002
export const WEATHER_CHANGE_EVENT_ID = 10003
export const REROUTE_EVENT_ID = 10004

export default class RouteServiceAbility extends ServiceAbility {
  private weatherTimer: number = 0
  private weatherService: WeatherService | null = null
  private trafficEventService: TrafficEventService | null = null
  private routeEngine: RoutePlanEngine | null = null
  private lastWeather: WeatherInfo | null = null
  private currentRoute: Array<{ lng: number; lat: number }> = []
  private currentDestination: string = ''
  private isNavigating: boolean = false

  onCreate() {
    console.info('RouteServiceAbility onCreate')
    
    this.weatherService = new WeatherService()
    this.trafficEventService = new TrafficEventService()
    this.routeEngine = new RoutePlanEngine()

    // 启动天气监控
    this.startWeatherMonitoring()

    // 注册路况事件回调
    this.trafficEventService.onAlert((alert) => {
      this.handleTrafficAlert(alert)
    })

    // 监听导航启动事件
    emitter.on({ eventId: ROUTE_SERVICE_EVENT_ID }, (eventData) => {
      this.handleServiceEvent(eventData)
    })
  }

  onDestroy() {
    console.info('RouteServiceAbility onDestroy')
    
    // 停止天气监控
    if (this.weatherTimer) {
      clearInterval(this.weatherTimer)
      this.weatherTimer = 0
    }

    // 停止路况监控
    this.trafficEventService?.stopMonitoring()

    // 取消事件监听
    emitter.off(ROUTE_SERVICE_EVENT_ID)
  }

  onStart(want) {
    console.info('RouteServiceAbility onStart')
    
    // 检查启动参数
    const action = want?.parameters?.action as string
    if (action === 'start_navigation') {
      const destination = want?.parameters?.destination as string
      const routePoints = want?.parameters?.routePoints as Array<{ lng: number; lat: number }>
      if (destination && routePoints) {
        this.startNavigation(destination, routePoints)
      }
    }
  }

  onBackground() {
    console.info('RouteServiceAbility onBackground')
  }

  /**
   * 启动天气监控
   */
  private startWeatherMonitoring(): void {
    // 立即检查一次
    this.checkWeather()

    // 每5分钟检查一次天气
    this.weatherTimer = setInterval(async () => {
      await this.checkWeather()
    }, 300000) as unknown as number
  }

  /**
   * 检查天气变化
   */
  private async checkWeather(): Promise<void> {
    const key = getAmapKey()
    if (!key || !this.weatherService) return

    try {
      // 默认使用北京城区编码，实际应用中应根据当前位置获取
      const result = await this.weatherService.getLiveWeather('110105')
      
      if (result.success && result.live) {
        const currentWeather = result.live
        
        // 检查天气是否发生重大变化
        if (this.lastWeather && this.isNavigating) {
          const changed = this.detectWeatherChange(this.lastWeather, currentWeather)
          if (changed) {
            await this.handleWeatherChange(currentWeather)
          }
        }

        this.lastWeather = currentWeather
        console.info(`天气更新: ${currentWeather.weather}, 温度: ${currentWeather.temperature}℃`)
      }
    } catch (e) {
      console.error(`天气检查失败: ${e}`)
    }
  }

  /**
   * 检测天气变化
   */
  private detectWeatherChange(oldWeather: WeatherInfo, newWeather: WeatherInfo): boolean {
    // 检查天气类型是否变化
    if (oldWeather.weather !== newWeather.weather) {
      // 检查是否变成恶劣天气
      const badWeathers = ['暴雨', '大雨', '大雪', '暴雪', '大雾', '浓雾']
      for (const bad of badWeathers) {
        if (newWeather.weather.includes(bad) && !oldWeather.weather.includes(bad)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * 处理天气变化
   */
  private async handleWeatherChange(weather: WeatherInfo): Promise<void> {
    const impact = this.weatherService!.evaluateWeatherImpact(weather)
    
    if (impact.impact >= 0.3) {
      // 发送通知
      await this.sendNotification(
        '天气变化提醒',
        `当前${weather.weather}，${impact.reason}，请注意行车安全`,
        'weather_alert'
      )

      // 发送事件
      emitter.emit({ eventId: WEATHER_CHANGE_EVENT_ID }, {
        data: {
          weather: JSON.stringify(weather),
          impact: JSON.stringify(impact)
        }
      })

      // 如果影响严重，建议重新规划
      if (impact.impact >= 0.5 && this.isNavigating) {
        await this.suggestReroute('天气恶化，建议重新规划路线')
      }
    }
  }

  /**
   * 处理路况预警
   */
  private async handleTrafficAlert(alert: TrafficAlert): Promise<void> {
    // 发送通知
    await this.sendNotification(
      '路况提醒',
      alert.suggestion,
      'traffic_alert'
    )

    // 如果影响严重，建议重新规划
    if (alert.event.impact === 'severe' && alert.alternativeAvailable) {
      await this.suggestReroute(alert.suggestion)
    }
  }

  /**
   * 建议重新规划路线
   */
  private async suggestReroute(reason: string): Promise<void> {
    if (!this.routeEngine || !this.currentDestination) return

    try {
      // 重新规划路线
      const newRoute = await this.routeEngine.planRoute({
        origin: '当前位置',
        destination: this.currentDestination,
        preferences: ['fastest'],
        considerTraffic: true,
        considerWeather: true
      })

      if (newRoute.routes.length > 0) {
        const bestRoute = newRoute.routes[0]
        const oldDuration = this.currentRoute.length > 0 ? 
          this.estimateDuration(this.currentRoute) : 0
        const newDuration = bestRoute.durationSeconds

        // 只有当新路线明显更优时才推荐
        if (oldDuration === 0 || newDuration < oldDuration * 0.8) {
          // 发送重规划事件
          emitter.emit({ eventId: REROUTE_EVENT_ID }, {
            data: {
              reason,
              newRoute: JSON.stringify(newRoute),
              timeSaved: Math.round((oldDuration - newDuration) / 60)
            }
          })

          const timeSavedMin = Math.round((oldDuration - newDuration) / 60)
          await this.sendNotification(
            '发现更优路线',
            `${reason}，已找到替代路线，可节省${timeSavedMin}分钟`,
            'reroute_suggestion'
          )
        }
      }
    } catch (e) {
      console.error(`重新规划失败: ${e}`)
    }
  }

  /**
   * 启动导航监控
   */
  startNavigation(destination: string, routePoints: Array<{ lng: number; lat: number }>): void {
    this.currentDestination = destination
    this.currentRoute = routePoints
    this.isNavigating = true

    // 启动路况事件监控
    this.trafficEventService?.startMonitoring(routePoints, 30000)

    console.info(`开始导航监控: ${destination}`)
  }

  /**
   * 停止导航监控
   */
  stopNavigation(): void {
    this.isNavigating = false
    this.currentRoute = []
    this.currentDestination = ''

    this.trafficEventService?.stopMonitoring()

    console.info('停止导航监控')
  }

  /**
   * 更新路线
   */
  updateRoute(routePoints: Array<{ lng: number; lat: number }>): void {
    this.currentRoute = routePoints
    this.trafficEventService?.updateRoute(routePoints)
  }

  /**
   * 处理服务事件
   */
  private handleServiceEvent(eventData: any): void {
    const action = eventData?.data?.action
    
    switch (action) {
      case 'start_navigation':
        const dest = eventData?.data?.destination
        const points = JSON.parse(eventData?.data?.routePoints || '[]')
        if (dest && points.length > 0) {
          this.startNavigation(dest, points)
        }
        break
      case 'stop_navigation':
        this.stopNavigation()
        break
      case 'update_route':
        const newPoints = JSON.parse(eventData?.data?.routePoints || '[]')
        if (newPoints.length > 0) {
          this.updateRoute(newPoints)
        }
        break
    }
  }

  /**
   * 发送通知
   */
  private async sendNotification(title: string, content: string, type: string): Promise<void> {
    try {
      const notificationRequest: notification.NotificationRequest = {
        id: Date.now() % 100000,
        content: {
          contentType: notification.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title,
            text: content
          }
        },
        slotType: notification.SlotType.SERVICE_INFORMATION
      }

      await notification.publish(notificationRequest)
      console.info(`通知已发送: ${title}`)
    } catch (e) {
      console.error(`发送通知失败: ${e}`)
    }
  }

  /**
   * 估算路线时间（简化计算）
   */
  private estimateDuration(points: Array<{ lng: number; lat: number }>): number {
    if (points.length < 2) return 0

    let totalDistance = 0
    for (let i = 0; i < points.length - 1; i++) {
      totalDistance += this.calculateDistance(points[i], points[i + 1])
    }

    // 假设平均车速40km/h
    return (totalDistance / 1000) / 40 * 3600
  }

  /**
   * 计算两点距离
   */
  private calculateDistance(p1: { lng: number; lat: number }, p2: { lng: number; lat: number }): number {
    const R = 6371000
    const dLat = (p2.lat - p1.lat) * Math.PI / 180
    const dLng = (p2.lng - p1.lng) * Math.PI / 180
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2)
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
}
