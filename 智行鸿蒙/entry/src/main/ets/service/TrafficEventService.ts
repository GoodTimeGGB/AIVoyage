/**
 * 交通事件服务
 * 实时监听路况事件，提供预警和动态重规划能力
 */
import http from '@ohos.net.http'
import { getAmapKey } from '../config/AppConfig'
import emitter from '@ohos.events.emitter'

export interface TrafficEvent {
  id: string
  type: 'accident' | 'construction' | 'control' | 'congestion' | 'fog' | 'rain' | 'other'
  typeText: string
  description: string
  startTime: string
  endTime?: string
  location: { lng: number; lat: number }
  roadName: string
  impact: 'minor' | 'moderate' | 'severe'
  delayMinutes?: number
}

export interface TrafficAlert {
  event: TrafficEvent
  affectsRoute: boolean
  alternativeAvailable: boolean
  suggestion: string
  timestamp: number
}

// 事件类型枚举
const EVENT_TYPE_MAP: Record<string, TrafficEvent['type']> = {
  '1': 'accident',
  '2': 'construction',
  '3': 'control',
  '4': 'congestion',
  '5': 'fog',
  '6': 'rain',
  '0': 'other'
}

const EVENT_TYPE_TEXT: Record<TrafficEvent['type'], string> = {
  accident: '交通事故',
  construction: '道路施工',
  control: '交通管制',
  congestion: '道路拥堵',
  fog: '大雾天气',
  rain: '雨雪天气',
  other: '其他事件'
}

// 事件通知ID
export const TRAFFIC_EVENT_ID = 10001

export default class TrafficEventService {
  private isMonitoring: boolean = false
  private monitorTimer: number = 0
  private currentRoute: Array<{ lng: number; lat: number }> = []
  private lastEvents: Map<string, TrafficEvent> = new Map()
  private alertCallbacks: Array<(alert: TrafficAlert) => void> = []

  /**
   * 开始监听路况事件
   */
  startMonitoring(routePoints: Array<{ lng: number; lat: number }>, intervalMs: number = 30000): void {
    this.currentRoute = routePoints
    this.isMonitoring = true

    // 立即执行一次检查
    this.checkTrafficEvents()

    // 定时轮询
    this.monitorTimer = setInterval(() => {
      if (this.isMonitoring) {
        this.checkTrafficEvents()
      }
    }, intervalMs) as unknown as number
  }

