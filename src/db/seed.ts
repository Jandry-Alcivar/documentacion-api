import {
  sequelize,
  Role,
  Department,
  ProcedureType,
  DocumentType,
  User,
  AllowedFileType,
  Template,
  Document,
  DocumentAlert,
  DocumentHistory,
  Procedure,
  AuditLog,
  Workflow,
  WorkflowNode
} from '../models/index.js';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('Iniciando la siembra (seed) de la base de datos con Sequelize - Distrito Chone...');

  // 1. Limpiar base de datos
  await WorkflowNode.destroy({ where: {} });
  await Workflow.destroy({ where: {} });
  await DocumentAlert.destroy({ where: {} });
  await DocumentHistory.destroy({ where: {} });
  await Document.destroy({ where: {} });
  await Procedure.destroy({ where: {} });
  await AuditLog.destroy({ where: {} });
  await User.destroy({ where: {} });
  await Department.destroy({ where: {} });
  await Role.destroy({ where: {} });
  await ProcedureType.destroy({ where: {} });
  await DocumentType.destroy({ where: {} });
  await Template.destroy({ where: {} });
  await AllowedFileType.destroy({ where: {} });

  // 2. Crear Roles
  const rolesData = [
    { name: 'Administrador', description: 'Rol con acceso total al sistema.', permissions: JSON.stringify(['all']) },
    { name: 'Alcalde', description: 'Rol de Máxima Autoridad.', permissions: JSON.stringify(['all']) },
    { name: 'Director Departamental', description: 'Responsable de revisión, aprobación y seguimiento de trámites y documentos.', permissions: JSON.stringify(['dashboard.view', 'procedures.view', 'procedures.manage', 'documents.view', 'documents.manage', 'users.view', 'alerts.view', 'alerts.view.department', 'audit-logs.view']) },
    { name: 'Funcionario', description: 'Funcionario encargado de registrar y gestionar trámites y documentos.', permissions: JSON.stringify(['dashboard.view', 'procedures.create', 'procedures.view', 'documents.view', 'documents.create']) },
    { name: 'Recepción Documental', description: 'Funcionario encargado de registrar trámites y documentos iniciales.', permissions: JSON.stringify(['dashboard.view', 'procedures.create', 'procedures.view']) },
    { name: 'Auditor', description: 'Usuario autorizado para consultar bitácoras, reportes e integridad documental.', permissions: JSON.stringify(['dashboard.view', 'reports.view', 'logs.view', 'audit-logs.view']) },
  ];

  const roles: any = {};
  for (const r of rolesData) {
    roles[r.name] = await Role.create(r);
  }
  console.log('Roles creados.');

  // 3. Crear Departamentos
  const deptoTech = await Department.create({ name: 'Tecnología', description: 'Departamento responsable de la administración tecnológica institucional.' });
  const deptoFinanciero = await Department.create({ name: 'Finanzas', description: 'Administración financiera de la institución.' });
  const deptoGeneral = await Department.create({ name: 'Dirección General', description: 'Máxima autoridad.' });
  const deptoRRHH = await Department.create({ name: 'Recursos Humanos', description: 'Gestión de talento humano.' });
  console.log('Departamentos creados.');

  // 4. Crear Tipos de Trámite
  const procTypesData = [
    { name: 'Permiso municipal', description: 'Gestión de permisos municipales según área responsable.', estimatedDays: 15 },
    { name: 'Solicitud administrativa', description: 'Trámite general solicitado por un ciudadano o funcionario.', estimatedDays: 5 },
    { name: 'Certificación institucional', description: 'Emisión de certificados o constancias institucionales.', estimatedDays: 3 },
    { name: 'Reclamo ciudadano', description: 'Registro y seguimiento de reclamos ciudadanos.', estimatedDays: 10 },
    { name: 'Informe técnico', description: 'Solicitud o emisión de informes técnicos internos.', estimatedDays: 7 },
  ];
  for (const pt of procTypesData) {
    await ProcedureType.create(pt);
  }
  console.log('Tipos de trámite creados.');

  // 5. Crear Tipos de Documento
  const docTypesData = [
    { name: 'Oficio', description: 'Documento formal para comunicación municipal.' },
    { name: 'Memorando', description: 'Documento interno para comunicación administrativa.' },
    { name: 'Informe', description: 'Documento técnico o administrativo con resultados o análisis.' },
    { name: 'Resolución', description: 'Documento oficial de decisión institucional.' },
    { name: 'Acta', description: 'Documento que registra acuerdos, reuniones o constataciones.' },
    { name: 'Certificado', description: 'Documento que acredita información institucional.' },
    { name: 'QUEJA', description: 'Reclamos y quejas formales de ciudadanos o funcionarios.' },
    { name: 'RENUNCIA', description: 'Renuncias formales de funcionarios.' },
  ];
  const docTypes: any = {};
  for (const dt of docTypesData) {
    docTypes[dt.name] = await DocumentType.create(dt);
  }
  console.log('Tipos de documento creados.');

  // 6. Crear Usuarios Semilla
  const defaultPassword = await bcrypt.hash('password123', 10);

  const usersData = [
    { email: 'admin@gob.gob', name: 'Administrador Sistema', roleId: roles['Administrador'].id, departmentId: deptoTech.id },
    { email: 'alcalde@gob.gob', name: 'Alcalde Chone', roleId: roles['Alcalde'].id, departmentId: deptoGeneral.id },
    { email: 'lider.rrhh@gob.gob', name: 'Director Recursos Humanos', roleId: roles['Director Departamental'].id, departmentId: deptoRRHH.id },
    { email: 'empleado.rrhh@gob.gob', name: 'Funcionario Recursos Humanos', roleId: roles['Funcionario'].id, departmentId: deptoRRHH.id },
    { email: 'lider.tech@gob.gob', name: 'Director TI', roleId: roles['Director Departamental'].id, departmentId: deptoTech.id },
    { email: 'empleado.tech@gob.gob', name: 'Funcionario TI', roleId: roles['Funcionario'].id, departmentId: deptoTech.id },
    { email: 'lider.finanzas@gob.gob', name: 'Director Finanzas', roleId: roles['Director Departamental'].id, departmentId: deptoFinanciero.id },
    { email: 'empleado.finanzas@gob.gob', name: 'Funcionario Finanzas', roleId: roles['Funcionario'].id, departmentId: deptoFinanciero.id },
  ];

  for (const u of usersData) {
    await User.create({
      email: u.email,
      name: u.name,
      password: defaultPassword,
      roleId: u.roleId,
      departmentId: u.departmentId,
      isActive: true,
    });
  }
  console.log('Usuarios semilla creados.');

  // 7. Tipos de Archivos
  const extensions = ['.docx', '.xlsx', '.pdf'];
  for (const ext of extensions) {
    await AllowedFileType.create({ extension: ext, isActive: true });
  }

  // 8. Plantillas
  const uploadDir = path.join(__dirname, '..', '..', 'uploads');
  const templateDir = path.join(uploadDir, 'templates');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  if (!fs.existsSync(templateDir)) fs.mkdirSync(templateDir, { recursive: true });

  const templatesInfo = [
    { name: 'Plantilla Oficial de Oficio', typeName: 'Oficio', filename: 'plantilla_oficio.docx', description: 'Documento Word base con membrete.' },
    { name: 'Plantilla de Memorando Interno', typeName: 'Memorando', filename: 'plantilla_memorando.docx', description: 'Documento Word estructurado.' },
  ];

  for (const temp of templatesInfo) {
    const filePath = path.join(templateDir, temp.filename);
    fs.writeFileSync(filePath, 'Contenido de prueba', 'utf8');
    const relativeUrl = `/uploads/templates/${temp.filename}`;
    await Template.create({
      name: temp.name,
      typeId: docTypes[temp.typeName].id,
      fileUrl: relativeUrl,
      description: temp.description,
    });
  }
  console.log('Plantillas creadas.');
  console.log('Siembra exitosa.');
}

sequelize.authenticate()
  .then(() => main())
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await sequelize.close(); });
