# syntax=docker/dockerfile:1.7
#
# Operation Öland — Vue + Vite SPA served by nginx.
#
# Build the SPA in a Node stage, then ship only the static `dist/` output
# in a tiny nginx-alpine runtime. VITE_ORS_API_KEY is baked into the bundle
# at build time (Vite inlines all VITE_* envs), so it MUST be passed as a
# build arg if road-following routing is required.

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app

# Bring in lockfile first so npm ci can be cached across source-only edits.
COPY package.json package-lock.json* ./
RUN npm ci

# VITE_ORS_API_KEY is consumed during `npm run build`. Without it the app
# still loads — road routes just fall back to straight lines (see
# fetchRoadRoute in useAdminTracking.js).
ARG VITE_ORS_API_KEY=""
ENV VITE_ORS_API_KEY=$VITE_ORS_API_KEY

COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
