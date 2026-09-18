"use client"

import { MapPinned } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { loadTencentMapSdk } from "@/components/electronic-fence/tencent-fence-map"

export type TrackPoint = {
  reportedAt: string | null
  latitude: number
  longitude: number
  accuracyMeters: number | null
  verdict: string | null
  transition: string | null
}

type Layer = { destroy?: () => void }

/** 轨迹折线 + 采样点。SDK 不可用时退回坐标列表，页面不会变成空白。 */
export function LocationTrackMap({ points }: { points: TrackPoint[] }) {
  const container = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  )
  const key = process.env.NEXT_PUBLIC_TENCENT_MAP_KEY

  useEffect(() => {
    if (!key || !container.current) {
      setState("unavailable")
      return
    }
    let map: Layer | undefined
    const layers: Layer[] = []
    let disposed = false
    setState("loading")
    void loadTencentMapSdk(key)
      .then((api) => {
        if (disposed || !container.current) return
        const first = points[0]
        const center = new api.LatLng(
          first?.latitude ?? 31.2304,
          first?.longitude ?? 121.4737,
        )
        map = new api.Map(container.current, { center, zoom: 15 }) as Layer
        if (points.length) {
          const paths = points.map(
            (point) => new api.LatLng(point.latitude, point.longitude),
          )
          layers.push(
            new api.MultiPolyline({
              map,
              styles: {
                track: new api.PolylineStyle({ color: "#0f766e", width: 4 }),
              },
              geometries: [{ id: "track", styleId: "track", paths }],
            }) as Layer,
          )
          layers.push(
            new api.MultiMarker({
              map,
              styles: {
                sample: new api.MarkerStyle({
                  width: 10,
                  height: 10,
                  anchor: { x: 5, y: 5 },
                  color: "#0f766e",
                }),
              },
              geometries: points.map((point, index) => ({
                id: `p${index}`,
                styleId: "sample",
                position: new api.LatLng(point.latitude, point.longitude),
              })),
            }) as Layer,
          )
        }
        setState("ready")
      })
      .catch(() => setState("unavailable"))
    return () => {
      disposed = true
      for (const layer of layers) layer.destroy?.()
      map?.destroy?.()
    }
  }, [key, points])

  if (state === "unavailable")
    return (
      <div className="border-border/70 bg-muted/20 flex flex-col items-center justify-center rounded-xl border px-4 py-10 text-center">
        <MapPinned className="text-muted-foreground size-6" />
        <p className="mt-3 text-sm font-medium">地图暂不可用</p>
        <p className="text-muted-foreground mt-2 max-w-sm text-xs leading-5">
          {key
            ? "腾讯地图未能加载，下方仍按时间顺序列出了采样点。"
            : "未配置 NEXT_PUBLIC_TENCENT_MAP_KEY，可通过下方采样点列表核对轨迹。"}
        </p>
      </div>
    )

  return (
    <div className="border-border/70 relative overflow-hidden rounded-xl border">
      <div ref={container} className="h-80 w-full" />
      {state === "loading" ? (
        <div className="bg-background/70 absolute inset-0 flex items-center justify-center text-xs">
          正在加载地图…
        </div>
      ) : null}
    </div>
  )
}
