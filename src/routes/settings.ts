import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { getImmutabilityMode, setImmutabilityMode, isAdminUser, logAudit } from '../services/seal.js';

const router = Router();
router.use(authenticate);

router.get('/immutability', async (_req, res) => {
  try {
    return res.json({ mode: await getImmutabilityMode() });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.put('/immutability', async (req, res) => {
  const { mode } = req.body as any;
  if (!isAdminUser(req.user)) return res.status(403).json({ error: 'Solo el Administrador puede cambiar esta configuración.' });
  if (mode !== 'REOPEN' && mode !== 'LOCKED') return res.status(400).json({ error: 'Modo inválido.' });
  try {
    const previous = await getImmutabilityMode();
    await setImmutabilityMode(mode);
    await logAudit(req, 'CONFIG_CHANGE', 'immutability.mode', `Modo de inmutabilidad: ${previous} → ${mode}`);
    return res.json({ mode });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
