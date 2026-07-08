import { Sequelize, DataTypes, Model } from 'sequelize';

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:admin123@localhost:5432/doc_gestion_db';

export const sequelize = new Sequelize(dbUrl, {
  dialect: 'postgres',
  logging: false,
});

// TypeScript Enums matching the Prisma schema
export enum DocStatus {
  DRAFT = 'DRAFT',
  PENDING_LEADER = 'PENDING_LEADER',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PENDING_MAYOR = 'PENDING_MAYOR',
  SENT_TO_DEPT = 'SENT_TO_DEPT',
  ASSIGNED_TO_EMPLOYEE = 'ASSIGNED_TO_EMPLOYEE',
  RESPONDED = 'RESPONDED',
}

export enum ProcedureStatus {
  REGISTRADO = 'REGISTRADO',
  RECIBIDO = 'RECIBIDO',
  EN_REVISION = 'EN_REVISION',
  DERIVADO = 'DERIVADO',
  OBSERVADO = 'OBSERVADO',
  FINALIZADO = 'FINALIZADO',
  CERRADO = 'CERRADO',
  ARCHIVADO = 'ARCHIVADO',
}

export enum ProcedurePriority {
  BAJA = 'BAJA',
  NORMAL = 'NORMAL',
  ALTA = 'ALTA',
  URGENTE = 'URGENTE',
}

export enum TemplateScope {
  GLOBAL = 'GLOBAL',
  DEPARTMENT = 'DEPARTMENT',
}

// 1. Role Model
export class Role extends Model {
  declare id: string;
  declare name: string;
  declare description?: string | null;
  declare permissions: string; // JSON stringified array of permission keys
  declare isActive: boolean;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}
Role.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, unique: true, allowNull: false },
  description: { type: DataTypes.STRING, allowNull: true },
  permissions: { type: DataTypes.TEXT, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false }
}, { sequelize, tableName: 'Role', timestamps: true });

// 2. ProcedureType Model
export class ProcedureType extends Model {
  declare id: string;
  declare name: string;
  declare description?: string | null;
  declare estimatedDays: number;
  declare isActive: boolean;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}
ProcedureType.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, unique: true, allowNull: false },
  description: { type: DataTypes.STRING, allowNull: true },
  estimatedDays: { type: DataTypes.INTEGER, defaultValue: 0, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false }
}, { sequelize, tableName: 'ProcedureType', timestamps: true });

// 3. DocumentType Model
export class DocumentType extends Model {
  declare id: string;
  declare name: string;
  declare description?: string | null;
  declare isActive: boolean;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}
DocumentType.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, unique: true, allowNull: false },
  description: { type: DataTypes.STRING, allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false }
}, { sequelize, tableName: 'DocumentType', timestamps: true });

// 4. Department Model
export class Department extends Model {
  declare id: string;
  declare name: string;
  declare description?: string | null;
  declare isActive: boolean;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}
Department.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, unique: true, allowNull: false },
  description: { type: DataTypes.STRING, allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false }
}, { sequelize, tableName: 'Department', timestamps: true });

// 5. User Model
export class User extends Model {
  declare id: string;
  declare email: string;
  declare password: string;
  declare name: string;
  declare roleId: string;
  declare departmentId: string;
  declare isActive: boolean;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  // Associations
  declare role: any;
  declare department: any;
}
User.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  roleId: { type: DataTypes.UUID, allowNull: false },
  departmentId: { type: DataTypes.UUID, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false }
}, { sequelize, tableName: 'User', timestamps: true });

// 6. Procedure Model
export class Procedure extends Model {
  declare id: string;
  declare code: string;
  declare subject: string;
  declare description: string;
  declare priority: ProcedurePriority;
  declare status: ProcedureStatus;
  declare applicantName: string;
  declare applicantId?: string | null;
  declare applicantEmail?: string | null;
  declare applicantPhone?: string | null;
  declare expirationDate?: Date | null;
  declare typeId: string;
  declare departmentId: string;
  declare assigneeId?: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  // Associations
  declare type: any;
  declare department: any;
  declare assignee: any;
  declare documents: any[];
}
Procedure.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING, unique: true, allowNull: false },
  subject: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false },
  priority: { type: DataTypes.ENUM(...Object.values(ProcedurePriority)), defaultValue: ProcedurePriority.NORMAL, allowNull: false },
  status: { type: DataTypes.ENUM(...Object.values(ProcedureStatus)), defaultValue: ProcedureStatus.REGISTRADO, allowNull: false },
  applicantName: { type: DataTypes.STRING, allowNull: false },
  applicantId: { type: DataTypes.STRING, allowNull: true },
  applicantEmail: { type: DataTypes.STRING, allowNull: true },
  applicantPhone: { type: DataTypes.STRING, allowNull: true },
  expirationDate: { type: DataTypes.DATE, allowNull: true },
  typeId: { type: DataTypes.UUID, allowNull: false },
  departmentId: { type: DataTypes.UUID, allowNull: false },
  assigneeId: { type: DataTypes.UUID, allowNull: true }
}, { sequelize, tableName: 'Procedure', timestamps: true });

