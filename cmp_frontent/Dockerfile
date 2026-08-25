# syntax=docker/dockerfile:1.7

# Multi-stage build using Next's standalone output: the runtime image carries a
# minimal server and the traced dependencies only, not the whole node_modules
# tree. Roughly a tenth of the size, and far less to scan.

FROM node:22-alpine AS deps
WORKDIR /app
# npm ci, not npm install: it installs exactly the lock file and fails if
# package.json disagrees with it, rather than quietly resolving something else.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined at build time, so the API URL is a build
# argument rather than a runtime variable. A different environment means a
# different image, which is the honest way to model it.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_NAME="Consent Management Platform"
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_TELEMETRY_DISABLED=1

# Standalone output is opt-in: it is what this image is built around, and it
# gets in the way of a local `next start`. See next.config.ts.
ENV NEXT_OUTPUT=standalone
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root, no shell. A compromised process cannot install anything or leave a
# login behind.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs --shell /sbin/nologin nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/sign-in').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
