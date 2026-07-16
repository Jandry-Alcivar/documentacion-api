import { Router } from 'express';
import { Procedure, AuditLog } from '../models/index.js';
import { Op } from 'sequelize';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', async (request, response) => {
  const user = request.user!;
  const { view } = request.query as any;

  const andClause: any[] = [];

  // 1. Filtro por Estado (Inbox vs Historial General)
  if (view === 'inbox') {
    // Bandeja de Entrada solo muestra activos (no finalizados, cerrados o archivados)
    andClause.push({
      status: {
        [Op.notIn]: ['FINALIZADO', 'CERRADO', 'ARCHIVADO']
      }
    });
  }

  // 2. Filtro por Responsabilidad / Asignación
  if (user.permissions.includes('all') || user.roleName === 'Administrador') {
    // Admin ve todos los de la plataforma
  } else {
    if (view === 'inbox') {
      if (user.roleName === 'Director Departamental') {
        // El director ve todo lo activo de su departamento
        andClause.push({ departmentId: user.departmentId });
      } else {
        // El funcionario ve lo asignado a él, o lo que esté sin asignar en su departamento
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
      // Historial General del Depto: muestra todos los del departamento (activos e históricos de otros funcionarios también)
      andClause.push({ departmentId: user.departmentId });
    }
  }

  const finalWhere = andClause.length > 0 ? { [Op.and]: andClause } : {};

  try {
    const procedures = await Procedure.findAll({
      where: finalWhere,
      include: [
        { association: 'type' },
        { association: 'department' },
        { association: 'assignee', attributes: ['name'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    return response.json(procedures);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

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

router.post('/', requirePermission(['procedures.create', 'all']), async (request, response) => {
  const data = request.body as any;
  const code = `TRM-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 100000)}`;

  try {
    const created = await Procedure.create({
      code,
      subject: data.subject,
      description: data.description,
      priority: data.priority,
      applicantName: data.applicantName,
      applicantId: data.applicantId,
      applicantEmail: data.applicantEmail,
      applicantPhone: data.applicantPhone,
      typeId: data.typeId,
      departmentId: data.departmentId,
      assigneeId: data.assigneeId
    });

    await AuditLog.create({
      userId: request.user!.id,
      module: 'Trámites',
      action: 'Creación de Trámite',
      recordId: created.id,
      ipAddress: request.ip || '127.0.0.1',
      details: `Trámite creado: ${created.code} - ${created.subject}`
    });

    return response.status(201).json(created);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (request, response) => {
  const { id } = request.params;
  try {
    const procedure = await Procedure.findByPk(id, {
      include: [
        { association: 'type' },
        { association: 'department' },
        { association: 'assignee' },
        { association: 'documents' }
      ]
    });
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });
    return response.json(procedure);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

router.post('/:id/finalize', async (request, response) => {
  const { id } = request.params;
  const { conclusion } = request.body as any;

  try {
    const procedure = await Procedure.findByPk(id);
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    await procedure.update({
      status: 'FINALIZADO' as any,
      description: procedure.description + `\n\n[Conclusión]: ${conclusion || 'Finalizado por el usuario.'}`
    });

    await AuditLog.create({
      userId: request.user!.id,
      module: 'Trámites',
      action: 'Finalizar Trámite',
      recordId: procedure.id,
      ipAddress: request.ip || '127.0.0.1',
      details: `Trámite finalizado. Conclusión: ${conclusion || 'N/A'}`
    });

    return response.json(procedure);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

router.post('/:id/revert', async (request, response) => {
  const { id } = request.params;
  const { reason } = request.body as any;

  try {
    const procedure = await Procedure.findByPk(id);
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    await procedure.update({
      status: 'RECIBIDO' as any,
      warehouseId: null,
      sectorId: null,
      sectionId: null,
      folderCode: null,
      description: procedure.description + `\n\n[Reversión]: ${reason || 'Trámite reabierto.'}`
    });

    await AuditLog.create({
      userId: request.user!.id,
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

router.post('/:id/return', async (request, response) => {
  const { id } = request.params;
  const { notes } = request.body as any;

  try {
    const procedure = await Procedure.findByPk(id);
    if (!procedure) return response.status(404).json({ error: 'Trámite no encontrado.' });

    const creatorId = procedure.applicantId;

    await procedure.update({
      status: 'OBSERVADO' as any,
      assigneeId: creatorId || procedure.assigneeId,
      description: procedure.description + `\n\n[Devolución]: ${notes || 'Revisión solicitada.'}`
    });

    await AuditLog.create({
      userId: request.user!.id,
      module: 'Trámites',
      action: 'Devolver Trámite',
      recordId: procedure.id,
      ipAddress: request.ip || '127.0.0.1',
      details: `Trámite devuelto. Observación: ${notes || 'N/A'}`
    });

    return response.json(procedure);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

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

export default router;
