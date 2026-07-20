import { Router } from 'express';
import multer from 'multer';
import archiver from 'archiver';
import { DocStatus, Document, DocumentAlert, DocumentHistory, AllowedFileType, Department, User, AuditLog, DocumentType, sequelize, Procedure, Workflow, WorkflowNode } from '../models/index.js';
import { Op } from 'sequelize';
import * as path from 'path';
import * as fs from 'fs';
import { saveDocumentFile, getAbsolutePathFromUrl, deletePhysicalFile } from '../utils/storage.js';
import { calculateBufferHash, calculateFileHash } from '../utils/hash.js';
import { authenticate } from '../middlewares/auth.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const signerModule = require('node-signpdf');
const signer = signerModule.default || signerModule;

const plainAddPlaceholderModule = require('node-signpdf/dist/helpers/plainAddPlaceholder');
const plainAddPlaceholder = typeof plainAddPlaceholderModule === 'function'
  ? plainAddPlaceholderModule
  : (plainAddPlaceholderModule.plainAddPlaceholder || plainAddPlaceholderModule.default || plainAddPlaceholderModule);

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticate);

// Helper para obtener los UUIDs de los tipos de documento confidenciales (QUEJA y RENUNCIA)
async function getSensitiveTypeIds(): Promise<string[]> {
  try {
    const types = await DocumentType.findAll({
      where: {
        name: {
          [Op.in]: ['QUEJA', 'RENUNCIA']
        }
      }
    });
    return types.map(t => t.id);
  } catch (e) {
    console.error('Error fetching sensitive type IDs:', e);
    return [];
  }
}

// Helper para verificar integridad física en el disco
async function verifyIntegrity(doc: any) {
  try {
    if (!doc.fileUrl) {
      return { isValid: true, noFile: true };
    }
    const absolutePath = getAbsolutePathFromUrl(doc.fileUrl);
    if (!fs.existsSync(absolutePath)) {
      return { isValid: false, error: 'Archivo físico no encontrado en el servidor.' };
    }
    const actualHash = await calculateFileHash(absolutePath);
    const isValid = actualHash === doc.fileHash;
    
    if (!isValid) {
      // Registrar alerta de integridad si no existe ya una activa para este documento
      const existingAlert = await DocumentAlert.findOne({
        where: { documentId: doc.id, isRead: false }
      });

      if (!existingAlert) {
        await DocumentAlert.create({
          documentId: doc.id,
          departmentId: doc.departmentId,
          userId: doc.creatorId, // Asumir creador por defecto o auditor
          message: `El archivo del documento "${doc.title}" ha sido alterado externamente. El hash original no coincide.`
        });

        await DocumentHistory.create({
          documentId: doc.id,
          userId: doc.creatorId,
          action: 'INTEGRITY_VIOLATION',
          fileHashBefore: doc.fileHash,
          fileHashAfter: actualHash,
          changesDescription: 'Se detectó una alteración externa del archivo físico en el disco.'
        });
      }
    }
    return { isValid, actualHash, expectedHash: doc.fileHash };
  } catch (e: any) {
    return { isValid: false, error: e.message };
  }
}

