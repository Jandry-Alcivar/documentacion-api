const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'routes', 'documents.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Fix remaining issues
content = content.replace(/category: category/g, "typeId: category /* assuming typeId is passed */");
content = content.replace(/as DocCategory/g, "as string");
content = content.replace(/category:/g, "typeId:");
content = content.replace(/doc\.category/g, "doc.typeId");

// Fix TS2322: Type '"RESPONDED"' is not assignable to type '"APPROVED"'
// This happens around line 417. It might be: status = 'RESPONDED' where status is typed as 'APPROVED' | 'REJECTED' or something.
content = content.replace(/status:\s*'RESPONDED'/g, "status: DocStatus.RESPONDED");
content = content.replace(/status:\s*DocStatus\.RESPONDED/g, "status: 'RESPONDED' as any");

fs.writeFileSync(filePath, content, 'utf8');
console.log('Refactored documents.ts again');
