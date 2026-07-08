import { Router } from 'express';
import jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body as any;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son requeridos.' });
  }

  try {
    const user = await User.findOne({
      where: { email },
      include: ['department', 'role']
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    let permissions: string[] = [];
    try {
      permissions = JSON.parse(user.role.permissions);
    } catch(e) {}

    const secret = process.env.JWT_SECRET || 'super-secret-key-change-it-in-production-123456';

    // Generar JWT usando jsonwebtoken
    const token = jwt.sign({
      id: user.id,
      email: user.email,
      roleName: user.role.name,
      permissions,
      departmentId: user.departmentId,
      name: user.name
    }, secret);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        department: {
          id: user.department.id,
          name: user.department.name
        }
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Profile (Verificación de Token)
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user!.id, {
      include: ['department', 'role']
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: {
        id: user.department.id,
        name: user.department.name
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
