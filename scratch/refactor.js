const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'routes', 'documents.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Imports
content = content.replace(/import { Role, DocCategory, DocStatus, Prisma } from '@prisma\/client';/, "import { DocStatus, Prisma } from '@prisma/client';");

// user.role checks
content = content.replace(/user\.role === Role\.EMPLOYEE/g, "user.roleName === 'Funcionario'");
content = content.replace(/user\.role === Role\.LEADER/g, "user.roleName === 'Director Departamental'");
content = content.replace(/user\.role === Role\.MAYOR/g, "user.permissions.includes('all') /* TODO: fix mayor role */");
content = content.replace(/user\.role === Role\.ADMIN/g, "user.permissions.includes('all')");

content = content.replace(/user\.role !== Role\.EMPLOYEE/g, "user.roleName !== 'Funcionario'");
content = content.replace(/user\.role !== Role\.LEADER/g, "user.roleName !== 'Director Departamental'");
content = content.replace(/user\.role !== Role\.MAYOR/g, "!user.permissions.includes('all')");
content = content.replace(/user\.role !== Role\.ADMIN/g, "!user.permissions.includes('all')");

// Category replacements
content = content.replace(/category: DocCategory/g, "typeId: string");
content = content.replace(/category:/g, "typeId:");
content = content.replace(/doc\.category/g, "doc.typeId");
content = content.replace(/DocCategory\.QUEJA/g, "'QUEJA'");
content = content.replace(/DocCategory\.RENUNCIA/g, "'RENUNCIA'");

// Fix TS2322: Type '"RESPONDED"' is not assignable to type '"APPROVED"'
content = content.replace(/status: 'RESPONDED'/g, "status: DocStatus.RESPONDED"); // might not be correct but let's see

fs.writeFileSync(filePath, content, 'utf8');
console.log('Refactored documents.ts');
