FROM oven/bun:1-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy the application source.
COPY . .

ENV NODE_ENV=production
# Railway injects PORT; this is just the local default.
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
