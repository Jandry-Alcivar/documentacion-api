import { Router } from 'express';
import { AllowedFileType, Document, User, Department, DocumentAlert, DocumentHistory, sequelize } from '../models/index.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

// Middleware global de permisos
router.use(authenticate);
router.use(requirePermission(['system.manage', 'all']));

// Listar extensiones permitidas
router.get('/file-types', async (req, res) => {
  try {
    const fileTypes = await AllowedFileType.findAll({
      order: [['extension', 'ASC']]
    });
    return res.json(fileTypes);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Agregar extensión permitida
router.post('/file-types', async (req, res) => {
  const { extension } = req.body as { extension: string };

  if (!extension || !extension.startsWith('.')) {
    return res.status(400).json({ error: 'La extensión es requerida y debe comenzar con punto (ej. .pdf).' });
  }

  const cleanExt = extension.toLowerCase().trim();

  try {
    const exists = await AllowedFileType.findOne({
      where: { extension: cleanExt }
    });

    if (exists) {
      return res.status(400).json({ error: 'Esta extensión ya está configurada.' });
    }

    const created = await AllowedFileType.create({
      extension: cleanExt,
      isActive: true
    });

    return res.status(201).json(created);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Habilitar/Deshabilitar extensión
router.put('/file-types/:id', async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body as { isActive: boolean };

  if (isActive === undefined) {
    return res.status(400).json({ error: 'El campo isActive es requerido.' });
  }

  try {
    const fileType = await AllowedFileType.findByPk(id);

    if (!fileType) {
      return res.status(404).json({ error: 'Tipo de archivo no encontrado.' });
    }

    await fileType.update({ isActive });

    return res.json(fileType);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Reportes y Estadísticas Generales del Sistema
router.get('/reports', async (req, res) => {
  try {
    const docCountsRaw = await Document.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['status']
    });

    const docCounts = docCountsRaw.map((item: any) => ({
      status: item.getDataValue('status'),
      _count: { id: parseInt(item.getDataValue('count'), 10) }
    }));

    const totalUsers = await User.count();
    const totalDepts = await Department.count();
    const totalAlerts = await DocumentAlert.count({
      where: { isRead: false }
    });
    
    // Obtener últimos cambios en el historial (Auditoría global de acciones)
    const auditLogs = await DocumentHistory.findAll({
      limit: 20,
      include: [
        { association: 'user', attributes: ['name', 'email'] },
        { association: 'document', attributes: ['title'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    return res.json({
      stats: {
        totalUsers,
        totalDepts,
        totalAlerts,
        documentsByStatus: docCounts,
      },
      auditLogs
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
