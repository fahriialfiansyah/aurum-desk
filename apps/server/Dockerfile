FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm install --frozen-lockfile --filter @aurum/server...
ENV NODE_ENV=production
EXPOSE 4000
CMD ["pnpm", "--filter", "@aurum/server", "start"]
