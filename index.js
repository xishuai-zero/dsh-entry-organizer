/**
 * dsh-entry-organizer — host half.
 *
 * 这个插件的全部逻辑都在浏览器半身（client.js）：顺序、搬移、启动器标签、
 * 返回入口都由 slot 契约 + DOM 完成，host 侧没有需要持久化的服务端状态
 * （顺序与搬移集合存 localStorage），因此这里只保留一个合法的 cordis
 * 插件入口，让 cordis.patch.yml 里的裸包名可解析、可热加载。
 */

export const name = 'dsh-entry-organizer';

export function apply(ctx) {
  try {
    ctx.logger?.debug?.('dsh-entry-organizer: browser half owns the arrangement UI');
  } catch {
    // logging must never break the plugin
  }
}
