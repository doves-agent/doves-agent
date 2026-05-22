const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '交互式聊天.js');
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: sed corrupted line 122 - restore proper two-line format
content = content.replace(
  '  let fullResponseText = ""; let convId = conversationId;  // 声明在 try 外，确保 catch 块可访问',
  '  let fullResponseText = \'\';\r\n  let convId = conversationId;  // 声明在 try 外，确保 catch 块可访问'
);

// Fix 2: change const convId to convId (assignment) so it uses the outer let
content = content.replace(
  '    const convId = result.conversationId || conversationId;',
  '    convId = result.conversationId || conversationId;'
);

fs.writeFileSync(filePath, content);
console.log('Fixed: convId declaration and assignment');
