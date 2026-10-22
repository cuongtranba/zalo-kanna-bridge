FROM oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src

RUN mkdir -p /app/data && chown -R bun:bun /app/data

ENV NODE_ENV=production
ENV STATE_FILE=/app/data/state.json

USER bun
VOLUME /app/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch(`http://localhost:${process.env.PORT ?? 3000}/healthz`); process.exit(r.ok ? 0 : 1)"]

CMD ["bun", "run", "src/main.ts"]
