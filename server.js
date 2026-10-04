/**
 * SERVIDOR EXPRESS CON PERSISTENCIA SQL Y CARGA DE FOTOS
 * Listo para ejecución local y despliegue en contenedor Docker / Coolify
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { SectionRepo, ItemRepo, UPLOADS_DIR, DATA_DIR } = require('./db');

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

// Middlewares
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Servir fotos subidas
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
// API REST - SECCIONES
// =============================================================================

// Listar todas las secciones
app.get('/api/sections', (req, res) => {
  try {
    const sections = SectionRepo.getAll();
    res.json(sections);
  } catch (error) {
    console.error('Error al obtener secciones:', error);
    res.status(500).json({ error: 'Error al obtener secciones de la base de datos' });
  }
});

// Crear nueva sección
app.post('/api/sections', (req, res) => {
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
app.put('/api/sections/:id', (req, res) => {
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
app.delete('/api/sections/:id', (req, res) => {
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
// API REST - ÍTEMS CON FOTOS
// =============================================================================

// Listar todos los ítems
app.get('/api/items', (req, res) => {
  try {
    const items = ItemRepo.getAll();
    res.json(items);
  } catch (error) {
    console.error('Error al obtener ítems:', error);
    res.status(500).json({ error: 'Error al consultar ítems en SQL' });
  }
});

// Crear nuevo ítem
app.post('/api/items', (req, res) => {
  try {
    const { nombre, seccion, estado, etiqueta_destino, precio_venta, notas, fotos } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del ítem es obligatorio' });
    }
    if (!seccion) {
      return res.status(400).json({ error: 'La sección es obligatoria' });
    }

    const id = req.body.id || 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const newItem = ItemRepo.create({
      id,
      nombre: nombre.trim(),
      seccion,
      estado: estado || 'Buen estado',
      etiqueta_destino: etiqueta_destino || 'Guardar',
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
app.put('/api/items/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, seccion, estado, etiqueta_destino, precio_venta, notas, fotos } = req.body;

    const existing = ItemRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Ítem no encontrado' });
    }

    const updated = ItemRepo.update(id, {
      nombre: nombre ? nombre.trim() : undefined,
      seccion,
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
app.delete('/api/items/:id', (req, res) => {
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
app.post('/api/upload', upload.array('fotos', 10), (req, res) => {
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

// Exportación CSV directo desde SQL
app.get('/api/export', (req, res) => {
  try {
    const items = ItemRepo.getAll();
    const headers = ['id', 'nombre', 'seccion', 'estado', 'etiqueta_destino', 'precio_venta', 'notas', 'fotos', 'fecha_registro'];

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
      escapeCSV(i.nombre),
      escapeCSV(i.seccion),
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
