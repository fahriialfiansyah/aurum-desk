FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @aurum/web...
RUN pnpm --filter @aurum/web build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
