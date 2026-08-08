FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY pnpm-workspace.yaml package.json ./
COPY tsconfig.json ./
COPY apps/worker/package.json apps/worker/tsconfig.json ./apps/worker/
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY apps/worker/src ./apps/worker/src
COPY packages/shared/src ./packages/shared/src
RUN pnpm --filter @wspeech/worker build

FROM base AS production
ENV NODE_ENV=production
COPY --from=build /app/apps/worker/dist ./dist
COPY --from=deps /app/apps/worker/node_modules ./node_modules
COPY --from=deps /app/package.json ./
CMD ["node", "dist/index.js"]
