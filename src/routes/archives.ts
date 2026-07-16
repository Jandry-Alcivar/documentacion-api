import { Router } from 'express';
import { Warehouse, Sector, Section, Procedure, Period, AuditLog } from '../models/index.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

// --- BODEGAS, SECTORES, SECCIONES ---

// Listar bodegas con sus sectores y secciones
router.get('/warehouses', async (req, res) => {
  try {
    const warehouses = await Warehouse.findAll({
      include: [
        {
          association: 'sectors',
          include: [{ association: 'sections' }]
        }
      ],
      order: [['name', 'ASC']]
    });
    return res.json(warehouses);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Crear bodega
router.post('/warehouses', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  const { name, location, type } = req.body as any;
  if (!name || !location) return res.status(400).json({ error: 'Nombre y ubicación son obligatorios.' });

  try {
    const created = await Warehouse.create({ name, location, type: type || 'GENERAL' });
    return res.status(201).json(created);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Actualizar bodega
router.put('/warehouses/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const warehouse = await Warehouse.findByPk(req.params.id as string);
    if (!warehouse) return res.status(404).json({ error: 'Bodega no encontrada.' });
    await warehouse.update(req.body);
    return res.json(warehouse);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Eliminar bodega
router.delete('/warehouses/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const warehouse = await Warehouse.findByPk(req.params.id as string);
    if (!warehouse) return res.status(404).json({ error: 'Bodega no encontrada.' });
    await warehouse.destroy();
    return res.json({ message: 'Bodega eliminada.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Crear sector
router.post('/sectors', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  const { name, warehouseId } = req.body as any;
  if (!name || !warehouseId) return res.status(400).json({ error: 'Nombre y bodega son obligatorios.' });

  try {
    const created = await Sector.create({ name, warehouseId });
    return res.status(201).json(created);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Actualizar sector
router.put('/sectors/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const sector = await Sector.findByPk(req.params.id as string);
    if (!sector) return res.status(404).json({ error: 'Sector no encontrado.' });
    await sector.update(req.body);
    return res.json(sector);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Eliminar sector
router.delete('/sectors/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const sector = await Sector.findByPk(req.params.id as string);
    if (!sector) return res.status(404).json({ error: 'Sector no encontrado.' });
    await sector.destroy();
    return res.json({ message: 'Sector eliminado.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Crear sección
router.post('/sections', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  const { name, sectorId } = req.body as any;
  if (!name || !sectorId) return res.status(400).json({ error: 'Nombre y sector son obligatorios.' });

  try {
    const created = await Section.create({ name, sectorId });
    return res.status(201).json(created);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Actualizar sección
router.put('/sections/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const section = await Section.findByPk(req.params.id as string);
    if (!section) return res.status(404).json({ error: 'Sección no encontrada.' });
    await section.update(req.body);
    return res.json(section);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Eliminar sección
router.delete('/sections/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const section = await Section.findByPk(req.params.id as string);
    if (!section) return res.status(404).json({ error: 'Sección no encontrada.' });
    await section.destroy();
    return res.json({ message: 'Sección eliminada.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// --- ARCHIVADO FÍSICO DE TRÁMITES ---

// Archivar físicamente un trámite finalizado
router.post('/finalize-physical', async (req, res) => {
  const { procedureId, warehouseId, sectorId, sectionId, folderCode } = req.body as any;

  if (!procedureId || !warehouseId || !sectorId || !sectionId || !folderCode) {
    return res.status(400).json({ error: 'Todos los campos de localización física son obligatorios.' });
  }

  try {
    const procedure = await Procedure.findByPk(procedureId);
    if (!procedure) return res.status(404).json({ error: 'Trámite no encontrado.' });
    if (procedure.status !== 'FINALIZADO') {
      return res.status(400).json({ error: 'Solo se pueden archivar físicamente trámites finalizados.' });
    }

    await procedure.update({
      warehouseId,
      sectorId,
      sectionId,
      folderCode,
      status: 'ARCHIVADO' // Actualizar estado a ARCHIVADO
    });

    await AuditLog.create({
      userId: req.user!.id,
      module: 'Archivo',
      action: 'Archivado Físico',
      recordId: procedure.id,
      ipAddress: req.ip || '127.0.0.1',
      details: `Trámite ${procedure.code} archivado en Bodega ID ${warehouseId}, Carpeta: ${folderCode}`
    });

    return res.json({ message: 'Trámite archivado físicamente.', procedure });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Listar trámites archivados
router.get('/list', async (req, res) => {
  try {
    const list = await Procedure.findAll({
      where: { status: 'ARCHIVADO' },
      include: [
        { association: 'type' },
        { association: 'department' },
        { association: 'warehouse' },
        { association: 'sector' },
        { association: 'section' }
      ],
      order: [['updatedAt', 'DESC']]
    });
    return res.json(list);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// --- GESTIÓN DE PERIODOS ---

// Listar periodos
router.get('/periods', async (req, res) => {
  try {
    const periods = await Period.findAll({ order: [['startDate', 'DESC']] });
    return res.json(periods);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Crear periodo
router.post('/periods', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  const { startDate, endDate, status } = req.body as any;
  if (!startDate || !endDate) return res.status(400).json({ error: 'Fechas de inicio y fin son obligatorias.' });

  try {
    const created = await Period.create({ startDate, endDate, status: status || 'ACTIVO' });
    return res.status(201).json(created);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Actualizar periodo
router.put('/periods/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const period = await Period.findByPk(req.params.id as string);
    if (!period) return res.status(404).json({ error: 'Periodo no encontrado.' });
    await period.update(req.body);
    return res.json(period);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Eliminar periodo
router.delete('/periods/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const period = await Period.findByPk(req.params.id as string);
    if (!period) return res.status(404).json({ error: 'Periodo no encontrado.' });
    await period.destroy();
    return res.json({ message: 'Periodo eliminado.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
