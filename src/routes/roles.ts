import { Router } from 'express';
import { Role } from '../models/index.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);
router.use(requirePermission(['roles.manage', 'all']));

router.get('/', async (request, response) => {
  try {
    const roles = await Role.findAll({
      order: [['name', 'asc']]
    });
    const result = roles.map(r => {
      const json = r.toJSON();
      try {
        json.permissions = JSON.parse(json.permissions);
      } catch (e) {
        json.permissions = [];
      }
      return json;
    });
    return response.json(result);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

router.post('/', async (request, response) => {
  const { name, description, permissions, isActive } = request.body as any;
  if (!name) return response.status(400).json({ error: 'Nombre es requerido.' });

  try {
    const created = await Role.create({
      name,
      description,
      permissions: JSON.stringify(permissions || []),
      isActive: isActive ?? true
    });

    const json = created.toJSON();
    try {
      json.permissions = JSON.parse(json.permissions);
    } catch (e) {
      json.permissions = [];
    }
    return response.status(201).json(json);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (request, response) => {
  const { id } = request.params as { id: string };
  const { name, description, permissions, isActive } = request.body as any;

  try {
    const role = await Role.findByPk(id);
    if (!role) return response.status(404).json({ error: 'Rol no encontrado.' });

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (permissions !== undefined) updateData.permissions = JSON.stringify(permissions);

    await role.update(updateData);

    const json = role.toJSON();
    try {
      json.permissions = JSON.parse(json.permissions);
    } catch (e) {
      json.permissions = [];
    }
    return response.json(json);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (request, response) => {
  const { id } = request.params as { id: string };

  try {
    const role = await Role.findByPk(id, { include: ['users'] });
    if (!role) return response.status(404).json({ error: 'Rol no encontrado.' });

    const users = (role as any).users || [];
    if (users.length > 0) {
      return response.status(400).json({ error: 'No se puede eliminar porque tiene usuarios asignados.' });
    }

    await role.destroy();
    return response.json({ message: 'Rol eliminado correctamente.' });
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

export default router;
