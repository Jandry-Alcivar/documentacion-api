import { Router } from 'express';
import { AuditLog } from '../models/index.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

// GET /api/audit-logs
router.get('/', async (req, res) => {
  const user = req.user!;
  const permissions = user.permissions || [];
  if (!permissions.includes('audit-logs.view') && !permissions.includes('all') && user.roleName !== 'Administrador') {
    return res.status(403).json({ error: 'No tienes permiso para ver la bitácora de auditoría' });
  }

  try {
    const logs = await AuditLog.findAll({
      order: [['createdAt', 'DESC']],
      limit: 200,
      include: [
        {
          association: 'user',
          attributes: ['id', 'name', 'email']
        }
      ]
    });

    return res.json(logs);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/audit-logs/:id
router.get('/:id', async (req, res) => {
  const user = req.user!;
  const permissions = user.permissions || [];
  if (!permissions.includes('audit-logs.view') && !permissions.includes('all') && user.roleName !== 'Administrador') {
    return res.status(403).json({ error: 'No tienes permiso para ver la bitácora de auditoría' });
  }

  const { id } = req.params;
  try {
    const log = await AuditLog.findByPk(id, {
      include: [
        {
          association: 'user',
          attributes: ['name', 'email']
        }
      ]
    });

    if (!log) {
      return res.status(404).json({ error: 'Log no encontrado' });
    }

    return res.json(log);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
