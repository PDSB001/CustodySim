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
    homeSubtitle: "先批阅任务与补卡，再核对点名记录，落实本班监管事项。",
    homeBanner: "",
  },
  SUPERVISED: {
    homeTitle: "{name}，监室日程",
    homeSubtitle: "按时点名，完成指定任务；留意批阅意见与监所通知。",
    homeBanner: "",
  },
}