// 7. Document Model
export class Document extends Model {
  declare id: string;
  declare title: string;
  declare description: string;
  declare typeId?: string | null;
  declare procedureId?: string | null;
  declare status: DocStatus;
  declare tags: string[];
  declare fileUrl?: string | null;
  declare fileHash?: string | null;
  declare content?: string | null;
  declare isConfidential: boolean;
  declare creatorId: string;
  declare departmentId: string;
  declare targetDepartmentId?: string | null;
  declare currentAssigneeId?: string | null;
  declare parentId?: string | null;
  declare rejectionNotes?: string | null;
  declare deletedAt?: Date | null;
  declare deletedById?: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  // Associations
  declare type: any;
  declare procedure: any;
  declare creator: any;
  declare department: any;
  declare currentAssignee: any;
  declare parent: any;
  declare replies: any[];
  declare history: any[];
  declare alerts: any[];
}
Document.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false },
  typeId: { type: DataTypes.UUID, allowNull: true },
  procedureId: { type: DataTypes.UUID, allowNull: true },
  status: { type: DataTypes.ENUM(...Object.values(DocStatus)), defaultValue: DocStatus.DRAFT, allowNull: false },
  tags: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [], allowNull: false },
  fileUrl: { type: DataTypes.STRING, allowNull: true },
  fileHash: { type: DataTypes.STRING, allowNull: true },
  content: { type: DataTypes.TEXT, allowNull: true },
  isConfidential: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
  creatorId: { type: DataTypes.UUID, allowNull: false },
  departmentId: { type: DataTypes.UUID, allowNull: false },
  targetDepartmentId: { type: DataTypes.UUID, allowNull: true },
  currentAssigneeId: { type: DataTypes.UUID, allowNull: true },
  parentId: { type: DataTypes.UUID, allowNull: true },
  rejectionNotes: { type: DataTypes.TEXT, allowNull: true },
  deletedAt: { type: DataTypes.DATE, allowNull: true },
  deletedById: { type: DataTypes.STRING, allowNull: true }
}, { sequelize, tableName: 'Document', timestamps: true });

// 8. DocumentHistory Model
export class DocumentHistory extends Model {
  declare id: string;
  declare documentId: string;
  declare userId: string;
  declare action: string;
  declare fileHashBefore?: string | null;
  declare fileHashAfter?: string | null;
  declare changesDescription: string;
  declare readonly createdAt: Date;

  // Associations
  declare user: any;
  declare document: any;
}
DocumentHistory.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  documentId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  action: { type: DataTypes.STRING, allowNull: false },
  fileHashBefore: { type: DataTypes.STRING, allowNull: true },
  fileHashAfter: { type: DataTypes.STRING, allowNull: true },
  changesDescription: { type: DataTypes.TEXT, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, allowNull: false }
}, { sequelize, tableName: 'DocumentHistory', timestamps: false });

// 9. DocumentAlert Model
export class DocumentAlert extends Model {
  declare id: string;
  declare documentId: string;
  declare departmentId: string;
  declare userId: string;
  declare message: string;
  declare isRead: boolean;
  declare readonly createdAt: Date;

  // Associations
  declare user: any;
  declare document: any;
}
DocumentAlert.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  documentId: { type: DataTypes.UUID, allowNull: false },
  departmentId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  isRead: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, allowNull: false }
}, { sequelize, tableName: 'DocumentAlert', timestamps: false });

// 10. Template Model
export class Template extends Model {
  declare id: string;
  declare name: string;
  declare typeId?: string | null;
  declare scope: TemplateScope;
  declare fileUrl?: string | null;
  declare content?: string | null;
  declare description: string;
  declare readonly createdAt: Date;

