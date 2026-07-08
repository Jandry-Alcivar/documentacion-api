import { Router } from 'express';
import * as bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { User, Department, Role } from '../models/index.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);
router.use(requirePermission(['users.view', 'users.manage', 'all']));

// Listar usuarios
router.get('/', async (request, response) => {
  try {
    const users = await User.findAll({
      include: [
        { association: 'department', attributes: ['name'] },
        { association: 'role', attributes: ['name'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    const result = users.map(u => {
      const json = u.toJSON();
      delete json.password;
      return json;
    });
    return response.json(result);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// Crear usuario
router.post('/', requirePermission(['users.manage', 'all']), async (request, response) => {
  const { email, name, password, roleId, departmentId } = request.body as any;

  if (!email || !name || !password || !roleId || !departmentId) {
    return response.status(400).json({ error: 'Faltan campos requeridos.' });
  }

  try {
    const exists = await User.findOne({ where: { email } });
    if (exists) {
      return response.status(400).json({ error: 'El correo electrónico ya está registrado.' });
    }

    const depto = await Department.findByPk(departmentId);
    if (!depto) return response.status(404).json({ error: 'El departamento especificado no existe.' });

    const role = await Role.findByPk(roleId);
    if (!role) return response.status(404).json({ error: 'El rol especificado no existe.' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      name,
      password: hashedPassword,
      roleId,
      departmentId,
      isActive: true
    });

    const resultUser = await User.findByPk(user.id, {
      include: ['department', 'role']
    });

    const json = resultUser!.toJSON();
    delete json.password;
    return response.status(201).json(json);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// Actualizar usuario
router.put('/:id', requirePermission(['users.manage', 'all']), async (request, response) => {
  const id = request.params.id as string;
  const { email, name, roleId, departmentId, isActive, password } = request.body as any;

  try {
    const user = await User.findByPk(id);
    if (!user) return response.status(404).json({ error: 'Usuario no encontrado.' });

    const updateData: any = {};
    if (email) {
      const exists = await User.findOne({ where: { email, id: { [Op.ne]: id } } });
      if (exists) return response.status(400).json({ error: 'El correo electrónico ya está registrado por otro usuario.' });
      updateData.email = email;
    }
    if (name !== undefined) updateData.name = name;
    if (roleId) {
      const role = await Role.findByPk(roleId);
      if (!role) return response.status(404).json({ error: 'El rol especificado no existe.' });
      updateData.roleId = roleId;
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) updateData.password = await bcrypt.hash(password, 10);
    if (departmentId) {
      const depto = await Department.findByPk(departmentId);
      if (!depto) return response.status(404).json({ error: 'El departamento especificado no existe.' });
      updateData.departmentId = departmentId;
    }

    await user.update(updateData);

    const updatedUser = await User.findByPk(id, {
      include: ['department', 'role']
    });

    const json = updatedUser!.toJSON();
    delete json.password;
    return response.json(json);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// Eliminar usuario (Desactivar)
router.delete('/:id', requirePermission(['users.manage', 'all']), async (request, response) => {
  const id = request.params.id as string;

  try {
    const user = await User.findByPk(id);
    if (!user) return response.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.id === request.user!.id) return response.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });

    await user.update({ isActive: false });

    return response.json({ message: 'Usuario inactivado correctamente.' });
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

export default router;
