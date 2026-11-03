FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/generated ./generated
COPY --from=builder /app/public ./public
COPY package.json next.config.ts ./
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]

FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./package.json
COPY scripts/worker.mjs ./scripts/worker.mjs
COPY scripts/clamav-scanner.mjs ./scripts/clamav-scanner.mjs
USER nextjs
CMD ["node", "scripts/worker.mjs"]