  // Associations
  declare type: any;
}
Template.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  typeId: { type: DataTypes.UUID, allowNull: true },
  scope: { type: DataTypes.ENUM(...Object.values(TemplateScope)), defaultValue: TemplateScope.GLOBAL, allowNull: false },
  fileUrl: { type: DataTypes.STRING, allowNull: true },
  content: { type: DataTypes.TEXT, allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, allowNull: false }
}, { sequelize, tableName: 'Template', timestamps: false });

// 11. AuditLog Model
export class AuditLog extends Model {
  declare id: string;
  declare userId: string;
  declare module: string;
  declare action: string;
  declare recordId: string;
  declare ipAddress?: string | null;
  declare details?: string | null;
  declare readonly createdAt: Date;

  // Associations
  declare user: any;
}
AuditLog.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  module: { type: DataTypes.STRING, allowNull: false },
  action: { type: DataTypes.STRING, allowNull: false },
  recordId: { type: DataTypes.STRING, allowNull: false },
  ipAddress: { type: DataTypes.STRING, allowNull: true },
  details: { type: DataTypes.TEXT, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, allowNull: false }
}, { sequelize, tableName: 'AuditLog', timestamps: false });

// 12. AllowedFileType Model
export class AllowedFileType extends Model {
  declare id: string;
  declare extension: string;
  declare isActive: boolean;
}
AllowedFileType.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  extension: { type: DataTypes.STRING, unique: true, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false }
}, { sequelize, tableName: 'AllowedFileType', timestamps: false });

// Setup Model Associations

// Role <-> User
Role.hasMany(User, { foreignKey: 'roleId', as: 'users' });
User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });

// Department <-> User
Department.hasMany(User, { foreignKey: 'departmentId', as: 'users' });
User.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

// ProcedureType <-> Procedure
ProcedureType.hasMany(Procedure, { foreignKey: 'typeId', as: 'procedures' });
Procedure.belongsTo(ProcedureType, { foreignKey: 'typeId', as: 'type' });

// Department <-> Procedure
Department.hasMany(Procedure, { foreignKey: 'departmentId', as: 'procedures' });
Procedure.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

// User <-> Procedure (assignee)
User.hasMany(Procedure, { foreignKey: 'assigneeId', as: 'assignedProcedures' });
Procedure.belongsTo(User, { foreignKey: 'assigneeId', as: 'assignee' });

// DocumentType <-> Document
DocumentType.hasMany(Document, { foreignKey: 'typeId', as: 'documents' });
Document.belongsTo(DocumentType, { foreignKey: 'typeId', as: 'type' });

// Procedure <-> Document
Procedure.hasMany(Document, { foreignKey: 'procedureId', as: 'documents' });
Document.belongsTo(Procedure, { foreignKey: 'procedureId', as: 'procedure' });

// User (creator) <-> Document
User.hasMany(Document, { foreignKey: 'creatorId', as: 'createdDocs' });
Document.belongsTo(User, { foreignKey: 'creatorId', as: 'creator' });

// Department <-> Document
Department.hasMany(Document, { foreignKey: 'departmentId', as: 'documents' });
Document.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

// User (currentAssignee) <-> Document
User.hasMany(Document, { foreignKey: 'currentAssigneeId', as: 'assignedDocs' });
Document.belongsTo(User, { foreignKey: 'currentAssigneeId', as: 'currentAssignee' });

// Document (parentId self relation)
Document.belongsTo(Document, { foreignKey: 'parentId', as: 'parent' });
Document.hasMany(Document, { foreignKey: 'parentId', as: 'replies' });

// Document <-> DocumentHistory
Document.hasMany(DocumentHistory, { foreignKey: 'documentId', as: 'history', onDelete: 'CASCADE' });
DocumentHistory.belongsTo(Document, { foreignKey: 'documentId', as: 'document' });

// User <-> DocumentHistory
User.hasMany(DocumentHistory, { foreignKey: 'userId', as: 'history' });
DocumentHistory.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Document <-> DocumentAlert
Document.hasMany(DocumentAlert, { foreignKey: 'documentId', as: 'alerts', onDelete: 'CASCADE' });
DocumentAlert.belongsTo(Document, { foreignKey: 'documentId', as: 'document' });

// User <-> DocumentAlert
User.hasMany(DocumentAlert, { foreignKey: 'userId', as: 'alertsTriggered' });
DocumentAlert.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// DocumentType <-> Template
DocumentType.hasMany(Template, { foreignKey: 'typeId', as: 'templates' });
Template.belongsTo(DocumentType, { foreignKey: 'typeId', as: 'type' });

// User <-> AuditLog
User.hasMany(AuditLog, { foreignKey: 'userId', as: 'auditLogs' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });
