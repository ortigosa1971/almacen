import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true") === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendLowStockEmail(rows) {
  if (!rows || rows.length === 0) return;

  const to = process.env.ALERT_TO_EMAIL;
  if (!to) throw new Error("Falta ALERT_TO_EMAIL en el entorno");

  const from = process.env.ALERT_FROM_EMAIL || process.env.SMTP_USER;

  const htmlRows = rows
    .map(
      (r) => `
      <tr>
        <td>${r.codigo ?? ""}</td>
        <td>${r.nombre ?? ""}</td>
        <td style="text-align:right">${r.cantidad ?? ""}</td>
        <td style="text-align:right">${r.stock_minimo ?? ""}</td>
      </tr>`
    )
    .join("");

  await transporter.sendMail({
    from,
    to,
    subject: `⚠️ Alerta stock mínimo (${rows.length})`,
    html: `
      <h2>Antibióticos por debajo del stock mínimo</h2>
      <table border="1" cellpadding="6" cellspacing="0">
        <thead>
          <tr><th>Código</th><th>Nombre</th><th>Stock</th><th>Mínimo</th></tr>
        </thead>
        <tbody>${htmlRows}</tbody>
      </table>
      <p>Generado por Almacén.</p>
    `,
  });
}
