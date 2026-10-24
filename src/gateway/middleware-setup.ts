/**
 * SDK 中间件编排
 *
 * 根据插件配置组装 SDK 内置中间件链（洋葱模型）。
 * 中间件负责过滤与上下文富化；最终消息统一由 bot.on('message') 处理转发。
 */
import type { QQBot } from '@tencent-connect/qqbot-nodejs';
import {
  errorHandler,
  messageFilter,
  accessPolicy,
  mentionGate,
  contentSanitizer,
  rateLimiter,
  slashCommand,
  concurrencyGuard,
  typingIndicator,
  quoteRef,
  historyBuffer,
  envelopeFormatter,
} from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger } from '../types.ts';
import { buildCommandList } from '../commands/index.ts';
import { attachmentProcessor } from '../middleware/attachment.ts';
import { questionAnswer } from '../middleware/question-answer.ts';
import { getHistoryStore, historyGroupKey } from '../features/history-store.ts';

/**
 * 白名单条目归一化。
 *
 * - 支持 `备注|openid` 写法：备注可以写 QQ 号/群号或人名（自己看得懂就行），
 *   匹配时只取最后一个 `|` 之后的值。官方 Bot API 不提供真实 QQ 号/群号
 *   （事件里只有 user_openid / group_openid），所以号码只能作为标签存在。
 * - **空数组必须原样返回**。原实现退化成 `['*']`，而 SDK 的 matcherMatches
 *   把 `'*'` 当全匹配通配符 —— 等于「allowlist 模式 + 空白名单 = 全放行」，
 *   是 fail-open。空数组交给 SDK 后会被判成 "allowlist is empty" 并全部拒绝。
 */
function normalizeAllow(list: readonly string[] | undefined): string[] {
  return (list ?? [])
    .map((entry) => {
      const sep = entry.lastIndexOf('|');
      return (sep >= 0 ? entry.slice(sep + 1) : entry).trim();
    })
    .filter((entry) => entry !== '');
}

export function setupMiddlewares(
  bot: QQBot,
  config: ImQQBotConfig,
  manager: SessionManager,
  logger: Logger,
): void {
  // 1. 错误兜底（最外层洋葱皮）
  bot.use(errorHandler());

  // 2. 消息过滤：bot 回声 + 消息去重
  bot.use(messageFilter({ skipSelfEcho: false }));

  // 3. 访问控制（白名单/开放/禁用）
  bot.use(accessPolicy({
    c2c: {
      mode: config.access.c2cMode,
      allow: normalizeAllow(config.access.c2cAllow),
    },
    group: {
      mode: config.access.groupMode,
      allow: normalizeAllow(config.access.groupAllow),
    },
    onBlock: (_mCtx, reason) => {
      // 被拒时始终记一条 info：reason 里带 openid，用户第一次配置白名单时
      // 就靠这行拿到自己的标识（桌面版的 debug 日志默认看不到）。
      logger.info(`Access blocked: ${reason}`);
    },
  }));

  // 4. 群历史缓冲 — 放在门控之前，确保所有消息（含未 @bot）都计入上下文
  //    store 走共享单例（getHistoryStore），groupKey 带 appId 前缀，供回复后清空
  bot.use(historyBuffer({
    limit: config.historyLimit,
    store: getHistoryStore(),
    recordOnSkip: true,
    groupKey: (ctx) => {
      const gid = ctx.message.groupOpenid;
      if (ctx.message.kind !== 'group' || !gid) return undefined;
      return historyGroupKey(config.appId, gid);
    },
  }));

  // 5. 群聊 @bot 门控
  bot.use(mentionGate({
    requireMentionInGroup: config.requireMention,
  }));

  // 6. 内容清洗（去 @marker、表情标签、多余空白）
  bot.use(contentSanitizer({
    parseFaceTags: true,
  }));

  // 7. 三层限流（sender / group / global）
  bot.use(rateLimiter());

  // 8. 斜杠命令（在 concurrencyGuard 之前，命令匹配后不排队直接响应）
  const slash = slashCommand({
    // 关闭 autoHelp：help 命令由 qqbot 注册为 /bot-help，
    // 避免 SDK 再自动注册一个无前缀的 /help 造成重复
    autoHelp: false,
    commands: buildCommandList({ manager, config }),
  });
  bot.use(slash.middleware);

  // 8.5. 待答问题截获（在 concurrencyGuard 之前，答案消息不排队直接作答）
  bot.use(questionAnswer(manager));

  // 9. 并发串行 + 消息合并（同 peer 排队，避免 session 冲突）
  bot.use(concurrencyGuard({
    strategy: 'merge',
    maxQueue: config.maxQueue,
    maxProcessingMs: config.processingTimeoutMs,
  }));

  // 10. C2C 输入状态指示
  bot.use(typingIndicator());

  // 11. 引用消息解析（记录 + 解析被引用原文）
  bot.use(quoteRef({
    maxSize: 500,
    preferMsgElements: true,
  }));

  // 11.5. 附件下载（file 附件下载到本地，供 @提及 / 工具访问）
  bot.use(attachmentProcessor(config, logger));

  // 12. 上下文组装（将 history + quote + sender 组成 envelope）
  bot.use(envelopeFormatter({
    historyLimit: config.historyLimit,
    includeQuote: true,
    includeSender: true,
  }));
}
