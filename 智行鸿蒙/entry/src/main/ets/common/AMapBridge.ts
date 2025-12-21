/**
 * 高德地图桥接层
 * 提供地图初始化、路线绘制、POI标注、路况图层等能力
 */
import { getAmapKey } from '../config/AppConfig'
import { POIInfo } from '../service/POIService'

export interface MapMarker {
  id: string
  position: { lng: number; lat: number }
  title?: string
  icon?: string
  type?: 'origin' | 'destination' | 'waypoint' | 'poi'
}

export interface RouteOverlay {
  id: string
  points: Array<{ lng: number; lat: number }>
  color?: string
  width?: number
  isSelected?: boolean
}

export default class AMapBridge {
  private static surfaceId: string = ''
  private static markers: Map<string, MapMarker> = new Map()
  private static routes: Map<string, RouteOverlay> = new Map()
  private static trafficEnabled: boolean = false

  /**
   * 初始化地图
   */
  static init(surfaceId: string) {
    const g: any = globalThis as any
    const fn = g.__amap_init
    const key = getAmapKey()
    if (typeof fn === 'function') {
      fn(surfaceId, key)
    }
    AMapBridge.surfaceId = surfaceId
  }

  /**
   * 绘制路线
   */
  static drawRoute(points: Array<{ lng: number; lat: number }>, options?: {
    id?: string
    color?: string
    width?: number
    isSelected?: boolean
  }): string {
    const g: any = globalThis as any
    const fn = g.__amap_drawPolyline
    const routeId = options?.id || `route_${Date.now()}`

    if (typeof fn === 'function' && points && points.length > 0) {
      fn(points, {
        color: options?.color || '#3366FF',
        width: options?.width || 8,
        isSelected: options?.isSelected ?? true
      })
    }

    AMapBridge.routes.set(routeId, {
      id: routeId,
      points,
      color: options?.color || '#3366FF',
      width: options?.width || 8,
      isSelected: options?.isSelected ?? true
    })

    return routeId
  }

  /**
   * 绘制多条路线（备选路线）
   */
  static drawMultipleRoutes(routes: Array<{
    id: string
    points: Array<{ lng: number; lat: number }>
    isRecommended?: boolean
  }>): void {
    const g: any = globalThis as any
    const fn = g.__amap_drawMultiPolylines

    if (typeof fn === 'function') {
      fn(routes.map(r => ({
        ...r,
        color: r.isRecommended ? '#3366FF' : '#999999',
        width: r.isRecommended ? 8 : 5
      })))
    }

    // 保存路线信息
    for (const route of routes) {
      AMapBridge.routes.set(route.id, {
        id: route.id,
        points: route.points,
        color: route.isRecommended ? '#3366FF' : '#999999',
        width: route.isRecommended ? 8 : 5,
        isSelected: route.isRecommended
      })
    }
  }

  /**
   * 清除路线
   */
  static clearRoute(routeId?: string): void {
    const g: any = globalThis as any
    const fn = g.__amap_clearPolyline

    if (typeof fn === 'function') {
      fn(routeId)
    }

    if (routeId) {
      AMapBridge.routes.delete(routeId)
    } else {
      AMapBridge.routes.clear()
    }
  }

  /**
   * 添加标记点
   */
  static addMarker(marker: MapMarker): void {
    const g: any = globalThis as any
    const fn = g.__amap_addMarker

    if (typeof fn === 'function') {
      fn(marker)
    }

    AMapBridge.markers.set(marker.id, marker)
  }

  /**
   * 添加起终点标记
   */
  static addOriginDestinationMarkers(
    origin: { lng: number; lat: number; title?: string },
    destination: { lng: number; lat: number; title?: string }
  ): void {
    AMapBridge.addMarker({
      id: 'origin',
      position: origin,
      title: origin.title || '起点',
      type: 'origin'
    })

    AMapBridge.addMarker({
      id: 'destination',
      position: destination,
      title: destination.title || '终点',
      type: 'destination'
    })
  }

