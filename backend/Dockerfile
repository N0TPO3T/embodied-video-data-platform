FROM node:22-alpine AS dependencies
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM node:22-alpine AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libstdc++ && corepack enable
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

FROM runtime-base AS api
EXPOSE 4000
CMD ["sh", "-c", "node dist/database/run-migrations.js && node dist/cli/bootstrap-local-identity.js && node dist/main.js"]

FROM runtime-base AS media-worker
RUN apk add --no-cache ffmpeg
CMD ["node", "dist/media/media-worker.js"]
