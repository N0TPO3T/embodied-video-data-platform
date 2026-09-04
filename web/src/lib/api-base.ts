/**
 * 解析后端 API base URL。
 *
 * 开发/测试环境允许回退到本地默认值；生产构建（NODE_ENV=production）缺省时立即抛错，
 * 避免客户端静默退化到 localhost、造成“页面正常但请求全部失败”的难排查故障。
 *
 * 生产部署必须显式注入：
 * - 客户端：构建期 NEXT_PUBLIC_API_BASE_URL（见 compose.prod.yaml web build.args）
 * - 服务端（SSR/渲染路径）：容器环境 BACKEND_INTERNAL_URL
 */
export function resolveApiBaseUrl(
  envValue: string | undefined,
  localFallback: string,
): string {
  const trimmed = envValue?.trim();
  if (trimmed) {
    return trimmed.replace(/\/+$/u, "");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "后端 API base URL 未注入：生产构建必须显式设置 " +
        "NEXT_PUBLIC_API_BASE_URL（客户端）或 BACKEND_INTERNAL_URL（服务端）",
    );
  }
  return localFallback;
}
