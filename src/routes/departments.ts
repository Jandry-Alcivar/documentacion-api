import { Router } from 'express';
import { Department, User } from '../models/index.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

// Listar departamentos
router.get('/', authenticate, async (request, response) => {
  try {
    const departments = await Department.findAll({
      order: [['name', 'ASC']],
    });
    return response.json(departments);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// Obtener usuarios de un departamento
router.get('/:id/users', authenticate, async (request, response) => {
  const { id } = request.params;
  try {
    const users = await User.findAll({
      where: { departmentId: id, isActive: true },
      attributes: ['id', 'name', 'email'],
      include: [
        { association: 'role', attributes: ['name'] }
      ],
      order: [['name', 'ASC']],
    });
    return response.json(users);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// Crear departamento
router.post('/', authenticate, requirePermission(['departments.manage', 'all']), async (request, response) => {
  const { name, description } = request.body as any;

  if (!name) {
    return response.status(400).json({ error: 'El nombre del departamento es requerido.' });
  }

  try {
    const exists = await Department.findOne({ where: { name } });
    if (exists) {
      return response.status(400).json({ error: 'Ya existe un departamento con ese nombre.' });
    }

    const department = await Department.create({ name, description });
    return response.status(201).json(department);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// Actualizar departamento
router.put('/:id', authenticate, requirePermission(['departments.manage', 'all']), async (request, response) => {
  const id = request.params.id as string;
  const { name, description } = request.body as any;

  try {
    const department = await Department.findByPk(id);
    if (!department) return response.status(404).json({ error: 'Departamento no encontrado.' });

    await department.update({ name, description });
    return response.json(department);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// Eliminar departamento
router.delete('/:id', authenticate, requirePermission(['departments.manage', 'all']), async (request, response) => {
  const id = request.params.id as string;

  try {
    const department = await Department.findByPk(id, { include: ['users'] });
    if (!department) return response.status(404).json({ error: 'Departamento no encontrado.' });

    const users = (department as any).users || [];
    if (users.length > 0) {
      return response.status(400).json({ error: 'No se puede eliminar porque tiene usuarios asignados.' });
    }

    await department.destroy();
    return response.json({ message: 'Departamento eliminado correctamente.' });
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

export default router;
