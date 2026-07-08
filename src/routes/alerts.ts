import { Router } from 'express';
import { DocumentAlert } from '../models/index.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

// Listar alertas no leídas
router.get('/', async (req, res) => {
  const user = req.user!;
  const permissions = user.permissions || [];

  if (!permissions.includes('alerts.view') && !permissions.includes('all')) {
    return res.status(403).json({ error: 'No tienes permisos para ver las alertas de integridad.' });
  }

  const whereClause: Record<string, any> = { isRead: false };

  // Si no es admin y solo puede ver alertas de su departamento
  if (!permissions.includes('all') && permissions.includes('alerts.view.department')) {
    whereClause.departmentId = user.departmentId;
  }

  try {
    const alerts = await DocumentAlert.findAll({
      where: whereClause,
      include: [
        { association: 'document', attributes: ['id', 'title', 'fileUrl'] },
        { association: 'user', attributes: ['name', 'email'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    return res.json(alerts);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Marcar alerta como leída
router.post('/:id/read', async (req, res) => {
  const { id } = req.params;
  const user = req.user!;
  const permissions = user.permissions || [];

  try {
    const alert = await DocumentAlert.findByPk(id);
    if (!alert) return res.status(404).json({ error: 'Alerta no encontrada.' });

    if (!permissions.includes('all') && permissions.includes('alerts.view.department')) {
      if (alert.departmentId !== user.departmentId) {
        return res.status(403).json({ error: 'Solo puedes gestionar las alertas de tu propio departamento.' });
      }
    }

    await alert.update({ isRead: true });

    return res.json(alert);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
