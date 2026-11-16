/* ============================================================
 *  CloudBase 配置 —— 只需要改这两行
 * ------------------------------------------------------------
 *  1) envId     : 云开发环境 ID，形如 tcb-xxxxxxxxxxxxx
 *                 位置：CloudBase 控制台 → 概览 → 环境 ID
 *  2) accessKey : Publishable Key（相当于 Supabase 的 anon key）
 *                 位置：CloudBase 控制台 → 环境 → API Key 配置 → 新建
 *  3) region    : 环境所在地域
 *                 ap-shanghai（上海，默认）/ ap-guangzhou（广州）/ ap-singapore
 *                 ⚠️ 建环境时选的哪个地域，这里就填哪个，填错会连不上
 *
 *  改完保存即可，不需要重新部署代码以外的东西。
 *  这两个值会出现在公开仓库里，属于正常情况：
 *  Publishable Key 本来就是给前端用的，安全边界靠数据库 RLS 策略。
 * ============================================================ */

window.CLOUDBASE_CONFIG = {
  envId: "your-env-id",              // ← 改成你的环境 ID
  accessKey: "your-publishable-key", // ← 改成你的 Publishable Key
  region: "ap-shanghai"              // ← 改成你的环境地域
};
