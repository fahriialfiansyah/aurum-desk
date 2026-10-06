FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/ingest ./apps/ingest
RUN pnpm install --frozen-lockfile --filter @aurum/ingest...
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@aurum/ingest", "start"]
