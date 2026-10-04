# Dockerfile optimizado para producción y despliegue en Coolify
FROM node:22-alpine

# Metadatos del contenedor
LABEL maintainer="Inventario Hogar PWA"
LABEL description="PWA de Inventario para el Hogar con persistencia SQL y fotos para Coolify"

# Crear directorio de la aplicación
WORKDIR /app

# Instalar dependencias primero para aprovechar la caché de capas de Docker
COPY package*.json ./

RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# Copiar el código fuente
COPY . .

# Crear directorio de datos persistentes y asegurar permisos
RUN mkdir -p /app/data /app/data/uploads && \
    chmod -R 755 /app/data

# Configuración de variables de entorno para producción
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    UPLOADS_DIR=/app/data/uploads \
    DB_PATH=/app/data/inventario.sqlite

# Declarar volumen persistente para SQLite y fotos en Coolify
VOLUME ["/app/data"]

# Puerto expuesto
EXPOSE 3000

# Verificación de salud del contenedor (Healthcheck)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Comando de inicio
CMD ["node", "server.js"]
