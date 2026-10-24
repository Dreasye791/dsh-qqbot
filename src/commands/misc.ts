/**
 * 杂项命令
 *
 * - /bot-ping /bot-version：QQBot 插件特有（连通性测试、版本信息）
 * - /stop：中止当前生成（对应底层 agent cancel，通用能力）
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { getScopePeer, PLUGIN_VERSION } from '../shared/index.ts';

/** /bot-ping — 测试当前 dsh 与 QQ 连接的网络延迟 */
export function pingCommand(): CategorizedCommand {
  return {
    name: 'bot-ping',
    category: 'qqbot',
    description: '测试当前 dsh 与 QQ 连接的网络延迟',
    usage: [
      '/bot-ping',
      '',
      '测试 dsh 主机与 QQ 服务器之间的网络延迟。',
      '返回网络传输耗时和插件处理耗时。',
    ].join('\n'),
    handler: (ctx) => {
      const now = Date.now();
      const ts = ctx.message.timestamp;
      const eventTime = ts ? new Date(ts).getTime() : NaN;
      if (Number.isNaN(eventTime)) {
        return '✅ pong!';
      }
      const totalMs = now - eventTime;
      const qqToPlugin = ctx.receivedAt - eventTime;
      const pluginProcess = now - ctx.receivedAt;
      return [
        '✅ pong！',
        `⏱ 延迟: ${totalMs}ms`,
        `  ├ 网络传输: ${qqToPlugin}ms`,
        `  └ 插件处理: ${pluginProcess}ms`,
      ].join('\n');
    },
  };
}

/**
 * /bot-id — 查看当前会话的 openid（配置白名单用）
 *
 * 官方 Bot API 不返回真实 QQ 号/群号，事件里只有 user_openid / group_openid，
 * 而这两者没有任何后台可查 —— 只能在会话内取。群聊场景下这条命令是最省事的方式：
 * 把模式设成 allowlist 之前先发一次 /bot-id，拿到值填进白名单。
 */
export function idCommand(): CategorizedCommand {
  return {
    name: 'bot-id',
    category: 'qqbot',
    description: '查看当前会话的 openid（配置白名单用）',
    usage: [
      '/bot-id',
      '',
      '显示当前会话的 scope、聊天标识（群 openid / 用户 openid）与你的 openid。',
      '官方 Bot API 不提供真实 QQ 号/群号，白名单只能用这里给出的 openid。',
      '备注可以写在白名单条目的竖线前，例如「我的QQ 123456|<openid>」。',
    ].join('\n'),
    handler: (ctx) => {
      const { scope, peerId } = getScopePeer(ctx);
      const senderId = (ctx.message as { senderId?: string }).senderId ?? '';
      return [
        `scope: ${scope}`,
        `${scope === 'group' ? '群' : '用户'} openid: ${peerId}`,
        `你的 openid: ${senderId}`,
        '',
        '把上面这行填进白名单即可（可写成「备注|openid」）。',
      ].join('\n');
    },
  };
}

/** /bot-version — 查看版本信息 */
export function versionCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: 'bot-version',
    category: 'qqbot',
    description: '查看版本信息',
    handler: () => {
      const current = manager.getEffectiveModel('c2c', '');
      const modelInfo = current ? `${current.provider}/${current.model}` : '宿主默认';
      return `dsh-qqbot v${PLUGIN_VERSION} | model: ${modelInfo}`;
    },
  };
}

/** /stop — 中止当前生成（隐藏） */
export function stopCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: 'stop',
    category: 'agent',
    description: '中止当前生成',
    hidden: true,
    handler: (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const record = manager.getSessionRecord(scope, peerId);
      // 会话存在不等于正在生成：只有 agent 处于 running 才算有进行中的回复
      if (record === undefined || record.agent.status !== 'running') {
        return '当前没有进行中的生成';
      }

      // cancel 会让当前轮以 turn/end (kind=interrupted) 收尾，
      // 出站侧据此 flush 已生成的文本并关闭流式会话。
      record.agent.cancel({ kind: 'user' });
      return '已中止 ⛔';
    },
  };
}
