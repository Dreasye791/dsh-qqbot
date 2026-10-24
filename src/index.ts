/**
 * dsh-im-qqbot — QQ Bot IM channel plugin for deepseek-harness
 *
 * Cordis 插件入口。将 QQ 消息平台作为 dsh 的前端协议驱动。
 * 网关组装（中间件编排 + 事件 + 出站 + 生命周期）见 src/gateway/；
 * 凭据绑定编排（扫码状态机 + 端内绑定页路由）见 src/setup/。
 */
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, type ImQQBotConfig } from './config.ts';
import { bootstrapGateway } from './gateway/index.ts';
import type { DshAgentRegistry } from './session/index.ts';
import { getProfileDir, resolveEnv } from './shared/index.ts';
import { ensureCredentials, persistCredentialsToProfile, registerBoundCredentialRoutes } from './setup/index.ts';
import type { Logger } from './types.ts';
import type { ModelOptionsWire, ProviderOptionWire } from './shared/bind-protocol.ts';

// ── Cordis 插件元数据 ──
export const name = 'im-qqbot';
export const inject = ['agents'];
export const Config = ConfigSchema;

export type { ImQQBotConfig } from './config.ts';

// ── 插件主体 ──
export async function apply(ctx: Context, config: ImQQBotConfig): Promise<void> {
  const agents = (ctx as unknown as Record<string, unknown>).agents as DshAgentRegistry;
  const logger: Logger = ((ctx as unknown as Record<string, unknown>).logger as Logger) ?? console;

  let appId = resolveEnv(config.appId, 'QQBOT_APPID');
  let appSecret = resolveEnv(config.appSecret, 'QQBOT_SECRET');

  // ── 凭据缺失时唤起扫码绑定 ──
  if (!appId || !appSecret) {
    logger.info('凭据未配置，启动扫码绑定...');

    // 关键：不 await 扫码结果。boot 会等 Loader 树稳定（loader.await()），
    // 无限期等待用户扫码会阻塞 Host ready——Desktop 界面无法进入、
    // Web 的 URL 延迟输出。绑定编排（路由/呈现/生命周期）在
    // ensureCredentials 的同步阶段即完成，凭据就绪后由异步链接管。
    void ensureCredentials(ctx, { logger, config: { ...config } })
      .then((credentials): void => {
        if (!credentials) {
          // null 包括：扫码取消、手动提交（已另行持久化）、流程失败
          logger.info('扫码绑定流程结束（未获取凭据或已手动配置）');
          return;
        }

        // 持久化到 profile：成功则等待热更新重载，失败则用凭据直接启动。
        // 注意：不写入 process.env——resolveEnv 的 env 回退属于用户显式
        // export 的配置语义，运行时写入会与解绑清理不对齐（解绑后 HMR
        // 重载的新 fiber 仍从 env 读到旧凭据，状态停留 bound）
        const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
        if (persisted) {
          // 写入 cordis.patch.yml 会触发 dsh 热更新，自动重新加载本插件。
          logger.info('配置已保存，等待热更新重新加载...');
          return;
        }
        logger.warn('凭据未能持久化，本次进程将使用环境变量凭据启动（重启后需重新绑定）');
        // 本 fiber 已激活（ctx 有效），直接以凭据启动网关
        void bootstrapGateway(ctx, agents, {
          ...config,
          appId: credentials.appId,
          appSecret: credentials.appSecret,
        }, logger).catch((err: unknown) => {
          logger.error(`网关启动失败: ${err instanceof Error ? err.message : String(err)}`);
        });
      })
      .catch((err: unknown) => {
        // 全兜：unhandled rejection 会被宿主 fail-loud 判致命
        logger.error(`扫码绑定流程异常: ${err instanceof Error ? err.message : String(err)}`);
      });

    // apply 立即完成，插件 fiber 进入 ACTIVE，Host ready 不再被阻塞
    return;
  }

  // 已绑定：注册常驻路由（状态回显 + 手动编辑/更换凭据 + 配置编辑）
  registerBoundCredentialRoutes(ctx, logger, appId, { ...config }, () => buildModelOptions(ctx));

  const resolvedConfig: ImQQBotConfig = { ...config, appId, appSecret };

  await bootstrapGateway(ctx, agents, resolvedConfig, logger);
}

/** 思考档位（与 pi-ai 的 ReasoningEffortId 对齐；'' = 继承宿主默认） */
const EFFORT_OPTIONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: '', name: '继承（默认）' },
  { id: 'off', name: '关闭思考' },
  { id: 'minimal', name: '极低' },
  { id: 'low', name: '低' },
  { id: 'medium', name: '中' },
  { id: 'high', name: '高' },
  { id: 'xhigh', name: '很高' },
  { id: 'max', name: '最大' },
];

/** ctx.llm 的最小投影（不做类型硬绑定，宿主小版本升级不至于编译失败） */
interface LlmCatalogLike {
  listProviders(): Array<{ id: string; name?: string } | string>;
  listModels(id: string): Promise<Array<{ id: string; name?: string }>>;
}

/**
 * 本地 fork 补丁：给配置页提供 provider → model 的实时候选。
 * 发现失败一律降级为 available=false（前端回退手填），不把设置页卡在错误态。
 */
async function buildModelOptions(ctx: Context): Promise<ModelOptionsWire> {
  const efforts = EFFORT_OPTIONS.map(option => ({ ...option }));
  try {
    const llm = (ctx as unknown as { llm?: LlmCatalogLike }).llm;
    if (llm === undefined) return { available: false, providers: [], efforts };
    const raw = llm.listProviders() ?? [];
    const providers: ProviderOptionWire[] = [];
    for (const entry of raw) {
      if (entry === null || entry === undefined) continue;
      const id = typeof entry === 'string' ? entry : entry.id;
      const name = typeof entry === 'string' ? entry : (entry.name ?? entry.id);
      const models = await llm.listModels(id);
      providers.push({
        id,
        name,
        models: (models ?? [])
          .filter(model => model !== null && model !== undefined && typeof model.id === 'string')
          .map(model => ({ id: model.id, name: model.name ?? model.id })),
      });
    }
    return { available: providers.length > 0, providers, efforts };
  } catch {
    return { available: false, providers: [], efforts };
  }
}
