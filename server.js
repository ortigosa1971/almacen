import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { initDb } from "./seed.js";
import { pool, query } from "./db.js";
import { enviarAlertaStock } from "./mailer.js";

const app = express();
app.use(express.json());

// --- Auth (JWT) ---
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const AUTH_USER = process.env.AUTH_USER || "admin";
const AUTH_PASS = process.env.AUTH_PASS || "admin123";
const AUTH_PASS_HASH = bcrypt.hashSync(AUTH_PASS, 10);

function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = getCookie(req, "token");
  const token = bearer || cookieToken;

  if (!token) return res.status(401).json({ error: "Auth requerida" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

function isAuthed(req) {
  const token = getCookie(req, "token");
  if (!token) return false;
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

// ✅ Web (protegida)
app.get("/login", (req, res) => {
  res.sendFile(new URL("./public/login.html", import.meta.url).pathname);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username !== AUTH_USER) return res.status(401).json({ error: "Credenciales inválidas" });
  const ok = bcrypt.compareSync(String(password || ""), AUTH_PASS_HASH);
  if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "1h" });

  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 1000
  });

  res.json({ token, user: { username } });
});

app.post("/logout", (req, res) => {
  res.cookie("token", "", { httpOnly: true, sameSite: "lax", maxAge: 0 });
  res.json({ ok: true });
});

// Home: si no hay login, muestra la pantalla de login
app.get("/", (req, res) => {
  const file = isAuthed(req) ? "./public/index.html" : "./public/login.html";
  res.sendFile(new URL(file, import.meta.url).pathname);
});

// (Opcional) accesos directos
app.get("/index.html", (req, res) => {
  if (!isAuthed(req)) return res.redirect(302, "/login");
  res.sendFile(new URL("./public/index.html", import.meta.url).pathname);
});
app.get("/login.html", (req, res) => {
  res.sendFile(new URL("./public/login.html", import.meta.url).pathname);
});

// Protege toda la API bajo /productos
app.use("/productos", authMiddleware);

// ✅ Admin: vaciar tabla productos (requiere login)
app.post("/admin/vaciar-bd", authMiddleware, async (req, res) => {
  try {
    await query("TRUNCATE TABLE productos RESTART IDENTITY CASCADE;");
    res.json({ ok: true, mensaje: "✅ Base de datos vaciada (tabla productos)" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Error vaciando la base de datos" });
  }
});

const PORT = process.env.PORT || 3000;

app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1;");
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// API: listar
app.get("/productos", async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT id, referencia, nombre, existencias, stock_minimo, alerta_enviada FROM productos ORDER BY referencia;"
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error leyendo productos" });
  }
});

// API: crear
app.post("/productos", async (req, res) => {
  try {
    const { referencia, nombre, existencias, stock_minimo } = req.body;

    // Acepta referencia como número o como texto numérico (para BDs donde referencia sea TEXT)
    const refStr = String(referencia ?? "").trim();
    if (!/^[0-9]+$/.test(refStr) || Number(refStr) <= 0) {
      return res.status(400).json({ error: "Requiere: referencia (número > 0)" });
    }

    if (!nombre || typeof existencias !== "number" || existencias < 0) {
      return res
        .status(400)
        .json({ error: "Requiere: nombre (string) y existencias (number >= 0)" });
    }

    const stockMin =
      typeof stock_minimo === "number" && Number.isFinite(stock_minimo) && stock_minimo >= 0
        ? Math.floor(stock_minimo)
        : 0;

    const { rows } = await query(
      "INSERT INTO productos (referencia, nombre, existencias, stock_minimo, alerta_enviada) VALUES ($1, $2, $3, $4, false) RETURNING referencia, nombre, existencias, stock_minimo, alerta_enviada;",
      [refStr, nombre, existencias, stockMin]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error creando producto" });
  }
});

// API: salida + alerta email
app.post("/productos/:referencia/salida", async (req, res) => {
  const client = await pool.connect();
  try {
    const referenciaParam = String(req.params.referencia ?? "").trim();
    const { cantidad } = req.body;

    // Soporta referencia en BD como INTEGER o como TEXT.
    // Comparamos siempre contra referencia::text.
    if (!/^[0-9]+$/.test(referenciaParam) || Number(referenciaParam) <= 0) {
      return res.status(400).json({ error: "referencia inválida" });
    }
    if (typeof cantidad !== "number" || !Number.isFinite(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: "cantidad debe ser number > 0" });
    }

    await client.query("BEGIN");

    // 1) Leemos y bloqueamos la fila para que 2 salidas simultáneas no se pisen
    const cur = await client.query(
      "SELECT referencia, nombre, existencias, stock_minimo, alerta_enviada FROM productos WHERE referencia::text = $1 FOR UPDATE;",
      [referenciaParam]
    );

    if (!cur.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const actual = cur.rows[0];
    const existenciasActuales = Number(actual.existencias);

    // 2) Si no hay stock suficiente, NO restamos y devolvemos detalle para que el front lo muestre
    if (existenciasActuales < cantidad) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "No hay existencias suficientes",
        detalle: {
          referencia: actual.referencia,
          nombre: actual.nombre,
          existencias_actuales: existenciasActuales,
          cantidad_solicitada: cantidad
        }
      });
    }

    // 3) Restamos
    const upd = await client.query(
      "UPDATE productos SET existencias = existencias - $1 WHERE referencia::text = $2 RETURNING referencia, nombre, existencias, stock_minimo, alerta_enviada;",
      [cantidad, referenciaParam]
    );

    let producto = upd.rows[0];

    // Si cae a <= stock_minimo y aún no hay alerta -> marcar + enviar
    if (producto.existencias <= producto.stock_minimo && !producto.alerta_enviada) {
      await client.query("UPDATE productos SET alerta_enviada = true WHERE referencia::text = $1;", [referenciaParam]);

      // Enviar email con Gmail SMTP (destino: ALERT_EMAIL_TO)
      await enviarAlertaStock({
        referencia: producto.referencia,
        nombre: producto.nombre,
        existencias: producto.existencias,
        stock_minimo: producto.stock_minimo
      });

      producto = { ...producto, alerta_enviada: true };
    }

    await client.query("COMMIT");
    res.json({ ok: true, producto });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "Error registrando salida" });
  } finally {
    client.release();
  }
});

(async () => {
  try {
    await initDb();
    app.listen(PORT, () => console.log(`🚀 Running on port ${PORT}`));
  } catch (e) {
    console.error("❌ Error inicializando DB:", e);
    process.exit(1);
  }
})();
