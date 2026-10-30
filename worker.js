/**
 * CRM Asopiel — Cloudflare Worker
 * API REST sobre D1 para gestión de contactos y fichas
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname.replace(/\/$/, '');
    const method = request.method.toUpperCase();

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── CONTACTOS ────────────────────────────────────────────────

    // GET /api/contactos — listar con filtros opcionales
    if (method === 'GET' && path === '/api/contactos') {
      const tipo   = url.searchParams.get('tipo');
      const estado = url.searchParams.get('estado');
      const canal  = url.searchParams.get('canal');
      const q      = url.searchParams.get('q');

      let sql    = 'SELECT * FROM contactos WHERE 1=1';
      const args = [];

      if (tipo)   { sql += ' AND tipo=?';   args.push(tipo); }
      if (estado) { sql += ' AND estado=?'; args.push(estado); }
      if (canal)  { sql += ' AND canal=?';  args.push(canal); }
      if (q) {
        sql += ' AND (nombre LIKE ? OR empresa LIKE ? OR email LIKE ?)';
        const like = `%${q}%`;
        args.push(like, like, like);
      }
      sql += ' ORDER BY id DESC';

      const { results } = await env.DB.prepare(sql).bind(...args).all();
      return json(results);
    }

    // GET /api/contactos/:id — detalle con ficha
    const matchId = path.match(/^\/api\/contactos\/(\d+)$/);
    if (method === 'GET' && matchId) {
      const id = matchId[1];
      const contacto = await env.DB.prepare(
        'SELECT * FROM contactos WHERE id=?'
      ).bind(id).first();
      if (!contacto) return err('Contacto no encontrado', 404);

      const ficha = await env.DB.prepare(
        'SELECT * FROM fichas WHERE contacto_id=? ORDER BY id DESC LIMIT 1'
      ).bind(id).first();

      return json({ ...contacto, ficha: ficha || null });
    }

    // POST /api/contactos — crear
    if (method === 'POST' && path === '/api/contactos') {
      let body;
      try { body = await request.json(); } catch { return err('JSON inválido'); }

      const { nombre, email, tipo, canal } = body;
      if (!nombre || !email || !tipo || !canal) {
        return err('Campos obligatorios: nombre, email, tipo, canal');
      }

      const idioma = ['es','en','fr'].includes(body.idioma) ? body.idioma : 'es';

      const result = await env.DB.prepare(`
        INSERT INTO contactos (nombre, empresa, email, telefono, tipo, canal, idioma,
                               estado, precio_web, dominio_analisis, notas)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        nombre,
        body.empresa || null,
        email,
        body.telefono || null,
        tipo,
        canal,
        idioma,
        body.estado || 'nuevo',
        body.precio_web ?? null,
        body.dominio_analisis || null,
        body.notas || null
      ).run();

      const nuevo = await env.DB.prepare(
        'SELECT * FROM contactos WHERE id=?'
      ).bind(result.meta.last_row_id).first();

      return json(nuevo, 201);
    }

    // PATCH /api/contactos/:id — actualizar campos
    const matchPatch = path.match(/^\/api\/contactos\/(\d+)$/);
    if ((method === 'PATCH' || method === 'PUT') && matchPatch) {
      const id = matchPatch[1];
      let body;
      try { body = await request.json(); } catch { return err('JSON inválido'); }

      const allowed = ['nombre','empresa','email','telefono','tipo','canal',
                       'idioma','estado','precio_web','dominio_analisis','notas'];
      const sets = [];
      const args = [];

      for (const key of allowed) {
        if (key in body) {
          sets.push(`${key}=?`);
          args.push(body[key]);
        }
      }
      if (sets.length === 0) return err('Nada que actualizar');

      sets.push("fecha_update=datetime('now')");
      args.push(id);

      await env.DB.prepare(
        `UPDATE contactos SET ${sets.join(',')} WHERE id=?`
      ).bind(...args).run();

      const updated = await env.DB.prepare(
        'SELECT * FROM contactos WHERE id=?'
      ).bind(id).first();

      return json(updated);
    }

    // DELETE /api/contactos/:id
    const matchDel = path.match(/^\/api\/contactos\/(\d+)$/);
    if (method === 'DELETE' && matchDel) {
      const id = matchDel[1];
      await env.DB.prepare('DELETE FROM contactos WHERE id=?').bind(id).run();
      return json({ ok: true });
    }

    // ── FICHAS ───────────────────────────────────────────────────

    // POST /api/contactos/:id/ficha — guardar ficha recibida
    const matchFicha = path.match(/^\/api\/contactos\/(\d+)\/ficha$/);
    if (method === 'POST' && matchFicha) {
      const contacto_id = matchFicha[1];
      let body;
      try { body = await request.json(); } catch { return err('JSON inválido'); }

      const result = await env.DB.prepare(`
        INSERT INTO fichas (contacto_id, proposito, produccion_prev, volumen,
                            presupuesto, necesidades, fecha_inicio, observaciones)
        VALUES (?,?,?,?,?,?,?,?)
      `).bind(
        contacto_id,
        body.proposito || null,
        body.produccion_prev || null,
        body.volumen || null,
        body.presupuesto ?? null,
        body.necesidades ? JSON.stringify(body.necesidades) : null,
        body.fecha_inicio || null,
        body.observaciones || null
      ).run();

      // Avanzar estado a 'ficha'
      await env.DB.prepare(
        "UPDATE contactos SET estado='ficha', fecha_update=datetime('now') WHERE id=?"
      ).bind(contacto_id).run();

      const ficha = await env.DB.prepare(
        'SELECT * FROM fichas WHERE id=?'
      ).bind(result.meta.last_row_id).first();

      return json(ficha, 201);
    }

    // ── ESTADÍSTICAS ─────────────────────────────────────────────

    // GET /api/stats
    if (method === 'GET' && path === '/api/stats') {
      const [totales, porTipo, porEstado, porCanal] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as total FROM contactos').first(),
        env.DB.prepare('SELECT tipo, COUNT(*) as n FROM contactos GROUP BY tipo').all(),
        env.DB.prepare('SELECT estado, COUNT(*) as n FROM contactos GROUP BY estado').all(),
        env.DB.prepare('SELECT canal, COUNT(*) as n FROM contactos GROUP BY canal').all(),
      ]);
      return json({
        total:     totales.total,
        por_tipo:  porTipo.results,
        por_estado:porEstado.results,
        por_canal: porCanal.results,
      });
    }

    return err('Ruta no encontrada', 404);
  }
};
