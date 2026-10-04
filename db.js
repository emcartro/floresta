/**
 * CAPA DE BASE DE DATOS SQL (SQLite nativo de Node.js)
 * Almacena secciones, artículos y metadatos con soporte de persistencia en disco
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Directorio persistente de datos (configurable por variable de entorno para Docker/Coolify)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'inventario.sqlite');

// Asegurar que los directorios existan
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Inicializar conexión SQLite
const db = new DatabaseSync(DB_PATH);

// Configuración pragmas recomendados para SQLite (WAL mode, foreign keys, UTF-8)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    nombre TEXT UNIQUE NOT NULL,
    icono TEXT DEFAULT '📦',
    descripcion TEXT,
    orden INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    seccion TEXT NOT NULL,
    estado TEXT NOT NULL,
    etiqueta_destino TEXT NOT NULL,
    precio_venta REAL,
    notas TEXT,
    fotos TEXT DEFAULT '[]',
    fecha_registro TEXT NOT NULL,
    FOREIGN KEY (seccion) REFERENCES sections(nombre) ON UPDATE CASCADE ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_items_seccion ON items(seccion);
  CREATE INDEX IF NOT EXISTS idx_items_destino ON items(etiqueta_destino);
`);

// Migración y siembra de datos iniciales
function seedInitialData() {
  const sectionsCount = db.prepare('SELECT COUNT(*) as count FROM sections').get().count;

  if (sectionsCount === 0) {
    console.log('🌱 Inicializando secciones predeterminadas en SQL...');
    const defaultSections = [
      { id: 'sec_sala', nombre: 'Sala', icono: '🛋️', descripcion: 'Área común y descanso principal', orden: 1 },
      { id: 'sec_cuarto_p', nombre: 'Cuarto Principal', icono: '🛏️', descripcion: 'Dormitorio master', orden: 2 },
      { id: 'sec_cuarto_s', nombre: 'Cuarto Secundario', icono: '🛌', descripcion: 'Habitación de visitas o niños', orden: 3 },
      { id: 'sec_bano', nombre: 'Baño', icono: '🚿', descripcion: 'Baño principal y social', orden: 4 },
      { id: 'sec_cocina', nombre: 'Cocina', icono: '🍳', descripcion: 'Electrodomésticos y utensilios', orden: 5 },
      { id: 'sec_comedor', nombre: 'Comedor', icono: '🍽️', descripcion: 'Mesa y vajilla', orden: 6 },
      { id: 'sec_estudio', nombre: 'Estudio', icono: '💻', descripcion: 'Oficina y computadores', orden: 7 },
      { id: 'sec_patio', nombre: 'Patio/Balcón', icono: '🪴', descripcion: 'Plantas, exteriores y balcón', orden: 8 }
    ];

    const insertSec = db.prepare(`
      INSERT INTO sections (id, nombre, icono, descripcion, orden, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    defaultSections.forEach(s => {
      insertSec.run(s.id, s.nombre, s.icono, s.descripcion, s.orden, now);
    });
  }

  const itemsCount = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
  if (itemsCount === 0) {
    console.log('🌱 Inicializando ítems de ejemplo en SQL...');
    const defaultItems = [
      { id: 'item_seed_1', nombre: 'Cuadro principal', seccion: 'Sala', estado: 'Excelente', etiqueta_destino: 'Guardar', precio_venta: null, notas: 'Marco de madera dorada', fotos: '[]', fecha_registro: new Date(Date.now() - 3600000 * 5).toISOString() },
      { id: 'item_seed_2', nombre: 'Comedor', seccion: 'Sala', estado: 'Buen estado', etiqueta_destino: 'Guardar', precio_venta: null, notas: 'Mesa con 6 sillas de roble', fotos: '[]', fecha_registro: new Date(Date.now() - 3600000 * 4).toISOString() },
      { id: 'item_seed_3', nombre: 'Estatua', seccion: 'Sala', estado: 'Excelente', etiqueta_destino: 'Vender', precio_venta: 80000, notas: 'Escultura decorativa de bronce', fotos: '[]', fecha_registro: new Date(Date.now() - 3600000 * 3).toISOString() },
      { id: 'item_seed_4', nombre: 'Panel', seccion: 'Sala', estado: 'Buen estado', etiqueta_destino: 'Guardar', precio_venta: null, notas: 'Panel acústico de pared', fotos: '[]', fecha_registro: new Date(Date.now() - 3600000 * 2).toISOString() },
      { id: 'item_seed_5', nombre: 'Lámpara', seccion: 'Sala', estado: 'Regular', etiqueta_destino: 'Donar', precio_venta: null, notas: 'Lámpara de pie de lectura', fotos: '[]', fecha_registro: new Date(Date.now() - 3600000 * 1).toISOString() },
      { id: 'item_seed_6', nombre: 'Sofá', seccion: 'Sala', estado: 'Buen estado', etiqueta_destino: 'Guardar', precio_venta: null, notas: 'Sofá de 3 puestos color gris', fotos: '[]', fecha_registro: new Date().toISOString() }
    ];

    const insertItem = db.prepare(`
      INSERT INTO items (id, nombre, seccion, estado, etiqueta_destino, precio_venta, notas, fotos, fecha_registro)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    defaultItems.forEach(i => {
      insertItem.run(i.id, i.nombre, i.seccion, i.estado, i.etiqueta_destino, i.precio_venta, i.notas, i.fotos, i.fecha_registro);
    });
  }
}

seedInitialData();

// =============================================================================
// REPOSITORIOS / MÉTODOS CRUD
// =============================================================================

const SectionRepo = {
  getAll() {
    const query = db.prepare(`
      SELECT s.*, COUNT(i.id) as item_count 
      FROM sections s
      LEFT JOIN items i ON s.nombre = i.seccion
      GROUP BY s.id
      ORDER BY s.orden ASC, s.created_at ASC
    `);
    return query.all();
  },

  getById(id) {
    const query = db.prepare('SELECT * FROM sections WHERE id = ?');
    return query.get(id);
  },

  getByName(nombre) {
    const query = db.prepare('SELECT * FROM sections WHERE nombre = ?');
    return query.get(nombre);
  },

  create({ id, nombre, icono, descripcion, orden }) {
    const stmt = db.prepare(`
      INSERT INTO sections (id, nombre, icono, descripcion, orden, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    stmt.run(id, nombre, icono || '📦', descripcion || '', orden || 99, now);
    return this.getById(id);
  },

  update(id, { nombre, icono, descripcion, orden }) {
    const existing = this.getById(id);
    if (!existing) return null;

    // Si cambia el nombre, actualizar en cascada los items
    if (nombre && nombre !== existing.nombre) {
      const updateItems = db.prepare('UPDATE items SET seccion = ? WHERE seccion = ?');
      updateItems.run(nombre, existing.nombre);
    }

    const stmt = db.prepare(`
      UPDATE sections 
      SET nombre = COALESCE(?, nombre),
          icono = COALESCE(?, icono),
          descripcion = COALESCE(?, descripcion),
          orden = COALESCE(?, orden)
      WHERE id = ?
    `);
    stmt.run(nombre, icono, descripcion, orden, id);
    return this.getById(id);
  },

  delete(id) {
    const existing = this.getById(id);
    if (!existing) return { deleted: false, reason: 'not_found' };

    // Verificar si existen ítems en esta sección
    const countCheck = db.prepare('SELECT COUNT(*) as count FROM items WHERE seccion = ?').get(existing.nombre);
    if (countCheck.count > 0) {
      return { 
        deleted: false, 
        reason: 'has_items', 
        itemCount: countCheck.count,
        sectionName: existing.nombre
      };
    }

    const stmt = db.prepare('DELETE FROM sections WHERE id = ?');
    stmt.run(id);
    return { deleted: true };
  }
};

const ItemRepo = {
  getAll() {
    const query = db.prepare('SELECT * FROM items ORDER BY fecha_registro DESC');
    const rows = query.all();
    return rows.map(row => ({
      ...row,
      fotos: row.fotos ? JSON.parse(row.fotos) : []
    }));
  },

  getById(id) {
    const query = db.prepare('SELECT * FROM items WHERE id = ?');
    const row = query.get(id);
    if (!row) return null;
    return {
      ...row,
      fotos: row.fotos ? JSON.parse(row.fotos) : []
    };
  },

  create({ id, nombre, seccion, estado, etiqueta_destino, precio_venta, notas, fotos, fecha_registro }) {
    const stmt = db.prepare(`
      INSERT INTO items (id, nombre, seccion, estado, etiqueta_destino, precio_venta, notas, fotos, fecha_registro)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const fotosJson = JSON.stringify(Array.isArray(fotos) ? fotos : []);
    const date = fecha_registro || new Date().toISOString();
    stmt.run(
      id,
      nombre,
      seccion,
      estado,
      etiqueta_destino,
      precio_venta !== undefined && precio_venta !== '' && precio_venta !== null ? Number(precio_venta) : null,
      notas || '',
      fotosJson,
      date
    );
    return this.getById(id);
  },

  update(id, { nombre, seccion, estado, etiqueta_destino, precio_venta, notas, fotos }) {
    const existing = this.getById(id);
    if (!existing) return null;

    const stmt = db.prepare(`
      UPDATE items 
      SET nombre = COALESCE(?, nombre),
          seccion = COALESCE(?, seccion),
          estado = COALESCE(?, estado),
          etiqueta_destino = COALESCE(?, etiqueta_destino),
          precio_venta = ?,
          notas = COALESCE(?, notas),
          fotos = COALESCE(?, fotos)
      WHERE id = ?
    `);

    const finalPrecio = (etiqueta_destino === 'Vender' || (existing.etiqueta_destino === 'Vender' && !etiqueta_destino))
      ? (precio_venta !== undefined && precio_venta !== null && precio_venta !== '' ? Number(precio_venta) : existing.precio_venta)
      : null;

    const fotosJson = fotos !== undefined ? JSON.stringify(Array.isArray(fotos) ? fotos : []) : JSON.stringify(existing.fotos);

    stmt.run(
      nombre,
      seccion,
      estado,
      etiqueta_destino,
      finalPrecio,
      notas,
      fotosJson,
      id
    );
    return this.getById(id);
  },

  delete(id) {
    const existing = this.getById(id);
    if (!existing) return false;

    // Eliminar fotos físicas asociadas si están en /uploads/
    if (existing.fotos && Array.isArray(existing.fotos)) {
      existing.fotos.forEach(photoUrl => {
        if (photoUrl && photoUrl.startsWith('/uploads/')) {
          const filename = path.basename(photoUrl);
          const fullPath = path.join(UPLOADS_DIR, filename);
          if (fs.existsSync(fullPath)) {
            try { fs.unlinkSync(fullPath); } catch (e) { /* ignore */ }
          }
        }
      });
    }

    const stmt = db.prepare('DELETE FROM items WHERE id = ?');
    stmt.run(id);
    return true;
  }
};

module.exports = {
  db,
  DATA_DIR,
  UPLOADS_DIR,
  DB_PATH,
  SectionRepo,
  ItemRepo
};
