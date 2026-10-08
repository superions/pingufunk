# Stage 1: Dependencies
FROM node:24-alpine AS deps
WORKDIR /app

# Install dependencies needed for native modules
RUN apk add --no-cache libc6-compat

# Copy package files and prisma schema (needed for postinstall)
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts/generate-database-clients.mjs ./scripts/
RUN npm ci

# Explicit one-shot migration runner, built from the same schema and pinned CLI.
# This target is never part of a normal application container startup.
FROM deps AS migrator
COPY scripts/postgresql-transport.mjs ./scripts/
COPY scripts/resolve-database-url.mjs scripts/database-config.mjs scripts/database-migrate.mjs scripts/load-database-environment.mjs scripts/sqlite-schema.mjs scripts/check-sqlite-schema.mjs scripts/check-postgresql-schema.mjs scripts/sqlite-baseline.mjs scripts/migrate-entrypoint.sh scripts/postgresql-preflight.mjs scripts/postgresql-snapshot.mjs scripts/postgresql-row-transform.mjs scripts/postgresql-import.mjs scripts/postgresql-prepare.mjs scripts/postgresql-verify.mjs scripts/postgresql-run-manifest.mjs scripts/postgresql-migration-cli.mjs ./scripts/
RUN apk add --no-cache su-exec && chmod +x ./scripts/migrate-entrypoint.sh \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
# The one-shot migrator invokes the locked Prisma CLI through node, not global npm.
ENTRYPOINT ["/app/scripts/migrate-entrypoint.sh"]
CMD ["node", "/app/scripts/database-migrate.mjs"]

# Stage 2: Builder
FROM node:24-alpine AS builder
WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/generated ./generated
COPY . .

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Move standalone files to fixed location
# Handle both cases: files directly in standalone/ OR in a subdirectory
RUN mkdir -p /app/standalone-out && \
    if [ -f /app/.next/standalone/server.js ]; then \
      echo "Files directly in standalone/" && \
      cd /app/.next/standalone && tar cf - . | tar xf - -C /app/standalone-out/; \
    else \
      echo "Files in subdirectory" && \
      cd /app/.next/standalone/*/ && tar cf - . | tar xf - -C /app/standalone-out/; \
    fi && \
    ls -la /app/standalone-out/

# Stage 3: Runner
FROM node:24-alpine AS runner
WORKDIR /app

# Installation belongs to the build stages; the server never invokes npm/npx.
# Exclude the base image's independent package-manager dependency tree at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

# Install runtime dependencies for FFmpeg and user management
# Note: yt-dlp standalone binary includes bundled Python, no separate install needed
RUN apk add --no-cache \
    tar \
    xz \
    wget \
    curl \
    su-exec \
    shadow \
    ffmpeg \
    && rm -rf /var/cache/apk/*

COPY src/server/ytdlp-release.json /tmp/ytdlp-release.json

# Select the standalone musl binary for the image's architecture.
RUN case "$(apk --print-arch)" in \
        x86_64) asset=yt-dlp_musllinux ;; \
        aarch64) asset=yt-dlp_musllinux_aarch64 ;; \
        *) echo "Unsupported yt-dlp architecture" >&2; exit 1 ;; \
    esac \
    && version=$(node -p 'require("/tmp/ytdlp-release.json").version') \
    && checksum=$(node -p 'require("/tmp/ytdlp-release.json").sha256[process.argv[1]]' "$asset") \
    && curl -fL "https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${asset}" -o /usr/local/bin/yt-dlp \
    && echo "$checksum  /usr/local/bin/yt-dlp" | sha256sum -c - \
    && chmod +x /usr/local/bin/yt-dlp

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public folder
COPY --from=builder /app/public ./public

# Copy standalone build
COPY --from=builder /app/standalone-out/ ./
COPY --from=builder /app/.next/static ./.next/static

# Copy generated Prisma client. Migrations run only in the migrator target.
COPY --from=builder /app/prisma/migrations ./prisma/migrations
COPY --from=builder /app/prisma/legacy/sqlite ./prisma/legacy/sqlite
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY scripts/resolve-database-url.mjs scripts/database-config.mjs scripts/check-database-schema.mjs scripts/check-sqlite-schema.mjs scripts/sqlite-schema.mjs scripts/check-postgresql-schema.mjs scripts/download-directories.mjs ./scripts/

# Create directories for data and downloads
# Symlink system FFmpeg and yt-dlp so the app finds them at expected locations
RUN mkdir -p /app/prisma/data /app/ffmpeg /app/ytdlp \
    && ln -s /usr/bin/ffmpeg /app/ffmpeg/ffmpeg \
    && ln -s /usr/bin/ffprobe /app/ffmpeg/ffprobe \
    && ln -s /usr/local/bin/yt-dlp /app/ytdlp/yt-dlp \
    && chown -R nextjs:nodejs /app

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose port
EXPOSE 6767

# Environment variables
ENV PORT=6767
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:6767/api/health?mode=ready || exit 1

# Start the application with entrypoint for PUID/PGID support
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
