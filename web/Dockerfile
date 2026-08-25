FROM node:22-alpine AS dependencies
WORKDIR /app
# 国内服务器无法稳定访问 registry.npmjs.org：corepack 走 npmmirror，并预装固定版本 pnpm，
# 避免运行时联网拉取导致容器启动失败。
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com

FROM dependencies AS build
ARG NEXT_PUBLIC_API_BASE_URL=/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json pnpm-workspace.yaml ./
USER node
EXPOSE 3000
CMD ["pnpm", "start", "--hostname", "0.0.0.0", "--port", "3000"]
