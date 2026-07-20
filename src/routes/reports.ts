import { Router } from 'express';
import { Procedure, Department, Document, User, ProcedureType, DocumentType, DocumentHistory, DocumentAlert, sequelize } from '../models/index.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

// /api/reports/procedures
router.get('/procedures', async (req, res) => {
  const user = req.user!;
  const permissions = user.permissions || [];
  if (!permissions.includes('reports.view') && !permissions.includes('all') && user.roleName !== 'Administrador') {
    return res.status(403).json({ error: 'Acceso denegado a reportes.' });
  }

  try {
    const total = await Procedure.count();

    // Group by status
    const byStatusRaw = await Procedure.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['status']
    });

    const byStatus = byStatusRaw.reduce((acc, curr: any) => {
      acc[curr.status] = parseInt(curr.getDataValue('count'), 10);
      return acc;
    }, {} as Record<string, number>);

    // Group by department
    const byDeptRaw = await Procedure.findAll({
      attributes: [
        'departmentId',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['departmentId']
    });

    // Populate department names
    const departments = await Department.findAll();
    const byDepartment = byDeptRaw.reduce((acc, curr: any) => {
      const dept = departments.find(d => d.id === curr.departmentId);
      acc[dept?.name || 'Desconocido'] = parseInt(curr.getDataValue('count'), 10);
      return acc;
    }, {} as Record<string, number>);

    // Avg Time for finished procedures
    const finishedProcs = await Procedure.findAll({
      where: { status: 'FINALIZADO' as any },
      attributes: ['createdAt', 'updatedAt']
    });

    let avgHours = 0;
    if (finishedProcs.length > 0) {
      const totalMs = finishedProcs.reduce((acc, proc) => acc + (proc.updatedAt.getTime() - proc.createdAt.getTime()), 0);
      avgHours = Math.round(totalMs / finishedProcs.length / (1000 * 60 * 60));
    }

    const detailedProcedures = await Procedure.findAll({
      limit: 50,
      order: [['createdAt', 'DESC']],
      include: [{ association: 'department' }]
    });

    return res.json({
      total,
      avgHours,
      byStatus,
      byDepartment,
      detailed: detailedProcedures
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// /api/reports/documents
router.get('/documents', async (req, res) => {
  const user = req.user!;
  const permissions = user.permissions || [];
  if (!permissions.includes('reports.view') && !permissions.includes('all') && user.roleName !== 'Administrador') {
    return res.status(403).json({ error: 'Acceso denegado a reportes.' });
  }

  try {
    const total = await Document.count({
      where: { deletedAt: null }
    });

    const byStatusRaw = await Document.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: { deletedAt: null },
      group: ['status']
    });

    const byStatus = byStatusRaw.reduce((acc, curr: any) => {
      acc[curr.status] = parseInt(curr.getDataValue('count'), 10);
      return acc;
    }, {} as Record<string, number>);

    const byTypeRaw = await Document.findAll({
      attributes: [
        'typeId',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: { deletedAt: null },
      group: ['typeId']
    });

    const docTypes = await DocumentType.findAll();
    const byType = byTypeRaw.reduce((acc, curr: any) => {
      const type = docTypes.find(t => t.id === curr.typeId);
      acc[type?.name || 'Desconocido'] = parseInt(curr.getDataValue('count'), 10);
      return acc;
    }, {} as Record<string, number>);

    const detailedDocs = await Document.findAll({
      where: { deletedAt: null },
      limit: 50,
      order: [['createdAt', 'DESC']],
      include: [{ association: 'type' }, { association: 'procedure' }]
    });

    return res.json({
      total,
      byStatus,
      byType,
      detailed: detailedDocs
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// /api/reports/dashboard
router.get('/dashboard', async (req, res) => {
  const user = req.user!;
  const permissions = user.permissions || [];
  if (!permissions.includes('dashboard.view') && !permissions.includes('all') && user.roleName !== 'Administrador') {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }

  const now = new Date();

  try {
    const [
      proceduresCount,
      usersCount,
      departmentsCount,
      procedureTypesCount,
      documentTypesCount,
      docsCount,
      docsConfidentialCount,
      finishedDocsCount
    ] = await Promise.all([
      Procedure.count(),
      User.count(),
      Department.count(),
      ProcedureType.count(),
      DocumentType.count(),
      Document.count({ where: { deletedAt: null } }),
      Document.count({ where: { deletedAt: null, isConfidential: true } }),
      Document.count({ where: { deletedAt: null, status: 'APPROVED' } })
    ]);

    const procedures = await Procedure.findAll({
      attributes: ['expirationDate', 'status']
    });

    let expiredProceduresCount = 0;
    let expiringProceduresCount = 0;

    for (const p of procedures) {
      if (p.expirationDate && p.status !== 'FINALIZADO' && p.status !== 'CERRADO' && p.status !== 'ARCHIVADO') {
        const exp = new Date(p.expirationDate);
        if (exp < now) expiredProceduresCount++;
        else {
          const diffDays = (exp.getTime() - now.getTime()) / (1000 * 3600 * 24);
          if (diffDays <= 3) expiringProceduresCount++;
        }
      }
    }

    return res.json({
      proceduresCount,
      expiredProceduresCount,
      expiringProceduresCount,
      usersCount,
      departmentsCount,
      procedureTypesCount,
      documentTypesCount,
      uploadedDocumentsCount: docsCount,
      finishedDocumentsCount: finishedDocsCount,
      lockedDocumentsCount: docsConfidentialCount
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
