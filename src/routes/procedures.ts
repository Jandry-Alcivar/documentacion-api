import { Router } from 'express';
import multer from 'multer';
import * as archiverModule from 'archiver';
import * as fs from 'fs';
import { 
  Procedure, 
  ProcedureMovement, 
  Document, 
  Department, 
  User, 
  DocumentType, 
  ProcedureType, 
  AuditLog, 
  DocStatus, 
  ProcedureStatus
} from '../models/index.js';
import { Op } from 'sequelize';
import { authenticate, requirePermission } from '../middlewares/auth.js';
import { sendEmail, buildEmailTemplate } from '../utils/mailer.js';
import { saveDocumentFile, getAbsolutePathFromUrl } from '../utils/storage.js';
import { calculateBufferHash } from '../utils/hash.js';
import forge from 'node-forge';
import { computeSeal, guardProcedureSealed, getImmutabilityMode, isAdminUser, logAudit } from '../services/seal.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// =========================================================================
// RUTAS PÚBLICAS (ACCESO CIUDADANO SIN AUTENTICACIÓN JWT)
// =========================================================================

// Consulta y Seguimiento Público de Trámite por Código y Cédula
router.get('/public/track', async (request, response) => {
  const { code, applicantId } = request.query as any;

  if (!code || typeof code !== 'string' || code.trim() === '') {
    return response.status(400).json({ error: 'Debe ingresar el código de trámite (ej: TRM-2026-XXXXX).' });
  }

  const andWhere: any[] = [
    { code: { [Op.iLike]: code.trim() } }
  ];

  if (applicantId && typeof applicantId === 'string' && applicantId.trim() !== '') {
    andWhere.push({
      [Op.or]: [
        { applicantId: { [Op.iLike]: `%${applicantId.trim()}%` } },
        { applicantEmail: { [Op.iLike]: `%${applicantId.trim()}%` } }
      ]
    });
  }

  try {
    const procedure = await Procedure.findOne({
      where: { [Op.and]: andWhere },
      include: [
        { association: 'type', attributes: ['name', 'description', 'estimatedDays'] },
        { association: 'department', attributes: ['name'] },
        { 
          association: 'documents',
          where: { isConfidential: false, deletedAt: null },
          required: false,
          attributes: ['id', 'title', 'fileUrl', 'signatures', 'createdAt'],
          include: [{ association: 'type', attributes: ['name'] }]
        },
        {
          association: 'movements',
          attributes: ['id', 'action', 'status', 'typeEnvio', 'createdAt', 'notes'],
          include: [
            { association: 'fromDepartment', attributes: ['name'] },
            { association: 'toDepartment', attributes: ['name'] }
          ],
          order: [['createdAt', 'ASC']]
        }
      ]
    });

    if (!procedure) {
      return response.status(404).json({ error: 'No se encontró ningún trámite con los datos proporcionados.' });
    }

    return response.json(procedure);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// =========================================================================
// RUTAS PROTEGIDAS CON AUTENTICACIÓN
// =========================================================================
router.use(authenticate);

// Inmutabilidad: bloquear modificaciones sobre trámites finalizados/sellados
router.post(['/:id/documents', '/:id/documents/:docId/sign', '/:id/derive', '/:id/return', '/:id/finalize'], guardProcedureSealed);
router.put('/:id', guardProcedureSealed);

// Verificar integridad del sello
router.get('/:id/verify', async (request, response) => {
  try {
    const procedure = await Procedure.findByPk(request.params.id as string);
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });
    const mode = await getImmutabilityMode();
    if (procedure.status !== ProcedureStatus.FINALIZADO && !procedure.sealHash) {
      return response.json({ sealed: false, mode });
    }
    const current = await computeSeal(procedure.id);
    // Trámites finalizados antes de esta función: sello inicial
    if (!procedure.sealHash) {
      await procedure.update({ sealHash: current, sealedAt: new Date(), sealedById: request.user!.id });
      await logAudit(request, 'SEAL', procedure.id, `Sello inicial (retroactivo) ${procedure.code}: ${current}`);
    }
    const valid = procedure.sealHash === current;
    if (!valid) await logAudit(request, 'VERIFY_FAIL', procedure.id,
      `Integridad comprometida en ${procedure.code} (sello ${procedure.sealHash}, actual ${current})`);
    return response.json({
      sealed: true, valid, mode, sealHash: procedure.sealHash, currentHash: current,
      sealedAt: procedure.sealedAt, sealedById: procedure.sealedById
    });
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 1. Listar trámites según vista (Inbox o Historial) y rol
router.get('/', async (request, response) => {
  const user = request.user!;
  const { view, search } = request.query as any;

  const andClause: any[] = [];

  if (view === 'inbox') {
    andClause.push({
      status: {
        [Op.notIn]: ['FINALIZADO', 'CERRADO', 'ARCHIVADO']
      }
    });
  }

  if (user.permissions.includes('all') || user.roleName === 'Administrador') {
    // Admin ve todo
  } else {
    if (view === 'inbox') {
      if (user.roleName === 'Director Departamental') {
        andClause.push({ departmentId: user.departmentId });
      } else {
        andClause.push({
          [Op.or]: [
            { assigneeId: user.id },
            {
              departmentId: user.departmentId,
              assigneeId: null
            }
          ]
        });
      }
    } else {
      andClause.push({ departmentId: user.departmentId });
    }
  }

  if (search) {
    andClause.push({
      [Op.or]: [
        { code: { [Op.iLike]: `%${search}%` } },
        { subject: { [Op.iLike]: `%${search}%` } },
        { applicantName: { [Op.iLike]: `%${search}%` } },
        { applicantId: { [Op.iLike]: `%${search}%` } }
      ]
    });
  }

  const finalWhere = andClause.length > 0 ? { [Op.and]: andClause } : {};

  try {
    const procedures = await Procedure.findAll({
      where: finalWhere,
      include: [
        { association: 'type' },
        { association: 'department' },
        { association: 'assignee', attributes: ['id', 'name', 'email'] },
        { 
          association: 'documents',
          attributes: ['id', 'title', 'status', 'fileUrl', 'createdAt']
        }
      ],
      order: [['createdAt', 'DESC']]
    });
    return response.json(procedures);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 2. Contadores para dashboard / badges de trámites
router.get('/inbox-counts', async (request, response) => {
  const user = request.user!;
  const andClause: any[] = [];

  if (user.permissions.includes('all') || user.roleName === 'Administrador') {
    // Admin ve todo
  } else {
    const orClause: any[] = [{ assigneeId: user.id }];
    if (user.roleName === 'Director Departamental') {
      orClause.push({ departmentId: user.departmentId });
    }
    andClause.push({ [Op.or]: orClause });
  }

  const finalWhere = andClause.length > 0 ? { [Op.and]: andClause } : {};

  try {
    const procedures = await Procedure.findAll({
      where: finalWhere,
      attributes: ['status', 'expirationDate']
    });

    const now = new Date();
    let pending = 0, received = 0, derived = 0, expired = 0, finished = 0;

    for (const p of procedures) {
      if (p.status === 'EN_REVISION' || p.status === 'OBSERVADO') pending++;
      else if (p.status === 'RECIBIDO' || p.status === 'REGISTRADO') received++;
      else if (p.status === 'DERIVADO') derived++;
      else if (p.status === 'FINALIZADO' || p.status === 'CERRADO' || p.status === 'ARCHIVADO') finished++;
      
      if (p.expirationDate && new Date(p.expirationDate) < now && p.status !== 'FINALIZADO' && p.status !== 'CERRADO' && p.status !== 'ARCHIVADO') {
        expired++;
      }
    }

    const totalPending = pending + received + derived;

    return response.json({ totalPending, pending, received, derived, expired, finished });
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 3. Crear nuevo trámite (Folder Principal)
router.post('/', requirePermission(['procedures.create', 'all']), async (request, response) => {
  const data = request.body as any;
  const user = request.user!;
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(10000 + Math.random() * 90000);
  const code = `TRM-${year}-${randomSuffix}`;

  try {
    let expirationDate = data.expirationDate ? new Date(data.expirationDate) : null;
    if (!expirationDate && data.typeId) {
      const procType = await ProcedureType.findByPk(data.typeId);
      if (procType && procType.estimatedDays > 0) {
        expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + procType.estimatedDays);
      }
    }

    const created = await Procedure.create({
      code,
      subject: data.subject,
      description: data.description,
      priority: data.priority || 'NORMAL',
      status: ProcedureStatus.REGISTRADO,
      applicantName: data.applicantName?.trim() || 'Trámite Interno',
      applicantId: data.applicantId || null,
      applicantEmail: data.applicantEmail || null,
      applicantPhone: data.applicantPhone || null,
      applicantAddress: data.applicantAddress || null,
      applicantInstitution: data.applicantInstitution || null,
      expirationDate,
      typeId: data.typeId,
      departmentId: data.departmentId || user.departmentId,
      assigneeId: data.assigneeId || null
    });

    // Registrar movimiento inicial de apertura de expediente
    await ProcedureMovement.create({
      procedureId: created.id,
      fromUserId: user.id,
      fromDepartmentId: user.departmentId,
      toUserId: data.assigneeId || null,
      toDepartmentId: data.departmentId || user.departmentId,
      action: 'CREACION',
      status: ProcedureStatus.REGISTRADO,
      notes: `Apertura de expediente digital. Solicitante: ${created.applicantName}. Asunto: ${data.subject}`,
      typeEnvio: 'PARA',
      sentEmail: !!data.applicantEmail,
      emailRecipients: data.applicantEmail ? { to: [data.applicantEmail], cc: [] } : null
    });

    if (data.applicantEmail) {
      const html = buildEmailTemplate({
        headerTitle: 'Confirmación de Ingreso de Trámite',
        procedureCode: created.code,
        subject: created.subject,
        applicantName: created.applicantName,
        badgeText: 'TRÁMITE REGISTRADO',
        badgeColor: '#10b981',
        mainContent: `
          <p>Estimado(a) <strong>${created.applicantName}</strong>,</p>
          <p>Su trámite ha sido registrado con éxito en nuestro Sistema de Gestión Documental. Su expediente digital se encuentra abierto y ha sido asignado al departamento correspondiente para su pronta atención.</p>
          <p>Puede hacer seguimiento con su código de trámite: <strong>${created.code}</strong>.</p>
        `
      });

      sendEmail({
        to: data.applicantEmail,
        subject: `[${created.code}] Confirmación de Ingreso de Trámite: ${created.subject}`,
        html
      }).catch(err => console.error('Error enviando email al solicitante:', err));
    }

    await AuditLog.create({
      userId: user.id,
      module: 'Trámites',
      action: 'Creación de Expediente',
      recordId: created.id,
      ipAddress: request.ip || '127.0.0.1',
      details: `Expediente creado: ${created.code} - ${created.subject}`
    });

    return response.status(201).json(created);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 4. Obtener detalle completo del Trámite / Expediente Digital
router.get('/:id', async (request, response) => {
  const id = request.params.id as string;
  try {
    const procedure = await Procedure.findByPk(id, {
      include: [
        { association: 'type' },
        { association: 'department' },
        { association: 'assignee', attributes: ['id', 'name', 'email'] },
        { 
          association: 'documents',
          include: [
            { association: 'type' },
            { association: 'creator', attributes: ['id', 'name', 'email'] }
          ]
        },
        {
          association: 'movements',
          include: [
            { association: 'fromUser', attributes: ['id', 'name', 'email'] },
            { association: 'fromDepartment', attributes: ['id', 'name'] },
            { association: 'toUser', attributes: ['id', 'name', 'email'] },
            { association: 'toDepartment', attributes: ['id', 'name'] },
            { association: 'attachedDocument', attributes: ['id', 'title', 'fileUrl', 'signatures'] }
          ],
          order: [['createdAt', 'ASC']]
        }
      ]
    });

    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });
    return response.json(procedure);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 5. Descargar Expediente Completo en ZIP (Dossier con todos los oficios y manifiesto)
router.get('/:id/dossier-zip', async (request, response) => {
  const id = request.params.id as string;

  try {
    const procedure = await Procedure.findByPk(id, {
      include: [
        { association: 'type' },
        { association: 'department' },
        { association: 'assignee', attributes: ['name', 'email'] },
        { association: 'documents' },
        {
          association: 'movements',
          include: [
            { association: 'fromUser', attributes: ['name'] },
            { association: 'fromDepartment', attributes: ['name'] },
            { association: 'toUser', attributes: ['name'] },
            { association: 'toDepartment', attributes: ['name'] }
          ]
        }
      ]
    });

    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    // Instanciación compatible con archiver v7 y v8
    const aModule: any = archiverModule;
    let archive: any;
    if (aModule?.ZipArchive) {
      archive = new aModule.ZipArchive({ zlib: { level: 9 } });
    } else if (typeof aModule === 'function') {
      archive = aModule('zip', { zlib: { level: 9 } });
    } else if (aModule?.default) {
      archive = typeof aModule.default === 'function' ? aModule.default('zip', { zlib: { level: 9 } }) : new aModule.default.ZipArchive({ zlib: { level: 9 } });
    } else {
      archive = new aModule.Archiver('zip', { zlib: { level: 9 } });
    }

    archive.on('error', (err: any) => {
      console.error('Error en streaming de archivo ZIP:', err);
      if (!response.headersSent) {
        response.status(500).json({ error: 'Error interno generando el archivo comprimido.' });
      }
    });

    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', `attachment; filename="Expediente_${procedure.code}.zip"`);
    archive.pipe(response);

    // 1. Manifiesto / Hoja de Ruta de Texto
    let manifestContent = `=================================================================\n`;
    manifestContent += `            EXPEDIENTE DIGITAL INSTITUCIONAL                     \n`;
    manifestContent += `=================================================================\n\n`;
    manifestContent += `CÓDIGO DE TRÁMITE: ${procedure.code}\n`;
    manifestContent += `ASUNTO:            ${procedure.subject}\n`;
    manifestContent += `ESTADO:            ${procedure.status}\n`;
    manifestContent += `PRIORIDAD:         ${procedure.priority}\n`;
    manifestContent += `FECHA DE APERTURA: ${new Date(procedure.createdAt).toLocaleString()}\n\n`;
    manifestContent += `--- DATOS DEL SOLICITANTE ---\n`;
    manifestContent += `NOMBRE:      ${procedure.applicantName || 'Trámite Interno'}\n`;
    manifestContent += `CÉDULA/RUC:  ${procedure.applicantId || 'N/A'}\n`;
    manifestContent += `EMAIL:       ${procedure.applicantEmail || 'N/A'}\n`;
    manifestContent += `TELÉFONO:    ${procedure.applicantPhone || 'N/A'}\n`;
    manifestContent += `INSTITUCIÓN: ${procedure.applicantInstitution || 'N/A'}\n`;
    manifestContent += `DIRECCIÓN:   ${procedure.applicantAddress || 'N/A'}\n\n`;
    manifestContent += `--- DOCUMENTOS EN ESTE FOLDER (${procedure.documents?.length || 0}) ---\n`;

    if (procedure.documents && procedure.documents.length > 0) {
      procedure.documents.forEach((d: any, idx: number) => {
        const sigs = d.signatures && d.signatures.length > 0
          ? `[FIRMADO ELECTRÓNICAMENTE por ${d.signatures.map((s: any) => s.signerName).join(', ')}]`
          : `[PENDIENTE DE FIRMA]`;
        manifestContent += `${idx + 1}. ${d.title} - ${sigs} (Hash: ${d.fileHash || 'N/A'})\n`;
      });
    } else {
      manifestContent += `(Sin documentos adjuntos todavía)\n`;
    }

    manifestContent += `\n--- TRAZABILIDAD Y DERIVACIONES ---\n`;
    if (procedure.movements && procedure.movements.length > 0) {
      procedure.movements.forEach((m: any, idx: number) => {
        manifestContent += `[${new Date(m.createdAt).toLocaleString()}] ${m.action} (${m.typeEnvio || 'PARA'}): De ${m.fromDepartment?.name || 'General'} -> A ${m.toDepartment?.name || 'General'}. Proveído: "${m.notes || 'N/A'}"\n`;
      });
    }

    archive.append(manifestContent, { name: `00_HOJA_DE_RUTA_${procedure.code}.txt` });

    // 2. Adjuntar los archivos físicos del expediente si existen
    if (procedure.documents && procedure.documents.length > 0) {
      procedure.documents.forEach((d: any, idx: number) => {
        if (d.fileUrl) {
          try {
            const absPath = getAbsolutePathFromUrl(d.fileUrl);
            if (fs.existsSync(absPath)) {
              const ext = absPath.split('.').pop() || 'pdf';
              const cleanName = `${idx + 1}_${d.title.replace(/[^a-zA-Z0-9_\-]/g, '_')}.${ext}`;
              archive.file(absPath, { name: `Documentos/${cleanName}` });
            }
          } catch (fileErr) {
            console.error('Error adjuntando archivo a ZIP:', fileErr);
          }
        }
      });
    }

    await archive.finalize();
  } catch (error: any) {
    console.error('Error generando dossier ZIP:', error);
    if (!response.headersSent) {
      return response.status(500).json({ error: error.message });
    }
  }
});

// 6. Agregar Documento / Oficio al Folder del Trámite
router.post('/:id/documents', upload.single('file'), async (request, response) => {
  const id = request.params.id as string;
  const user = request.user!;
  const { title, description, typeId, content, tags, isConfidential } = request.body;

  try {
    const procedure = await Procedure.findByPk(id);
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    let fileUrl: string | null = null;
    let fileHash: string | null = null;

    if (request.file) {
      const saved = await saveDocumentFile(request.file.originalname, request.file.buffer);
      fileUrl = saved.relativeUrl;
      fileHash = calculateBufferHash(request.file.buffer);
    }

    const parsedTags = typeof tags === 'string' ? JSON.parse(tags || '[]') : (tags || []);

    const createdDoc = await Document.create({
      title: title || `Documento anexo - ${new Date().toLocaleDateString()}`,
      description: description || 'Documento adjunto al expediente',
      typeId: typeId || null,
      procedureId: procedure.id,
      status: DocStatus.APPROVED,
      tags: parsedTags,
      fileUrl,
      fileHash,
      content: content || null,
      isConfidential: isConfidential === 'true' || isConfidential === true,
      creatorId: user.id,
      departmentId: user.departmentId,
      currentAssigneeId: user.id,
      signatures: []
    });

    await ProcedureMovement.create({
      procedureId: procedure.id,
      fromUserId: user.id,
      fromDepartmentId: user.departmentId,
      toDepartmentId: procedure.departmentId,
      toUserId: procedure.assigneeId,
      action: 'AGREGAR_DOCUMENTO',
      status: procedure.status,
      notes: `Se incorporó el documento/oficio "${createdDoc.title}" al expediente.`,
      attachedDocumentId: createdDoc.id,
      typeEnvio: 'PARA',
      sentEmail: false
    });

    await AuditLog.create({
      userId: user.id,
      module: 'Trámites',
      action: 'Documento Anexado al Expediente',
      recordId: procedure.id,
      ipAddress: request.ip || '127.0.0.1',
      details: `Documento ID ${createdDoc.id} ("${createdDoc.title}") anexado al trámite ${procedure.code}`
    });

    return response.status(201).json(createdDoc);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 7. Firmar Electrónicamente un Documento u Oficio específico dentro del Trámite
router.post('/:id/documents/:docId/sign', upload.single('certificate'), async (request, response) => {
  const id = request.params.id as string;
  const docId = request.params.docId as string;
  const user = request.user!;
  const { password, reason, location, signatureType } = request.body;

  try {
    const procedure = await Procedure.findByPk(id);
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    const doc = await Document.findOne({
      where: { id: docId, procedureId: procedure.id }
    });
    if (!doc) return response.status(404).json({ error: 'Documento no encontrado en este expediente.' });

    let signerName = user.name;
    let issuer = 'Autoridad de Certificación Institucional';
    let serialNumber = Math.random().toString(36).substring(2, 10).toUpperCase();

    if (request.file && password) {
      try {
        const p12Der = request.file.buffer.toString('binary');
        const p12Asn1 = forge.asn1.fromDer(p12Der);
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

        const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
        const certBag = bags[forge.pki.oids.certBag];
        if (certBag && certBag.length > 0 && certBag[0].cert) {
          const cert = certBag[0].cert;
          const cnAttr = cert.subject.attributes.find((a: any) => a.name === 'commonName');
          if (cnAttr && cnAttr.value) signerName = String(cnAttr.value);

          const issuerCn = cert.issuer.attributes.find((a: any) => a.name === 'commonName');
          if (issuerCn && issuerCn.value) issuer = String(issuerCn.value);

          if (cert.serialNumber) serialNumber = cert.serialNumber;
        }
      } catch (certErr: any) {
        return response.status(400).json({ error: 'Error al procesar el certificado digital: Clave incorrecta o formato inválido.' });
      }
    }

    const userDept = await Department.findByPk(user.departmentId);
    const deptName = userDept?.name || 'Departamento';

    const newSignature = {
      id: Math.random().toString(36).substring(2, 9),
      userId: user.id,
      signerName,
      signerRole: user.roleName || 'Funcionario',
      departmentId: user.departmentId,
      departmentName: deptName,
      signedAt: new Date().toISOString(),
      reason: reason || 'Aprobación y firma de documento/oficio institucional',
      location: location || 'Plataforma de Gestión Documental',
      issuer,
      serialNumber,
      signatureType: signatureType || (request.file ? 'P12_DIGITAL' : 'ELECTRONICA_CRIPTOGRAFICA'),
      documentHash: doc.fileHash || calculateBufferHash(Buffer.from(doc.content || doc.title))
    };

    const currentSignatures = Array.isArray(doc.signatures) ? [...doc.signatures] : [];
    currentSignatures.push(newSignature);

    await doc.update({
      signatures: currentSignatures,
      status: DocStatus.APPROVED
    });

    await ProcedureMovement.create({
      procedureId: procedure.id,
      fromUserId: user.id,
      fromDepartmentId: user.departmentId,
      toDepartmentId: procedure.departmentId,
      toUserId: procedure.assigneeId,
      action: 'FIRMA_DOCUMENTO',
      status: procedure.status,
      notes: `Firma electrónica estampada en "${doc.title}" por ${signerName} (${newSignature.signatureType}).`,
      attachedDocumentId: doc.id,
      typeEnvio: 'PARA',
      sentEmail: false
    });

    await AuditLog.create({
      userId: user.id,
      module: 'Trámites',
      action: 'Firma Electrónica de Documento',
      recordId: procedure.id,
      ipAddress: request.ip || '127.0.0.1',
      details: `Documento "${doc.title}" firmado electrónicamente por ${signerName}`
    });

    return response.json({ message: 'Documento firmado exitosamente', signature: newSignature, document: doc });
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 8. Derivar Trámite a otro Departamento / Funcionario (con Proveído, Para y Con Copia - CC)
router.post('/:id/derive', async (request, response) => {
  const id = request.params.id as string;
  const user = request.user!;
  const { 
    toDepartmentId, 
    toUserId, 
    notes, 
    typeEnvio = 'PARA', 
    sendEmailNotification = true,
    recipients = { to: [], cc: [] },
    attachedDocumentId
  } = request.body;

  try {
    const procedure = await Procedure.findByPk(id, {
      include: [
        { association: 'department' },
        { association: 'assignee' }
      ]
    });
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    const targetDept = await Department.findByPk(toDepartmentId);
    if (!targetDept) return response.status(404).json({ error: 'Departamento de destino no válido.' });

    const targetUser = toUserId ? await User.findByPk(toUserId) : null;

    if (typeEnvio === 'PARA') {
      await procedure.update({
        departmentId: toDepartmentId,
        assigneeId: toUserId || null,
        status: ProcedureStatus.DERIVADO
      });
    }

    const emailTo: string[] = [];
    const emailCc: string[] = [];

    if (targetUser?.email) emailTo.push(targetUser.email);
    if (recipients && Array.isArray(recipients.to)) {
      for (const e of recipients.to) {
        if (e && !emailTo.includes(e)) emailTo.push(e);
      }
    }

    if (recipients && Array.isArray(recipients.cc)) {
      for (const e of recipients.cc) {
        if (e && !emailTo.includes(e) && !emailCc.includes(e)) emailCc.push(e);
      }
    }

    const movement = await ProcedureMovement.create({
      procedureId: procedure.id,
      fromUserId: user.id,
      fromDepartmentId: user.departmentId,
      toUserId: toUserId || null,
      toDepartmentId: toDepartmentId,
      action: 'DERIVACION',
      status: ProcedureStatus.DERIVADO,
      notes: notes || 'Derivación interdepartamental de expediente',
      attachedDocumentId: attachedDocumentId || null,
      typeEnvio,
      sentEmail: sendEmailNotification && emailTo.length > 0,
      emailRecipients: { to: emailTo, cc: emailCc }
    });

    if (sendEmailNotification && emailTo.length > 0) {
      const senderDept = await Department.findByPk(user.departmentId);
      const html = buildEmailTemplate({
        headerTitle: `Derivación de Expediente: ${procedure.code}`,
        procedureCode: procedure.code,
        subject: procedure.subject,
        applicantName: procedure.applicantName,
        badgeText: `DERIVADO A: ${targetDept.name}`,
        badgeColor: '#3b82f6',
        mainContent: `
          <p>Se ha derivado el expediente a su atención con la siguiente instrucción/proveído:</p>
          <div style="background: #0f172a; padding: 12px; border-radius: 6px; border-left: 3px solid #3b82f6; font-style: italic; margin: 12px 0;">
            "${notes || 'Sin observaciones adicionales.'}"
          </div>
          <p><strong>Remitente:</strong> ${user.name} (${senderDept?.name || 'Departamento remitente'})</p>
          <p><strong>Destino:</strong> ${targetDept.name} ${targetUser ? ` - Asignado a: ${targetUser.name}` : ''}</p>
          <p><strong>Tipo de Envío:</strong> ${typeEnvio === 'PARA' ? 'Acción / Trámite Directo (PARA)' : 'Conocimiento / Copia Informativa (CC)'}</p>
        `
      });

      sendEmail({
        to: emailTo,
        cc: emailCc.length > 0 ? emailCc : undefined,
        subject: `[DERIVACIÓN ${procedure.code}] ${procedure.subject}`,
        html
      }).catch(err => console.error('Error enviando correo de derivación:', err));
    }

    await AuditLog.create({
      userId: user.id,
      module: 'Trámites',
      action: 'Derivación de Trámite',
      recordId: procedure.id,
      ipAddress: request.ip || '127.0.0.1',
      details: `Trámite derivado a ${targetDept.name} (Asignado: ${targetUser?.name || 'General'}). Proveído: ${notes || 'N/A'}`
    });

    return response.json({ message: 'Trámite derivado exitosamente', procedure, movement });
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 9. Enviar correo electrónico informativo o con oficios adjuntos
router.post('/:id/send-email', async (request, response) => {
  const id = request.params.id as string;
  const user = request.user!;
  const { to, cc, subject, message, documentIds = [] } = request.body;

  try {
    const procedure = await Procedure.findByPk(id, {
      include: [{ association: 'documents' }]
    });
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    if (!to || (Array.isArray(to) && to.length === 0)) {
      return response.status(400).json({ error: 'Debe especificar al menos un destinatario (Para).' });
    }

    const attachments: any[] = [];
    if (Array.isArray(documentIds) && documentIds.length > 0) {
      const selectedDocs = procedure.documents.filter((d: any) => documentIds.includes(d.id));
      for (const d of selectedDocs) {
        if (d.fileUrl) {
          const absPath = getAbsolutePathFromUrl(d.fileUrl);
          attachments.push({
            filename: `${d.title}.pdf`,
            path: absPath
          });
        }
      }
    }

    const senderDept = await Department.findByPk(user.departmentId);

    const html = buildEmailTemplate({
      headerTitle: `Notificación Oficial - ${procedure.code}`,
      procedureCode: procedure.code,
      subject: subject || procedure.subject,
      applicantName: procedure.applicantName,
      badgeText: 'NOTIFICACIÓN INSTITUCIONAL',
      badgeColor: '#6366f1',
      mainContent: `
        <div style="margin: 12px 0; line-height: 1.6;">
          ${message || 'Se adjunta información y documentación relativa al expediente en referencia.'}
        </div>
        <p><strong>Remitente:</strong> ${user.name} (${senderDept?.name || 'Funcionario'})</p>
      `
    });

    const mailRes = await sendEmail({
      to,
      cc,
      subject: subject ? `[${procedure.code}] ${subject}` : `[${procedure.code}] Notificación de Trámite: ${procedure.subject}`,
      html,
      attachments: attachments.length > 0 ? attachments : undefined
    });

    await ProcedureMovement.create({
      procedureId: procedure.id,
      fromUserId: user.id,
      fromDepartmentId: user.departmentId,
      toDepartmentId: procedure.departmentId,
      action: 'ENVIO_CORREO',
      status: procedure.status,
      notes: `Correo electrónico enviado a: ${Array.isArray(to) ? to.join(', ') : to}. Asunto: ${subject || procedure.subject}`,
      typeEnvio: 'PARA',
      sentEmail: true,
      emailRecipients: { to: Array.isArray(to) ? to : [to], cc: Array.isArray(cc) ? cc : [cc].filter(Boolean) }
    });

    return response.json({ message: 'Correo enviado correctamente', result: mailRes });
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 10. Finalizar Trámite / Conclusión del Expediente
router.post('/:id/finalize', async (request, response) => {
  const id = request.params.id as string;
  const user = request.user!;
  const { conclusion, sendEmailToApplicant = true } = request.body as any;

  try {
    const procedure = await Procedure.findByPk(id);
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    await procedure.update({
      status: ProcedureStatus.FINALIZADO,
      description: procedure.description + `\n\n[Conclusión]: ${conclusion || 'Trámite finalizado satisfactoriamente.'}`
    });

    await ProcedureMovement.create({
      procedureId: procedure.id,
      fromUserId: user.id,
      fromDepartmentId: user.departmentId,
      toDepartmentId: procedure.departmentId,
      action: 'FINALIZACION',
      status: ProcedureStatus.FINALIZADO,
      notes: `Trámite concluido. Resolución / Conclusión: ${conclusion || 'Proceso finalizado.'}`,
      typeEnvio: 'PARA',
      sentEmail: sendEmailToApplicant && !!procedure.applicantEmail,
      emailRecipients: procedure.applicantEmail ? { to: [procedure.applicantEmail], cc: [] } : null
    });

    if (sendEmailToApplicant && procedure.applicantEmail) {
      const html = buildEmailTemplate({
        headerTitle: 'Resolución y Finalización de Trámite',
        procedureCode: procedure.code,
        subject: procedure.subject,
        applicantName: procedure.applicantName,
        badgeText: 'TRÁMITE FINALIZADO',
        badgeColor: '#10b981',
        mainContent: `
          <p>Estimado(a) <strong>${procedure.applicantName}</strong>,</p>
          <p>Le informamos que su trámite <strong>${procedure.code}</strong> ha sido atendido y finalizado con éxito.</p>
          <div style="background: #0f172a; padding: 12px; border-radius: 6px; border-left: 3px solid #10b981; margin: 12px 0;">
            <strong>Dictamen / Conclusión:</strong><br>
            ${conclusion || 'El proceso ha concluido satisfactoriamente conforme a las normativas institucionales.'}
          </div>
          <p>Agradecemos su atención.</p>
        `
      });

      sendEmail({
        to: procedure.applicantEmail,
        subject: `[${procedure.code}] FINALIZACIÓN DE TRÁMITE: ${procedure.subject}`,
        html
      }).catch(err => console.error('Error enviando correo de finalización:', err));
    }

    const sealHash = await computeSeal(procedure.id);
    await procedure.update({ sealHash, sealedAt: new Date(), sealedById: user.id });

    await AuditLog.create({
      userId: user.id,
      module: 'Trámites',
      action: 'Finalizar Trámite',
      recordId: procedure.id,
      ipAddress: request.ip || '127.0.0.1',
      details: `Trámite finalizado por ${user.name}. Conclusión: ${conclusion || 'N/A'}`
    });
    await logAudit(request, 'SEAL', procedure.id, `Trámite ${procedure.code} sellado. SHA-256: ${sealHash}`);

    return response.json(procedure);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 11. Devolver / Observar Trámite
router.post('/:id/return', async (request, response) => {
  const id = request.params.id as string;
  const user = request.user!;
  const { notes } = request.body as any;

  try {
    const procedure = await Procedure.findByPk(id);
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    await procedure.update({
      status: ProcedureStatus.OBSERVADO,
      description: procedure.description + `\n\n[Devolución/Observación]: ${notes || 'Revisión solicitada.'}`
    });

    await ProcedureMovement.create({
      procedureId: procedure.id,
      fromUserId: user.id,
      fromDepartmentId: user.departmentId,
      toDepartmentId: procedure.departmentId,
      toUserId: procedure.assigneeId,
      action: 'DEVOLUCION',
      status: ProcedureStatus.OBSERVADO,
      notes: `Expediente devuelto con observaciones: ${notes || 'Requiere correcciones o recaudos adicionales.'}`,
      typeEnvio: 'PARA',
      sentEmail: false
    });

    await AuditLog.create({
      userId: user.id,
      module: 'Trámites',
      action: 'Devolver Trámite',
      recordId: procedure.id,
      ipAddress: request.ip || '127.0.0.1',
      details: `Trámite observado y devuelto. Motivo: ${notes || 'N/A'}`
    });

    return response.json(procedure);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 12. Revertir finalización
router.post('/:id/revert', async (request, response) => {
  const id = request.params.id as string;
  const user = request.user!;
  const { reason } = request.body as any;

  try {
    const procedure = await Procedure.findByPk(id);
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    const mode = await getImmutabilityMode();
    if (mode === 'LOCKED') {
      await logAudit(request, 'TAMPER_ATTEMPT', procedure.id, `Intento de reabrir ${procedure.code} con bloqueo total activo.`);
      return response.status(423).json({ error: 'Bloqueo total activo: los trámites finalizados no pueden reabrirse.', sealed: true });
    }
    if (!isAdminUser(user)) {
      await logAudit(request, 'TAMPER_ATTEMPT', procedure.id, `Usuario sin privilegios intentó reabrir ${procedure.code}.`);
      return response.status(403).json({ error: 'Solo el Administrador puede reabrir un trámite sellado.' });
    }
    if (!reason || String(reason).trim().length < 5) {
      return response.status(400).json({ error: 'Debe indicar el motivo de la reapertura (mínimo 5 caracteres).' });
    }
    const previousSeal = procedure.sealHash;

    await procedure.update({
      status: ProcedureStatus.RECIBIDO,
      warehouseId: null,
      sectorId: null,
      sectionId: null,
      folderCode: null,
      sealHash: null,
      sealedAt: null,
      sealedById: null,
      description: procedure.description + `\n\n[Reapertura]: ${reason || 'Trámite reabierto.'}`
    });
    await logAudit(request, 'REOPEN', procedure.id,
      `Reapertura de ${procedure.code} por ${user.name}. Motivo: ${reason}. Sello anterior: ${previousSeal || 'N/A'}`);

    await ProcedureMovement.create({
      procedureId: procedure.id,
      fromUserId: user.id,
      fromDepartmentId: user.departmentId,
      toDepartmentId: procedure.departmentId,
      toUserId: procedure.assigneeId,
      action: 'REAPERTURA',
      status: ProcedureStatus.RECIBIDO,
      notes: `Reapertura de expediente. Motivo: ${reason || 'Trámite reabierto.'}`,
      typeEnvio: 'PARA',
      sentEmail: false
    });

    await AuditLog.create({
      userId: user.id,
      module: 'Trámites',
      action: 'Revertir Finalización',
      recordId: procedure.id,
      ipAddress: request.ip || '127.0.0.1',
      details: `Reversión de finalización. Motivo: ${reason || 'N/A'}`
    });

    return response.json(procedure);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 13. Actualización de datos generales del trámite
router.put('/:id', requirePermission(['procedures.manage', 'all']), async (request, response) => {
  const id = request.params.id as string;
  const data = request.body as any;

  try {
    const procedure = await Procedure.findByPk(id);
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    await procedure.update(data);
    return response.json(procedure);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// 14. Eliminación definitiva de trámite (Solo permitido en estado REGISTRADO)
router.delete('/:id', authenticate, async (request, response) => {
  const id = request.params.id as string;
  const user = request.user!;

  try {
    const procedure = await Procedure.findByPk(id, {
      include: [{ association: 'documents' }]
    });

    if (!procedure) {
      return response.status(404).json({ error: 'Trámite no encontrado.' });
    }

    // Validar que el expediente solo se pueda borrar si está en estado REGISTRADO
    if (procedure.status !== ProcedureStatus.REGISTRADO) {
      return response.status(400).json({ 
        error: `No se puede eliminar el trámite porque su estado actual es ${procedure.status}. Solo se pueden eliminar trámites en estado REGISTRADO.` 
      });
    }

    const procedureCode = procedure.code;

    // 1. Eliminar archivos físicos de documentos asociados si existen
    if (procedure.documents && procedure.documents.length > 0) {
      for (const doc of procedure.documents) {
        if (doc.fileUrl) {
          try {
            const filePath = getAbsolutePathFromUrl(doc.fileUrl);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (e) {
            console.error('Error eliminando archivo físico:', e);
          }
        }
      }
    }

    // 2. Eliminar documentos del expediente
    await Document.destroy({ where: { procedureId: id } });

    // 3. Eliminar movimientos de trazabilidad del expediente
    await ProcedureMovement.destroy({ where: { procedureId: id } });

    // 4. Eliminar el expediente
    await procedure.destroy();

    // 5. Auditoría
    await AuditLog.create({
      userId: user.id,
      module: 'Trámites',
      action: 'Eliminar Expediente',
      recordId: id,
      ipAddress: request.ip || '127.0.0.1',
      details: `Expediente ${procedureCode} eliminado completamente del sistema por el usuario ${user.name}.`
    });

    return response.json({ message: `Expediente ${procedureCode} y todos sus documentos eliminados exitosamente.` });
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

export default router;
