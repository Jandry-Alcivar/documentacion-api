import nodemailer from 'nodemailer';

interface EmailAttachment {
  filename: string;
  path?: string;
  content?: any;
  contentType?: string;
}

interface SendEmailOptions {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

// Configuración de transporte SMTP
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass }
    });
  }

  return null;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; simulated?: boolean; messageId?: string; error?: string }> {
  const from = process.env.SMTP_FROM || '"Sistema de Gestión Documental" <notificaciones@gestiondocumental.gob>';
  const toList = Array.isArray(options.to) ? options.to.filter(Boolean).join(', ') : options.to;
  const ccList = Array.isArray(options.cc) ? options.cc.filter(Boolean).join(', ') : options.cc;

  if (!toList || toList.trim() === '') {
    console.warn('[MAILER] No se especificó destinatario (to) válido.');
    return { success: false, error: 'Sin destinatarios válidos' };
  }

  const transporter = createTransporter();

  if (!transporter) {
    console.log('\n✉️ ========== [SIMULACIÓN DE CORREO ELECTRÓNICO] ==========');
    console.log(`De: ${from}`);
    console.log(`Para (TO): ${toList}`);
    if (ccList) console.log(`Con Copia (CC): ${ccList}`);
    console.log(`Asunto: ${options.subject}`);
    console.log(`Adjuntos: ${options.attachments?.map(a => a.filename).join(', ') || 'Ninguno'}`);
    console.log('-----------------------------------------------------------');
    console.log('Cuerpo HTML (Resumen):', options.html.replace(/<[^>]*>?/gm, ' ').substring(0, 300) + '...');
    console.log('===========================================================\n');
    return { success: true, simulated: true };
  }

  try {
    const info = await transporter.sendMail({
      from,
      to: toList,
      cc: ccList || undefined,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments
    });

    console.log(`[MAILER] Correo enviado exitosamente a ${toList}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error('[MAILER ERROR] Falló el envío de correo:', error.message);
    return { success: false, error: error.message };
  }
}

// Plantilla base HTML con diseño institucional premium
export function buildEmailTemplate({
  headerTitle,
  procedureCode,
  subject,
  applicantName,
  mainContent,
  badgeText,
  badgeColor = '#4f46e5',
  actionUrl
}: {
  headerTitle: string;
  procedureCode: string;
  subject: string;
  applicantName?: string;
  mainContent: string;
  badgeText?: string;
  badgeColor?: string;
  actionUrl?: string;
}): string {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
    <style>
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f172a; color: #e2e8f0; margin: 0; padding: 20px; }
      .container { max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; overflow: hidden; border: 1px solid #334155; }
      .header { background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 24px; text-align: center; border-bottom: 1px solid #4338ca; }
      .header h1 { margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
      .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; background-color: ${badgeColor}; color: white; margin-top: 8px; }
      .content { padding: 24px; line-height: 1.6; font-size: 14px; color: #cbd5e1; }
      .card { background: #0f172a; border-radius: 8px; padding: 16px; margin: 16px 0; border-left: 4px solid #6366f1; }
      .card-item { margin-bottom: 8px; }
      .card-item strong { color: #f8fafc; }
      .btn { display: inline-block; background: #4f46e5; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 16px; text-align: center; }
      .footer { background: #0f172a; padding: 16px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #1e293b; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>${headerTitle}</h1>
        ${badgeText ? `<div class="badge">${badgeText}</div>` : ''}
      </div>
      <div class="content">
        <div class="card">
          <div class="card-item"><strong>N° Expediente / Trámite:</strong> ${procedureCode}</div>
          <div class="card-item"><strong>Asunto:</strong> ${subject}</div>
          ${applicantName ? `<div class="card-item"><strong>Solicitante:</strong> ${applicantName}</div>` : ''}
        </div>
        <div>
          ${mainContent}
        </div>
        ${actionUrl ? `<div style="text-align: center;"><a href="${actionUrl}" class="btn">Ver Expediente en el Sistema</a></div>` : ''}
      </div>
      <div class="footer">
        <p>Este es un correo automático generado por el Sistema de Gestión Documental y Trámites.</p>
        <p>© ${new Date().getFullYear()} Plataforma Institucional. Todos los derechos reservados.</p>
      </div>
    </div>
  </body>
  </html>
  `;
}
