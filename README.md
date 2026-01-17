# almacen — PostgreSQL + Web + Salidas + Alertas email (Gmail SMTP)

✅ Web: `/`

✅ API (requiere login):
- `GET /productos`
- `POST /productos` body: `{ "referencia": 412219, "nombre": "...", "existencias": 5, "stock_minimo": 3 }`
- `POST /productos/:referencia/salida` body: `{ "cantidad": 2 }`
- `POST /admin/vaciar-bd`
- `GET /api/health`

📧 Alerta por email (Gmail SMTP)
- Se envía cuando `existencias <= stock_minimo` y `alerta_enviada = false`
- Marca `alerta_enviada=true` para evitar repetidos

## Variables en Railway (servicio `almacen`)
- `DATABASE_URL` = `${{ Postgres.DATABASE_URL }}`
- `JWT_SECRET` = (recomendado)
- `AUTH_USER` / `AUTH_PASS` = credenciales login (opcional)

### Gmail SMTP
- `SMTP_HOST` = `smtp.gmail.com`
- `SMTP_PORT` = `587`
- `SMTP_USER` = tu gmail
- `SMTP_PASS` = **App Password** de Gmail (16 caracteres)
- `ALERT_EMAIL_TO` = correo que recibe las alertas
- `SMTP_FROM` = ej: `Almacen <tu_gmail@gmail.com>`

## Nota (DB)
Si tu tabla `productos` ya existe, asegúrate de tener estas columnas:
```sql
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS referencia INTEGER,
  ADD COLUMN IF NOT EXISTS stock_minimo INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS alerta_enviada BOOLEAN NOT NULL DEFAULT false;
```

Y recomienda un índice único:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS productos_referencia_uq ON productos (referencia);
```