// 1. Listar documentos del usuario según su rol y permisos
router.get('/', async (req, res) => {
  const user = req.user!;
  const { search, category, status, departmentId } = req.query as any;
  const sensitiveIds = await getSensitiveTypeIds();

  const andClause: any[] = [
    { deletedAt: null } // Excluir papelera
  ];

  // Filtros de búsqueda y categorías
  if (category) andClause.push({ typeId: category as string });
  if (status) andClause.push({ status: status as DocStatus });
  if (departmentId) {
    andClause.push({
      [Op.or]: [
        { departmentId },
        sequelize.literal(`"Document"."signatures" @> '[{"departmentId": "${departmentId}"}]'`)
      ]
    });
  }
  if (search) {
    andClause.push({
      [Op.or]: [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { tags: { [Op.contains]: [search] } }
      ]
    });
  }

  const visibilityOr: any[] = [];

  // Reglas de negocio de visibilidad por rol
  if (user.roleName === 'Funcionario') {
    visibilityOr.push(
      { creatorId: user.id },
      { departmentId: user.departmentId, status: DocStatus.APPROVED, isConfidential: false },
      { currentAssigneeId: user.id }
    );
  } else if (user.roleName === 'Director Departamental') {
    visibilityOr.push(
      { 
        departmentId: user.departmentId, 
        isConfidential: false,
        typeId: { [Op.notIn]: sensitiveIds }
      },
      { targetDepartmentId: user.departmentId },
      { creatorId: user.id },
      { '$procedure.departmentId$': user.departmentId },
      sequelize.literal(`"Document"."signatures" @> '[{"departmentId": "${user.departmentId}"}]'`)
    );
  } else if (user.roleName === 'Alcalde') {
    visibilityOr.push(
      { isConfidential: true },
      { typeId: { [Op.in]: sensitiveIds } },
      { status: DocStatus.APPROVED },
      { '$procedure.departmentId$': user.departmentId },
      sequelize.literal(`"Document"."signatures" @> '[{"departmentId": "${user.departmentId}"}]'`)
    );
  }

  if (visibilityOr.length > 0) {
    andClause.push({ [Op.or]: visibilityOr });
  }

  try {
    const docs = await Document.findAll({
      where: { [Op.and]: andClause },
      include: [
        { association: 'type' },
        { 
          association: 'procedure',
          include: [
            { association: 'department', attributes: ['id', 'name'] }
          ]
        },
        { association: 'creator', attributes: ['id', 'name', 'email'] },
        { association: 'department', attributes: ['id', 'name'] },
        { association: 'currentAssignee', attributes: ['id', 'name'] },
        {
          association: 'replies',
          include: [
            { association: 'creator', attributes: ['name'] }
          ]
        }
      ],
      order: [['updatedAt', 'DESC']]
    });

    return res.json(docs);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 12. Obtener lista de papelera
router.get('/trash', async (req, res) => {
  const user = req.user!;
  const whereClause: any = {
    deletedAt: { [Op.ne]: null }
  };

  if (user.roleName === 'Funcionario') {
    whereClause.deletedById = user.id;
  } else if (user.roleName === 'Director Departamental') {
    whereClause.departmentId = user.departmentId;
  } else if (user.permissions.includes('all')) {
    whereClause.isConfidential = true;
  }

  try {
    const docs = await Document.findAll({
      where: whereClause,
      include: [
        { association: 'creator', attributes: ['name'] }
      ],
      order: [['deletedAt', 'DESC']]
    });

    return res.json(docs);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 2. Obtener un documento por ID e inspeccionar integridad
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const doc = await Document.findByPk(id, {
      include: [
        { 
          association: 'procedure',
          include: [
            { association: 'department', attributes: ['id', 'name'] }
          ]
        },
        { association: 'creator', attributes: ['id', 'name', 'email', 'departmentId'] },
        { association: 'department', attributes: ['id', 'name'] },
        { association: 'currentAssignee', attributes: ['id', 'name'] },
        {
          association: 'history',
          include: [
            { 
              association: 'user', 
              attributes: ['name', 'roleId', 'departmentId'],
              include: [
                { association: 'department', attributes: ['id', 'name'] }
              ]
            }
          ]
        },
        {
          association: 'alerts',
          where: { isRead: false },
          required: false,
          include: [
            { association: 'user', attributes: ['name'] }
          ]
        }
      ],
      order: [
        [{ model: DocumentHistory, as: 'history' }, 'createdAt', 'DESC']
      ]
    });

    if (!doc || doc.deletedAt !== null) {
      return res.status(404).json({ error: 'Documento no encontrado o eliminado.' });
    }

    // Verificar permisos
    const user = req.user!;
    const isOwner = doc.creatorId === user.id;
    const inSameDept = doc.departmentId === user.departmentId;
    const inProcedureDept = doc.procedure && doc.procedure.departmentId === user.departmentId;
    const sensitiveIds = await getSensitiveTypeIds();
    const isConfidential = doc.isConfidential || sensitiveIds.includes(doc.typeId || '');

    if (user.roleName === 'Funcionario' && !isOwner && doc.status !== DocStatus.APPROVED && doc.currentAssigneeId !== user.id && !inProcedureDept) {
      return res.status(403).json({ error: 'No tienes permisos para ver este documento.' });
    }

    if (user.roleName === 'Director Departamental' && !inSameDept && doc.targetDepartmentId !== user.departmentId && !isOwner && !inProcedureDept) {
      return res.status(403).json({ error: 'No tienes permisos para ver este documento.' });
    }

    if (isConfidential && !user.permissions.includes('all') && !isOwner && !inProcedureDept) {
      return res.status(403).json({ error: 'Acceso denegado. Este es un documento confidencial.' });
    }

    // Ejecutar verificación de integridad
    const integrity = await verifyIntegrity(doc);

    // Adaptar salida agregando el objeto de integridad y convirtiendo a JSON plano
    const result = doc.toJSON();
    (result as any).integrity = integrity;

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 3. Crear y subir un nuevo documento (Procesado por multer)
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Debe adjuntar un archivo.' });
  }

  // Validar tipo de archivo
  const ext = path.extname(req.file.originalname).toLowerCase();
  
  try {
    const allowed = await AllowedFileType.findOne({
      where: { extension: ext }
    });

    if (!allowed || !allowed.isActive) {
      return res.status(400).json({ 
        error: `El tipo de archivo "${ext}" no está permitido por el administrador.` 
      });
    }

    // Campos del formulario
    const title = req.body.title;
    const description = req.body.description || '';
    const category = req.body.category as string;
    const tagsRaw = req.body.tags || '[]';
    const parentId = req.body.parentId || null;
    const submitImmediately = req.body.submitImmediately === 'true';

    if (!title || !category) {
      return res.status(400).json({ error: 'Título y categoría son obligatorios.' });
    }

    let tags: string[] = [];
    try {
      tags = typeof tagsRaw === 'string' ? JSON.parse(tagsRaw) : tagsRaw;
    } catch {
      tags = tagsRaw ? tagsRaw.split(',').map((t: string) => t.trim()) : [];
    }

    // Guardar el archivo físicamente
    const fileBuffer = req.file.buffer;
    const hash = calculateBufferHash(fileBuffer);
    const savedFile = await saveDocumentFile(req.file.originalname, fileBuffer);

    // Determinar confidencialidad y estado inicial
    const sensitiveIds = await getSensitiveTypeIds();
    const isSensitive = sensitiveIds.includes(category);
    
    let status: DocStatus = DocStatus.DRAFT;
    if (submitImmediately) {
      status = isSensitive ? DocStatus.PENDING_MAYOR : DocStatus.PENDING_LEADER;
    }

    const document = await Document.create({
      title,
      description,
      typeId: category,
      tags,
      fileUrl: savedFile.relativeUrl,
      fileHash: hash,
      isConfidential: isSensitive,
      creatorId: req.user!.id,
      departmentId: req.user!.departmentId,
      status,
      parentId,
      procedureId: req.body.procedureId || null
    });

    // Guardar en el historial
    await DocumentHistory.create({
      documentId: document.id,
      userId: req.user!.id,
      action: 'CREATE',
      fileHashAfter: hash,
      changesDescription: `Documento creado y subido. Estado inicial: ${status}`
    });

    await AuditLog.create({
      userId: req.user!.id,
      module: 'Documentos',
      action: 'Creación de Documento (Subida)',
      recordId: document.id,
      ipAddress: req.ip || '127.0.0.1',
      details: `Documento subido: ${document.title}`
    });

    return res.status(201).json(document);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 3b. Crear Documento Interno (WYSIWYG con variables dinámicas)
router.post('/internal', async (req, res) => {
  const { title, description, category, tags: tagsRaw, procedureId, content } = req.body as any;

  if (!title || !category || !content) {
    return res.status(400).json({ error: 'Título, categoría y contenido son obligatorios.' });
  }

  let tags: string[] = [];
  try {
    tags = typeof tagsRaw === 'string' ? JSON.parse(tagsRaw) : tagsRaw;
  } catch {
    tags = [];
  }

  const sensitiveIds = await getSensitiveTypeIds();
  const isSensitive = sensitiveIds.includes(category);
  const status = DocStatus.DRAFT;

  try {
    const document = await Document.create({
      title,
      description: description || '',
      typeId: category,
      tags,
      content,
      procedureId,
      isConfidential: isSensitive,
      creatorId: req.user!.id,
      departmentId: req.user!.departmentId,
      status
    });

    await DocumentHistory.create({
      documentId: document.id,
      userId: req.user!.id,
      action: 'CREATE_INTERNAL',
      changesDescription: `Documento interno (WYSIWYG) creado. Estado inicial: ${status}`
    });

    await AuditLog.create({
      userId: req.user!.id,
      module: 'Documentos',
      action: 'CREATE_INTERNAL',
      recordId: document.id,
      details: JSON.stringify({ title, typeId: category })
    });

    return res.status(201).json(document);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 4. Modificar/Editar el archivo de un documento existente (Procesado por multer)
router.put('/:id/file', upload.single('file'), async (req, res) => {
  const id = req.params.id as string;

  if (!req.file) {
    return res.status(400).json({ error: 'Debe adjuntar el nuevo archivo.' });
  }

  try {
    const doc = await Document.findByPk(id);
    if (!doc) {
      return res.status(404).json({ error: 'Documento no encontrado.' });
    }

    const user = req.user!;
    
    // Solo el creador puede editarlo, y solo si está en DRAFT o REJECTED
    if (doc.creatorId !== user.id) {
      return res.status(403).json({ error: 'Solo el creador del documento puede editar el archivo.' });
    }

    if (doc.status !== DocStatus.DRAFT && doc.status !== DocStatus.REJECTED) {
      return res.status(400).json({ 
        error: 'No se puede editar un documento que ya está en revisión, aprobado o procesado.' 
      });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const allowed = await AllowedFileType.findOne({ where: { extension: ext } });
    if (!allowed || !allowed.isActive) {
      return res.status(400).json({ error: 'Tipo de archivo no permitido.' });
    }

    const fileBuffer = req.file.buffer;
    const newHash = calculateBufferHash(fileBuffer);
    
    // Guardar nuevo archivo y eliminar el anterior
    const savedFile = await saveDocumentFile(req.file.originalname, fileBuffer);
    if (doc.fileUrl) {
      await deletePhysicalFile(doc.fileUrl);
    }

    const submitImmediately = req.body.submitImmediately === 'true';
    const sensitiveIds = await getSensitiveTypeIds();
    const isSensitive = sensitiveIds.includes(doc.typeId || '');
    
    let nextStatus: DocStatus = doc.status;
    if (submitImmediately) {
      nextStatus = isSensitive ? DocStatus.PENDING_MAYOR : DocStatus.PENDING_LEADER;
    }

    await doc.update({
      fileUrl: savedFile.relativeUrl,
      fileHash: newHash,
      status: nextStatus,
      rejectionNotes: null // Limpiar notas de rechazo previas
    });

    await DocumentHistory.create({
      documentId: doc.id,
      userId: user.id,
      action: 'UPDATE_FILE',
      fileHashBefore: doc.fileHash,
      fileHashAfter: newHash,
      changesDescription: `Archivo actualizado. Estado actualizado a: ${nextStatus}`
    });

    return res.json(doc);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 5. Enviar documento borrador a revisión formal
router.post('/:id/submit', async (req, res) => {
  const { id } = req.params;

  try {
    const doc = await Document.findByPk(id);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

    if (doc.creatorId !== req.user!.id) {
      return res.status(403).json({ error: 'Solo el creador puede enviar este documento.' });
    }

    if (doc.status !== DocStatus.DRAFT) {
      return res.status(400).json({ error: 'El documento ya ha sido enviado o procesado.' });
    }

    const sensitiveIds = await getSensitiveTypeIds();
    const isSensitive = sensitiveIds.includes(doc.typeId || '');
    const nextStatus = isSensitive ? DocStatus.PENDING_MAYOR : DocStatus.PENDING_LEADER;

    await doc.update({ status: nextStatus });

    // Actualizar estado de trámite automáticamente
    if (doc.procedureId) {
      const proc = await Procedure.findByPk(doc.procedureId);
      if (proc) {
        await proc.update({
          status: 'EN_REVISION' as any
        });
      }
    }

    await DocumentHistory.create({
      documentId: doc.id,
      userId: req.user!.id,
      action: 'SUBMIT',
      changesDescription: `Documento enviado a revisión formal. Estado: ${nextStatus}`
    });

    return res.json(doc);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 6. Aprobación interna (Líder / Alcalde)
router.post('/:id/approve', async (req, res) => {
  const { id } = req.params;
  const user = req.user!;

  try {
    const doc = await Document.findByPk(id, { include: [{ association: 'procedure' }] });
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

    const sensitiveIds = await getSensitiveTypeIds();
    const isConfidential = sensitiveIds.includes(doc.typeId || '');

    // Validar permisos de aprobación
    if (isConfidential) {
      if (!user.permissions.includes('all')) {
        return res.status(403).json({ error: 'Solo la Máxima Autoridad (Alcalde) puede aprobar trámites confidenciales.' });
      }
      if (doc.status !== DocStatus.PENDING_MAYOR) {
        return res.status(400).json({ error: 'El documento no está pendiente de la firma de la Alcaldía.' });
      }
    } else {
      const targetDeptId = doc.procedure ? doc.procedure.departmentId : doc.departmentId;
      const isLeaderOrMayor = user.roleName === 'Director Departamental' || user.roleName === 'Alcalde';
      if (!isLeaderOrMayor || user.departmentId !== targetDeptId) {
        return res.status(403).json({ error: 'Solo el líder del departamento responsable del trámite puede aprobar este documento.' });
      }
      if (doc.status !== DocStatus.PENDING_LEADER) {
        return res.status(400).json({ error: 'El documento no está en estado pendiente de aprobación.' });
      }
    }

    let finalStatus: DocStatus = DocStatus.APPROVED;

    // Si es respuesta a un oficio interdepartamental (tiene parentId)
    if (doc.parentId) {
      finalStatus = DocStatus.RESPONDED;
      
      await Document.update(
        { status: 'RESPONDED' as any },
        { where: { id: doc.parentId } }
      );

      await DocumentHistory.create({
        documentId: doc.parentId,
        userId: user.id,
        action: 'RESPONDED',
        changesDescription: `El trámite interdepartamental fue respondido y cerrado con el documento ID ${doc.id}`
      });
    }

    await doc.update({ status: finalStatus, rejectionNotes: null });

    await DocumentHistory.create({
      documentId: doc.id,
      userId: user.id,
      action: 'APPROVE',
      changesDescription: `Documento aprobado oficialmente por el líder/autoridad. Estado final: ${finalStatus}`
    });

    return res.json(doc);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 7. Rechazo interno con retroalimentación (Líder / Alcalde)
router.post('/:id/reject', async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body as { notes: string };
  const user = req.user!;

  if (!notes) {
    return res.status(400).json({ error: 'Debes proporcionar una justificación o notas de rechazo.' });
  }

  try {
    const doc = await Document.findByPk(id, { include: [{ association: 'procedure' }] });
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

    const isConfidential = doc.typeId === 'QUEJA' || doc.typeId === 'RENUNCIA';

    if (isConfidential) {
      if (!user.permissions.includes('all')) {
        return res.status(403).json({ error: 'Solo el Alcalde puede rechazar trámites confidenciales.' });
      }
    } else {
      const targetDeptId = doc.procedure ? doc.procedure.departmentId : doc.departmentId;
      const isLeaderOrMayor = user.roleName === 'Director Departamental' || user.roleName === 'Alcalde';
      if (!isLeaderOrMayor || user.departmentId !== targetDeptId) {
        return res.status(403).json({ error: 'Solo el líder del departamento responsable del trámite puede rechazar este documento.' });
      }
    }

    await doc.update({ 
      status: DocStatus.REJECTED,
      rejectionNotes: notes
    });

    // Actualizar estado de trámite automáticamente a OBSERVADO
    if (doc.procedureId) {
      const proc = await Procedure.findByPk(doc.procedureId);
      if (proc) {
        await proc.update({
          status: 'OBSERVADO' as any,
          description: proc.description + `\n\n[Devolución por Jefatura]: ${notes}`
        });
      }
    }

    await DocumentHistory.create({
      documentId: doc.id,
      userId: user.id,
      action: 'REJECT',
      changesDescription: `Documento rechazado. Notas: "${notes}"`
    });

    return res.json(doc);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 8. Flujo Interdepartamental: Enviar un documento formal de un departamento a otro
router.post('/:id/send-interdept', async (req, res) => {
  const { id } = req.params;
  const { targetDepartmentId } = req.body as { targetDepartmentId: string };
  const user = req.user!;

  if (user.roleName !== 'Director Departamental') {
    return res.status(403).json({ error: 'Solo los líderes de departamento pueden realizar solicitudes interdepartamentales.' });
  }

  try {
    const doc = await Document.findByPk(id);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

    if (doc.departmentId !== user.departmentId) {
      return res.status(403).json({ error: 'El documento no pertenece a tu departamento.' });
    }

    if (doc.status !== DocStatus.APPROVED) {
      return res.status(400).json({ error: 'Solo puedes enviar documentos que ya estén previamente aprobados.' });
    }

    if (doc.isConfidential) {
      return res.status(400).json({ error: 'No se puede enviar un documento confidencial a otro departamento.' });
    }

    const targetDept = await Department.findByPk(targetDepartmentId);
    if (!targetDept) {
      return res.status(404).json({ error: 'El departamento destino no existe.' });
    }

    await doc.update({ 
      status: DocStatus.SENT_TO_DEPT,
      targetDepartmentId
    });

    await DocumentHistory.create({
      documentId: doc.id,
      userId: user.id,
      action: 'SENT_TO_DEPT',
      changesDescription: `Enviado formalmente al departamento de "${targetDept.name}"`
    });

    return res.json(doc);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 9. Flujo Interdepartamental: Asignar trámite entrante a un empleado
router.post('/:id/assign-interdept', async (req, res) => {
  const { id } = req.params;
  const { assigneeId } = req.body as { assigneeId: string };
  const user = req.user!;

  try {
    const doc = await Document.findByPk(id);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

    if (user.roleName !== 'Director Departamental' || doc.targetDepartmentId !== user.departmentId) {
      return res.status(403).json({ error: 'Solo el líder del departamento de destino puede asignar esta tarea.' });
    }

    const assignee = await User.findByPk(assigneeId);
    if (!assignee || assignee.departmentId !== user.departmentId || !assignee.isActive) {
      return res.status(400).json({ error: 'El asignado debe ser un empleado activo de tu propio departamento.' });
    }

    await doc.update({ 
      status: DocStatus.ASSIGNED_TO_EMPLOYEE,
      currentAssigneeId: assigneeId
    });

    await DocumentHistory.create({
      documentId: doc.id,
      userId: user.id,
      action: 'ASSIGN_TO_EMPLOYEE',
      changesDescription: `Asignado a ${assignee.name} para redactar respuesta.`
    });

    return res.json(doc);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 10. Eliminar un documento (Enviar a Papelera - Borrado Suave)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const user = req.user!;

  try {
    const doc = await Document.findByPk(id);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

    const isOwner = doc.creatorId === user.id;
    const isLeaderInDept = user.roleName === 'Director Departamental' && user.departmentId === doc.departmentId;
    const isAdmin = user.permissions.includes('all');

    if (!isOwner && !isLeaderInDept && !isAdmin) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este documento.' });
    }

    await doc.update({ 
      deletedAt: new Date(),
      deletedById: user.id
    });

    await DocumentHistory.create({
      documentId: doc.id,
      userId: user.id,
      action: 'DELETE',
      changesDescription: 'Documento enviado a la papelera de reciclaje.'
    });

    return res.json({ message: 'Documento enviado a la papelera.', document: doc });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 11. Recuperar documento de la papelera
router.post('/:id/restore', async (req, res) => {
  const { id } = req.params;
  const user = req.user!;

  try {
    const doc = await Document.findByPk(id);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

    if (doc.deletedAt === null) {
      return res.status(400).json({ error: 'El documento no está en la papelera.' });
    }

    const isDeletedBy = doc.deletedById === user.id;
    const isLeaderInDept = user.roleName === 'Director Departamental' && user.departmentId === doc.departmentId;
    const isAdmin = user.permissions.includes('all');

    if (!isDeletedBy && !isLeaderInDept && !isAdmin) {
      return res.status(403).json({ error: 'No tienes permiso para restaurar este documento.' });
    }

    await doc.update({ 
      deletedAt: null,
      deletedById: null
    });

    await DocumentHistory.create({
      documentId: doc.id,
      userId: user.id,
      action: 'RESTORE',
      changesDescription: 'Documento restaurado de la papelera de reciclaje.'
    });

    return res.json({ message: 'Documento restaurado con éxito.', document: doc });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 13. Forzar verificación de integridad
router.post('/:id/verify', async (req, res) => {
  const { id } = req.params;
  
  try {
    const doc = await Document.findByPk(id);

    if (!doc) {
      return res.status(404).json({ error: 'Documento no encontrado.' });
    }

    const verification = await verifyIntegrity(doc);
    return res.json(verification);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Aprobación con firma digital (Líder / Alcalde) - Firma criptográfica con .p12 y contraseña
router.post('/:id/sign-and-approve', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'certificate', maxCount: 1 }
]), async (req, res) => {
  const { id } = req.params;
  const { password } = req.body as { password?: string };
  const user = req.user!;

  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const pdfFile = files?.['file']?.[0];
  const certFile = files?.['certificate']?.[0];

  if (!pdfFile || !certFile || !password) {
    return res.status(400).json({ error: 'Debe adjuntar el PDF, el certificado .p12 y la contraseña.' });
  }

  try {
    const doc = await Document.findByPk(id as string, { include: [{ association: 'procedure' }] });
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

    const dbUser = await User.findByPk(user.id, {
      include: [
        { association: 'role' },
        { association: 'department' }
      ]
    });

    const signaturePos = req.body.signaturePos ? JSON.parse(req.body.signaturePos) : null;
    const signatureDate = req.body.signatureDate || new Date().toISOString();

    let updatedSignatures = doc.signatures ? [...doc.signatures] : [];
    if (signaturePos) {
      updatedSignatures.push({
        x: signaturePos.x,
        y: signaturePos.y,
        date: signatureDate,
        signerName: dbUser?.name || user.name,
        signerRole: dbUser?.role?.name || user.roleName || 'Autoridad',
        departmentName: dbUser?.department?.name || 'GAD Junín',
        departmentId: dbUser?.departmentId || user.departmentId
      });
    }

    const sensitiveIds = await getSensitiveTypeIds();
    const isConfidential = sensitiveIds.includes(doc.typeId || '');
    const targetDeptId = doc.procedure ? doc.procedure.departmentId : doc.departmentId;

    if (isConfidential) {
      if (!user.permissions.includes('all')) {
        return res.status(403).json({ error: 'Solo el Alcalde puede firmar documentos confidenciales.' });
      }
    } else {
      const isLeaderOrMayor = user.roleName === 'Director Departamental' || user.roleName === 'Alcalde';
      if (!isLeaderOrMayor || user.departmentId !== targetDeptId) {
        return res.status(403).json({ error: 'Solo el líder del departamento responsable del trámite puede firmar este documento.' });
      }
    }

    const fileBuffer = pdfFile.buffer;
    const certBuffer = certFile.buffer;

    // 1. Añadir el placeholder vacío para firma PKCS#7 en el PDF
    let pdfWithPlaceholder: Buffer;
    try {
      pdfWithPlaceholder = plainAddPlaceholder({
        pdfBuffer: fileBuffer,
        reason: 'Firma Digital GAD Junín',
        contactInfo: user.email,
        name: user.name,
        location: 'Junín, Manabí, Ecuador',
        signatureLength: 8192,
      });
    } catch (placeholderError: any) {
      console.error('Error al añadir placeholder:', placeholderError);
      return res.status(500).json({ error: `Error al preparar el PDF para firma: ${placeholderError.message}` });
    }

    // 2. Firmar el PDF
    let signedPdf: Buffer;
    try {
      signedPdf = signer.sign(
        pdfWithPlaceholder,
        certBuffer,
        { passphrase: password }
      );
    } catch (signError: any) {
      console.error('Error al firmar PDF:', signError);
      return res.status(400).json({ error: `Contraseña incorrecta o certificado .p12 inválido: ${signError.message}` });
    }

    const hash = calculateBufferHash(signedPdf);
    const savedFile = await saveDocumentFile(pdfFile.originalname, signedPdf);

    // Eliminar físico anterior
    if (doc.fileUrl) {
      await deletePhysicalFile(doc.fileUrl);
    }

    // Verificar si el trámite tiene un flujo de trabajo (workflow) activo
    let hasNextStep = false;
    let nextNode: any = null;

    if (doc.procedureId) {
      const proc = await Procedure.findByPk(doc.procedureId);
      if (proc) {
        // Buscar el flujo de trabajo para el tipo de trámite
        const workflow = await Workflow.findOne({
          where: { procedureTypeId: proc.typeId, isActive: true },
          include: [{ association: 'nodes' }]
        });

        if (workflow && workflow.nodes && workflow.nodes.length > 0) {
          // Ordenar los nodos por su fecha de creación para mantener la secuencia
          const nodes = [...workflow.nodes].sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
          const currentIdx = nodes.findIndex((n: any) => n.departmentId === proc.departmentId);

          if (currentIdx !== -1 && currentIdx < nodes.length - 1) {
            hasNextStep = true;
            nextNode = nodes[currentIdx + 1];
          }
        }

        if (hasNextStep && nextNode) {
          // Si hay un siguiente paso, derivar el trámite a ese departamento
          await proc.update({
            departmentId: nextNode.departmentId,
            status: 'EN_REVISION' as any,
            assigneeId: null // Se limpia el asignado específico para que el nuevo departamento lo gestione
          });

          // Poner el documento en estado PENDING_LEADER de nuevo, pero con target en el nuevo departamento
          await doc.update({
            fileUrl: savedFile.relativeUrl,
            fileHash: hash,
            status: DocStatus.PENDING_LEADER,
            targetDepartmentId: nextNode.departmentId,
            rejectionNotes: null,
            signatures: updatedSignatures
          });
        } else {
          // Si es el último paso o no tiene flujo, finalizar el trámite
          await proc.update({
            status: 'FINALIZADO' as any
          });

          let finalStatus: DocStatus = DocStatus.APPROVED;
          if (doc.parentId) {
            finalStatus = DocStatus.RESPONDED;
            await Document.update(
              { status: 'RESPONDED' as any },
              { where: { id: doc.parentId } }
            );
          }

          await doc.update({
            fileUrl: savedFile.relativeUrl,
            fileHash: hash,
            status: finalStatus,
            rejectionNotes: null,
            signatures: updatedSignatures
          });
        }
      }
    } else {
      // Documento suelto
      let finalStatus: DocStatus = DocStatus.APPROVED;
      if (doc.parentId) {
        finalStatus = DocStatus.RESPONDED;
        await Document.update(
          { status: 'RESPONDED' as any },
          { where: { id: doc.parentId } }
        );
      }

      await doc.update({
        fileUrl: savedFile.relativeUrl,
        fileHash: hash,
        status: finalStatus,
        rejectionNotes: null,
        signatures: updatedSignatures
      });
    }

    await DocumentHistory.create({
      documentId: doc.id,
      userId: user.id,
      action: 'APPROVE',
      fileHashBefore: doc.fileHash,
      fileHashAfter: hash,
      changesDescription: `Documento firmado digitalmente (.p12) y aprobado. Hash: ${hash}`
    });

    await AuditLog.create({
      userId: user.id,
      module: 'Documentos',
      action: 'Firma y Aprobación',
      recordId: doc.id,
      ipAddress: req.ip || '127.0.0.1',
      details: `Documento firmado digitalmente y aprobado: ${doc.title}`
    });

    return res.json(doc);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Descargar todos los documentos de un trámite en ZIP
router.get('/procedure/:procedureId/download-zip', async (req, res) => {
  const { procedureId } = req.params;

  try {
    const docs = await Document.findAll({
      where: { procedureId, deletedAt: null }
    });

    if (docs.length === 0) {
      return res.status(404).json({ error: 'No se encontraron documentos para este trámite.' });
    }

    // Configurar cabeceras de respuesta
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=tramite-${procedureId}.zip`);

    const archive = (archiver as any)('zip', { zlib: { level: 9 } });
    archive.on('error', (err: any) => {
      throw err;
    });

    archive.pipe(res);

    for (const doc of docs) {
      if (doc.fileUrl) {
        const absolutePath = getAbsolutePathFromUrl(doc.fileUrl);
        if (fs.existsSync(absolutePath)) {
          const filename = doc.title.replace(/[/\\?%*:|"<>]/g, '-') + path.extname(absolutePath);
          archive.file(absolutePath, { name: filename });
        }
      }
    }

    await archive.finalize();
  } catch (error: any) {
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
  }
});

export default router;
