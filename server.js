/**
 * SERVIDOR EXPRESS CON PERSISTENCIA SQL Y CARGA DE FOTOS
 * Listo para ejecución local y despliegue en contenedor Docker / Coolify
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const { 
  UserRepo,
  SessionRepo,
  CasaRepo,
  SectionRepo, 
  CategoryRepo,
  ItemRepo, 
  UPLOADS_DIR, 
  DATA_DIR, 
  DB_PATH, 
  flushAndCheckpoint, 
  closeDatabase, 
  reopenDatabase 
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de almacenamiento para fotos con Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueName = `foto_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB máximo por foto
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen (JPEG, PNG, WebP, GIF).'));
    }
  }
});

// Helper para parsear cookies simples sin librerías externas
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const key = parts.shift().trim();
      const value = decodeURI(parts.join('='));
      if (key) list[key] = value;
    });
  }
  return list;
}

// Middlewares
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Middleware de Autenticación
function requireAuth(req, res, next) {
  // 1. Extraer token de cabecera Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  // 2. Fallback a Cookie de sesión
  if (!token) {
    const cookies = parseCookies(req);
    token = cookies['session_token'];
  }

  // 3. Fallback a query param (?token=) para descargas directas de CSV / backup
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'No autenticado. Inicie sesión para continuar.' });
  }

  const session = SessionRepo.getByToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Sesión expirada o inválida. Inicie sesión nuevamente.' });
  }

  req.user = session;
  req.token = token;
  next();
}

// Servir fotos subidas (permitir visualización)
app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '7d',
  immutable: true
}));

// Servir archivos estáticos de la PWA
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('manifest.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// =============================================================================
// API REST - AUTENTICACIÓN
// =============================================================================

// Registro de usuario
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password, nombre } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'El nombre de usuario es obligatorio' });
    }
    if (!password || password.trim().length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const existing = UserRepo.getByUsername(cleanUsername);
    if (existing) {
      return res.status(409).json({ error: 'Este nombre de usuario ya está registrado' });
    }

    const user = UserRepo.create({
      username: cleanUsername,
      password: password.trim(),
      nombre: nombre || cleanUsername
    });

    const session = SessionRepo.create(user.id);
    res.cookie = `session_token=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`;
    res.setHeader('Set-Cookie', `session_token=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);

    res.status(201).json({
      success: true,
      token: session.token,
      user: { id: user.id, username: user.username, nombre: user.nombre }
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error al registrar usuario: ' + error.message });
  }
});

// Inicio de sesión
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const user = UserRepo.getByUsername(cleanUsername);
    if (!user || !UserRepo.verifyPassword(user, password)) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const session = SessionRepo.create(user.id);
    res.setHeader('Set-Cookie', `session_token=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);

    res.json({
      success: true,
      token: session.token,
      user: { id: user.id, username: user.username, nombre: user.nombre }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Sesión actual / Me
app.get('/api/auth/me', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }
    if (!token) {
      const cookies = parseCookies(req);
      token = cookies['session_token'];
    }

    if (!token) {
      return res.status(401).json({ authenticated: false });
    }

    const session = SessionRepo.getByToken(token);
    if (!session) {
      return res.status(401).json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user: {
        id: session.userId,
        username: session.username,
        nombre: session.nombre
      }
    });
  } catch (error) {
    console.error('Error en auth/me:', error);
    res.status(500).json({ error: 'Error al verificar sesión' });
  }
});

// Cerrar sesión
app.post('/api/auth/logout', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }
    if (!token) {
      const cookies = parseCookies(req);
      token = cookies['session_token'];
    }

    if (token) {
      SessionRepo.delete(token);
    }

    res.setHeader('Set-Cookie', 'session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax');
    res.json({ success: true, message: 'Sesión cerrada correctamente' });
  } catch (error) {
    console.error('Error en logout:', error);
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
});

// =============================================================================
// API REST - CASAS / PROPIEDADES (Multi-casa)
// =============================================================================

// Listar todas las casas
app.get('/api/casas', requireAuth, (req, res) => {
  try {
    const casas = CasaRepo.getAll();
    res.json(casas);
  } catch (error) {
    console.error('Error al obtener casas:', error);
    res.status(500).json({ error: 'Error al obtener casas en SQL' });
  }
});

// Crear una nueva casa
app.post('/api/casas', requireAuth, (req, res) => {
  try {
    const { nombre, icono, direccion, descripcion } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre de la casa es obligatorio' });
    }

    const trimmedNombre = nombre.trim();
    const existing = CasaRepo.getByName(trimmedNombre);
    if (existing) {
      return res.status(409).json({ error: 'Ya existe una propiedad con este nombre' });
    }

    const nuevaCasa = CasaRepo.create({
      nombre: trimmedNombre,
      icono: icono || '🏡',
      direccion,
      descripcion
    });

    res.status(201).json(nuevaCasa);
  } catch (error) {
    console.error('Error al crear casa:', error);
    res.status(500).json({ error: 'Error al crear casa en SQL' });
  }
});

// Actualizar una casa
app.put('/api/casas/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, icono, direccion, descripcion } = req.body;

    const existing = CasaRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Casa no encontrada' });
    }

    if (nombre && nombre.trim() !== existing.nombre) {
      const conflict = CasaRepo.getByName(nombre.trim());
      if (conflict && conflict.id !== id) {
        return res.status(409).json({ error: 'Ya existe otra casa con ese nombre' });
      }
    }

    const updated = CasaRepo.update(id, {
      nombre,
      icono,
      direccion,
      descripcion
    });

    res.json(updated);
  } catch (error) {
    console.error('Error al actualizar casa:', error);
    res.status(500).json({ error: 'Error al actualizar casa en SQL' });
  }
});

// Eliminar una casa
app.delete('/api/casas/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const result = CasaRepo.delete(id);

    if (!result.deleted) {
      if (result.reason === 'has_items') {
        return res.status(400).json({
          error: `No se puede eliminar "${result.casaName}" porque contiene ${result.itemCount} artículo(s). Reasigna o elimina los artículos primero.`
        });
      }
      if (result.reason === 'last_casa') {
        return res.status(400).json({ error: result.message });
      }
      return res.status(404).json({ error: 'Casa no encontrada' });
    }

    res.json({ message: 'Casa eliminada exitosamente' });
  } catch (error) {
    console.error('Error al eliminar casa:', error);
    res.status(500).json({ error: 'Error al eliminar casa en SQL' });
  }
});

// =============================================================================
// API REST - SECCIONES
// =============================================================================

// Listar todas las secciones
app.get('/api/sections', requireAuth, (req, res) => {
  try {
    const casaId = req.query.casa_id || null;
    const sections = SectionRepo.getAll(casaId);
    res.json(sections);
  } catch (error) {
    console.error('Error al obtener secciones:', error);
    res.status(500).json({ error: 'Error al obtener secciones de la base de datos' });
  }
});

// Crear nueva sección
app.post('/api/sections', requireAuth, (req, res) => {
  try {
    const { nombre, icono, descripcion } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre de la sección es obligatorio' });
    }

    const trimmedNombre = nombre.trim();
    const existing = SectionRepo.getByName(trimmedNombre);
    if (existing) {
      return res.status(409).json({ error: 'Ya existe una sección con este nombre' });
    }

    const id = 'sec_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const newSection = SectionRepo.create({
      id,
      nombre: trimmedNombre,
      icono: icono || '📦',
      descripcion: descripcion ? descripcion.trim() : '',
      orden: 99
    });

    res.status(201).json(newSection);
  } catch (error) {
    console.error('Error al crear sección:', error);
    res.status(500).json({ error: 'Error al crear sección en SQL' });
  }
});

// Actualizar sección
app.put('/api/sections/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, icono, descripcion } = req.body;

    const existing = SectionRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Sección no encontrada' });
    }

    if (nombre && nombre.trim() !== existing.nombre) {
      const nameConflict = SectionRepo.getByName(nombre.trim());
      if (nameConflict && nameConflict.id !== id) {
        return res.status(409).json({ error: 'Ya existe otra sección con ese nombre' });
      }
    }

    const updated = SectionRepo.update(id, {
      nombre: nombre ? nombre.trim() : existing.nombre,
      icono: icono || existing.icono,
      descripcion: descripcion !== undefined ? descripcion.trim() : existing.descripcion,
      orden: existing.orden
    });

    res.json(updated);
  } catch (error) {
    console.error('Error al actualizar sección:', error);
    res.status(500).json({ error: 'Error al actualizar sección en SQL' });
  }
});

// Eliminar sección
app.delete('/api/sections/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const result = SectionRepo.delete(id);

    if (!result.deleted) {
      if (result.reason === 'has_items') {
        return res.status(400).json({
          error: `No se puede eliminar la sección "${result.sectionName}" porque contiene ${result.itemCount} artículo(s). Reasigna o elimina los artículos primero.`
        });
      }
      return res.status(404).json({ error: 'Sección no encontrada' });
    }

    res.json({ message: 'Sección eliminada exitosamente' });
  } catch (error) {
    console.error('Error al eliminar sección:', error);
    res.status(500).json({ error: 'Error al eliminar sección en SQL' });
  }
});

// =============================================================================
// API REST - CATEGORÍAS
// =============================================================================

// Listar todas las categorías
app.get('/api/categories', requireAuth, (req, res) => {
  try {
    const categories = CategoryRepo.getAll();
    res.json(categories);
  } catch (error) {
    console.error('Error al obtener categorías:', error);
    res.status(500).json({ error: 'Error al consultar categorías en SQL' });
  }
});

// Crear nueva categoría
app.post('/api/categories', requireAuth, (req, res) => {
  try {
    const { nombre, icono } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre de la categoría es obligatorio' });
    }

    const trimmedNombre = nombre.trim();
    const existing = CategoryRepo.getByName(trimmedNombre);
    if (existing) {
      return res.status(409).json({ error: 'Ya existe una categoría con este nombre' });
    }

    const id = 'cat_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const newCategory = CategoryRepo.create({
      id,
      nombre: trimmedNombre,
      icono: icono || '🏷️'
    });

    res.status(201).json(newCategory);
  } catch (error) {
    console.error('Error al crear categoría:', error);
    res.status(500).json({ error: 'Error al guardar categoría en SQL' });
  }
});

// =============================================================================
// API REST - ÍTEMS CON FOTOS, CANTIDAD, CATEGORÍA Y CASA
// =============================================================================

// Listar todos los ítems (filtrable opcionalmente por ?casa_id=)
app.get('/api/items', requireAuth, (req, res) => {
  try {
    const casaId = req.query.casa_id || null;
    const items = ItemRepo.getAll(casaId);
    res.json(items);
  } catch (error) {
    console.error('Error al obtener ítems:', error);
    res.status(500).json({ error: 'Error al consultar ítems en SQL' });
  }
});

// Crear nuevo ítem
app.post('/api/items', requireAuth, (req, res) => {
  try {
    const { casa_id, nombre, seccion, categoria, cantidad, estado, etiqueta_destino, precio_venta, notas, fotos } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del ítem es obligatorio' });
    }
    if (!seccion) {
      return res.status(400).json({ error: 'La sección es obligatoria' });
    }

    const id = req.body.id || 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const newItem = ItemRepo.create({
      id,
      casa_id: casa_id || 'casa_floresta',
      nombre: nombre.trim(),
      seccion,
      categoria: categoria || 'Mobiliario',
      cantidad: Math.max(1, parseInt(cantidad, 10) || 1),
      estado: estado || 'Buen estado',
      etiqueta_destino: etiqueta_destino || 'Almacenar',
      precio_venta,
      notas: notas ? notas.trim() : '',
      fotos: fotos || [],
      fecha_registro: req.body.fecha_registro || new Date().toISOString()
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error al crear ítem:', error);
    res.status(500).json({ error: 'Error al guardar ítem en SQL' });
  }
});

// Actualizar ítem
app.put('/api/items/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { casa_id, nombre, seccion, categoria, cantidad, estado, etiqueta_destino, precio_venta, notas, fotos } = req.body;

    const existing = ItemRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Ítem no encontrado' });
    }

    const updated = ItemRepo.update(id, {
      casa_id,
      nombre: nombre ? nombre.trim() : undefined,
      seccion,
      categoria,
      cantidad,
      estado,
      etiqueta_destino,
      precio_venta,
      notas: notas !== undefined ? notas.trim() : undefined,
      fotos
    });

    res.json(updated);
  } catch (error) {
    console.error('Error al actualizar ítem:', error);
    res.status(500).json({ error: 'Error al actualizar ítem en SQL' });
  }
});

// Eliminar ítem
app.delete('/api/items/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const success = ItemRepo.delete(id);
    if (!success) {
      return res.status(404).json({ error: 'Ítem no encontrado' });
    }
    res.json({ message: 'Ítem eliminado con éxito' });
  } catch (error) {
    console.error('Error al eliminar ítem:', error);
    res.status(500).json({ error: 'Error al eliminar ítem en SQL' });
  }
});

// Subida de fotos (Multipart)
app.post('/api/upload', requireAuth, upload.array('fotos', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se subió ninguna imagen' });
    }

    const uploadedUrls = req.files.map(file => `/uploads/${file.filename}`);
    res.json({
      urls: uploadedUrls,
      files: req.files.map(f => ({
        filename: f.filename,
        originalName: f.originalname,
        size: f.size,
        url: `/uploads/${f.filename}`
      }))
    });
  } catch (error) {
    console.error('Error en subida de fotos:', error);
    res.status(500).json({ error: 'Error al procesar la subida de fotos' });
  }
});

// Exportación CSV directo desde SQL (soporta ?casa_id=)
app.get('/api/export', requireAuth, (req, res) => {
  try {
    const casaId = req.query.casa_id || null;
    const items = ItemRepo.getAll(casaId);
    const headers = ['id', 'casa_id', 'nombre', 'seccion', 'categoria', 'cantidad', 'estado', 'etiqueta_destino', 'precio_venta', 'notas', 'fotos', 'fecha_registro'];

    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = items.map(i => [
      escapeCSV(i.id),
      escapeCSV(i.casa_id),
      escapeCSV(i.nombre),
      escapeCSV(i.seccion),
      escapeCSV(i.categoria || 'Mobiliario'),
      escapeCSV(i.cantidad || 1),
      escapeCSV(i.estado),
      escapeCSV(i.etiqueta_destino),
      escapeCSV(i.precio_venta !== null && i.precio_venta !== undefined ? i.precio_venta : ''),
      escapeCSV(i.notas || ''),
      escapeCSV(Array.isArray(i.fotos) ? i.fotos.join('; ') : ''),
      escapeCSV(i.fecha_registro)
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inventario_hogar.csv"');
    res.send(Buffer.from(csvContent, 'utf-8'));
  } catch (error) {
    console.error('Error al exportar CSV:', error);
    res.status(500).send('Error generando CSV');
  }
});

// =============================================================================
// API REST - COPIA DE SEGURIDAD Y RESTAURACIÓN (ZIP CON SQLITE Y FOTOS)
// =============================================================================

// Exportar copia de seguridad completa en ZIP
app.get('/api/backup/export', requireAuth, (req, res) => {
  try {
    flushAndCheckpoint();

    const sections = SectionRepo.getAll();
    const items = ItemRepo.getAll();

    const backupInfo = {
      appName: 'Inventario para el Hogar',
      version: '1.0',
      createdAt: new Date().toISOString(),
      sectionsCount: sections.length,
      itemsCount: items.length
    };

    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const zipFilename = `backup_inventario_${dateStr}.zip`;

    const zip = new AdmZip();

    // 1. Metadatos del respaldo
    zip.addFile('backup_info.json', Buffer.from(JSON.stringify(backupInfo, null, 2), 'utf-8'));

    // 2. Base de datos SQLite completa
    if (fs.existsSync(DB_PATH)) {
      zip.addLocalFile(DB_PATH);
    }

    // 3. Carpeta de fotos completas
    if (fs.existsSync(UPLOADS_DIR)) {
      const uploadFiles = fs.readdirSync(UPLOADS_DIR);
      uploadFiles.forEach(file => {
        const fullPath = path.join(UPLOADS_DIR, file);
        if (fs.statSync(fullPath).isFile()) {
          zip.addLocalFile(fullPath, 'uploads');
        }
      });
    }

    const zipBuffer = zip.toBuffer();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);
  } catch (error) {
    console.error('Error al exportar backup ZIP:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error al exportar copia de seguridad' });
  }
});

// Directorio temporal para procesar subidas de backup
const TEMP_DIR = path.join(DATA_DIR, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const zipUpload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 250 * 1024 * 1024 } // 250 MB máximo
});

// Restaurar copia de seguridad desde archivo ZIP
app.post('/api/backup/restore', requireAuth, zipUpload.single('backup_zip'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se envió ningún archivo de respaldo (.zip)' });
    }

    const zipFilePath = req.file.path;
    const zip = new AdmZip(zipFilePath);
    const zipEntries = zip.getEntries();

    // Validar que el archivo ZIP contenga la base de datos
    const dbEntry = zipEntries.find(e => e.entryName === 'inventario.sqlite' || e.entryName.endsWith('/inventario.sqlite'));
    if (!dbEntry) {
      if (fs.existsSync(zipFilePath)) fs.unlinkSync(zipFilePath);
      return res.status(400).json({ error: 'El archivo ZIP no contiene una base de datos válida (inventario.sqlite).' });
    }

    // 1. Crear copia de respaldo de reversión (Rollback pre-restore)
    if (fs.existsSync(DB_PATH)) {
      flushAndCheckpoint();
      const rollbackFile = path.join(DATA_DIR, `inventario_pre_restore_${Date.now()}.sqlite`);
      fs.copyFileSync(DB_PATH, rollbackFile);
    }

    // 2. Cerrar la conexión SQLite activa
    closeDatabase();

    // 3. Extraer y sobreescribir inventario.sqlite
    fs.writeFileSync(DB_PATH, dbEntry.getData());

    // 4. Extraer fotos contenidas en uploads/
    zipEntries.forEach(entry => {
      if ((entry.entryName.startsWith('uploads/') || entry.entryName.includes('/uploads/')) && !entry.isDirectory) {
        const filename = path.basename(entry.entryName);
        if (filename) {
          const targetPath = path.join(UPLOADS_DIR, filename);
          fs.writeFileSync(targetPath, entry.getData());
        }
      }
    });

    // 5. Reabrir conexión SQLite y aplicar pragmas
    reopenDatabase();

    // Limpiar archivo ZIP temporal
    if (fs.existsSync(zipFilePath)) fs.unlinkSync(zipFilePath);

    const sections = SectionRepo.getAll();
    const items = ItemRepo.getAll();

    res.json({
      success: true,
      message: 'Copia de seguridad restaurada correctamente',
      sectionsCount: sections.length,
      itemsCount: items.length
    });
  } catch (error) {
    console.error('Error restaurando backup ZIP:', error);
    try { reopenDatabase(); } catch (e) {}
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ error: 'Error al restaurar la copia de seguridad: ' + error.message });
  }
});

// Health check para Coolify y Docker
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: 'sqlite-connected',
    dataDir: DATA_DIR
  });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Inventario para el Hogar PWA + SQL Backend`);
  console.log(`🌐 Servidor activo en: http://localhost:${PORT}`);
  console.log(`📁 Directorio de datos persistentes: ${DATA_DIR}`);
  console.log(`📸 Almacén de fotos: ${UPLOADS_DIR}`);
  console.log(`======================================================\n`);
});
