# GDSO TIS API - Dockerfile
# Multi-stage build pour image optimisée

FROM node:20-alpine AS builder

WORKDIR /app

# Copier uniquement les fichiers de dépendances d'abord (cache layer)
COPY package.json ./

# Installer les dépendances de production
RUN npm install --omit=dev && npm cache clean --force

# ============================================================================

FROM node:20-alpine

WORKDIR /app

# Créer un utilisateur non-root pour la sécurité
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copier les node_modules du builder
COPY --from=builder /app/node_modules ./node_modules

# Copier le code source
COPY --chown=nodejs:nodejs . .

# Utiliser l'utilisateur non-root
USER nodejs

# Port exposé
EXPOSE 3000

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Démarrer l'API
CMD ["node", "server.js"]