  /**
   * 添加POI标记
   */
  static addPOIMarkers(pois: POIInfo[]): void {
    const g: any = globalThis as any
    const fn = g.__amap_addMarkers

    const markers = pois.map(poi => ({
      id: `poi_${poi.id}`,
      position: poi.location,
      title: poi.name,
      type: 'poi' as const,
      data: poi
    }))

    if (typeof fn === 'function') {
      fn(markers)
    }

    for (const marker of markers) {
      AMapBridge.markers.set(marker.id, marker)
    }
  }

  /**
   * 清除标记
   */
  static clearMarkers(type?: MapMarker['type']): void {
    const g: any = globalThis as any
    const fn = g.__amap_clearMarkers

    if (typeof fn === 'function') {
      fn(type)
    }

    if (type) {
      for (const [id, marker] of AMapBridge.markers) {
        if (marker.type === type) {
          AMapBridge.markers.delete(id)
        }
      }
    } else {
      AMapBridge.markers.clear()
    }
  }

  /**
   * 开启/关闭路况图层
   */
  static setTrafficLayer(enabled: boolean): void {
    const g: any = globalThis as any
    const fn = g.__amap_setTrafficLayer

    if (typeof fn === 'function') {
      fn(enabled)
    }

    AMapBridge.trafficEnabled = enabled
  }

  /**
   * 获取路况图层状态
   */
  static isTrafficEnabled(): boolean {
    return AMapBridge.trafficEnabled
  }

  /**
   * 移动地图中心
   */
  static moveToCenter(position: { lng: number; lat: number }, zoom?: number): void {
    const g: any = globalThis as any
    const fn = g.__amap_setCenter

    if (typeof fn === 'function') {
      fn(position, zoom || 15)
    }
  }

  /**
   * 调整视野以包含所有点
   */
  static fitBounds(points: Array<{ lng: number; lat: number }>, padding?: number): void {
    const g: any = globalThis as any
    const fn = g.__amap_fitBounds

    if (typeof fn === 'function' && points.length > 0) {
      fn(points, padding || 50)
    }
  }

  /**
   * 显示信息窗
   */
  static showInfoWindow(position: { lng: number; lat: number }, content: string): void {
    const g: any = globalThis as any
    const fn = g.__amap_showInfoWindow

    if (typeof fn === 'function') {
      fn(position, content)
    }
  }

  /**
   * 关闭信息窗
   */
  static hideInfoWindow(): void {
    const g: any = globalThis as any
    const fn = g.__amap_hideInfoWindow

    if (typeof fn === 'function') {
      fn()
    }
  }

  /**
   * 获取当前位置
   */
  static getCurrentLocation(): Promise<{ lng: number; lat: number } | null> {
    return new Promise((resolve) => {
      const g: any = globalThis as any
      const fn = g.__amap_getCurrentLocation

      if (typeof fn === 'function') {
        fn((location: { lng: number; lat: number } | null) => {
          resolve(location)
        })
      } else {
        // 模拟位置（北京天安门）
        resolve({ lng: 116.397, lat: 39.908 })
      }
    })
  }

  /**
   * 启动导航模式
   */
  static startNavigation(routePoints: Array<{ lng: number; lat: number }>): void {
    const g: any = globalThis as any
    const fn = g.__amap_startNavigation

    if (typeof fn === 'function') {
      fn(routePoints)
    }
  }

  /**
   * 停止导航
   */
  static stopNavigation(): void {
    const g: any = globalThis as any
    const fn = g.__amap_stopNavigation

    if (typeof fn === 'function') {
      fn()
    }
  }

  /**
   * 设置地图样式
   */
  static setMapStyle(style: 'normal' | 'dark' | 'satellite'): void {
    const g: any = globalThis as any
    const fn = g.__amap_setMapStyle

    if (typeof fn === 'function') {
      fn(style)
    }
  }

  /**
   * 清除所有覆盖物
   */
  static clearAll(): void {
    AMapBridge.clearRoute()
    AMapBridge.clearMarkers()
    AMapBridge.hideInfoWindow()
  }
}
