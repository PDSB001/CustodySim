/**
 * 首页标语（homeTitle/homeSubtitle/homeBanner）的默认值。
 *
 * 管理端配置表单与用户端首页读取的是同一份配置，默认值必须只有一处，
 * 否则「管理员在表单里看到的」与「用户实际看到的」会不一致。
 * `{name}` 由前端替换为当前用户姓名。
 */
export const UI_CONFIG_DEFAULTS: Record<
  string,
  { homeTitle: string; homeSubtitle: string; homeBanner: string }
> = {
  SUPERVISOR: {
    homeTitle: "{name}，当班执勤",
    homeSubtitle: "按班次批阅呈报、核准补点，核对点名记录，落实本班监管事项。",
    homeBanner: "",
  },
  SUPERVISED: {
    homeTitle: "{name}，监室日程",
    homeSubtitle: "按规定时间接受点名、完成指令任务，服从监室管理，留意监所公示与批阅意见。",
    homeBanner: "",
  },
}
