"use client"

import { MapPinned } from "lucide-react"
import { useEffect, useRef, useState } from "react"

type FenceMapData = {
  name: string
  latitude: number
  longitude: number
  radiusMeters: number
  boundaryPoints?: Array<{ latitude: number; longitude: number }>
}

type TencentMapEvent = {
  latLng: { getLat: () => number; getLng: () => number }
}

type TencentMapInstance = {
  on: (event: "click", callback: (event: TencentMapEvent) => void) => void
  destroy?: () => void
}

type TencentPolygonLayer = { setGeometries?: (geometries: Array<Record<string, unknown>>) => void; destroy?: () => void }

type TencentMapApi = {
  Map: new (
    element: HTMLElement,
    options: { center: unknown; zoom: number },
  ) => TencentMapInstance
  LatLng: new (latitude: number, longitude: number) => unknown
  MultiPolygon: new (options: Record<string, unknown>) => unknown
  PolygonStyle: new (options: Record<string, unknown>) => unknown
  CircleStyle: new (options: Record<string, unknown>) => unknown
  MultiMarker: new (options: Record<string, unknown>) => unknown
  MarkerStyle: new (options: Record<string, unknown>) => unknown
}

declare global {
  interface Window {
    TMap?: TencentMapApi
  }
}

let sdkPromise: Promise<TencentMapApi> | null = null

function loadTencentMapSdk(key: string) {
  if (window.TMap) return Promise.resolve(window.TMap)
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<TencentMapApi>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(key)}`
    script.async = true
    script.onload = () =>
      window.TMap
        ? resolve(window.TMap)
        : reject(new Error("腾讯地图 SDK 未正确加载"))
    script.onerror = () => reject(new Error("腾讯地图 SDK 加载失败"))
    document.head.appendChild(script)
  })
  return sdkPromise
}

export function TencentFenceMap({
  fence,
  editable = false,
  onPick,
}: {
  fence: FenceMapData
  editable?: boolean
  onPick?: (point: Pick<FenceMapData, "latitude" | "longitude">) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<TencentMapInstance | null>(null)
  const polygonRef = useRef<TencentPolygonLayer | null>(null)
  const markerRef = useRef<TencentPolygonLayer | null>(null)
  const apiRef = useRef<TencentMapApi | null>(null)
  const onPickRef = useRef(onPick)
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const key = process.env.NEXT_PUBLIC_TENCENT_MAP_KEY
  onPickRef.current = onPick

  useEffect(() => {
    if (!key || !container.current) {
      setState("unavailable")
      return
    }
    setErrorMessage(null)
    let map: TencentMapInstance | undefined
    let disposed = false
    void loadTencentMapSdk(key)
      .then((api) => {
        if (disposed || !container.current) return
        const center = new api.LatLng(fence.latitude, fence.longitude)
        map = new api.Map(container.current, {
          center,
          zoom: 16,
          dragEnable: true,
          scrollWheel: true,
        } as { center: unknown; zoom: number })
        setState("ready")
        mapRef.current = map
        apiRef.current = api
        if (editable && onPickRef.current) {
          try {
            map.on("click", (event) =>
              onPickRef.current?.({
                latitude: Number(event.latLng.getLat().toFixed(6)),
                longitude: Number(event.latLng.getLng().toFixed(6)),
              }),
            )
          } catch {
            // Some SDK builds expose a different event API; the base map remains usable.
          }
        }
      })
      .catch((error: unknown) => {
        console.error("[TencentFenceMap] SDK 初始化失败", error)
        setErrorMessage(error instanceof Error ? error.message : String(error))
        setState("unavailable")
      })
    return () => {
      disposed = true
      polygonRef.current?.destroy?.()
      polygonRef.current = null
      markerRef.current?.destroy?.()
      markerRef.current = null
      mapRef.current = null
      map?.destroy?.()
    }
  }, [
    editable,
    fence.latitude,
    fence.longitude,
    fence.radiusMeters,
    key,
  ])

  useEffect(() => {
    const api = apiRef.current
    const map = mapRef.current
    if (!api || !map) return
    const points = (fence.boundaryPoints ?? []).map(
      (point) => new api.LatLng(point.latitude, point.longitude),
    )
    try {
      const markerGeometries = points.map((position, index) => ({
        id: `electronic-fence-point-${index + 1}`,
        styleId: "point",
        position,
      }))
      if (!markerRef.current) {
        markerRef.current = new api.MultiMarker({
          map,
          styles: {
            point: new api.MarkerStyle({
              width: 25,
              height: 35,
              anchor: { x: 12, y: 35 },
              src: "https://mapapi.qq.com/web/lbs/javascriptGL/demo/img/markerDefault.png",
            }),
          },
          geometries: markerGeometries,
        }) as TencentPolygonLayer
      } else {
        markerRef.current.setGeometries?.(markerGeometries)
      }
      if (points.length < 3) {
        polygonRef.current?.setGeometries?.([])
        return
      }
      if (!polygonRef.current) {
        polygonRef.current = new api.MultiPolygon({
          map,
          styles: { fence: new api.PolygonStyle({ color: "rgba(37, 99, 235, 0.14)", showBorder: true, borderColor: "#2563eb", borderWidth: 2 }) },
          geometries: [{ id: "electronic-fence", styleId: "fence", paths: [points] }],
        }) as TencentPolygonLayer
        return
      }
      polygonRef.current.setGeometries?.(
        [{ id: "electronic-fence", styleId: "fence", paths: [points] }],
      )
    } catch (error) {
      console.error("[TencentFenceMap] 多边形图层初始化失败", error)
    }
  }, [fence.boundaryPoints])

  return (
    <div className="relative min-h-64 overflow-hidden rounded-lg border bg-sky-50">
      <div ref={container} className="absolute inset-0" />
      {state !== "ready" && !key ? (
        <div className="absolute inset-0 grid place-items-center bg-sky-50/95 p-6 text-center">
          <div>
            <MapPinned className="text-brand-600 mx-auto mb-3 size-7" />
            <p className="text-sm font-semibold">电子围栏坐标</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {fence.boundaryPoints && fence.boundaryPoints.length >= 3
                ? `多边形 ${fence.boundaryPoints.length} 个点`
                : `${fence.latitude.toFixed(6)}, ${fence.longitude.toFixed(6)} · 半径 ${fence.radiusMeters} 米`}
            </p>
            <p className="text-muted-foreground mt-3 max-w-sm text-xs leading-5">
              {key
                ? "腾讯地图暂不可用，仍可通过坐标维护围栏。"
                : "配置 NEXT_PUBLIC_TENCENT_MAP_KEY 后，这里将使用腾讯地图 SDK 展示和选点。"}
            </p>
          </div>
        </div>
      ) : null}
      {state !== "ready" && key ? (
        <div className="absolute inset-x-3 top-3 rounded bg-white/90 px-3 py-2 text-center text-xs shadow-sm">
          地图初始化失败：{errorMessage ?? "未知错误"}
        </div>
      ) : null}
      {editable && state === "ready" ? (
        <p className="bg-background/90 text-muted-foreground absolute right-3 bottom-3 rounded px-2.5 py-1.5 text-xs shadow-sm">
          点击地图添加边界点（至少 3 个点）
        </p>
      ) : null}
    </div>
  )
}
