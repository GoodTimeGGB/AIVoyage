/**
 * 实时交通服务
 * 调用高德交通态势API获取路况信息
 */
import http from '@ohos.net.http'
import { getAmapKey } from '../config/AppConfig'

export interface TrafficStatus {
  status: 'smooth' | 'slow' | 'congested' | 'blocked' | 'unknown'
  statusText: string
  expedite: number  // 畅通占比
  congested: number // 拥堵占比
  blocked: number   // 严重拥堵占比
  description: string
}

export interface RoadTraffic {
  name: string
  status: TrafficStatus['status']
  speed: number      // 平均速度 km/h
  direction: string  // 方向
  angle: number      // 道路方向角度
  lcodes: string     // 路段编码
}

export interface TrafficResult {
  success: boolean
  status?: TrafficStatus
  roads?: RoadTraffic[]
  error?: string
  updateTime?: string
}

export interface TrafficEvent {
  id: string
  type: 'accident' | 'construction' | 'control' | 'fog' | 'other'
  typeText: string
  description: string
  startTime: string
  endTime?: string
  location: { lng: number; lat: number }
  roadName: string
  impact: 'minor' | 'moderate' | 'severe'
}

export default class TrafficService {
  private readonly TRAFFIC_BASE_URL = 'https://restapi.amap.com/v3/traffic/status'

  /**
   * 获取矩形区域的交通态势
   */
  async getTrafficByRectangle(
    minLng: number, minLat: number, 
    maxLng: number, maxLat: number
  ): Promise<TrafficResult> {
    const key = getAmapKey()
    if (!key) {
      return { success: false, error: '高德API Key未配置' }
    }

    const rectangle = `${minLng},${minLat};${maxLng},${maxLat}`
    const httpClient = http.createHttp()

    try {
      const response = await httpClient.request({
        url: `${this.TRAFFIC_BASE_URL}/rectangle?rectangle=${rectangle}&key=${key}`,
        method: http.RequestMethod.GET
      })

      const data = JSON.parse(response.result as string)
      if (data.status !== '1') {
        return { success: false, error: data.info || '获取路况失败' }
      }

      const trafficInfo = data.trafficinfo || {}
      const evaluation = trafficInfo.evaluation || {}

      const status: TrafficStatus = {
        status: this.parseTrafficStatus(evaluation.status),
        statusText: this.getStatusText(evaluation.status),
        expedite: parseFloat(evaluation.expedite) || 0,
        congested: parseFloat(evaluation.congested) || 0,
        blocked: parseFloat(evaluation.blocked) || 0,
        description: trafficInfo.description || ''
      }

      const roads: RoadTraffic[] = (trafficInfo.roads || []).map((road: any) => ({
        name: road.name || '',
        status: this.parseTrafficStatus(road.status),
        speed: parseFloat(road.speed) || 0,
        direction: road.direction || '',
        angle: parseFloat(road.angle) || 0,
        lcodes: road.lcodes || ''
      }))

      return {
        success: true,
        status,
        roads,
        updateTime: new Date().toISOString()
      }
    } catch (e) {
      return { success: false, error: `路况请求失败: ${e}` }
    } finally {
      httpClient.destroy()
    }
  }

  /**
   * 获取道路的交通态势
   */
  async getTrafficByRoad(roadName: string, cityCode: string): Promise<TrafficResult> {
    const key = getAmapKey()
    if (!key) {
      return { success: false, error: '高德API Key未配置' }
    }

    const httpClient = http.createHttp()

    try {
      const response = await httpClient.request({
        url: `${this.TRAFFIC_BASE_URL}/road?name=${encodeURIComponent(roadName)}&adcode=${cityCode}&key=${key}`,
        method: http.RequestMethod.GET
      })

      const data = JSON.parse(response.result as string)
      if (data.status !== '1') {
        return { success: false, error: data.info || '获取道路路况失败' }
      }

      const trafficInfo = data.trafficinfo || {}
      const evaluation = trafficInfo.evaluation || {}

      const status: TrafficStatus = {
        status: this.parseTrafficStatus(evaluation.status),
        statusText: this.getStatusText(evaluation.status),
        expedite: parseFloat(evaluation.expedite) || 0,
        congested: parseFloat(evaluation.congested) || 0,
        blocked: parseFloat(evaluation.blocked) || 0,
        description: trafficInfo.description || `${roadName}当前路况：${this.getStatusText(evaluation.status)}`
      }

      return {
        success: true,
        status,
        updateTime: new Date().toISOString()
      }
    } catch (e) {
      return { success: false, error: `道路路况请求失败: ${e}` }
    } finally {
      httpClient.destroy()
    }
  }

  /**
   * 评估路径的交通拥堵程度
   * 根据路径点获取沿途交通状况
   */
  async evaluateRouteTraffic(
    points: Array<{ lng: number; lat: number }>
  ): Promise<{ avgStatus: string; congestionRate: number; tips: string }> {
    if (points.length < 2) {
      return { avgStatus: 'unknown', congestionRate: 0, tips: '路径点不足' }
    }

    // 计算路径的边界矩形
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

    // 适当扩大边界
    const padding = 0.01
    minLng -= padding
    maxLng += padding
    minLat -= padding
    maxLat += padding

    const result = await this.getTrafficByRectangle(minLng, minLat, maxLng, maxLat)

    if (!result.success || !result.status) {
      return { avgStatus: 'unknown', congestionRate: 0, tips: '无法获取路况' }
    }

    const congestionRate = result.status.congested + result.status.blocked
    let tips = ''

    if (congestionRate > 50) {
      tips = '前方路段严重拥堵，建议绕行'
    } else if (congestionRate > 30) {
      tips = '前方有轻微拥堵，请耐心等待'
    } else {
      tips = '前方道路畅通'
    }

    return {
      avgStatus: result.status.statusText,
      congestionRate,
      tips
    }
  }

  /**
   * 解析路况状态码
   */
  private parseTrafficStatus(status: string | number): TrafficStatus['status'] {
    const s = String(status)
    switch (s) {
      case '1': return 'smooth'
      case '2': return 'slow'
      case '3': return 'congested'
      case '4': return 'blocked'
      default: return 'unknown'
    }
  }

  /**
   * 获取状态文本
   */
  private getStatusText(status: string | number): string {
    const s = String(status)
    switch (s) {
      case '1': return '畅通'
      case '2': return '缓行'
      case '3': return '拥堵'
      case '4': return '严重拥堵'
      default: return '未知'
    }
  }

  /**
   * 计算拥堵时间增量（分钟）
   */
  calculateDelayMinutes(
    originalDuration: number, // 原始预计时间（秒）
    congestionRate: number    // 拥堵率 0-100
  ): number {
    if (congestionRate <= 20) {
      return 0
    }
    
    // 拥堵率每增加10%，时间增加5%
    const delayFactor = (congestionRate - 20) * 0.005
    const delaySeconds = originalDuration * delayFactor
    return Math.round(delaySeconds / 60)
  }
}
