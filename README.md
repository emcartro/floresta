# 🏠 Inventario para el Hogar (PWA + SQL + Docker)

Una **Progressive Web App (PWA)** moderna, limpia y **Mobile-First** con backend en **Node.js + SQL (SQLite)**, soporte para **fotos de artículos**, **gestión dinámica de secciones del hogar** y lista para desplegar en **Coolify** o cualquier servidor con Docker.

---

## ✨ Nuevas Funcionalidades

### 1. 🏷️ Pestaña para Creación y Gestión de Secciones del Hogar
- Nueva vista dedicada: **"Secciones del Hogar"** accesible desde la barra superior.
- **Formulario de Creación/Edición**:
  - Nombre de la sección (ej. *Terraza*, *Garaje*, *Lavandería*, *Bodega*).
  - Selector rápido de emojis para habitaciones (🛋️, 🛏️, 🍳, 🍽️, 🚿, 💻, 🪴, 🚗, 🧺, 📦, 🌿, 🍷, 🎮, 🛠️, 🏊).
  - Descripción o notas del área.
- **Gestión en Tiempo Real**:
  - Cuadrícula con conteo dinámico de artículos por sección.
  - Botón para filtrar directamente el inventario por esa sección.
  - Edición y eliminación con validación de seguridad (previene borrar secciones que contengan artículos).
  - Actualización automática del selector desplegable al agregar o editar ítems.

### 2. 📸 Soporte Completo de Fotos por Ítem
- **Subida de fotos**: Permite seleccionar o tomar fotos directamente desde la cámara o galería del móvil (hasta 10 fotos por ítem).
- **Vistas previas interactivas**: Visualiza miniaturas antes de guardar con opción de remover fotos individuales (`✕`).
- **Portada en tarjetas**: Las tarjetas del inventario muestran la foto principal con un badge del total de fotos.
- **Visor Lightbox a pantalla completa**: Al tocar una foto se abre un visor modal en alta resolución con controles para navegar entre imágenes (`‹`, `›`).
- **Almacenamiento persistente**: Las fotos se guardan en el servidor (`/data/uploads/`) y sus rutas se indexan en la base de datos SQL.

### 3. 🗄️ Persistencia en Base de Datos SQL
- Backend robusto con **SQLite nativo** (`node:sqlite`) y tablas relacionales (`sections` e `items`).
- Sincronización bidireccional:
  - En línea: Lee y escribe directamente en la base de datos SQL mediante API REST.
  - Fuera de línea: Si el usuario pierde conexión, la PWA sigue funcionando mediante **IndexedDB**.
- Exportación CSV (`inventario_hogar.csv`) generada desde el SQL con compatibilidad para Excel y UTF-8 BOM.

### 4. 🐳 Dockerización Lista para Coolify
- **`Dockerfile`**: Imagen multi-etapa ultra ligera basada en `node:22-alpine` con healthcheck en `/health`.
- **Volumen Persistente `/app/data`**: Un solo volumen preserva tanto la base de datos `inventario.sqlite` como todas las fotos subidas en `/app/data/uploads`.
- **`docker-compose.yml`**: Configuración lista para desarrollo local o despliegue en VPS.
- **Guía de Coolify**: Consulta [`COOLIFY.md`](COOLIFY.md) para el paso a paso en Coolify.

---

## 🚀 Cómo Ejecutar Localmente

### Opción 1: Con Node.js
```bash
# Entrar al directorio
cd C:\Users\gap\.gemini\antigravity\scratch\inventario-hogar-pwa

# Iniciar servidor
npm start
```
Abre tu navegador en: **`http://localhost:3000`**

### Opción 2: Con Docker Compose
```bash
docker compose up -d
```
Abre: **`http://localhost:3000`**

---

## 🌐 Despliegue en Coolify

Para instrucciones detalladas sobre cómo configurar el volumen `/app/data` y desplegar en Coolify, consulta la guía:
👉 **[COOLIFY.md](COOLIFY.md)**

---

## 📁 Estructura del Proyecto

```
inventario-hogar-pwa/
├── data/                    # Almacenamiento persistente (Base de datos y fotos)
│   ├── inventario.sqlite    # Base de datos SQL
│   └── uploads/             # Directorio de fotos cargadas
├── icons/                   # Iconos PWA (SVG y PNG 192/512)
├── index.html               # Frontend con pestañas de inventario y secciones
├── styles.css               # Estilos modernos mobile-first con lightbox y galerías
├── app.js                   # Lógica reactiva, llamadas a API SQL y PWA
├── db.js                    # Capa de base de datos SQL (SQLite nativo)
├── server.js                # Servidor Express, API REST y subida con Multer
├── sw.js                    # Service Worker para modo offline PWA
├── manifest.webmanifest     # Manifiesto de instalación PWA
├── Dockerfile               # Imagen Docker para producción y Coolify
├── docker-compose.yml       # Orquestación con volúmenes persistentes
├── COOLIFY.md               # Guía paso a paso de Coolify
└── README.md                # Documentación general
```
