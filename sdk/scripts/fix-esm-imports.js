const fs = require('fs');
const path = require('path');

const esmDir = path.resolve(__dirname, '..', 'dist', 'esm');

function fixImports(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      fixImports(fullPath);
    } else if (entry.name.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      content = content.replace(
        /((?:from|import)\s+['"])(\.\.?\/[^'"]+)(?<!\.js)(['"])/g,
        (match, prefix, importPath, suffix) => {
          const resolved = path.resolve(dir, importPath);
          if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            return `${prefix}${importPath}/index.js${suffix}`;
          }
          return `${prefix}${importPath}.js${suffix}`;
        }
      );
      fs.writeFileSync(fullPath, content);
    }
  }
}

fixImports(esmDir);
