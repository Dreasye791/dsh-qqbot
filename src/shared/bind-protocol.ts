/**
 * 端内绑定协议 —— 宿主路由与客户端面板的共享契约
 *
 * 类型与路径常量的唯一事实源：宿主（setup/bind-routes.ts）与浏览器
 * （client/bind-page.ts）各自 import，杜绝两端协议漂移。
 * 本模块必须保持纯类型 + 纯常量（零 node 依赖、零副作用）：
 * 客户端 tsdown 构建会将其内联进 bundle。
 */

/** 状态查询（绑定页轮询） */
export const BIND_STATE_PATH = '/qqbot/im-qqbot/bind';

/** 刷新二维码（绑定页按钮） */
export const BIND_REFRESH_PATH = '/qqbot/im-qqbot/bind/refresh';

/** 手动填写/编辑凭据（绑定页表单） */
export const BIND_MANUAL_PATH = '/qqbot/im-qqbot/bind/manual';

/** 解绑：移除已保存凭据，回到绑定流程 */
export const BIND_UNBIND_PATH = '/qqbot/im-qqbot/bind/unbind';

/** 配置读写（设置面板表单） */
export const BIND_CONFIG_PATH = '/qqbot/im-qqbot/config';

/**
 * 模型目录（本地 fork 补丁）：配置页的「模型 / 思考强度」下拉数据源。
 * 从宿主 llm 服务动态发现 provider → model 列表；失败时回退为空列表（前端降级为手填）。
 */
export const BIND_MODEL_OPTIONS_PATH = '/qqbot/im-qqbot/model-options';

/** 单个模型条目（下拉用） */
export interface ModelOptionWire {
  id: string;
  name: string;
}

/** 单个 provider 及其模型 */
export interface ProviderOptionWire {
  id: string;
  name: string;
  models: ModelOptionWire[];
}

/** GET model-options 的响应体 */
export interface ModelOptionsWire {
  /** 动态发现是否成功；false 时前端回退手填 */
  available: boolean;
  providers: ProviderOptionWire[];
  /** 思考档位（含「继承」空值；实际生效取决于模型是否支持） */
  efforts: ModelOptionWire[];
  /** 发现失败的原因（仅排障用，前端不展示） */
  error?: string;
}

/** 线上协议（HTTP 路由序列化形态） */
export type BindStateWire =
  | { phase: 'starting' }
  | { phase: 'waiting'; url: string; qrSvg?: string; issuedAt: number }
  | { phase: 'saving' }
  | { phase: 'failed'; reason: string }
  | { phase: 'bound'; appId: string };

/** manual / unbind 操作的统一响应 */
export interface BindActionResponse {
  ok: boolean;
  message?: string;
  error?: string;
}
