/**
 * 模型路由层类型定义
 */

/** 模型路由 */
export interface ModelRoute {
  provider: string;
  model: string;
  /**
   * 思考强度覆盖（本地 fork 补丁）：仅当 config.reasoningEffort 非空时出现。
   * 由 session-manager 通过 installModelSelection 应用，只影响本通道的 agent。
   */
  reasoningEffort?: string;
}

/** 模型信息条目 */
export interface ModelEntry {
  provider: string;
  id: string;
  name?: string;
}