  /**
   * 停止监听
   */
  stopMonitoring(): void {
    this.isMonitoring = false
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer)
      this.monitorTimer = 0
    }
    this.currentRoute = []
    this.lastEvents.clear()
  }

  /**
   * 更新监听的路线
   */
  updateRoute(routePoints: Array<{ lng: number; lat: number }>): void {
    this.currentRoute = routePoints
  }

  /**
   * 注册预警回调
   */
  onAlert(callback: (alert: TrafficAlert) => void): void {
    this.alertCallbacks.push(callback)
  }

  /**
   * 移除预警回调
   */
  offAlert(callback: (alert: TrafficAlert) => void): void {
    const index = this.alertCallbacks.indexOf(callback)
    if (index > -1) {
      this.alertCallbacks.splice(index, 1)
    }
  }

  /**
   * 检查路况事件
   */
  private async checkTrafficEvents(): Promise<void> {
    if (this.currentRoute.length < 2) return

    const key = getAmapKey()
    if (!key) return

    try {
      // 计算路线边界
      const bounds = this.calculateBounds(this.currentRoute)
      
      // 查询区域内的交通事件
      const events = await this.fetchTrafficEvents(bounds, key)

      // 检查新事件
      for (const event of events) {
        const isNew = !this.lastEvents.has(event.id)
        const affectsRoute = this.checkEventAffectsRoute(event)

        if (isNew && affectsRoute) {
          const alert = this.createAlert(event)
          this.notifyAlert(alert)
        }

        this.lastEvents.set(event.id, event)
      }

      // 清理过期事件
      const currentIds = new Set(events.map(e => e.id))
      for (const [id] of this.lastEvents) {
        if (!currentIds.has(id)) {
          this.lastEvents.delete(id)
        }
      }
    } catch (e) {
      console.error(`检查路况事件失败: ${e}`)
    }
  }

  /**
   * 获取交通事件
   */
  private async fetchTrafficEvents(
    bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number },
    key: string
  ): Promise<TrafficEvent[]> {
    const httpClient = http.createHttp()

    try {
      // 使用高德交通态势API获取路况信息
      const rectangle = `${bounds.minLng},${bounds.minLat};${bounds.maxLng},${bounds.maxLat}`
      const response = await httpClient.request({
        url: `https://restapi.amap.com/v3/traffic/status/rectangle?rectangle=${rectangle}&key=${key}&extensions=all`,
        method: http.RequestMethod.GET
      })

      const data = JSON.parse(response.result as string)
      const events: TrafficEvent[] = []

      // 解析拥堵路段作为事件
      const roads = data?.trafficinfo?.roads || []
      for (const road of roads) {
        const status = parseInt(road.status || '0')
        // 只关注拥堵和严重拥堵
        if (status >= 3) {
          const [lng, lat] = (road.polyline || '').split(';')[0]?.split(',').map(parseFloat) || [0, 0]
          
          events.push({
            id: `congestion_${road.lcodes || Date.now()}`,
            type: 'congestion',
            typeText: status === 4 ? '严重拥堵' : '拥堵',
            description: `${road.name || '未知道路'}${status === 4 ? '严重拥堵' : '拥堵'}`,
            startTime: new Date().toISOString(),
            location: { lng: lng || 0, lat: lat || 0 },
            roadName: road.name || '未知道路',
            impact: status === 4 ? 'severe' : 'moderate',
            delayMinutes: status === 4 ? 20 : 10
          })
        }
      }

      return events
    } finally {
      httpClient.destroy()
    }
  }

  /**
   * 计算路线边界
   */
  private calculateBounds(points: Array<{ lng: number; lat: number }>): {
    minLng: number; minLat: number; maxLng: number; maxLat: number
  } {
    let minLng = points[0].lng
    let maxLng = points[0].lng
    let minLat = points[0].lat
    let maxLat = points[0].lat

    for (const p of points) {
      minLng = Math.min(minLng, p.lng)
      maxLng = Math.max(maxLng, p.lng)
      minLat = Math.min(minLat, p.lat)
      maxLat = Math.max(maxLat, p.lat)
    }

    // 扩大边界范围
    const padding = 0.02
    return {
      minLng: minLng - padding,
      minLat: minLat - padding,
      maxLng: maxLng + padding,
      maxLat: maxLat + padding
    }
  }

  /**
   * 检查事件是否影响当前路线
   */
  private checkEventAffectsRoute(event: TrafficEvent): boolean {
    if (!event.location || this.currentRoute.length === 0) return false

    // 计算事件位置到路线的最近距离
    const minDistance = this.calculateMinDistanceToRoute(event.location)
    
    // 500米以内认为影响路线
    return minDistance < 500
  }

  /**
   * 计算点到路线的最近距离
   */
  private calculateMinDistanceToRoute(point: { lng: number; lat: number }): number {
    let minDist = Infinity

    for (let i = 0; i < this.currentRoute.length - 1; i++) {
      const dist = this.pointToSegmentDistance(
        point,
        this.currentRoute[i],
        this.currentRoute[i + 1]
      )
      minDist = Math.min(minDist, dist)
    }

    return minDist
  }

  /**
   * 点到线段的距离（米）
   */
  private pointToSegmentDistance(
    point: { lng: number; lat: number },
    segStart: { lng: number; lat: number },
    segEnd: { lng: number; lat: number }
  ): number {
    const R = 6371000 // 地球半径（米）

    // 简化计算：使用欧几里得距离的近似
    const toRad = (deg: number) => deg * Math.PI / 180
    const avgLat = (segStart.lat + segEnd.lat) / 2

    const dx = (point.lng - segStart.lng) * Math.cos(toRad(avgLat))
    const dy = point.lat - segStart.lat

    const sx = (segEnd.lng - segStart.lng) * Math.cos(toRad(avgLat))
    const sy = segEnd.lat - segStart.lat

    const t = Math.max(0, Math.min(1, (dx * sx + dy * sy) / (sx * sx + sy * sy)))

    const closestX = segStart.lng + t * (segEnd.lng - segStart.lng)
    const closestY = segStart.lat + t * (segEnd.lat - segStart.lat)

    const distLng = (point.lng - closestX) * Math.cos(toRad(avgLat))
    const distLat = point.lat - closestY

    return Math.sqrt(distLng * distLng + distLat * distLat) * R * Math.PI / 180
  }

  /**
   * 创建预警
   */
  private createAlert(event: TrafficEvent): TrafficAlert {
    let suggestion = ''
    
    switch (event.type) {
      case 'accident':
        suggestion = `前方${event.roadName}发生交通事故，预计延误${event.delayMinutes || 15}分钟，建议绕行`
        break
      case 'construction':
        suggestion = `前方${event.roadName}道路施工，建议选择其他路线`
        break
      case 'congestion':
        suggestion = `前方${event.roadName}${event.typeText}，预计延误${event.delayMinutes || 10}分钟`
        break
      case 'control':
        suggestion = `前方${event.roadName}交通管制，请注意绕行`
        break
      default:
        suggestion = `前方路段有${event.typeText}，请注意安全`
    }

    return {
      event,
      affectsRoute: true,
      alternativeAvailable: true,
      suggestion,
      timestamp: Date.now()
    }
  }

  /**
   * 通知预警
   */
  private notifyAlert(alert: TrafficAlert): void {
    // 调用回调
    for (const callback of this.alertCallbacks) {
      try {
        callback(alert)
      } catch (e) {
        console.error(`预警回调执行失败: ${e}`)
      }
    }

    // 发送系统事件
    try {
      emitter.emit({
        eventId: TRAFFIC_EVENT_ID,
        priority: emitter.EventPriority.HIGH
      }, {
        data: {
          type: 'traffic_alert',
          alert: JSON.stringify(alert)
        }
      })
    } catch (e) {
      console.error(`发送事件失败: ${e}`)
    }

    console.info(`路况预警: ${alert.suggestion}`)
  }

  /**
   * 获取当前活跃事件
   */
  getActiveEvents(): TrafficEvent[] {
    return Array.from(this.lastEvents.values())
  }

  /**
   * 检查是否有严重事件
   */
  hasSevereEvents(): boolean {
    for (const event of this.lastEvents.values()) {
      if (event.impact === 'severe') {
        return true
      }
    }
    return false
  }
}
