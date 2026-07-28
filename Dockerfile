FROM node:24-alpine AS ui-build
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

FROM node:24-alpine AS api-deps
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=api-deps /app/node_modules ./node_modules
COPY api/package.json ./
COPY api/src ./src
COPY --from=ui-build /ui/dist ./public
EXPOSE 8080
USER node
CMD ["node", "src/server.ts"]
