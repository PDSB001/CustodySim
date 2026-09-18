/**
 * 位置上报的**服务端规定范围**。
 *
 * 上报间隔由 App 侧自行设置（兼顾电量与精度），但必须落在下面的区间内。
 * 服务端的各项限制全部从这里推导，因此三者自洽：
 * **只要客户端遵守最小间隔，就永远碰不到每日上限。**
 * App 启动时应通过 `GET /api/mobile/location/config` 拉取本策略，
 * 不要把这些数字硬编码在客户端。
 */

/** 允许的最快上报间隔（下限）。1 分钟 × 72 小时保留期已足够精确画轨迹。 */
export const LOCATION_MIN_INTERVAL_SECONDS = 60

/** 允许的最慢上报间隔（上限）。 */
export const LOCATION_MAX_INTERVAL_SECONDS = 60 * 60

/**
 * 单批最多点数。
 * 取「滞后窗口 ÷ 最小间隔」的一半，允许客户端为省电合并几次上报一起提交；
 * 超出时应自行分片，而不是扩大这个上限。
 */
export const LOCATION_MAX_POINTS_PER_BATCH = 180

/** 可接受的滞后：覆盖一个工作班次加离线重试，同时不给"补造历史"留口子。 */
export const LOCATION_MAX_REPORT_AGE_MS = 6 * 60 * 60 * 1000

/** 最新点允许的前置偏差（设备时钟略快）。 */
export const LOCATION_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

/** 近 24 小时点数上限：按最小间隔跑满一天再加 10% 余量。 */
export const LOCATION_MAX_POINTS_PER_DAY = Math.ceil(
  ((24 * 60 * 60) / LOCATION_MIN_INTERVAL_SECONDS) * 1.1,
)

/** 供客户端读取的策略描述。`retentionHours` 由调用方按隐私保留期传入。 */
export function describeLocationReportingPolicy(retentionHours: number) {
  return {
    minIntervalSeconds: LOCATION_MIN_INTERVAL_SECONDS,
    maxIntervalSeconds: LOCATION_MAX_INTERVAL_SECONDS,
    maxPointsPerBatch: LOCATION_MAX_POINTS_PER_BATCH,
    maxPointsPerDay: LOCATION_MAX_POINTS_PER_DAY,
    maxReportAgeSeconds: LOCATION_MAX_REPORT_AGE_MS / 1000,
    maxFutureSkewSeconds: LOCATION_MAX_FUTURE_SKEW_MS / 1000,
    retentionHours,
  }
}
