-- CRM Asopiel — Esquema D1
-- Ejecutar: wrangler d1 execute crm-asopiel-db --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS contactos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT    NOT NULL,
  empresa     TEXT,
  email       TEXT    NOT NULL,
  telefono    TEXT,
  tipo        TEXT    NOT NULL CHECK(tipo IN ('marca','proveedor','institucion','empleo')),
  canal       TEXT    NOT NULL CHECK(canal IN ('web','movex','cade','ayuntamiento','directo','otro')),
  idioma      TEXT    NOT NULL DEFAULT 'es' CHECK(idioma IN ('es','en','fr')),
  estado      TEXT    NOT NULL DEFAULT 'nuevo'
                      CHECK(estado IN ('nuevo','contactado','ficha','valorado','derivado','descartado')),
  precio_web  REAL,
  dominio_analisis TEXT,
  notas       TEXT,
  fecha_entrada TEXT NOT NULL DEFAULT (date('now')),
  fecha_update  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fichas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contacto_id     INTEGER NOT NULL REFERENCES contactos(id) ON DELETE CASCADE,
  proposito       TEXT,
  produccion_prev TEXT,
  volumen         TEXT,
  presupuesto     REAL,
  necesidades     TEXT,   -- JSON array
  fecha_inicio    TEXT,
  observaciones   TEXT,
  fecha_recibida  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contactos_tipo   ON contactos(tipo);
CREATE INDEX IF NOT EXISTS idx_contactos_estado ON contactos(estado);
CREATE INDEX IF NOT EXISTS idx_contactos_canal  ON contactos(canal);
CREATE INDEX IF NOT EXISTS idx_fichas_contacto  ON fichas(contacto_id);
