import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // 587 => STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function enviarAlertaStock({ referencia, nombre, existencias, stock_minimo }) {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) throw new Error("Falta ALERT_EMAIL_TO");
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error("Faltan SMTP_USER / SMTP_PASS");
  }

  const from = process.env.SMTP_FROM || `Almacen <${process.env.SMTP_USER}>`;

  const subject = `⚠️ Stock mínimo: ${nombre} (ref ${referencia}) (quedan ${existencias})`;

  const text =
`Alerta de stock mínimo

Producto: ${nombre}
Referencia: ${referencia}
Quedan: ${existencias}
Stock mínimo: ${stock_minimo}
`;

  await transporter.sendMail({ from, to, subject, text });
}
