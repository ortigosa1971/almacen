import { query } from "./db.js";

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS productos (
      id SERIAL PRIMARY KEY,
      referencia TEXT,
      nombre TEXT NOT NULL,
      existencias INTEGER NOT NULL CHECK (existencias >= 0),
      stock_minimo INTEGER NOT NULL DEFAULT 0,
      alerta_enviada BOOLEAN NOT NULL DEFAULT false
    );
  `);

  // ✅ Migraciones suaves (para BDs ya existentes)
  // Si la tabla se creó antes de añadir columnas nuevas, las añadimos aquí.
  await query(`
    ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS stock_minimo INTEGER NOT NULL DEFAULT 0;
  `);
  await query(`
    ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS alerta_enviada BOOLEAN NOT NULL DEFAULT false;
  `);
  await query(`
    ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS referencia TEXT;
  `);

  // ✅ Si referencia existía con otro tipo (p.ej. INTEGER), lo pasamos a TEXT para compatibilidad.
  // (Soporta tanto instalaciones viejas como ediciones manuales en pgAdmin.)
  try {
    const info = await query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'productos' AND column_name = 'referencia' LIMIT 1;`
    );
    const dt = info.rows?.[0]?.data_type;
    if (dt && dt !== 'text') {
      await query(`ALTER TABLE productos ALTER COLUMN referencia TYPE TEXT USING referencia::text;`);
    }
  } catch (e) {
    // si falla esta migración, no impedimos el arranque; la API ya compara referencia::text
    console.warn('ℹ️ No se pudo convertir referencia a TEXT:', e?.message || e);
  }

  // ✅ Migración: asignar referencia a productos existentes (si venían de un id antiguo)
  await query(`
    UPDATE productos
    SET referencia = id
    WHERE referencia IS NULL;
  `);

  // ✅ Asegurar unicidad y obligatoriedad
  await query(`
    ALTER TABLE productos
      ALTER COLUMN referencia SET NOT NULL;
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS productos_referencia_uq ON productos (referencia);
  `);

  // ✅ Ya no usamos creado_en
  await query(`
    ALTER TABLE productos
      DROP COLUMN IF EXISTS creado_en;
  `);

  const { rows } = await query("SELECT COUNT(*)::int AS n FROM productos;");
  const n = rows?.[0]?.n ?? 0;

  if (n === 0) {
    const values = [];
    const params = [];
    let p = 1;

    for (let i = 0; i < 30; i++) {
      values.push(`($${p++}, $${p++}, $${p++})`);
      params.push(1000 + i + 1, `Producto ${i + 1}`, 10 + (i % 7));
    }

    await query(
      `INSERT INTO productos (referencia, nombre, existencias) VALUES ${values.join(",")};`,
      params
    );

    console.log("✅ Seed PostgreSQL: insertados 30 productos");
  } else {
    console.log(`ℹ️ Seed PostgreSQL: ya hay ${n} productos`);
  }
}
