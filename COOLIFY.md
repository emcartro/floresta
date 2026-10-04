# 🚀 Despliegue en Coolify - Inventario para el Hogar PWA

Esta guía detalla los pasos para desplegar la PWA en cualquier servidor gestionado por **Coolify** garantizando la persistencia total de la base de datos **SQLite** y de las **fotos** subidas.

---

## 📋 Requisitos Previos

- Una instancia de **Coolify** activa (v4 o superior).
- Acceso al repositorio Git (GitHub, GitLab o Git local/privado) donde subas este proyecto, o desplegar directamente mediante Dockerfile/Git.

---

## 🛠️ Paso a Paso para Desplegar en Coolify

### 1. Crear un Nuevo Proyecto / Aplicación
1. En tu panel de Coolify, dirígete a tu **Project** y selecciona tu **Environment** (ej. `production`).
2. Haz clic en **+ New** y selecciona **Application**.
3. Elige la fuente:
   - **Public / Private Git Repository**: Conecta el repositorio de este proyecto.
   - O **Dockerfile / Docker Compose**: Selecciona la opción adecuada.

### 2. Configuración de Construcción (Build Settings)
- **Build Pack**: Selecciona **Dockerfile** (Coolify detectará automáticamente el archivo [`Dockerfile`](file:///C:/Users/gap/.gemini/antigravity/scratch/inventario-hogar-pwa/Dockerfile)).
- **Port**: `3000` (el puerto predeterminado donde escucha Express).

### 3. Configurar Almacenamiento Persistente (¡MUY IMPORTANTE!)
Para que la base de datos SQL (`inventario.sqlite`) y las fotos cargadas en (`/uploads`) no se borren en cada reinicio o actualización:

1. Ve a la pestaña **Storages** (Almacenamiento) en la configuración de la aplicación en Coolify.
2. Haz clic en **+ Add Storage** (o Persistent Storage).
3. Configura:
   - **Type**: `Volume`
   - **Destination Path**: `/app/data`
   - **Name**: `inventario_data` (o el nombre que prefieras).
4. Guarda los cambios.

> [!NOTE]
> Todo lo que la aplicación genera (`/app/data/inventario.sqlite` y `/app/data/uploads/`) se almacena dentro de `/app/data`, por lo que un solo volumen persistente preserva tanto la base de datos como todas las fotos.

### 4. Variables de Entorno (Opcional)
En la pestaña **Environment Variables**, puedes configurar si deseas:
```env
NODE_ENV=production
PORT=3000
DATA_DIR=/app/data
UPLOADS_DIR=/app/data/uploads
DB_PATH=/app/data/inventario.sqlite
```
*(Todas estas variables ya vienen con valores por defecto adecuados en el Dockerfile).*

### 5. Dominio y Certificado SSL
1. En la pestaña **General**, ingresa tu dominio en **Domains** (ejemplo: `https://inventario.tudominio.com`).
2. Coolify configurará automáticamente el proxy inverso (Traefik / Caddy) y solicitará el certificado SSL gratuito de Let's Encrypt.

### 6. Desplegar
- Haz clic en **Deploy**.
- Coolify construirá la imagen con Alpine Linux, ejecutará el healthcheck en `/health` y pondrá la PWA en línea.

---

## 🐳 Despliegue Alternativo: Docker Compose

Si prefieres usar la opción **Docker Compose** en Coolify:
1. Copia y pega el contenido de [`docker-compose.yml`](file:///C:/Users/gap/.gemini/antigravity/scratch/inventario-hogar-pwa/docker-compose.yml).
2. Coolify creará el volumen `inventario_storage` automáticamente.
3. Despliega con 1 solo clic.

---

## 🔍 Verificación de Salud
El contenedor incluye un endpoint de diagnóstico en `/health`.
Al ingresar a `https://tudominio.com/health` recibirás:
```json
{
  "status": "ok",
  "database": "sqlite-connected",
  "dataDir": "/app/data"
}
```
