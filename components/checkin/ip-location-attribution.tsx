export function IpLocationAttribution() {
  return (
    <details className="text-muted-foreground text-xs">
      <summary className="cursor-pointer">IP 定位说明</summary>
      <p className="mt-1 leading-relaxed">
        IP 位置为城市级粗略定位，可能与实际所在地有偏差。数据来自
        Merged-IP，包含{" "}
        <a
          className="underline underline-offset-2"
          href="https://www.maxmind.com"
          target="_blank"
          rel="noreferrer"
        >
          GeoLite2 by MaxMind
        </a>
        {" 和 "}
        <a
          className="underline underline-offset-2"
          href="https://db-ip.com"
          target="_blank"
          rel="noreferrer"
        >
          IP Geolocation by DB-IP
        </a>
        。
      </p>
    </details>
  )
}
