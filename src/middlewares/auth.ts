import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        roleName: string;
        permissions: string[];
        departmentId: string;
        name: string;
      };
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado. Token inválido o ausente.' });
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET || 'super-secret-key-change-it-in-production-123456';

  try {
    const decoded = jwt.verify(token, secret) as any;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'No autorizado. Token inválido o expirado.' });
  }
};

export const requirePermission = (allowedPermissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'No autorizado.' });
    }

    const userPermissions = user.permissions || [];
    if (userPermissions.includes('all')) {
      return next(); // Admin bypass
    }

    const hasPermission = allowedPermissions.some(p => userPermissions.includes(p));
    if (!hasPermission) {
      return res.status(403).json({ 
        error: 'Acceso prohibido. No tienes los privilegios necesarios para realizar esta acción.' 
      });
    }

    next();
  };
};
